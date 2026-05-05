// services/whatsapp.js
// Nexus Digital Solutions — WhatsApp Service
// OpenClaw Multi-Channel Support (1 Web + 2 Desktop)

require('dotenv').config();
const { summarizeMeeting, askOpsBot, generateDailyReport } = require('./ai');
const { createTask, getTasks, getOverdueTasks } = require('./asana');

// ===== CONFIG: 3-Channel Setup =====
const CHANNELS = {
  business: {
    enabled: process.env.OPENCLAW_CHANNEL_1_ENABLED === 'true',
    mode: process.env.OPENCLAW_CHANNEL_1_MODE || 'web',
    name: process.env.OPENCLAW_CHANNEL_1_NAME || 'business',
    number: process.env.OPENCLAW_CHANNEL_1_NUMBER,
    sessionPath: process.env.OPENCLAW_CHANNEL_1_SESSION_PATH
  },
  personal1: {
    enabled: process.env.OPENCLAW_CHANNEL_2_ENABLED === 'true',
    mode: process.env.OPENCLAW_CHANNEL_2_MODE || 'desktop',
    name: process.env.OPENCLAW_CHANNEL_2_NAME || 'personal1',
    number: process.env.OPENCLAW_CHANNEL_2_NUMBER,
    sessionPath: process.env.OPENCLAW_CHANNEL_2_SESSION_PATH
  },
  personal2: {
    enabled: process.env.OPENCLAW_CHANNEL_3_ENABLED === 'true',
    mode: process.env.OPENCLAW_CHANNEL_3_MODE || 'desktop',
    name: process.env.OPENCLAW_CHANNEL_3_NAME || 'personal2',
    number: process.env.OPENCLAW_CHANNEL_3_NUMBER,
    sessionPath: process.env.OPENCLAW_CHANNEL_3_SESSION_PATH
  }
};

const WEBHOOK_SECRET = process.env.WHATSAPP_WEBHOOK_SECRET || 'nexus-default-secret';
const ALLOW_FROM = (process.env.WHATSAPP_ALLOW_FROM || '')
  .split(',')
  .map(n => n.trim())
  .filter(n => n);

// ===== HELPER: Check authorization =====
function isAuthorized(number) {
  if (!number) return false;
  const normalized = number.startsWith('+') ? number : `+${number}`;
  return ALLOW_FROM.includes(normalized) || ALLOW_FROM.includes(number);
}

// ===== HELPER: Normalize phone number =====
function normalizeNumber(number) {
  if (!number) return '';
  return number.startsWith('+') ? number : `+${number}`;
}

// ===== HELPER: Identify channel from number =====
function getChannelByNumber(number) {
  const normalized = normalizeNumber(number);
  if (normalized === normalizeNumber(CHANNELS.business.number)) return 'business';
  if (normalized === normalizeNumber(CHANNELS.personal1.number)) return 'personal1';
  if (normalized === normalizeNumber(CHANNELS.personal2.number)) return 'personal2';
  return 'business'; // Default to business if not matched
}

// ===== HELPER: Get channel display name =====
function getChannelDisplayName(channel) {
  const names = {
    business: '🏢 Business',
    personal1: '👤 Personal 1',
    personal2: '👤 Personal 2'
  };
  return names[channel] || '📱 WhatsApp';
}

// ===== CORE: Process incoming WhatsApp message =====
async function processIncoming(from, body, channel = null) {
  const detectedChannel = channel || getChannelByNumber(from);
  const channelLabel = getChannelDisplayName(detectedChannel);
  
  console.log(`[WhatsApp/${channelLabel}] Received from ${from}: ${body.slice(0, 100)}...`);

  // Security check
  if (!isAuthorized(from)) {
    console.warn(`[WhatsApp] Unauthorized attempt from ${from}`);
    return { success: false, error: 'Unauthorized' };
  }

  const normalizedFrom = normalizeNumber(from);

  try {
    const trimmedBody = body.trim();
    
    // Command routing
    if (trimmedBody.toLowerCase() === 'help') {
      return await sendHelpMessage(normalizedFrom, detectedChannel);
    }
    
    if (trimmedBody.toLowerCase() === 'tasks') {
      return await sendTasksList(normalizedFrom);
    }
    
    if (trimmedBody.toLowerCase().startsWith('meeting:')) {
      const transcript = trimmedBody.substring(8).trim();
      return await processMeetingCommand(normalizedFrom, transcript);
    }
    
    if (trimmedBody.toLowerCase().startsWith('report')) {
      return await sendDailyReport(normalizedFrom);
    }
    
    // Default: treat as AI question
    return await handleAIQuestion(normalizedFrom, trimmedBody);
    
  } catch (error) {
    console.error(`[WhatsApp/${channelLabel}] Process error:`, error.message);
    return await sendMessage(normalizedFrom, `⚠️ Error: ${error.message}\n\nType 'help' for available commands.`, detectedChannel);
  }
}

// ===== COMMAND: Help (Channel-aware) =====
async function sendHelpMessage(to, channel) {
  const channelLabel = getChannelDisplayName(channel);
  
  const helpText = `🤖 *Nexus Ops Engine — ${channelLabel}*

*Available Commands:*

📋 *tasks* — View all open tasks and overdue items

🎙️ *meeting: [notes]* — AI analyzes meeting, extracts tasks
Example: meeting: Called Juicyway today. Waiting on Q1 Q2 rates. Sid said needs $2M off-ramped.

📊 *report* — Get daily ops report

💬 *[any question]* — Ask AI anything about Nexus ops
Example: What's overdue? Summarize today's progress.

*Channel:* ${channelLabel}
*Powered by OpenClaw + Nexus AI*`;

  return await sendMessage(to, helpText, channel);
}

// ===== COMMAND: Tasks List =====
async function sendTasksList(to) {
  try {
    const tasks = await getTasks();
    const overdue = await getOverdueTasks();
    
    if (!tasks.length) {
      return await sendMessage(to, '✅ No open tasks — you\'re clear!');
    }
    
    const today = new Date().toISOString().split('T')[0];
    let message = `📋 *Open Tasks (${tasks.length})*\n\n`;
    
    if (overdue.length > 0) {
      message += `⚠️ *Overdue (${overdue.length})*\n`;
      overdue.slice(0, 5).forEach(t => {
        message += `• ${t.name}\n  Due: ${t.due_on}\n`;
      });
      if (overdue.length > 5) message += `  ...and ${overdue.length - 5} more\n`;
      message += '\n';
    }
    
    message += `📌 *Recent Tasks*\n`;
    tasks.slice(0, 10).forEach(t => {
      const isOverdue = t.due_on && t.due_on < today;
      const icon = isOverdue ? '⚠️' : '📌';
      message += `${icon} ${t.name}\n`;
      if (t.due_on) message += `   Due: ${t.due_on}\n`;
    });
    
    return await sendMessage(to, message);
  } catch (error) {
    console.error('[WhatsApp] Tasks error:', error.message);
    return await sendMessage(to, '❌ Failed to fetch tasks. Try again.');
  }
}

// ===== COMMAND: Meeting Analysis =====
async function processMeetingCommand(to, transcript) {
  if (!transcript || transcript.length < 10) {
    return await sendMessage(to, '❌ Please provide meeting notes after "meeting:"\n\nExample: meeting: Called Juicyway today. Waiting on Q1 Q2 rates.');
  }
  
  try {
    await sendMessage(to, '🤖 Analyzing meeting notes...\n\nExtracting:\n• Summary & decisions\n• Action items with owners\n• Blockers & next steps\n\nTasks will be auto-created in Asana.', 'business');
    
    const result = await summarizeMeeting(transcript, 'WhatsApp Meeting');
    
    let response = `✅ *Meeting Analyzed*\n\n`;
    response += `📋 *Summary*\n${result.summary}\n\n`;
    
    if (result.decisions?.length > 0) {
      response += `✅ *Decisions*\n${result.decisions.map(d => `• ${d}`).join('\n')}\n\n`;
    }
    
    if (result.tasks?.length > 0) {
      response += `📌 *Tasks Created in Asana (${result.tasks.length})*\n`;
      result.tasks.forEach(t => {
        response += `• ${t.task}\n  Owner: ${t.owner || 'Unassigned'}`;
        if (t.deadline) response += ` | Due: ${t.deadline}`;
        response += '\n';
      });
      response += '\n';
    }
    
    if (result.blockers?.length > 0) {
      response += `🚨 *Blockers*\n${result.blockers.map(b => `• ${b}`).join('\n')}\n\n`;
    }
    
    response += `_Powered by Nexus AI Ops Engine_`;
    
    return await sendMessage(to, response);
    
  } catch (error) {
    console.error('[WhatsApp] Meeting analysis error:', error.message);
    return await sendMessage(to, `❌ Failed to analyze meeting: ${error.message}`);
  }
}

// ===== COMMAND: Daily Report =====
async function sendDailyReport(to) {
  try {
    const tasks = await getTasks();
    const overdue = await getOverdueTasks();
    const report = await generateDailyReport(tasks, [], overdue);
    
    let message = `📊 *Nexus Daily Report*\n\n`;
    message += `*${report.headline}*\n\n`;
    message += `${report.progress}\n\n`;
    
    if (report.urgent?.length > 0) {
      message += `🚨 *Urgent*\n${report.urgent.map(u => `• ${u}`).join('\n')}\n\n`;
    }
    
    if (report.tomorrow?.length > 0) {
      message += `➡️ *Tomorrow*\n${report.tomorrow.map(t => `• ${t}`).join('\n')}\n\n`;
    }
    
    message += `📈 *Health Score: ${report.healthScore}/10*\n`;
    message += `\n_Open tasks: ${tasks.length} | Overdue: ${overdue.length}_`;
    
    return await sendMessage(to, message);
    
  } catch (error) {
    console.error('[WhatsApp] Report error:', error.message);
    return await sendMessage(to, '❌ Failed to generate report.');
  }
}

// ===== DEFAULT: AI Question =====
async function handleAIQuestion(to, question) {
  try {
    const tasks = await getTasks();
    const overdue = await getOverdueTasks();
    
    const answer = await askOpsBot(question, {
      openTasks: tasks.length,
      overdueTasks: overdue.length,
      askedVia: 'WhatsApp'
    });
    
    const chunks = chunkMessage(answer);
    for (const chunk of chunks) {
      await sendMessage(to, chunk);
    }
    
    return { success: true };
    
  } catch (error) {
    console.error('[WhatsApp] AI question error:', error.message);
    return await sendMessage(to, `❌ AI error: ${error.message}`);
  }
}

// ===== HELPER: Send WhatsApp Message (OpenClaw API) =====
async function sendMessage(to, text, channel = 'business') {
  const channelLabel = getChannelDisplayName(channel);
  console.log(`[WhatsApp/${channelLabel}] Sending to ${to}: ${text.slice(0, 100)}...`);
  
  try {
    const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:3000';
    const channelName = CHANNELS[channel]?.name || 'business';
    
    const res = await require('axios').post(`${gatewayUrl}/api/channels/whatsapp/send`, {
      to,
      text,
      type: 'text',
      channel: channelName
    }, {
      headers: {
        'Authorization': `Bearer ${WEBHOOK_SECRET}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`[WhatsApp/${channelLabel}] Message sent successfully`);
    return { success: true, messageId: res.data?.messageId };
    
  } catch (error) {
    console.error(`[WhatsApp/${channelLabel}] Send error:`, error.message);
    return { success: false, error: error.message };
  }
}

// ===== HELPER: Chunk long messages =====
function chunkMessage(text, maxLength = 4000) {
  if (text.length <= maxLength) return [text];
  
  const chunks = [];
  let remaining = text;
  
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    let breakPoint = remaining.lastIndexOf('\n\n', maxLength);
    if (breakPoint === -1) breakPoint = remaining.lastIndexOf('. ', maxLength);
    if (breakPoint === -1) breakPoint = maxLength;
    
    chunks.push(remaining.slice(0, breakPoint).trim());
    remaining = remaining.slice(breakPoint).trim();
  }
  
  return chunks;
}

// ===== WEBHOOK: OpenClaw inbound handler =====
async function handleWebhook(req, res) {
  try {
    const { from, body, type, channel } = req.body;
    
    if (type !== 'message' || !from || !body) {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }
    
    // Process async, respond immediately
    processIncoming(from, body, channel).catch(err => {
      console.error('[Webhook] Process error:', err.message);
    });
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('[Webhook] Handler error:', error.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

// ===== EXPORTS =====
module.exports = { 
  processIncoming, 
  handleWebhook, 
  sendMessage,
  isAuthorized,
  normalizeNumber,
  getChannelByNumber,
  getChannelDisplayName,
  CHANNELS
};
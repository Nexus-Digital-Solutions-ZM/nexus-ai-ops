// services/whatsapp.js
// Nexus Digital Solutions — WhatsApp Service
// OpenClaw Multi-Channel Support

require('dotenv').config();
const axios = require('axios');
const { summarizeMeeting, askOpsBot, generateDailyReport } = require('./ai');
const { createTask, getTasks, getOverdueTasks } = require('./asana');

// ===== CONFIG =====
const WEBHOOK_SECRET = process.env.WHATSAPP_WEBHOOK_SECRET || '';
const OPENCLAW_GATEWAY = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const ALLOW_FROM = (process.env.WHATSAPP_ALLOW_FROM || '')
  .split(',').map(n => n.trim()).filter(Boolean);

// Authorized numbers that receive daily reports
const REPORT_RECIPIENTS = ALLOW_FROM.length > 0
  ? ALLOW_FROM
  : [
      process.env.OPENCLAW_CHANNEL_1_NUMBER,
      process.env.OPENCLAW_CHANNEL_2_NUMBER,
      process.env.OPENCLAW_CHANNEL_3_NUMBER
    ].filter(Boolean);

// ===== HELPERS =====

function isAuthorized(number) {
  if (!number) return false;
  const n = number.startsWith('+') ? number : `+${number}`;
  return ALLOW_FROM.some(a => a === n || a === number);
}

function normalizeNumber(number) {
  if (!number) return '';
  return number.startsWith('+') ? number : `+${number}`;
}

function chunkMessage(text, maxLength = 4000) {
  if (text.length <= maxLength) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) { chunks.push(remaining); break; }
    let bp = remaining.lastIndexOf('\n\n', maxLength);
    if (bp === -1) bp = remaining.lastIndexOf('. ', maxLength);
    if (bp === -1) bp = maxLength;
    chunks.push(remaining.slice(0, bp).trim());
    remaining = remaining.slice(bp).trim();
  }
  return chunks;
}

// ===== CORE: Send Message via OpenClaw Gateway =====
async function sendMessage(to, text) {
  const normalized = normalizeNumber(to);
  console.log(`[WhatsApp] Sending to ${normalized}: ${text.slice(0, 80)}...`);

  try {
    // OpenClaw gateway message send endpoint
    const res = await axios.post(
      `${OPENCLAW_GATEWAY}/api/message/send`,
      { to: normalized, text },
      {
        headers: {
          'Authorization': `Bearer ${WEBHOOK_SECRET}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );
    console.log(`[WhatsApp] Sent OK to ${normalized}`);
    return { success: true, messageId: res.data?.id };
  } catch (err) {
    console.error(`[WhatsApp] Send failed to ${normalized}:`, err.message);
    return { success: false, error: err.message };
  }
}

// ===== CORE: Process Incoming Message =====
async function processIncoming(from, body, channel = null) {
  console.log(`[WhatsApp] Incoming from ${from}: ${body?.slice(0, 100)}`);

  if (!isAuthorized(from)) {
    console.warn(`[WhatsApp] Unauthorized from ${from}`);
    return { success: false, error: 'Unauthorized' };
  }

  const to = normalizeNumber(from);
  const text = body?.trim() || '';
  const lower = text.toLowerCase();

  try {
    if (lower === 'help') return await sendHelpMessage(to);
    if (lower === 'tasks') return await sendTasksList(to);
    if (lower.startsWith('meeting:')) return await processMeetingCommand(to, text.substring(8).trim());
    if (lower === 'report') return await sendDailyReportToNumber(to);
    return await handleAIQuestion(to, text);
  } catch (err) {
    console.error(`[WhatsApp] Process error:`, err.message);
    return await sendMessage(to, `⚠️ Error: ${err.message}\n\nType *help* for available commands.`);
  }
}

// ===== COMMANDS =====

async function sendHelpMessage(to) {
  const text = `🤖 *Nexus Ops Engine*

*Commands:*

📋 *tasks* — View open & overdue tasks

🎙️ *meeting: [notes]* — AI analyzes meeting, extracts tasks & creates them in Asana
_Example: meeting: Called Juicyway. Waiting on Q1 Q2 rates. Sid needs $2M off-ramped._

📊 *report* — Get daily ops report

💬 *[any question]* — Ask AI anything
_Example: What's overdue? Summarize today's progress._

_Powered by Nexus AI + OpenClaw_`;

  return await sendMessage(to, text);
}

async function sendTasksList(to) {
  try {
    const [tasks, overdue] = await Promise.all([getTasks(), getOverdueTasks()]);

    if (!tasks.length) {
      return await sendMessage(to, '✅ No open tasks — you\'re all clear!');
    }

    const today = new Date().toISOString().split('T')[0];
    let msg = `📋 *Open Tasks (${tasks.length})*\n\n`;

    if (overdue.length > 0) {
      msg += `⚠️ *Overdue (${overdue.length})*\n`;
      overdue.slice(0, 5).forEach(t => {
        msg += `• ${t.name}${t.due_on ? ` | Due: ${t.due_on}` : ''}\n`;
      });
      if (overdue.length > 5) msg += `  ...and ${overdue.length - 5} more\n`;
      msg += '\n';
    }

    msg += `📌 *All Tasks*\n`;
    tasks.slice(0, 10).forEach(t => {
      const late = t.due_on && t.due_on < today;
      msg += `${late ? '⚠️' : '•'} ${t.name}${t.due_on ? ` | ${t.due_on}` : ''}\n`;
    });

    return await sendMessage(to, msg);
  } catch (err) {
    console.error('[WhatsApp] Tasks error:', err.message);
    return await sendMessage(to, '❌ Failed to fetch tasks. Try again.');
  }
}

async function processMeetingCommand(to, transcript) {
  if (!transcript || transcript.length < 10) {
    return await sendMessage(to, '❌ Please provide meeting notes after "meeting:"\n\n_Example: meeting: Called Juicyway today. Waiting on Q1 Q2 rates._');
  }

  try {
    await sendMessage(to, '🤖 Analyzing meeting notes...\nExtracting tasks, decisions & blockers. Creating Asana tasks.');

    const result = await summarizeMeeting(transcript, 'WhatsApp Meeting');

    // Create Asana tasks
    let tasksCreated = 0;
    for (const task of result.tasks || []) {
      try {
        if (!task.task) continue;
        await createTask({
          name: task.task.trim(),
          notes: `Owner: ${task.owner || 'Unassigned'}\nSource: WhatsApp Meeting`,
          due_on: /^\d{4}-\d{2}-\d{2}$/.test(task.deadline) ? task.deadline : null,
          priority: task.priority || 'medium'
        });
        tasksCreated++;
      } catch (e) {
        console.warn('[WhatsApp] Task create failed:', e.message);
      }
    }

    let response = `✅ *Meeting Analyzed*\n\n`;
    response += `📋 *Summary*\n${result.summary}\n\n`;

    if (result.decisions?.length > 0) {
      response += `✅ *Decisions*\n${result.decisions.map(d => `• ${d}`).join('\n')}\n\n`;
    }

    if (result.tasks?.length > 0) {
      response += `📌 *Tasks Created in Asana (${tasksCreated})*\n`;
      result.tasks.forEach(t => {
        response += `• ${t.task}`;
        if (t.owner) response += ` → ${t.owner}`;
        if (/^\d{4}-\d{2}-\d{2}$/.test(t.deadline)) response += ` | Due: ${t.deadline}`;
        response += '\n';
      });
      response += '\n';
    }

    if (result.blockers?.length > 0) {
      response += `🚨 *Blockers*\n${result.blockers.map(b => `• ${b}`).join('\n')}\n\n`;
    }

    if (result.nextMeeting) {
      response += `📅 *Next Meeting*\n${result.nextMeeting}\n`;
    }

    response += `\n_Nexus AI Ops Engine_`;

    const chunks = chunkMessage(response);
    for (const chunk of chunks) await sendMessage(to, chunk);
    return { success: true };

  } catch (err) {
    console.error('[WhatsApp] Meeting error:', err.message);
    return await sendMessage(to, `❌ Failed to analyze meeting: ${err.message}`);
  }
}

async function sendDailyReportToNumber(to) {
  try {
    const [tasks, overdue] = await Promise.all([getTasks(), getOverdueTasks()]);
    const report = await generateDailyReport(tasks, [], overdue);

    let msg = `📊 *Nexus Daily Report*\n\n`;
    msg += `*${report.headline}*\n\n`;
    msg += `${report.progress}\n\n`;

    if (report.urgent?.length > 0) {
      msg += `🚨 *Urgent*\n${report.urgent.map(u => `• ${u}`).join('\n')}\n\n`;
    }

    if (report.tomorrow?.length > 0) {
      msg += `➡️ *Tomorrow*\n${report.tomorrow.map(t => `• ${t}`).join('\n')}\n\n`;
    }

    msg += `📈 *Health Score: ${report.healthScore}/10*\n`;
    msg += `_Open: ${tasks.length} | Overdue: ${overdue.length}_`;

    return await sendMessage(to, msg);
  } catch (err) {
    console.error('[WhatsApp] Report error:', err.message);
    return await sendMessage(to, '❌ Failed to generate report.');
  }
}

async function handleAIQuestion(to, question) {
  try {
    const [tasks, overdue] = await Promise.all([getTasks(), getOverdueTasks()]);
    const answer = await askOpsBot(question, {
      openTasks: tasks.length,
      overdueTasks: overdue.length,
      askedVia: 'WhatsApp'
    });

    const chunks = chunkMessage(answer);
    for (const chunk of chunks) await sendMessage(to, chunk);
    return { success: true };
  } catch (err) {
    console.error('[WhatsApp] AI error:', err.message);
    return await sendMessage(to, `❌ AI error: ${err.message}`);
  }
}

// ===== DAILY REPORT BROADCAST (called by cron in index.js) =====
async function sendDailyReportWhatsApp(report, openTasks, overdueTasks) {
  let msg = `📊 *Nexus Daily Report — ${new Date().toLocaleDateString('en-ZM', { timeZone: 'Africa/Lusaka' })}*\n\n`;
  msg += `*${report.headline}*\n\n`;
  msg += `${report.progress}\n\n`;

  if (report.urgent?.length > 0) {
    msg += `🚨 *Urgent*\n${report.urgent.map(u => `• ${u}`).join('\n')}\n\n`;
  }

  if (report.tomorrow?.length > 0) {
    msg += `➡️ *Tomorrow*\n${report.tomorrow.map(t => `• ${t}`).join('\n')}\n\n`;
  }

  msg += `📈 *Health Score: ${report.healthScore}/10*\n`;
  msg += `_Open: ${openTasks} | Overdue: ${overdueTasks}_`;

  // Send to all authorized numbers
  const results = await Promise.allSettled(
    REPORT_RECIPIENTS.map(number => sendMessage(number, msg))
  );

  const sent = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
  console.log(`[WhatsApp] Daily report sent to ${sent}/${REPORT_RECIPIENTS.length} recipients`);
  return { sent, total: REPORT_RECIPIENTS.length };
}

// ===== WEBHOOK: OpenClaw inbound =====
async function handleWebhook(req, res) {
  try {
    const { from, body, type, channel } = req.body;

    if (type !== 'message' || !from || !body) {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    // Respond immediately, process async
    res.json({ success: true });

    processIncoming(from, body, channel).catch(err => {
      console.error('[Webhook] Process error:', err.message);
    });

  } catch (err) {
    console.error('[Webhook] Handler error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Webhook processing failed' });
  }
}

// ===== EXPORTS =====
module.exports = {
  processIncoming,
  handleWebhook,
  sendMessage,
  sendDailyReportWhatsApp,
  isAuthorized,
  normalizeNumber
};

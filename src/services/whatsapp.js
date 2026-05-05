const axios = require('axios');
const { summarizeMeeting, askOpsBot } = require('./ai');
const { createTask, getTasks, getOverdueTasks } = require('./asana');

// WhatsApp via Africa's Talking (already in your ZamPOS stack)
// OR Twilio WhatsApp sandbox (easier for testing)
const AT_API_KEY = process.env.AT_API_KEY;
const AT_USERNAME = process.env.AT_USERNAME;
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM; // whatsapp:+14155238886

// Authorized WhatsApp numbers (with country code, no +)
const AUTHORIZED_NUMBERS = [
  process.env.SIMEON_WHATSAPP || '260971234567',
  process.env.SIDDHARTHA_WHATSAPP || '919876543210'
];

// Send WhatsApp via Twilio
async function sendWhatsApp(to, message) {
  if (!TWILIO_SID || TWILIO_SID === 'your_twilio_sid') {
    console.log(`[WhatsApp MOCK] To: ${to}\n${message}`);
    return { mock: true };
  }

  try {
    const res = await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      new URLSearchParams({
        From: TWILIO_WHATSAPP_FROM,
        To: `whatsapp:+${to}`,
        Body: message
      }),
      {
        auth: { username: TWILIO_SID, password: TWILIO_TOKEN },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );
    return res.data;
  } catch (err) {
    console.error('WhatsApp send error:', err.response?.data || err.message);
    throw err;
  }
}

// Broadcast to all authorized numbers
async function broadcastWhatsApp(message) {
  const results = [];
  for (const num of AUTHORIZED_NUMBERS) {
    try {
      const r = await sendWhatsApp(num, message);
      results.push({ num, success: true, r });
    } catch (e) {
      results.push({ num, success: false, error: e.message });
    }
  }
  return results;
}

// Send daily report via WhatsApp
async function sendDailyReportWhatsApp(report, taskCount, overdueCount) {
  const msg = `
🏢 *NEXUS DIGITAL SOLUTIONS*
📊 Daily Ops Report — ${new Date().toLocaleDateString('en-ZM', { weekday: 'short', day: 'numeric', month: 'short' })}

${report.headline}

📋 *Tasks:* ${taskCount} open | ${overdueCount} overdue
✅ *Progress:* ${report.progress}
${report.urgent?.length ? `\n🚨 *Urgent:*\n${report.urgent.map(u => `• ${u}`).join('\n')}` : ''}
${report.tomorrow?.length ? `\n➡️ *Tomorrow:*\n${report.tomorrow.map(t => `• ${t}`).join('\n')}` : ''}

Health Score: ${report.healthScore}/10 ${report.healthScore >= 7 ? '🟢' : report.healthScore >= 5 ? '🟡' : '🔴'}

_Nexus AI Ops Engine_
  `.trim();

  return broadcastWhatsApp(msg);
}

// Process incoming WhatsApp message (webhook handler)
async function processIncoming(from, body) {
  // Strip country code prefix for check
  const cleanFrom = from.replace(/^\+/, '').replace(/^whatsapp:/, '');
  const isAuthorized = AUTHORIZED_NUMBERS.some(n => cleanFrom.includes(n) || n.includes(cleanFrom));

  if (!isAuthorized) {
    console.log(`Unauthorized WhatsApp from ${from}`);
    return;
  }

  const text = body.trim();
  let reply = '';

  try {
    if (text.toLowerCase().startsWith('meeting:')) {
      const transcript = text.replace(/^meeting:/i, '').trim();
      reply = '🤖 Analyzing your meeting... give me a moment.';
      await sendWhatsApp(cleanFrom, reply);

      const result = await summarizeMeeting(transcript, 'WhatsApp Meeting');

      // Create Asana tasks
      for (const task of result.tasks || []) {
        await createTask({ name: task.task, notes: `Owner: ${task.owner}`, due_on: task.deadline, priority: task.priority });
      }

      reply = `
📋 *Meeting Summary*

${result.summary}

✅ *Decisions:*
${result.decisions?.map(d => `• ${d}`).join('\n') || 'None'}

📌 *Tasks created (${result.tasks?.length || 0}):*
${result.tasks?.map(t => `• ${t.task} → ${t.owner}`).join('\n') || 'None'}

${result.blockers?.length ? `🚨 *Blockers:*\n${result.blockers.map(b => `• ${b}`).join('\n')}` : ''}

_All tasks logged to Asana ✓_
      `.trim();

    } else if (text.toLowerCase().startsWith('tasks')) {
      const tasks = await getTasks();
      const overdue = await getOverdueTasks();
      reply = `📋 *Nexus Open Tasks (${tasks.length})*\n\n`;
      reply += tasks.slice(0, 8).map(t => `• ${t.name}${t.due_on ? ` _(${t.due_on})_` : ''}`).join('\n');
      if (overdue.length) reply += `\n\n🚨 *Overdue (${overdue.length}):*\n${overdue.map(t => `• ⚠️ ${t.name}`).join('\n')}`;

    } else if (text.toLowerCase() === 'help') {
      reply = `🤖 *Nexus AI Ops — Commands*\n\n• \`meeting: [notes]\` — Analyze & log meeting\n• \`tasks\` — See open tasks\n• \`[any question]\` — Ask the AI\n\n_Nexus Digital Solutions_`;

    } else {
      // General AI question
      const tasks = await getTasks();
      const overdue = await getOverdueTasks();
      reply = await askOpsBot(text, { openTasks: tasks.length, overdueTasks: overdue.length });
    }

    await sendWhatsApp(cleanFrom, reply);
  } catch (err) {
    console.error('WhatsApp handler error:', err.message);
    await sendWhatsApp(cleanFrom, `❌ Error: ${err.message}`);
  }
}

module.exports = { sendWhatsApp, broadcastWhatsApp, sendDailyReportWhatsApp, processIncoming };

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function summarizeMeeting(transcript, meetingTitle = 'Meeting') {
  const res = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `You are the AI ops assistant for Nexus Digital Solutions...
Respond ONLY with valid JSON:
{"summary":"...","decisions":[],"tasks":[{"task":"","owner":"","deadline":null,"priority":"medium"}],"blockers":[],"nextMeeting":""}

Meeting: ${meetingTitle}
Transcript: ${transcript}`
    }]
  });
  try { return JSON.parse(res.content[0].text); }
  catch { return { summary: res.content[0].text, decisions:[], tasks:[], blockers:[], nextMeeting:'' }; }
}

async function generateDailyReport(tasks, meetings, blockers) {
  const res = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 800,
    messages: [{ role: 'user', content: `Generate Nexus daily report as JSON only:
{"headline":"","progress":"","urgent":[],"tomorrow":[],"healthScore":7}
Tasks: ${JSON.stringify(tasks?.slice(0,10))}` }]
  });
  try { return JSON.parse(res.content[0].text); }
  catch { return { headline:'Nexus is running', progress:'', urgent:[], tomorrow:[], healthScore:5 }; }
}

async function askOpsBot(question, context = {}) {
  const res = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [{ role: 'user', content: `You are Nexus AI Ops assistant for Simeon and Siddhartha. Be concise, max 3 sentences.\nContext: ${JSON.stringify(context)}\nQuestion: ${question}` }]
  });
  return res.content[0].text;
}

module.exports = { summarizeMeeting, generateDailyReport, askOpsBot };
const OpenAI = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

async function summarizeMeeting(transcript, meetingTitle = 'Meeting') {
  const res = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 1000,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'system',
      content: `You are the AI ops assistant for Nexus Digital Solutions, a Zambian fintech company building ZamPOS — Bitcoin Lightning POS for Zambian merchants. Always respond with valid JSON only.`
    }, {
      role: 'user',
      content: `Analyze this meeting and return JSON:
{
  "summary": "2-3 sentence summary",
  "decisions": ["decision 1"],
  "tasks": [{"task":"...","owner":"...","deadline":"YYYY-MM-DD or null","priority":"high|medium|low"}],
  "blockers": ["blocker 1"],
  "nextMeeting": "suggested next topic"
}

Meeting: ${meetingTitle}
Transcript: ${transcript}`
    }]
  });
  try { return JSON.parse(res.choices[0].message.content); }
  catch { return { summary: res.choices[0].message.content, decisions:[], tasks:[], blockers:[], nextMeeting:'' }; }
}

async function generateDailyReport(tasks, meetings, blockers) {
  const res = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 800,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'system',
      content: 'You are the Nexus Digital Solutions AI Ops assistant. Respond with valid JSON only.'
    }, {
      role: 'user',
      content: `Generate daily ops report. Return JSON:
{
  "headline": "one line status",
  "progress": "what moved forward",
  "urgent": ["urgent item"],
  "tomorrow": ["priority for tomorrow"],
  "healthScore": 1
}

Open Tasks: ${JSON.stringify(tasks?.slice(0,10))}
Overdue: ${JSON.stringify(blockers?.slice(0,5))}`
    }]
  });
  try { return JSON.parse(res.choices[0].message.content); }
  catch { return { headline:'Nexus is running', progress:'', urgent:[], tomorrow:[], healthScore:5 }; }
}

async function askOpsBot(question, context = {}) {
  const res = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 500,
    messages: [{
      role: 'system',
      content: `You are the Nexus Digital Solutions AI Ops assistant helping Simeon Mwale (founder) and Siddhartha (mentor/partner) manage operations for ZamPOS and Nexus Digital Solutions in Zambia. Be concise, direct, and actionable. Max 3 sentences.`
    }, {
      role: 'user',
      content: `Context: ${JSON.stringify(context)}\n\nQuestion: ${question}`
    }]
  });
  return res.choices[0].message.content;
}

module.exports = { summarizeMeeting, generateDailyReport, askOpsBot };

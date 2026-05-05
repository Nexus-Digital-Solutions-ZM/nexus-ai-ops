// services/ai.js
// Nexus Digital Solutions — AI Ops Engine v2
// Production-ready AI service with provider fallback chain

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');

// ===== CONFIG: Provider Chain (Order = Priority) =====
const PROVIDERS = [
  {
    name: 'anthropic',
    type: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    timeout: 10000,
    enabled: !!process.env.ANTHROPIC_API_KEY
  },
  {
    name: 'groq',
    type: 'openai-compatible',
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey: process.env.GROQ_API_KEY,
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    timeout: 8000,
    enabled: !!process.env.GROQ_API_KEY
  },
  {
    name: 'openrouter',
    type: 'openai-compatible',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct:free',
    timeout: 12000,
    enabled: !!process.env.OPENROUTER_API_KEY
  },
  {
    name: 'google-ai',
    type: 'openai-compatible',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiKey: process.env.GOOGLE_AI_API_KEY,
    model: process.env.GOOGLE_MODEL || 'gemini-2.0-flash',
    timeout: 15000,
    enabled: !!process.env.GOOGLE_AI_API_KEY
  }
].filter(p => p.enabled);

// ===== HELPER: Safe JSON Parse =====
function safeJsonParse(text, fallback) {
  try {
    const cleaned = text.replace(/^```json\s*|\s*```$/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return fallback;
  }
}

// ===== HELPER: Call OpenAI-Compatible API =====
async function callOpenAICompatible(provider, messages, maxTokens) {
  const client = new OpenAI({
    baseURL: provider.baseURL,
    apiKey: provider.apiKey,
    timeout: provider.timeout
  });

  const response = await client.chat.completions.create({
    model: provider.model,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    max_tokens: maxTokens,
    temperature: 0.2
  });

  return response.choices[0]?.message?.content || '';
}

// ===== HELPER: Call Anthropic Native API =====
async function callAnthropic(provider, messages, maxTokens) {
  const client = new Anthropic({ 
    apiKey: provider.apiKey,
    timeout: provider.timeout 
  });

  const anthropicMessages = messages.map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content
  }));

  const response = await client.messages.create({
    model: provider.model,
    max_tokens: maxTokens,
    messages: anthropicMessages
  });

  return response.content[0]?.text || '';
}

// ===== CORE: Execute with Fallback Chain =====
async function executeWithFallback(prompt, maxTokens, systemPrompt = '') {
  const messages = systemPrompt 
    ? [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }]
    : [{ role: 'user', content: prompt }];

  let lastError = null;

  for (const provider of PROVIDERS) {
    try {
      console.log(`[AI] Trying ${provider.name} (${provider.model})...`);
      
      let content = '';
      if (provider.type === 'anthropic') {
        content = await callAnthropic(provider, messages, maxTokens);
      } else {
        content = await callOpenAICompatible(provider, messages, maxTokens);
      }

      if (!content || content.trim() === '') {
        throw new Error('Empty response from provider');
      }

      console.log(`[AI] ✅ Success with ${provider.name}`);
      return { content, provider: provider.name };

    } catch (error) {
      lastError = error;
      const isRetryable = 
        error.status === 429 ||
        error.status >= 500 ||
        error.code === 'ECONNABORTED' ||
        error.message?.toLowerCase().includes('credit') ||
        error.message?.toLowerCase().includes('insufficient') ||
        error.message?.toLowerCase().includes('quota');

      if (!isRetryable && error.status === 401) {
        console.error(`[AI] ❌ Auth error on ${provider.name} - skipping chain`);
        break;
      }

      console.warn(`[AI] ⚠️ ${provider.name} failed: ${error.message}. Trying next...`);
    }
  }

  console.error('[AI] ❌ All providers failed:', lastError?.message);
  throw new Error(`AI service unavailable: ${lastError?.message || 'Unknown error'}`);
}

// ===== EXPORTED FUNCTIONS =====

async function summarizeMeeting(transcript, meetingTitle = 'Meeting') {
  const systemPrompt = `You are the AI ops assistant for Nexus Digital Solutions. Respond ONLY with valid JSON matching this schema:
{
  "summary": "string",
  "decisions": ["string"],
  "tasks": [{"task":"string","owner":"string","deadline":"YYYY-MM-DD or null","priority":"low|medium|high"}],
  "blockers": ["string"],
  "nextMeeting": "string or empty"
}
Do not include markdown, code blocks, or explanations. Pure JSON only.`;

  const prompt = `Meeting: ${meetingTitle}\nTranscript: ${transcript}`;

  try {
    const { content } = await executeWithFallback(prompt, 1000, systemPrompt);
    return safeJsonParse(content, {
      summary: content.slice(0, 300),
      decisions: [],
      tasks: [],
      blockers: [],
      nextMeeting: ''
    });
  } catch (error) {
    console.error('[summarizeMeeting] Fallback chain failed:', error.message);
    return {
      summary: `Meeting: ${meetingTitle}. AI processing temporarily unavailable.`,
      decisions: [],
      tasks: [],
      blockers: ['AI service unavailable - please retry'],
      nextMeeting: ''
    };
  }
}

async function generateDailyReport(tasks, meetings, blockers) {
  const systemPrompt = `Generate Nexus daily report as JSON only. Schema:
{
  "headline": "string",
  "progress": "string",
  "urgent": ["string"],
  "tomorrow": ["string"],
  "healthScore": number (1-10)
}
Pure JSON, no markdown.`;

  const prompt = `Tasks: ${JSON.stringify(tasks?.slice(0,10) || [])}\nMeetings: ${JSON.stringify(meetings?.slice(0,3) || [])}\nBlockers: ${JSON.stringify(blockers || [])}`;

  try {
    const { content } = await executeWithFallback(prompt, 800, systemPrompt);
    return safeJsonParse(content, {
      headline: 'Nexus Ops Update',
      progress: 'Daily report generation experienced a temporary issue.',
      urgent: ['Check AI service status'],
      tomorrow: ['Retry report generation'],
      healthScore: 5
    });
  } catch (error) {
    console.error('[generateDailyReport] Fallback chain failed:', error.message);
    return {
      headline: 'Nexus is running',
      progress: 'Report generation paused due to AI service issue.',
      urgent: ['Manual check recommended'],
      tomorrow: ['Regenerate report when service restored'],
      healthScore: 5
    };
  }
}

async function askOpsBot(question, context = {}) {
  const systemPrompt = `You are Nexus AI Ops assistant for Simeon and Siddhartha. Be concise, professional, max 3 sentences. Focus on actionable answers.`;
  const prompt = `Context: ${JSON.stringify(context)}\nQuestion: ${question}`;

  try {
    const { content } = await executeWithFallback(prompt, 500, systemPrompt);
    return content.trim();
  } catch (error) {
    console.error('[askOpsBot] Fallback chain failed:', error.message);
    return `⚠️ AI assistant temporarily unavailable. Please try again in a moment or contact support.`;
  }
}

module.exports = { summarizeMeeting, generateDailyReport, askOpsBot };
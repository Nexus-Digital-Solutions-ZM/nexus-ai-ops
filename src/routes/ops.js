// routes/ops.js
// Nexus Digital Solutions — AI Ops Engine v2
// Production-ready Express routes with hardened error handling + OpenClaw WhatsApp

require('dotenv').config();
const express = require('express');
const router = express.Router();
const { summarizeMeeting, generateDailyReport, askOpsBot } = require('../services/ai');
const { createTask, getTasks, completeTask, logMeeting, getOverdueTasks } = require('../services/asana');
const { requireAuth } = require('../services/auth');
const { processIncoming, handleWebhook: handleOpenClawWebhook } = require('../services/whatsapp');

// ===== CONFIG =====
const OPENCLAW_ENABLED = process.env.OPENCLAW_WHATSAPP_ENABLED === 'true';
const WEBHOOK_SECRET = process.env.WHATSAPP_WEBHOOK_SECRET || '';
const ALLOW_FROM = (process.env.WHATSAPP_ALLOW_FROM || '')
  .split(',').map(n => n.trim()).filter(Boolean);

// ===== HELPERS =====

// Validates that a deadline is YYYY-MM-DD before sending to Asana
function sanitizeDeadline(deadline) {
  return /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : null;
}

// ===== PUBLIC ROUTES =====

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    system: 'Nexus Digital Solutions — AI Ops Engine v2',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    env: process.env.NODE_ENV || 'production',
    whatsapp: {
      openclaw: OPENCLAW_ENABLED,
      twilio: !!process.env.TWILIO_ACCOUNT_SID
    }
  });
});

// ----- Twilio WhatsApp Webhook (backward compatible) -----
router.post('/webhook/whatsapp',
  express.urlencoded({ extended: false }),
  async (req, res) => {
    res.sendStatus(200);
    try {
      const from = req.body?.From || req.body?.from || '';
      const body = req.body?.Body || req.body?.body || '';
      if (from && body) {
        processIncoming(from, body).catch(err => {
          console.error('[WhatsApp/Twilio] Process error:', err.message);
        });
      }
    } catch (err) {
      console.error('[WhatsApp/Twilio] Webhook parse error:', err.message);
    }
  }
);

// ----- OpenClaw WhatsApp Webhook -----
router.post('/webhook/openclaw/whatsapp',
  express.json(),
  async (req, res) => {
    // Reject if secret not configured server-side
    if (!WEBHOOK_SECRET) {
      console.error('[OpenClaw] WHATSAPP_WEBHOOK_SECRET not set');
      return res.status(500).json({ error: 'Webhook not configured' });
    }

    const incoming = req.headers['x-webhook-secret'] || req.query.secret || '';
    if (incoming !== WEBHOOK_SECRET) {
      console.warn('[OpenClaw] Invalid webhook secret attempt from', req.ip);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      await handleOpenClawWebhook(req, res);
    } catch (err) {
      console.error('[OpenClaw] Webhook handler error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Webhook processing failed' });
      }
    }
  }
);

// ----- OpenClaw Status -----
router.get('/webhook/openclaw/whatsapp/status', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Nexus Ops Engine',
    whatsapp: {
      enabled: OPENCLAW_ENABLED,
      authorizedNumbers: ALLOW_FROM,
      webhookSecret: WEBHOOK_SECRET ? '***configured***' : '***not-set***'
    },
    timestamp: new Date().toISOString()
  });
});

// ===== PROTECTED ROUTES =====
router.use(requireAuth);

// ----- AI: Summarize Meeting -----
router.post('/ai/summarize', async (req, res) => {
  try {
    const { transcript, title } = req.body;

    if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 10) {
      return res.status(400).json({ error: 'Valid transcript (min 10 chars) is required' });
    }

    const result = await summarizeMeeting(transcript, title || 'Meeting');

    let tasksCreated = 0;
    const hasValidTasks = Array.isArray(result.tasks) &&
      result.tasks.length > 0 &&
      typeof result.summary === 'string' &&
      result.summary.length > 20;

    if (hasValidTasks) {
      for (const task of result.tasks) {
        try {
          if (!task.task || typeof task.task !== 'string') continue;
          await createTask({
            name: task.task.trim(),
            notes: `Owner: ${task.owner || 'Unassigned'}\nBy: ${req.user.name}\nSource: AI Meeting Summary`,
            due_on: sanitizeDeadline(task.deadline),  // ✅ Fixed: no more "next Tuesday" errors
            priority: task.priority || 'medium'
          });
          tasksCreated++;
        } catch (taskErr) {
          console.warn(`[Asana] Task creation failed: ${taskErr.message}`);
        }
      }
    }

    try {
      await logMeeting({
        title: title || 'Meeting',
        summary: result.summary || '',
        decisions: result.decisions || [],
        tasks: result.tasks || [],
        blockers: result.blockers || [],
        nextMeeting: result.nextMeeting || '',
        date: new Date().toISOString().split('T')[0],
        createdBy: req.user.id
      });
    } catch (logErr) {
      console.warn(`[Log] Meeting log failed: ${logErr.message}`);
    }

    res.json({ success: true, summary: result, tasksCreated });

  } catch (err) {
    console.error('[POST /ai/summarize] Critical error:', err.message);
    res.status(500).json({
      error: 'Failed to process meeting. Our AI service is temporarily unavailable. Please try again in 1-2 minutes.',
      retryAfter: 60
    });
  }
});

// ----- AI: Ask Ops Bot -----
router.post('/ai/ask', async (req, res) => {
  try {
    const { question } = req.body;

    if (!question || typeof question !== 'string' || question.trim().length < 3) {
      return res.status(400).json({ error: 'A valid question (min 3 chars) is required' });
    }

    const [tasks, overdue] = await Promise.all([
      getTasks().catch(() => []),
      getOverdueTasks().catch(() => [])
    ]);

    const answer = await askOpsBot(question.trim(), {
      openTasks: tasks.length,
      overdueTasks: overdue.length,
      askedBy: req.user.name,
      timestamp: new Date().toISOString()
    });

    res.json({ answer, context: { openTasks: tasks.length, overdueTasks: overdue.length } });

  } catch (err) {
    console.error('[POST /ai/ask] Error:', err.message);
    res.status(500).json({
      error: 'AI assistant is temporarily unavailable. Please try again shortly.',
      suggestion: 'You can still view tasks and create items manually while we restore service.'
    });
  }
});

// ----- Reports: Daily Summary -----
router.get('/reports/daily', async (req, res) => {
  try {
    const [tasks, overdue] = await Promise.all([
      getTasks().catch(err => { console.warn('[Reports] getTasks failed:', err.message); return []; }),
      getOverdueTasks().catch(err => { console.warn('[Reports] getOverdueTasks failed:', err.message); return []; })
    ]);

    const report = await generateDailyReport(tasks, [], overdue);

    res.json({
      report,
      openTasks: tasks.length,
      overdueTasks: overdue.length,
      generatedAt: new Date().toISOString()
    });

  } catch (err) {
    console.error('[GET /reports/daily] Error:', err.message);
    res.json({
      report: {
        headline: 'Ops Update',
        progress: 'Report generation experienced a temporary issue.',
        urgent: ['Check system status'],
        tomorrow: ['Retry report generation'],
        healthScore: 5
      },
      openTasks: 0,
      overdueTasks: 0,
      generatedAt: new Date().toISOString(),
      warning: 'Using fallback report data'
    });
  }
});

// ----- Tasks: List -----
router.get('/tasks', async (req, res) => {
  try {
    const tasks = await getTasks();
    res.json({ tasks, count: tasks.length, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[GET /tasks] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch tasks. Please try again.', retry: true });
  }
});

// ----- Tasks: Create -----
router.post('/tasks/create', async (req, res) => {
  try {
    const { name, notes, due_on, priority } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ error: 'Task name (min 2 chars) is required' });
    }

    const task = await createTask({
      name: name.trim(),
      notes: notes?.trim() || '',
      due_on: sanitizeDeadline(due_on),  // ✅ Fixed here too
      priority: priority || 'medium',
      createdBy: req.user.id
    });

    res.status(201).json({ success: true, task, message: 'Task created successfully' });

  } catch (err) {
    console.error('[POST /tasks/create] Error:', err.message);
    if (err.message?.includes('quota') || err.message?.includes('rate limit')) {
      return res.status(429).json({ error: 'Task service is busy. Please wait 30 seconds and try again.', retryAfter: 30 });
    }
    res.status(500).json({ error: 'Failed to create task. Please check your input and try again.' });
  }
});

// ----- Tasks: Complete -----
router.put('/tasks/:gid/complete', async (req, res) => {
  try {
    const { gid } = req.params;

    if (!gid || typeof gid !== 'string') {
      return res.status(400).json({ error: 'Valid task ID is required' });
    }

    const task = await completeTask(gid);
    res.json({ success: true, task, message: 'Task marked complete', completedAt: new Date().toISOString() });

  } catch (err) {
    console.error('[PUT /tasks/:gid/complete] Error:', err.message);
    if (err.message?.includes('not found') || err.status === 404) {
      return res.status(404).json({ error: 'Task not found or already completed' });
    }
    res.status(500).json({ error: 'Failed to update task. Please try again.' });
  }
});

// ----- Events: Log Meeting -----
router.post('/events/meeting', async (req, res) => {
  try {
    const { title, transcript } = req.body;

    if (!title || !transcript) {
      return res.status(400).json({ error: 'Both title and transcript are required' });
    }
    if (typeof transcript !== 'string' || transcript.trim().length < 10) {
      return res.status(400).json({ error: 'Transcript must be at least 10 characters' });
    }

    const summary = await summarizeMeeting(transcript, title);
    const meeting = await logMeeting({
      title: title.trim(),
      ...summary,
      date: new Date().toISOString().split('T')[0],
      createdBy: req.user.id,
      rawTranscriptLength: transcript.length
    });

    res.status(201).json({ success: true, meeting, summary, message: 'Meeting logged successfully' });

  } catch (err) {
    console.error('[POST /events/meeting] Error:', err.message);
    res.status(500).json({ error: 'Failed to process meeting event. Please try again.', retryAfter: 60 });
  }
});

// ===== CATCH-ALL ERROR HANDLER =====
router.use((err, req, res, next) => {
  console.error('[Unhandled Route Error]', {
    path: req.path,
    method: req.method,
    userId: req.user?.id,
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
  res.status(500).json({
    error: 'An unexpected error occurred. Our team has been notified.',
    ...(process.env.NODE_ENV === 'development' && { details: err.message })
  });
});

module.exports = router;
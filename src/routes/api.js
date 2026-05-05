const express = require('express');
const router = express.Router();
const { summarizeMeeting, generateDailyReport, askOpsBot } = require('../services/ai');
const { createTask, getTasks, completeTask, logMeeting, getOverdueTasks } = require('../services/asana');
const { requireAuth } = require('../services/auth');
const { processIncoming } = require('../services/whatsapp');

// Public
router.get('/health', (req, res) => {
  res.json({ status: 'ok', system: 'Nexus Digital Solutions — AI Ops Engine v2', timestamp: new Date().toISOString() });
});

router.post('/webhook/whatsapp', express.urlencoded({ extended: false }), async (req, res) => {
  res.sendStatus(200);
  const from = req.body?.From || '';
  const body = req.body?.Body || '';
  if (from && body) processIncoming(from, body).catch(console.error);
});

// Protected
router.use(requireAuth);

router.post('/ai/summarize', async (req, res) => {
  try {
    const { transcript, title } = req.body;
    if (!transcript) return res.status(400).json({ error: 'transcript is required' });
    const result = await summarizeMeeting(transcript, title || 'Meeting');
    let tasksCreated = 0;
    for (const task of result.tasks || []) {
      try { await createTask({ name: task.task, notes: `Owner: ${task.owner}\nBy: ${req.user.name}`, due_on: task.deadline, priority: task.priority }); tasksCreated++; } catch {}
    }
    try { await logMeeting({ title: title || 'Meeting', ...result, date: new Date().toISOString().split('T')[0] }); } catch {}
    res.json({ success: true, summary: result, tasksCreated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ai/ask', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'question is required' });
    const tasks = await getTasks();
    const overdue = await getOverdueTasks();
    const answer = await askOpsBot(question, { openTasks: tasks.length, overdueTasks: overdue.length, askedBy: req.user.name });
    res.json({ answer });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/reports/daily', async (req, res) => {
  try {
    const tasks = await getTasks();
    const overdue = await getOverdueTasks();
    const report = await generateDailyReport(tasks, [], overdue);
    res.json({ report, openTasks: tasks.length, overdueTasks: overdue.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/tasks', async (req, res) => {
  try {
    const tasks = await getTasks();
    res.json({ tasks, count: tasks.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/tasks/create', async (req, res) => {
  try {
    const { name, notes, due_on, priority } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const task = await createTask({ name, notes, due_on, priority });
    res.json({ success: true, task });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/tasks/:gid/complete', async (req, res) => {
  try {
    const task = await completeTask(req.params.gid);
    res.json({ success: true, task });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/events/meeting', async (req, res) => {
  try {
    const { title, transcript } = req.body;
    if (!title || !transcript) return res.status(400).json({ error: 'title and transcript required' });
    const summary = await summarizeMeeting(transcript, title);
    const meeting = await logMeeting({ title, ...summary, date: new Date().toISOString().split('T')[0] });
    res.json({ success: true, meeting, summary });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

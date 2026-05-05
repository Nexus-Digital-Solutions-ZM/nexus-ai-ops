require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const cron = require('node-cron');

const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const { initSlack, startSlack } = require('./services/slack');
const { initPasswords } = require('./services/auth');
const { generateDailyReport } = require('./services/ai');
const { getTasks, getOverdueTasks } = require('./services/asana');
const { sendDailyReportWhatsApp } = require('./services/whatsapp');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== GLOBAL CRASH PROTECTION =====
process.on('uncaughtException', (err) => {
  if (
    err.message?.includes('Unhandled event') ||
    err.message?.includes('server explicit disconnect') ||
    err.message?.includes('socket hang up')
  ) {
    console.warn('[Slack] Non-fatal socket disconnect — server continuing...');
  } else {
    console.error('[Fatal] Uncaught exception:', err.message);
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason) => {
  const msg = reason?.message || String(reason);
  if (
    msg.includes('Unhandled event') ||
    msg.includes('server explicit disconnect') ||
    msg.includes('socket hang up')
  ) {
    console.warn('[Slack] Non-fatal rejection — socket disconnect, reconnecting...');
  } else {
    console.error('[Error] Unhandled rejection:', msg);
  }
});

// ===== MIDDLEWARE =====
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || true, credentials: true }));
app.use(cookieParser());
app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(path.join(__dirname, '../public')));

// ===== ROUTES =====
app.use('/auth', authRoutes);
app.use('/api', apiRoutes);
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.use((err, req, res, next) => {
  console.error('[Express] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ===== CRON: Daily Report @ 6AM CAT =====
cron.schedule('0 6 * * *', async () => {
  try {
    const tasks = await getTasks();
    const overdue = await getOverdueTasks();
    const report = await generateDailyReport(tasks, [], overdue);
    await sendDailyReportWhatsApp(report, tasks.length, overdue.length);
    console.log('[Cron] Daily report sent:', report.headline);
  } catch (err) {
    console.error('[Cron] Daily report failed:', err.message);
  }
}, { timezone: 'Africa/Lusaka' });

// ===== SLACK: Init with reconnect =====
function startSlackWithReconnect(attempt = 1) {
  const MAX_ATTEMPTS = 5;
  const RETRY_DELAY_MS = 10000;

  const slackApp = initSlack();
  if (!slackApp) {
    console.warn('[Slack] Not configured — skipping.');
    return;
  }

  startSlack()
    .then(() => {
      console.log('[Slack] Connected.');
    })
    .catch((err) => {
      console.error(`[Slack] Connection failed (attempt ${attempt}): ${err.message}`);
      if (attempt < MAX_ATTEMPTS) {
        console.log(`[Slack] Retrying in ${RETRY_DELAY_MS / 1000}s...`);
        setTimeout(() => startSlackWithReconnect(attempt + 1), RETRY_DELAY_MS);
      } else {
        console.warn('[Slack] Max retries reached — running without Slack.');
      }
    });
}

// ===== START =====
async function start() {
  await initPasswords();

  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║   NEXUS DIGITAL SOLUTIONS — AI OPS ENGINE v2    ║
║   Running on http://localhost:${PORT}               ║
║   Users: simeon (admin) · siddhartha (partner)  ║
╚══════════════════════════════════════════════════╝`);
  });

  startSlackWithReconnect();
}

start().catch(err => {
  console.error('[Fatal] Server failed to start:', err.message);
  process.exit(1);
});

module.exports = app;
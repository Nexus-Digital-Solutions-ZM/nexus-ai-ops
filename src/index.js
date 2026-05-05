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

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || true, credentials: true }));
app.use(cookieParser());
app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(path.join(__dirname, '../public')));

app.use('/auth', authRoutes);
app.use('/api', apiRoutes);
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Internal server error' }); });

cron.schedule('0 6 * * *', async () => {
  try {
    const tasks = await getTasks();
    const overdue = await getOverdueTasks();
    const report = await generateDailyReport(tasks, [], overdue);
    await sendDailyReportWhatsApp(report, tasks.length, overdue.length);
    console.log('Daily report sent:', report.headline);
  } catch (err) { console.error('Cron error:', err.message); }
}, { timezone: 'Africa/Lusaka' });

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
  const slackApp = initSlack();
  if (slackApp) startSlack().catch(err => console.error('Slack:', err.message));
}

start().catch(err => { console.error('Fatal:', err); process.exit(1); });
module.exports = app;

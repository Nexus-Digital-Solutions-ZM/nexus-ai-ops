const { App } = require('@slack/bolt');
const { summarizeMeeting, askOpsBot } = require('./ai');
const { createTask, getTasks, logMeeting, getOverdueTasks } = require('./asana');

let slackApp = null;

function initSlack() {
  if (!process.env.SLACK_BOT_TOKEN || process.env.SLACK_BOT_TOKEN === 'xoxb-your-slack-bot-token') {
    console.log('⚠️  Slack not configured - skipping Slack bot init');
    return null;
  }

  slackApp = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN,
  });

  // Listen for meeting transcripts
  slackApp.message(/^meeting:/i, async ({ message, say }) => {
    try {
      const transcript = message.text.replace(/^meeting:/i, '').trim();
      if (!transcript) return say('Please provide a meeting transcript after "meeting:"');

      await say('🤖 *Nexus AI* is analyzing your meeting...');
      const result = await summarizeMeeting(transcript, 'Nexus Meeting');

      // Log to Asana
      await logMeeting({
        title: 'Nexus Meeting',
        summary: result.summary,
        decisions: result.decisions,
        tasks: result.tasks,
        date: new Date().toISOString().split('T')[0]
      });

      // Create individual tasks in Asana
      for (const task of result.tasks || []) {
        await createTask({
          name: task.task,
          notes: `Owner: ${task.owner}\nFrom meeting summary`,
          due_on: task.deadline,
          priority: task.priority
        });
      }

      const blocks = [
        { type: 'header', text: { type: 'plain_text', text: '📋 Nexus Meeting Summary' } },
        { type: 'section', text: { type: 'mrkdwn', text: `*Summary:*\n${result.summary}` } },
        { type: 'divider' },
        { type: 'section', text: { type: 'mrkdwn', text: `*✅ Decisions:*\n${result.decisions?.map(d => `• ${d}`).join('\n') || 'None'}` } },
        { type: 'section', text: { type: 'mrkdwn', text: `*📌 Tasks Created in Asana:*\n${result.tasks?.map(t => `• *${t.task}* → ${t.owner} | ${t.deadline || 'no deadline'} | _${t.priority}_`).join('\n') || 'None'}` } },
        result.blockers?.length ? { type: 'section', text: { type: 'mrkdwn', text: `*🚨 Blockers:*\n${result.blockers.map(b => `• ${b}`).join('\n')}` } } : null,
        { type: 'section', text: { type: 'mrkdwn', text: `*➡️ Next:* ${result.nextMeeting}` } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: '_Tasks logged to Asana automatically_ • Nexus AI Ops Engine' }] }
      ].filter(Boolean);

      await say({ blocks });
    } catch (err) {
      console.error('Slack meeting handler error:', err);
      await say(`❌ Error processing meeting: ${err.message}`);
    }
  });

  // Ask the bot anything
  slackApp.message(/^nexus:/i, async ({ message, say }) => {
    try {
      const question = message.text.replace(/^nexus:/i, '').trim();
      if (!question) return say('Ask me anything! Example: "nexus: what tasks are overdue?"');

      const tasks = await getTasks();
      const overdue = await getOverdueTasks();
      const answer = await askOpsBot(question, { openTasks: tasks.length, overdueTasks: overdue.length });

      await say(`🤖 *Nexus AI:* ${answer}`);
    } catch (err) {
      await say(`❌ Error: ${err.message}`);
    }
  });

  // Tasks command
  slackApp.message(/^tasks/i, async ({ say }) => {
    try {
      const tasks = await getTasks();
      const overdue = await getOverdueTasks();

      const text = [
        `*📋 Nexus Open Tasks (${tasks.length})*`,
        tasks.slice(0, 10).map(t => `• ${t.name} ${t.due_on ? `_(due ${t.due_on})_` : ''}`).join('\n'),
        overdue.length ? `\n*🚨 Overdue (${overdue.length}):*\n${overdue.map(t => `• ⚠️ ${t.name}`).join('\n')}` : ''
      ].filter(Boolean).join('\n');

      await say(text);
    } catch (err) {
      await say(`❌ Error fetching tasks: ${err.message}`);
    }
  });

  console.log('✅ Slack bot initialized');
  return slackApp;
}

async function startSlack() {
  if (!slackApp) return;
  await slackApp.start();
  console.log('⚡ Nexus Slack bot is running');
}

module.exports = { initSlack, startSlack };

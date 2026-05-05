const axios = require('axios');

const ASANA_BASE = 'https://app.asana.com/api/1.0';
const headers = () => ({
  'Authorization': `Bearer ${process.env.ASANA_ACCESS_TOKEN}`,
  'Content-Type': 'application/json'
});

// Create a task in Asana
async function createTask({ name, notes, assignee, due_on, priority = 'medium' }) {
  try {
    const body = {
      data: {
        name,
        notes: notes || '',
        projects: [process.env.ASANA_PROJECT_GID],
        workspace: process.env.ASANA_WORKSPACE_GID,
      }
    };

    if (due_on) body.data.due_on = due_on;
    if (assignee) body.data.assignee = assignee;

    // Add priority as a tag in notes
    body.data.notes = `[${priority.toUpperCase()}] ${notes || ''}`;

    const res = await axios.post(`${ASANA_BASE}/tasks`, body, { headers: headers() });
    return res.data.data;
  } catch (err) {
    console.error('Asana createTask error:', err.response?.data || err.message);
    throw err;
  }
}

// Get all tasks from project
async function getTasks(completed = false) {
  try {
    const res = await axios.get(`${ASANA_BASE}/projects/${process.env.ASANA_PROJECT_GID}/tasks`, {
      headers: headers(),
      params: {
        completed_since: completed ? undefined : 'now',
        opt_fields: 'name,notes,due_on,assignee.name,completed,created_at'
      }
    });
    return res.data.data;
  } catch (err) {
    console.error('Asana getTasks error:', err.response?.data || err.message);
    return [];
  }
}

// Complete a task
async function completeTask(taskGid) {
  try {
    const res = await axios.put(`${ASANA_BASE}/tasks/${taskGid}`, {
      data: { completed: true }
    }, { headers: headers() });
    return res.data.data;
  } catch (err) {
    console.error('Asana completeTask error:', err.response?.data || err.message);
    throw err;
  }
}

// Create a meeting section/task
async function logMeeting({ title, summary, decisions, tasks: meetingTasks, date }) {
  try {
    const notes = `
📅 Meeting: ${title}
📆 Date: ${date || new Date().toISOString().split('T')[0]}

📋 SUMMARY
${summary}

✅ DECISIONS
${decisions?.map(d => `• ${d}`).join('\n') || 'None'}

📌 TASKS EXTRACTED
${meetingTasks?.map(t => `• [${t.priority?.toUpperCase()}] ${t.task} → ${t.owner} (${t.deadline || 'no deadline'})`).join('\n') || 'None'}
    `.trim();

    return await createTask({
      name: `📅 MEETING: ${title}`,
      notes,
      priority: 'high'
    });
  } catch (err) {
    console.error('Asana logMeeting error:', err.message);
    throw err;
  }
}

// Get overdue tasks
async function getOverdueTasks() {
  const tasks = await getTasks(false);
  const today = new Date().toISOString().split('T')[0];
  return tasks.filter(t => t.due_on && t.due_on < today && !t.completed);
}

module.exports = { createTask, getTasks, completeTask, logMeeting, getOverdueTasks };

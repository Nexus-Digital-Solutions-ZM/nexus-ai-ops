# Nexus Digital Solutions — AI Ops Engine

AI-powered operations system for Nexus Digital Solutions / ZamPOS.

## Features
- 🎙️ **Meeting Analyzer** — paste notes, AI extracts summary, decisions, tasks, blockers
- 📋 **Asana Integration** — tasks auto-created in Asana from meetings
- 🤖 **Slack Bot** — type `meeting: [transcript]` or `nexus: [question]` or `tasks`
- 📊 **Daily Reports** — auto-generated at 8am every day
- 🖥️ **Dashboard** — live ops command center UI

## Setup (15 minutes)

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```

Edit `.env` with your keys:

#### Anthropic (Claude AI)
- Get key: https://console.anthropic.com
- Add as `ANTHROPIC_API_KEY`

#### Asana
- Go to: https://app.asana.com/0/my-tasks
- Get Personal Access Token: https://app.asana.com/0/my-profile-apps
- Add as `ASANA_ACCESS_TOKEN`
- Get Workspace GID: call `https://app.asana.com/api/1.0/workspaces` with your token
- Create a project called "Nexus Ops" and get its GID
- Add both as `ASANA_WORKSPACE_GID` and `ASANA_PROJECT_GID`

#### Slack (optional - for bot)
- Create app at: https://api.slack.com/apps
- Enable Socket Mode
- Add Bot Token Scopes: `chat:write`, `channels:history`, `app_mentions:read`
- Add as `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN`

### 3. Run
```bash
# Development
npm run dev

# Production
npm start
```

Open http://localhost:3000

## Deploy to Render (same as ZamPOS backend)
1. Push to GitHub
2. New Web Service on Render
3. Add environment variables
4. Deploy

## Slack Bot Commands
- `meeting: [paste your notes here]` — AI analyzes and creates Asana tasks
- `nexus: [any question]` — Ask the ops bot
- `tasks` — See all open tasks

## API Endpoints
```
POST /api/ai/summarize    - Analyze meeting transcript
POST /api/ai/ask          - Ask the ops bot
GET  /api/reports/daily   - Daily ops report
GET  /api/tasks           - Get all Asana tasks
POST /api/tasks/create    - Create a task
PUT  /api/tasks/:gid/complete - Complete a task
POST /api/events/meeting  - Log a meeting
```

## Built by
Simeon Mwale — Nexus Digital Solutions, Lusaka, Zambia

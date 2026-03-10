# Air Traffic

<img src="assets/icon.svg" width="128" alt="Air Traffic icon" />

> Remote GitHub Copilot orchestration via Slack — from your phone.

## Overview

Air Traffic runs as a daemon on your development machine, watches Slack channels for commands and prompts, and bridges them to GitHub Copilot's agent SDK. You prompt Copilot from your phone (or any Slack client), and the agent executes tasks in your project directories — editing files, running shells, committing code — while streaming results back to Slack.

## Features

### 🖥️ Multi-Machine Support

Run Air Traffic on every machine you work with — desktop, laptop, cloud VM, CI box. Each machine gets its own Slack app (created via `npx air-traffic init`), so events are routed directly with zero cross-daemon coordination. DM each bot to manage that machine's projects. You manage your entire fleet from your phone.

### 🔗 Session Sharing with Local Copilot CLI

Air Traffic can join any existing Copilot CLI session running on your machine. Run `copilot` locally to start a session, then join it remotely with `join <session-id>` — output streams to the Slack channel and you can continue prompting from your phone. Sessions are listed with `sessions`, showing ID prefix, task summary, branch, working directory, and age. Prefix-matching means you only need to type the first few characters of the session ID.

### 📸 Screenshot Capture & Auto-Upload

When Copilot takes a browser screenshot (via Playwright), the image is automatically uploaded to the project's Slack channel. The agent's tool output is also scanned for file paths matching image/PDF extensions (`.png`, `.jpg`, `.gif`, `.svg`, `.webp`, `.pdf`), and any matches are uploaded. You see exactly what Copilot sees without leaving Slack.

### 📎 File Uploads via Slack

Drop a file into a project channel and it's saved directly to the project's working directory, making it available to Copilot immediately. Useful for sharing config files, design mockups, CSVs, or any reference material the agent might need. Files are downloaded via Slack's authenticated URL and saved to the project root.

### 📄 Auto-Upload of Created Artifacts

When Copilot creates files with uploadable extensions (images, PDFs, SVGs), they're automatically posted to the channel. Plan files (`plan.md`, `PLAN.md`) are detected and uploaded when the task completes with a 📋 marker, so you can review the plan before the agent continues.

### 🤖 Slack AI Assistant Status

Air Traffic integrates with Slack's `assistant.threads.setStatus` API to show live progress in the thread. The status line updates with the current intent (e.g., "is exploring codebase"), and `loading_messages` cycle through recent tool calls (`⚙️ grep — *.ts`, `✅ view — config.ts`). Status is re-asserted after every message to stay visible.

### 💬 DM-Based Control

Just DM the bot directly — no dedicated control channel needed. All control commands (`create`, `list`, `config`, `sessions`, `join`, `status`, `models`, `menu`) work in DMs. You can also type naturally — "make a project called my-app" or "what's running?" — and the NL intent classifier routes to the right command. First-time DMs show an interactive welcome menu.

### 🧠 Natural Language Commands

Air Traffic includes a local NL intent classifier that maps natural phrases to commands — no LLM needed, zero latency. Examples:
- "make a project called api-server" → `create api-server`
- "what's running?" → `status`
- "show me my projects" → `list`
- "switch to gpt-5" → `model gpt-5`

### 🎛️ Interactive Menu & Pickers

Type `menu` (or tap a menu button) to get an interactive Block Kit menu with buttons for all common actions. Commands with optional parameters show interactive dropdowns when arguments are omitted — `model` shows a picker of available models, `mode` displays all modes with descriptions, `config` walks through a guided wizard, `join` without an ID shows a session picker.

### 🔐 Granular Permission Controls

Each project has per-category permission policies: file edits, file creates, shell commands, git operations, and network access. Each category can be set to `auto` (approve silently) or `ask` (prompt in Slack with Allow / Always Allow / Deny buttons). "Always Allow" persists the decision to the project config. Common tools like `report_intent` and `ask_user` always bypass permission checks.

### 🚦 Agent Modes

Three operating modes control how Copilot handles prompts:

- **Normal** — Default behavior, full interactive agent
- **Plan** — Prepends `[[PLAN]]` to prompts, making Copilot generate a detailed plan for review before implementing
- **Autopilot** — Runs without confirmation prompts, suitable for well-defined tasks

Switch modes with `mode` in a DM or `!mode` in a project channel.

### 🧠 Session Management

List all Copilot CLI sessions on the machine with `sessions` — see managed vs. unmanaged sessions, their working directories, branches, and ages. Join any session by ID prefix. When joining from a DM, the system auto-creates a project and Slack channel if needed, deriving the project name from the session's working directory.

### 🌐 Web Console

A built-in web dashboard (React + Tailwind) runs alongside the daemon on a configurable port. It provides:

- **Dashboard** — View all projects, create/delete projects, machine status
- **Project View** — Live terminal output with streamed deltas, send prompts, abort sessions
- **Session History** — Load conversation history for active sessions
- **File Browser** — Navigate project files with path-traversal protection
- **Git Info** — Branch, remote, status, last commit
- **Config** — Change model, agent, mode, and permission settings per project
- **Settings** — Machine info, available models, default permissions

### 📝 Markdown → Slack mrkdwn Conversion

Copilot outputs standard Markdown, but Slack uses its own mrkdwn format. Air Traffic converts on the fly: `**bold**` → `*bold*`, `# Heading` → `*Heading*`, `[link](url)` → `<url|link>`, `- list` → `• list`, and code blocks are preserved. The system prompt also instructs Copilot to prefer Slack-native formatting.

### 🏗️ Project Isolation

Each project gets its own Slack channel (`#atc-<machine>-<project>`), working directory, Copilot session, model selection, agent type, permission policy, and operating mode. Projects can be cloned from a repo (`create my-app --from https://github.com/user/repo`) or created as empty directories.

### 🔌 Messaging Abstraction

The core logic is platform-agnostic. All platform communication goes through the `MessagingAdapter` interface — channels, messages, questions, permissions, file uploads, thread status. Slack is the first adapter; Discord, Teams, and others can be added by implementing the interface and swapping it in `src/index.ts`.

## Prerequisites

- **Node.js 18+**
- **GitHub Copilot CLI** installed and authenticated — verify with `copilot --version`
- **Active GitHub Copilot subscription** (Individual, Business, or Enterprise)
- **Slack workspace** with admin access to create apps

## Slack App Setup

### Option A: Setup wizard (recommended)

The `init` command walks you through creating a Slack app for your machine:

```bash
npx air-traffic init
```

It will:
1. Ask for your machine name (e.g. `desktop`, `laptop`)
2. Generate a customized Slack app manifest
3. Guide you through creating the app at [api.slack.com/apps](https://api.slack.com/apps)
4. Prompt you for the three required tokens
5. Write a `.env` file with your configuration

> **Multi-machine setup**: Run `npx air-traffic init` on each machine with a different machine name. Each machine gets its own Slack app — no conflicts, no routing issues.

### Option B: From manifest (manual)

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From an app manifest**
2. Select your workspace
3. Paste the contents of [`slack-app-manifest.yaml`](./slack-app-manifest.yaml) from this repo
4. Click **Create** — all scopes, events, and Socket Mode are configured automatically
5. **Install to Workspace** → authorize the app
6. Collect your tokens:
   - **Basic Information** → **App Credentials** → copy **Signing Secret** → `SLACK_SIGNING_SECRET`
   - **OAuth & Permissions** → copy **Bot User OAuth Token** → `SLACK_BOT_TOKEN` (starts with `xoxb-`)
   - **Basic Information** → **App-Level Tokens** → generate one with `connections:write` scope → `SLACK_APP_TOKEN` (starts with `xapp-`)

### Option C: Manual setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**. Give it a name (e.g. "Air Traffic") and select your workspace.

2. **OAuth & Permissions** → Scroll to **Scopes** → Add these **Bot Token Scopes**:
   - `channels:manage`, `channels:read`, `channels:history`, `channels:join`
   - `chat:write`, `chat:write.public`
   - `files:read`, `files:write`
   - `reactions:read`, `reactions:write`
   - `groups:read`, `groups:history`, `groups:write`
   - `users:read`, `im:history`, `im:read`, `im:write`

3. **Socket Mode** → **Enable Socket Mode** → Create an **App-Level Token** with the `connections:write` scope. Copy the token — this is your `SLACK_APP_TOKEN` (starts with `xapp-`).

4. **Event Subscriptions** → **Enable Events** → Under **Subscribe to bot events**, add:
   - `message.channels`
   - `message.groups`
   - `message.im`
   - `app_home_opened`

5. **Interactivity & Shortcuts** → **Enable Interactivity** (required for Block Kit button actions).

6. **Install to Workspace** → Click **Install to Workspace** and authorize. Copy the **Bot User OAuth Token** — this is your `SLACK_BOT_TOKEN` (starts with `xoxb-`).

7. **Basic Information** → Scroll to **App Credentials** → Copy the **Signing Secret** — this is your `SLACK_SIGNING_SECRET`.

## Installation

### Quick Start with npx

Run Air Traffic directly without installing — just make sure your environment variables are set:

```bash
# Set required env vars (or use a .env file in the current directory)
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_APP_TOKEN=xapp-...
export SLACK_SIGNING_SECRET=...
export ATC_MACHINE_NAME=my-machine

npx air-traffic
```

### Global Install

Install globally to get the `air-traffic` command:

```bash
npm install -g air-traffic
air-traffic
```

### From Source

```bash
git clone https://github.com/danielgerlag/air-traffic.git
cd air-traffic
npm install
cp .env.example .env
```

Edit `.env` with your Slack credentials and machine config:

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_SIGNING_SECRET=your-signing-secret
ATC_MACHINE_NAME=my-machine
```

Then run:

```bash
npm run dev
```

## Configuration

| Variable | Description | Default |
|---|---|---|
| `SLACK_BOT_TOKEN` | Bot User OAuth Token (`xoxb-...`) | *required* |
| `SLACK_APP_TOKEN` | App-Level Token with `connections:write` (`xapp-...`) | *required* |
| `SLACK_SIGNING_SECRET` | Slack app signing secret | *required* |
| `ATC_MACHINE_NAME` | Unique name for this machine (e.g. `desktop`, `laptop`) | *required* |
| `ATC_PROJECTS_DIR` | Directory where project working copies are created | `~/projects` |
| `ATC_DATA_DIR` | Directory for project metadata and config storage | `~/.air-traffic/data` |
| `ATC_DEFAULT_MODEL` | Default Copilot model for new projects | `claude-sonnet-4.5` |
| `ATC_LOG_LEVEL` | Log verbosity: `error`, `warn`, `info`, `debug` | `info` |
| `ATC_WEB_PORT` | Port for the Air Traffic Console web UI | `8089` |
| `ATC_PERMISSION_TIMEOUT_MS` | Timeout for permission prompts (ms) | `300000` |
| `ATC_QUESTION_TIMEOUT_MS` | Timeout for agent questions (ms) | `300000` |

## Running

```bash
# Quick run (no install needed)
npx air-traffic

# Development (with hot-reload via tsx)
npm run dev

# Production
npm run build
npm start

# With PM2 (recommended for always-on daemon)
npm install -g pm2
pm2 start dist/index.js --name air-traffic
pm2 save
pm2 startup
```

## Air Traffic Console (Web UI)

The Console is a web dashboard that runs alongside the daemon on port 8089. It provides a browser-based interface for:

- **Dashboard** — View all projects, create/delete projects, see machine status
- **Project View** — Live terminal output, send prompts, abort sessions
- **Config** — Change model, agent, and permission settings per project
- **Settings** — View machine info, available models, and default permissions

### Development

Run the daemon and Vite dev server side by side:

```bash
# Terminal 1: Backend daemon
npm run dev

# Terminal 2: Frontend dev server (with hot-reload + proxy)
npm run console:dev
```

The Vite dev server runs on `http://localhost:5173` and proxies API/Socket.IO calls to `localhost:8089`.

### Production

Build the frontend, then run the daemon — it serves the compiled assets automatically:

```bash
npm run console:build   # Compiles frontend to web/dist/
npm run build           # Compile backend TypeScript
npm start               # Serves everything on port 8089
```

Open `http://localhost:8089` to access the Console.

## Multi-Machine Setup

1. Run `npx air-traffic init` on each machine — give each a unique name (e.g. `desktop`, `laptop`, `cloud-dev`).
2. Each machine gets its own Slack app with a name like "ATC Desktop", "ATC Laptop", etc.
3. DM each bot to control that machine's projects.
4. No shared credentials, no routing conflicts — each app is independent.

## Command Reference

Commands are sent via DM to the bot or with `!` prefix in project channels. You can also type naturally — the NL intent classifier handles common phrases.

### DM Commands (control)

| Command | Description | Example |
|---|---|---|
| `create <name> [--from <url>]` | Create a new project (optionally clone a repo) | `create my-app --from https://github.com/user/repo` |
| `delete [name]` | Delete a project (picker if omitted) | `delete my-app` |
| `list` | List all projects | `list` |
| `config [project] [field] [value]` | Update project config (guided wizard if omitted) | `config my-app model gpt-5` |
| `status` | Show machine status and active sessions | `status` |
| `models` | List available Copilot models | `models` |
| `sessions` | List all Copilot CLI sessions | `sessions` |
| `join [session-id]` | Join a session (picker if omitted) | `join a1b2` |
| `menu` | Show interactive menu with action buttons | `menu` |
| `help` | Show command reference | `help` |

### Project Channel Commands (`#atc-<machine>-<project>`)

In project channels, regular messages are sent as prompts to Copilot. Use `!` prefix for commands:

| Command | Description | Example |
|---|---|---|
| *(any text)* | Send as a prompt to the Copilot agent | `Add user authentication with JWT` |
| `!model [name]` | Change the model (picker if omitted) | `!model gpt-5` |
| `!agent [name]` | Set the agent type | `!agent code-review` |
| `!mode [mode]` | Set operating mode (picker if omitted) | `!mode autopilot` |
| `!status` | Show project status and session state | `!status` |
| `!abort` | Abort the current agent session | `!abort` |
| `!diff` | Show `git diff` of the project directory | `!diff` |
| `!history` | Show session message history | `!history` |
| `!sessions` | List all Copilot CLI sessions | `!sessions` |
| `!join [id]` | Join a session (picker if omitted) | `!join a1b2` |
| `!leave` | Detach from session without killing it | `!leave` |
| `!help` | Show project command reference | `!help` |

## Architecture

```
┌──────────────────────────────────────────────┐
│                  Slack                        │
│         (phone / desktop client)              │
└──────────────┬───────────────────┬────────────┘
               │  Socket Mode      │
┌──────────────▼───────────────────▼────────────┐
│           SlackAdapter                        │
│    (implements MessagingAdapter)               │
├───────────────────────────────────────────────┤
│           AirTrafficDaemon                       │
│  ┌─────────────┐  ┌────────────────────────┐  │
│  │ ProjectMgr   │  │ SessionOrchestrator    │  │
│  │ (CRUD, store)│  │ (CopilotClient, pool)  │  │
│  └─────────────┘  └────────────────────────┘  │
│  ┌─────────────┐  ┌────────────────────────┐  │
│  │PermissionMgr│  │ ModelRegistry           │  │
│  └─────────────┘  └────────────────────────┘  │
├───────────────────────────────────────────────┤
│           AgentSession (per project)          │
│  - Copilot SDK session with streaming         │
│  - Delta batching for Slack messages          │
│  - Permission & question flow via adapter     │
└──────────────┬────────────────────────────────┘
               │
┌──────────────▼────────────────────────────────┐
│        GitHub Copilot SDK                     │
│   (CopilotClient / CopilotSession)            │
└───────────────────────────────────────────────┘
```

The `MessagingAdapter` interface (`src/messaging/types.ts`) abstracts all platform-specific communication. To add a new platform, implement the interface and swap it in `src/index.ts`.

## Development

```bash
npm test           # Run tests
npm run test:watch # Watch mode
npm run build      # Compile TypeScript
```

### Project Structure

```
src/
├── config.ts                  # Env var loading + Zod validation
├── daemon.ts                  # AirTrafficDaemon — main command router
├── index.ts                   # Entry point — wires config, adapter, daemon
├── cli/
│   ├── init.ts                # Setup wizard (npx air-traffic init)
│   └── manifest-template.ts   # Generates per-machine Slack app manifest
├── copilot/
│   ├── agent-session.ts       # Per-project Copilot session with streaming
│   ├── session-orchestrator.ts# CopilotClient lifecycle + session pool
│   ├── permission-manager.ts  # Tool → category mapping + policy check
│   └── model-registry.ts     # Known model list
├── messaging/
│   ├── types.ts               # Platform-agnostic interfaces
│   ├── adapter.ts             # BaseMessagingAdapter (shared event dispatch)
│   ├── in-memory-adapter.ts   # Test double
│   ├── intent.ts              # NL intent classifier (synonym/keyword map)
│   └── slack/
│       ├── slack-adapter.ts   # Slack Bolt integration
│       ├── commands.ts        # Message parsing (control + project channels)
│       ├── formatters.ts      # Block Kit formatting (help, menu, welcome)
│       └── presence.ts        # Heartbeat manager
├── projects/
│   ├── types.ts               # ProjectConfig, PermissionPolicy
│   ├── project-manager.ts     # CRUD + validation
│   └── project-store.ts       # JSON file persistence
├── utils/
│   ├── errors.ts              # Typed error hierarchy
│   └── logger.ts              # Winston logger
└── web/
    ├── server.ts              # Express + Socket.IO server
    ├── api-routes.ts          # REST API endpoints
    ├── socket-handlers.ts     # Socket.IO event handlers
    └── session-bridge.ts      # AgentSession → Socket.IO bridge

web/                           # React frontend (Vite + Tailwind)
├── src/
│   ├── App.tsx                # Router + layout
│   ├── pages/                 # Dashboard, ProjectView, Settings
│   ├── components/            # SessionTerminal, PromptInput, ConfigPanel
│   ├── hooks/                 # useProjects, useSession, useStatus
│   └── lib/                   # API client, Socket.IO client, types
└── dist/                      # Built frontend (served by Express)
```

## License

MIT

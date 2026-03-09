# Wingman

> Remote GitHub Copilot orchestration via Slack — from your phone.

## Overview

Wingman runs as a daemon on your development machine, watches Slack channels for commands and prompts, and bridges them to GitHub Copilot's agent SDK. You prompt Copilot from your phone (or any Slack client), and the agent executes tasks in your project directories — editing files, running shells, committing code — while streaming results back to Slack.

**Key features:**

- **Multi-machine support** — Run Wingman on multiple machines (desktop, laptop, cloud VM) and control all of them from a single Slack workspace. Each machine registers with a unique name and commands are routed accordingly.
- **Project isolation** — Each project gets its own Slack channel, working directory, Copilot session, and permission policy.
- **Permission controls** — Granular per-project policies for file edits, shell commands, git operations, and network access (auto-approve or ask-via-Slack).
- **Messaging abstraction** — The core logic is platform-agnostic. Slack is the first adapter; Discord, Teams, and others can be added by implementing the `MessagingAdapter` interface.

## Prerequisites

- **Node.js 18+**
- **GitHub Copilot CLI** installed and authenticated — verify with `copilot --version`
- **Active GitHub Copilot subscription** (Individual, Business, or Enterprise)
- **Slack workspace** with admin access to create apps

## Slack App Setup

### Option A: From manifest (recommended)

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From an app manifest**
2. Select your workspace
3. Paste the contents of [`slack-app-manifest.yaml`](./slack-app-manifest.yaml) from this repo
4. Click **Create** — all scopes, events, and Socket Mode are configured automatically
5. **Install to Workspace** → authorize the app
6. Collect your tokens:
   - **Basic Information** → **App Credentials** → copy **Signing Secret** → `SLACK_SIGNING_SECRET`
   - **OAuth & Permissions** → copy **Bot User OAuth Token** → `SLACK_BOT_TOKEN` (starts with `xoxb-`)
   - **Basic Information** → **App-Level Tokens** → generate one with `connections:write` scope → `SLACK_APP_TOKEN` (starts with `xapp-`)

### Option B: Manual setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**. Give it a name (e.g. "Wingman") and select your workspace.

2. **OAuth & Permissions** → Scroll to **Scopes** → Add these **Bot Token Scopes**:
   - `channels:manage`, `channels:read`, `channels:history`, `channels:join`
   - `chat:write`, `chat:write.public`
   - `reactions:read`, `reactions:write`
   - `groups:read`, `groups:history`, `groups:write`
   - `users:read`, `im:history`

3. **Socket Mode** → **Enable Socket Mode** → Create an **App-Level Token** with the `connections:write` scope. Copy the token — this is your `SLACK_APP_TOKEN` (starts with `xapp-`).

4. **Event Subscriptions** → **Enable Events** → Under **Subscribe to bot events**, add:
   - `message.channels`
   - `message.groups`

5. **Interactivity & Shortcuts** → **Enable Interactivity** (required for Block Kit button actions).

6. **Install to Workspace** → Click **Install to Workspace** and authorize. Copy the **Bot User OAuth Token** — this is your `SLACK_BOT_TOKEN` (starts with `xoxb-`).

7. **Basic Information** → Scroll to **App Credentials** → Copy the **Signing Secret** — this is your `SLACK_SIGNING_SECRET`.

## Installation

```bash
git clone <repo-url>
cd wingman
npm install
cp .env.example .env
# Edit .env with your Slack credentials and machine config
```

## Configuration

| Variable | Description | Default |
|---|---|---|
| `SLACK_BOT_TOKEN` | Bot User OAuth Token (`xoxb-...`) | *required* |
| `SLACK_APP_TOKEN` | App-Level Token with `connections:write` (`xapp-...`) | *required* |
| `SLACK_SIGNING_SECRET` | Slack app signing secret | *required* |
| `WINGMAN_MACHINE_NAME` | Unique name for this machine (e.g. `desktop`, `laptop`) | *required* |
| `WINGMAN_PROJECTS_DIR` | Directory where project working copies are created | `./projects` |
| `WINGMAN_DATA_DIR` | Directory for project metadata and config storage | `./data` |
| `WINGMAN_DEFAULT_MODEL` | Default Copilot model for new projects | `claude-sonnet-4.5` |
| `WINGMAN_LOG_LEVEL` | Log verbosity: `error`, `warn`, `info`, `debug` | `info` |
| `WINGMAN_WEB_PORT` | Port for the Wingman Console web UI | `8089` |
| `WINGMAN_PERMISSION_TIMEOUT_MS` | Timeout for permission prompts (ms) | `300000` |
| `WINGMAN_QUESTION_TIMEOUT_MS` | Timeout for agent questions (ms) | `300000` |

## Running

```bash
# Development (with hot-reload via tsx)
npm run dev

# Production
npm run build
npm start

# With PM2 (recommended for always-on daemon)
npm install -g pm2
pm2 start dist/index.js --name wingman
pm2 save
pm2 startup
```

## Wingman Console (Web UI)

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

1. Deploy Wingman to each machine you want to control.
2. Set a unique `WINGMAN_MACHINE_NAME` on each (e.g. `desktop`, `laptop`, `cloud-dev`).
3. All machines share the same Slack app credentials and connect to the same workspace.
4. Target a specific machine by prefixing commands with its name:
   ```
   desktop: create my-app
   laptop: status
   ```
5. Broadcast commands (e.g. `status`, `machines`) are received by all machines.

## Command Reference

All commands use the `/wm` slash command. The behavior depends on which channel you're in.

### From Any Channel (control commands)

| Command | Description | Example |
|---|---|---|
| `/wm <machine>: create <name> [--from <url>]` | Create a new project (optionally clone a repo) | `/wm desktop: create my-app --from https://github.com/user/repo` |
| `/wm <machine>: delete <name>` | Delete a project and archive its channel | `/wm desktop: delete my-app` |
| `/wm <machine>: list` | List all projects on a machine | `/wm desktop: list` |
| `/wm <machine>: config <project> <field> <value>` | Update project config | `/wm desktop: config my-app model gpt-5` |
| `/wm <machine>: status` | Show machine status and active sessions | `/wm desktop: status` |
| `/wm <machine>: models` | List available Copilot models | `/wm desktop: models` |
| `/wm status` | Broadcast — all machines report status | `/wm status` |
| `/wm machines` | Broadcast — all machines report presence | `/wm machines` |

### From a Project Channel (`#wm-<machine>-<project>`)

In project channels, prompts are sent as regular messages. Use `/wm` for commands:

| Command | Description | Example |
|---|---|---|
| *(any text)* | Send as a prompt to the Copilot agent | `Add user authentication with JWT` |
| `/wm model <model>` | Change the model for this project | `/wm model gpt-5` |
| `/wm agent <agent-name>` | Set the agent type | `/wm agent code-review` |
| `/wm status` | Show project status and session state | `/wm status` |
| `/wm abort` | Abort the current agent session | `/wm abort` |
| `/wm diff` | Show `git diff` of the project directory | `/wm diff` |
| `/wm history` | Show session history (placeholder) | `/wm history` |

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
│           WingmanDaemon                       │
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
├── daemon.ts                  # WingmanDaemon — main command router
├── index.ts                   # Entry point — wires config, adapter, daemon
├── copilot/
│   ├── agent-session.ts       # Per-project Copilot session with streaming
│   ├── session-orchestrator.ts# CopilotClient lifecycle + session pool
│   ├── permission-manager.ts  # Tool → category mapping + policy check
│   └── model-registry.ts     # Known model list
├── messaging/
│   ├── types.ts               # Platform-agnostic interfaces
│   ├── adapter.ts             # BaseMessagingAdapter (shared event dispatch)
│   ├── in-memory-adapter.ts   # Test double
│   └── slack/
│       ├── slack-adapter.ts   # Slack Bolt integration
│       ├── commands.ts        # Message parsing (control + project channels)
│       ├── formatters.ts      # Block Kit formatting
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

ISC

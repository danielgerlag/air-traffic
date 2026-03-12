# Slack Setup Guide

This guide walks through setting up Air Traffic with Slack.

## Prerequisites

- **Slack workspace** with admin access to create apps
- **Node.js 18+**
- **GitHub Copilot CLI** installed and authenticated

## Option A: Setup wizard (recommended)

```bash
npx air-traffic init
```

Choose **slack** as the platform. The wizard will:

1. Ask for your machine name (e.g. `desktop`, `laptop`)
2. Generate a customized Slack app manifest
3. Guide you through creating the app at [api.slack.com/apps](https://api.slack.com/apps)
4. Prompt you for the three required tokens
5. Write a `.env` file with your configuration

> **Multi-machine setup**: Run `npx air-traffic init` on each machine with a different machine name. Each machine gets its own Slack app — no conflicts, no routing issues.

## Option B: From manifest (manual)

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From an app manifest**
2. Select your workspace
3. Paste the contents of [`slack-app-manifest.yaml`](../slack-app-manifest.yaml) from this repo
4. Click **Create** — all scopes, events, and Socket Mode are configured automatically
5. **Install to Workspace** → authorize the app
6. Collect your tokens:
   - **Basic Information** → **App Credentials** → copy **Signing Secret** → `SLACK_SIGNING_SECRET`
   - **OAuth & Permissions** → copy **Bot User OAuth Token** → `SLACK_BOT_TOKEN` (starts with `xoxb-`)
   - **Basic Information** → **App-Level Tokens** → generate one with `connections:write` scope → `SLACK_APP_TOKEN` (starts with `xapp-`)

## Option C: Manual setup

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

## Environment Variables

Create a `.env` file (or set these variables in your environment):

```env
ATC_PLATFORM=slack
ATC_MACHINE_NAME=my-machine
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_SIGNING_SECRET=your-signing-secret
ATC_PROJECTS_DIR=~/projects
ATC_DEFAULT_MODEL=claude-sonnet-4.5
```

## Running

```bash
npx air-traffic
```

DM the bot in Slack to get started. Type `menu` for interactive options or `help` for a command list.

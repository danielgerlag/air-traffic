# Discord Setup Guide

This guide walks through setting up Air Traffic with Discord.

## Prerequisites

- **Discord server** where you have admin/manage permissions
- **Node.js 18+**
- **GitHub Copilot CLI** installed and authenticated

## Option A: Setup wizard (recommended)

```bash
npx air-traffic init
```

Choose **discord** as the platform. The wizard will:

1. Ask for your machine name (e.g. `desktop`, `laptop`)
2. Guide you through creating a Discord bot at the Developer Portal
3. Prompt for your bot token and server ID
4. Write a `.env` file with your configuration

## Option B: Manual setup

### 1. Create a Discord Application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → name it "Air Traffic" (or "ATC Desktop", etc.)
3. Click **Create**

### 2. Configure the Bot

1. Navigate to the **Bot** section in the left sidebar
2. Click **Reset Token** and copy the token — this is your `DISCORD_BOT_TOKEN`
3. Under **Privileged Gateway Intents**, enable:
   - ✅ **MESSAGE CONTENT INTENT** (required to read message text)
4. Optionally disable **Public Bot** if you don't want others to add it

### 3. Generate Invite URL

1. Navigate to **OAuth2** → **URL Generator**
2. Select scopes:
   - ✅ `bot`
   - ✅ `applications.commands`
3. Select bot permissions:
   - ✅ Manage Channels
   - ✅ Send Messages
   - ✅ Embed Links
   - ✅ Attach Files
   - ✅ Read Message History
   - ✅ Create Public Threads
   - ✅ Manage Threads
   - ✅ Use External Emojis
4. Copy the generated URL and open it in your browser
5. Select your server and authorize the bot

### 4. Get your Server ID

1. In Discord, go to **Settings** → **Advanced** → enable **Developer Mode**
2. Right-click your server name in the sidebar → **Copy Server ID**
3. This is your `DISCORD_GUILD_ID`

### 5. (Optional) Animated Spinner Emoji

Upload an animated GIF as a custom emoji to your server (e.g., a loading spinner). Then reference it as:

```
<a:loading:EMOJI_ID>
```

To find the emoji ID, type `\:loading:` in a Discord channel — it will show the full format. Set this as `DISCORD_SPINNER_EMOJI` for animated loading indicators.

## Environment Variables

Create a `.env` file (or set these variables in your environment):

```env
ATC_PLATFORM=discord
ATC_MACHINE_NAME=my-machine
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_GUILD_ID=your-server-id
ATC_PROJECTS_DIR=~/projects
ATC_DEFAULT_MODEL=claude-sonnet-4.5

# Optional
DISCORD_SPINNER_EMOJI=<a:loading:123456789>
```

## Running

```bash
npx air-traffic
```

DM the bot in Discord to get started. Type `menu` for interactive options or `help` for a command list.

## How It Works

Air Traffic creates an **"Air Traffic" category** in your Discord server and organizes project channels under it:

```
Air Traffic (category)
├── #atc-desktop-my-app
├── #atc-desktop-api-server
└── #atc-machines (registry)
```

### Interaction Mapping

| Feature | Discord |
|---------|---------|
| Project channels | Text channels under category |
| Threaded replies | Discord threads |
| Buttons | Discord button components |
| Dropdowns | String select menus |
| Rich formatting | Embeds with color |
| File upload | Discord attachment system |
| Typing indicator | `sendTyping()` (auto-refreshed) |
| Status | Bot presence activity |

### Differences from Slack

- **Message limit**: Discord allows 2000 characters per message (vs Slack's 4000)
- **No archive**: Discord channels are deleted instead of archived
- **No assistant status**: Uses typing indicator instead of Slack's `assistant.threads.setStatus`
- **File downloads**: Discord CDN URLs are public (no auth token needed)
- **Interactions**: Must be acknowledged within 3 seconds

## Multi-Machine Setup

1. Run `npx air-traffic init` on each machine — give each a unique name
2. Each machine needs its **own Discord bot application** (just like Slack, each gets its own bot identity)
3. Create a separate app at the [Developer Portal](https://discord.com/developers/applications) for each machine (e.g. "ATC Desktop", "ATC Laptop")
4. All bots can be invited to the same Discord server — channels are namespaced (`#atc-desktop-myapp`, `#atc-laptop-myapp`)
5. DM each bot to control that machine's projects

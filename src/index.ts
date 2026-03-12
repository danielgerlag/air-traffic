#!/usr/bin/env node

// Handle subcommands before loading config (which requires env vars)
const subcommand = process.argv[2];
if (subcommand === 'init') {
  const { runInit } = await import('./cli/init.js');
  await runInit();
  process.exit(0);
}

import { loadConfig } from './config.js';
import { createLogger } from './utils/logger.js';
import { AirTrafficDaemon } from './daemon.js';
import { createRequire } from 'node:module';
import type { MessagingAdapter } from './messaging/types.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { name: string; version: string };

const config = loadConfig();
const log = createLogger(config.airTraffic.logLevel, config.airTraffic.machineName);

let adapter: MessagingAdapter;

if (config.platform === 'discord') {
  const { DiscordAdapter } = await import('./messaging/discord/discord-adapter.js');
  adapter = new DiscordAdapter({
    botToken: config.discord!.botToken,
    guildId: config.discord!.guildId,
    machineName: config.airTraffic.machineName,
    version: pkg.version,
    spinnerEmoji: config.discord!.spinnerEmoji,
    permissionTimeoutMs: config.airTraffic.permissionTimeoutMs,
    questionTimeoutMs: config.airTraffic.questionTimeoutMs,
  });
} else {
  const { SlackAdapter } = await import('./messaging/slack/slack-adapter.js');
  adapter = new SlackAdapter({
    botToken: config.slack!.botToken,
    appToken: config.slack!.appToken,
    signingSecret: config.slack!.signingSecret,
    machineName: config.airTraffic.machineName,
    version: pkg.version,
  });
}

const daemon = new AirTrafficDaemon(config, adapter, pkg);

async function shutdown(signal: string): Promise<void> {
  log.info(`Received ${signal}, shutting down...`);
  try {
    await daemon.stop();
  } catch (err) {
    log.error('Error during shutdown', { error: err });
  }
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await daemon.start();
log.info(`Air Traffic v${pkg.version} is ready — machine: ${config.airTraffic.machineName} — platform: ${config.platform}`);

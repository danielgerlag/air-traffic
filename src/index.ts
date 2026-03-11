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
import { SlackAdapter } from './messaging/slack/slack-adapter.js';
import { AirTrafficDaemon } from './daemon.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { name: string; version: string };

const config = loadConfig();
const log = createLogger(config.airTraffic.logLevel, config.airTraffic.machineName);

const adapter = new SlackAdapter({
  botToken: config.slack.botToken,
  appToken: config.slack.appToken,
  signingSecret: config.slack.signingSecret,
  machineName: config.airTraffic.machineName,
  version: pkg.version,
});

const daemon = new AirTrafficDaemon(config, adapter);

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
log.info(`Air Traffic v${pkg.version} is ready — machine: ${config.airTraffic.machineName}`);

// Check for newer version on npm (non-blocking)
try {
  const res = await fetch(`https://registry.npmjs.org/${pkg.name}/latest`, { signal: AbortSignal.timeout(5000) });
  if (res.ok) {
    const data = (await res.json()) as { version?: string };
    if (data.version && data.version !== pkg.version) {
      log.warn(`A newer version of Air Traffic is available: v${data.version} (current: v${pkg.version}). Run: npm install -g ${pkg.name}`);
    }
  }
} catch {
  // Ignore — network may be unavailable
}

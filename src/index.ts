import { loadConfig } from './config.js';
import { createLogger } from './utils/logger.js';
import { SlackAdapter } from './messaging/slack/slack-adapter.js';
import { WingmanDaemon } from './daemon.js';

const config = loadConfig();
const log = createLogger(config.wingman.logLevel, config.wingman.machineName);

const adapter = new SlackAdapter({
  botToken: config.slack.botToken,
  appToken: config.slack.appToken,
  signingSecret: config.slack.signingSecret,
  machineName: config.wingman.machineName,
});

const daemon = new WingmanDaemon(config, adapter);

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
log.info(`Wingman is ready — machine: ${config.wingman.machineName}`);

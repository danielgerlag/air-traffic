import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Prevent dotenv from loading the real .env file during tests
vi.mock('dotenv', () => ({ config: () => ({}) }));

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // Remove any .env-injected values so tests control the environment
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('SLACK_') || key.startsWith('ATC_')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should load valid config from environment variables', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
    process.env.SLACK_APP_TOKEN = 'xapp-test';
    process.env.SLACK_SIGNING_SECRET = 'secret';
    process.env.ATC_MACHINE_NAME = 'desktop';
    process.env.ATC_PROJECTS_DIR = '/tmp/projects';
    process.env.ATC_DATA_DIR = '/tmp/data';
    process.env.ATC_DEFAULT_MODEL = 'gpt-5';
    process.env.ATC_LOG_LEVEL = 'debug';

    const { loadConfig } = await import('../../src/config.js');
    const config = loadConfig();

    expect(config.slack.botToken).toBe('xoxb-test');
    expect(config.slack.appToken).toBe('xapp-test');
    expect(config.slack.signingSecret).toBe('secret');
    expect(config.airTraffic.machineName).toBe('desktop');
    expect(config.airTraffic.projectsDir).toBe('/tmp/projects');
    expect(config.airTraffic.dataDir).toBe('/tmp/data');
    expect(config.airTraffic.defaultModel).toBe('gpt-5');
    expect(config.airTraffic.logLevel).toBe('debug');
  });

  it('should apply defaults for optional fields', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
    process.env.SLACK_APP_TOKEN = 'xapp-test';
    process.env.SLACK_SIGNING_SECRET = 'secret';
    process.env.ATC_MACHINE_NAME = 'laptop';
    delete process.env.ATC_DEFAULT_MODEL;
    delete process.env.ATC_LOG_LEVEL;

    const { loadConfig } = await import('../../src/config.js');
    const config = loadConfig();

    expect(config.airTraffic.defaultModel).toBe('claude-sonnet-4.5');
    expect(config.airTraffic.logLevel).toBe('info');
  });

  it('should throw when SLACK_BOT_TOKEN is missing', async () => {
    process.env.SLACK_APP_TOKEN = 'xapp-test';
    process.env.SLACK_SIGNING_SECRET = 'secret';
    process.env.ATC_MACHINE_NAME = 'desktop';
    delete process.env.SLACK_BOT_TOKEN;

    const { loadConfig } = await import('../../src/config.js');
    expect(() => loadConfig()).toThrow();
  });

  it('should throw when ATC_MACHINE_NAME is missing', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
    process.env.SLACK_APP_TOKEN = 'xapp-test';
    process.env.SLACK_SIGNING_SECRET = 'secret';
    delete process.env.ATC_MACHINE_NAME;

    const { loadConfig } = await import('../../src/config.js');
    expect(() => loadConfig()).toThrow();
  });

  it('should reject invalid log level', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
    process.env.SLACK_APP_TOKEN = 'xapp-test';
    process.env.SLACK_SIGNING_SECRET = 'secret';
    process.env.ATC_MACHINE_NAME = 'desktop';
    process.env.ATC_LOG_LEVEL = 'verbose';

    const { loadConfig } = await import('../../src/config.js');
    expect(() => loadConfig()).toThrow();
  });
});

import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';
import path from 'node:path';
import os from 'node:os';

dotenvConfig();

const DEFAULT_DATA_DIR = path.join(os.homedir(), '.air-traffic', 'data');
const DEFAULT_PROJECTS_DIR = path.join(os.homedir(), 'projects');

const ConfigSchema = z.object({
  platform: z.enum(['slack', 'discord']).default('slack'),
  slack: z.object({
    botToken: z.string().min(1, 'SLACK_BOT_TOKEN is required'),
    appToken: z.string().min(1, 'SLACK_APP_TOKEN is required'),
    signingSecret: z.string().min(1, 'SLACK_SIGNING_SECRET is required'),
  }).optional(),
  discord: z.object({
    botToken: z.string().min(1, 'DISCORD_BOT_TOKEN is required'),
    guildId: z.string().min(1, 'DISCORD_GUILD_ID is required'),
    spinnerEmoji: z.string().optional(),
  }).optional(),
  airTraffic: z.object({
    machineName: z.string().min(1, 'ATC_MACHINE_NAME is required'),
    projectsDir: z.string().min(1),
    dataDir: z.string().min(1),
    defaultModel: z.string().default('claude-sonnet-4.5'),
    logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    permissionTimeoutMs: z.number().default(300_000),
    questionTimeoutMs: z.number().default(300_000),
    webPort: z.number().default(8089),
  }),
}).refine(
  (cfg) =>
    (cfg.platform === 'slack' && cfg.slack != null) ||
    (cfg.platform === 'discord' && cfg.discord != null),
  { message: 'Platform-specific config section is required (slack or discord)' },
);

export type AirTrafficConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(): AirTrafficConfig {
  const platform = (process.env.ATC_PLATFORM ?? 'slack') as 'slack' | 'discord';

  const raw: Record<string, unknown> = {
    platform,
    airTraffic: {
      machineName: process.env.ATC_MACHINE_NAME ?? '',
      projectsDir: process.env.ATC_PROJECTS_DIR ?? DEFAULT_PROJECTS_DIR,
      dataDir: process.env.ATC_DATA_DIR ?? DEFAULT_DATA_DIR,
      defaultModel: process.env.ATC_DEFAULT_MODEL ?? 'claude-sonnet-4.5',
      logLevel: process.env.ATC_LOG_LEVEL ?? 'info',
      permissionTimeoutMs: Number(process.env.ATC_PERMISSION_TIMEOUT_MS) || 300_000,
      questionTimeoutMs: Number(process.env.ATC_QUESTION_TIMEOUT_MS) || 300_000,
      webPort: Number(process.env.ATC_WEB_PORT) || 8089,
    },
  };

  if (platform === 'slack') {
    raw.slack = {
      botToken: process.env.SLACK_BOT_TOKEN ?? '',
      appToken: process.env.SLACK_APP_TOKEN ?? '',
      signingSecret: process.env.SLACK_SIGNING_SECRET ?? '',
    };
  } else {
    raw.discord = {
      botToken: process.env.DISCORD_BOT_TOKEN ?? '',
      guildId: process.env.DISCORD_GUILD_ID ?? '',
      spinnerEmoji: process.env.DISCORD_SPINNER_EMOJI || undefined,
    };
  }

  return ConfigSchema.parse(raw) as AirTrafficConfig;
}

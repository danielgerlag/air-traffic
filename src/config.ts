import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';
import path from 'node:path';

dotenvConfig();

const ConfigSchema = z.object({
  slack: z.object({
    botToken: z.string().min(1, 'SLACK_BOT_TOKEN is required'),
    appToken: z.string().min(1, 'SLACK_APP_TOKEN is required'),
    signingSecret: z.string().min(1, 'SLACK_SIGNING_SECRET is required'),
  }),
  wingman: z.object({
    machineName: z.string().min(1, 'WINGMAN_MACHINE_NAME is required'),
    projectsDir: z.string().min(1),
    dataDir: z.string().min(1),
    defaultModel: z.string().default('claude-sonnet-4.5'),
    logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    permissionTimeoutMs: z.number().default(300_000),
    questionTimeoutMs: z.number().default(300_000),
    webPort: z.number().default(8089),
  }),
});

export type WingmanConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(): WingmanConfig {
  const raw = {
    slack: {
      botToken: process.env.SLACK_BOT_TOKEN ?? '',
      appToken: process.env.SLACK_APP_TOKEN ?? '',
      signingSecret: process.env.SLACK_SIGNING_SECRET ?? '',
    },
    wingman: {
      machineName: process.env.WINGMAN_MACHINE_NAME ?? '',
      projectsDir: process.env.WINGMAN_PROJECTS_DIR ?? path.join(process.cwd(), 'projects'),
      dataDir: process.env.WINGMAN_DATA_DIR ?? path.join(process.cwd(), 'data'),
      defaultModel: process.env.WINGMAN_DEFAULT_MODEL ?? 'claude-sonnet-4.5',
      logLevel: process.env.WINGMAN_LOG_LEVEL ?? 'info',
      permissionTimeoutMs: Number(process.env.WINGMAN_PERMISSION_TIMEOUT_MS) || 300_000,
      questionTimeoutMs: Number(process.env.WINGMAN_QUESTION_TIMEOUT_MS) || 300_000,
      webPort: Number(process.env.WINGMAN_WEB_PORT) || 8089,
    },
  };

  return ConfigSchema.parse(raw);
}

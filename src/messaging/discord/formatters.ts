/**
 * Discord-specific formatters.
 *
 * Unlike Slack's Block Kit, Discord uses embeds and component rows.
 * These formatters return `MessageContent` where `blocks` carries
 * Discord-specific embed / component payloads that the adapter
 * interprets when sending.
 */
import type { MessageContent, MachineStatus } from '../types.js';

// ─── Shared ──────────────────────────────────────────────────────────

const STATUS_EMOJI: Record<string, string> = {
  running: '⏳',
  complete: '✅',
  error: '❌',
  idle: '💤',
};

/** Brand color for Air Traffic embeds. */
const EMBED_COLOR = 0x1e90ff; // DodgerBlue

// ─── Public formatters ──────────────────────────────────────────────

export function formatTaskStatus(
  projectName: string,
  status: 'running' | 'complete' | 'error' | 'idle',
  detail?: string,
): MessageContent {
  const emoji = STATUS_EMOJI[status] ?? '❓';
  const text = `${emoji} **${projectName}** — ${status}${detail ? `: ${detail}` : ''}`;
  return {
    text,
    blocks: [{
      type: 'discord_embed',
      title: `${emoji} ${projectName}`,
      description: `${status}${detail ? `\n${detail}` : ''}`,
      color: EMBED_COLOR,
    }],
  };
}

export function formatPermissionRequest(
  toolName: string,
  description: string,
  requestId: string,
  toolCategory?: string,
): MessageContent {
  const categoryLabel = toolCategory ? ` (${toolCategory})` : '';
  const text = `🔧 **Permission request** — \`${toolName}\`${categoryLabel}\n${description}`;
  return {
    text,
    blocks: [
      {
        type: 'discord_embed',
        title: `🔧 Permission request — ${toolName}${categoryLabel}`,
        description,
        color: EMBED_COLOR,
      },
      {
        type: 'discord_action_row',
        requestId,
        components: [
          { style: 'success', label: '✅ Allow', customId: `perm_allow_${requestId}` },
          { style: 'primary', label: '✅ Always Allow', customId: `perm_always_${requestId}` },
          { style: 'danger', label: '❌ Deny', customId: `perm_deny_${requestId}` },
        ],
      },
    ],
  };
}

export function formatQuestion(
  question: string,
  choices: string[] | undefined,
  requestId: string,
): MessageContent {
  const text = `❓ ${question}`;

  const blocks: unknown[] = [
    {
      type: 'discord_embed',
      title: '❓ Question',
      description: question,
      color: EMBED_COLOR,
    },
  ];

  if (choices && choices.length > 0) {
    blocks.push({
      type: 'discord_select',
      requestId,
      placeholder: 'Choose an option…',
      options: choices.map((c, i) => ({
        label: c.length > 100 ? c.slice(0, 97) + '…' : c,
        value: c.length > 100 ? `idx_${i}` : c,
        description: c.length > 100 ? c.slice(0, 100) : undefined,
      })),
    });
  } else {
    blocks.push({
      type: 'discord_embed',
      description: '_Reply in this thread to answer._',
      color: EMBED_COLOR,
    });
  }

  return { text, blocks };
}

export function formatProjectList(
  projects: Array<{ name: string; model: string; status: string }>,
): MessageContent {
  if (projects.length === 0) {
    return {
      text: 'No active projects.',
      blocks: [{
        type: 'discord_embed',
        title: '📋 No active projects.',
        color: EMBED_COLOR,
      }],
    };
  }

  const lines = projects.map(
    (p) => `- **${p.name}** — model: \`${p.model}\` — ${STATUS_EMOJI[p.status] ?? '❓'} ${p.status}`,
  );
  const text = `📋 **Projects (${projects.length})**\n${lines.join('\n')}`;
  return {
    text,
    blocks: [{
      type: 'discord_embed',
      title: `📋 Projects (${projects.length})`,
      description: lines.join('\n'),
      color: EMBED_COLOR,
    }],
  };
}

export function formatMachineStatus(machineName: string, status: MachineStatus): MessageContent {
  const onlineEmoji = status.online ? '🟢' : '🔴';
  const header = `🖥️ **${machineName}** ${onlineEmoji} ${status.online ? 'online' : 'offline'}`;
  const details = [
    `Active sessions: ${status.activeSessions}`,
    `Projects: ${status.projects.length > 0 ? status.projects.join(', ') : 'none'}`,
    `Last seen: ${status.lastSeen.toISOString()}`,
  ].join('\n');

  return {
    text: `${header}\n${details}`,
    blocks: [{
      type: 'discord_embed',
      title: `🖥️ ${machineName} ${onlineEmoji} ${status.online ? 'online' : 'offline'}`,
      description: details,
      color: EMBED_COLOR,
    }],
  };
}

export function formatControlHelp(machineName: string): MessageContent {
  const description = [
    '**Project management**',
    '`create <name> [--from <repo-url>]` — Create a new project',
    '`delete [name]` — Delete a project (picker if omitted)',
    '`list` — List all projects',
    '`config [project] [field] [value]` — Update config',
    '',
    '**Machine**',
    '`status` — Show machine status',
    '`models` — List available models',
    '`sessions` — List all Copilot CLI sessions',
    '`join [session-id]` — Join a session (picker if omitted)',
    '`menu` — Show interactive menu',
    '`help` — Show this help',
    '',
    '_Omit parameters for an interactive picker. You can also type naturally — e.g. "make a project called my-app"._',
  ].join('\n');

  return {
    text: `📖 Air Traffic Commands — machine: ${machineName}\n${description}`,
    blocks: [{
      type: 'discord_embed',
      title: `📖 Air Traffic Commands — ${machineName}`,
      description,
      color: EMBED_COLOR,
    }],
  };
}

export function formatProjectHelp(projectName: string): MessageContent {
  const description = [
    '**Session**',
    '`!status` — Project & session status',
    '`!abort` — Abort the current session',
    '`!sessions` — List all Copilot CLI sessions',
    '`!join [session-id]` — Join a session (picker if omitted)',
    '`!leave` — Detach without killing the session',
    '`!history` — Show session history',
    '`!diff` — Show git diff',
    '',
    '**Config**',
    '`!model [name]` — Change model (picker if omitted)',
    '`!agent [name]` — Change agent (prompts if omitted)',
    '`!mode [normal|plan|autopilot]` — Change mode (picker if omitted)',
    '`!help` — Show this help',
    '',
    '_Omit parameters for an interactive picker. Or just type a message to send a prompt to Copilot._',
  ].join('\n');

  return {
    text: `📖 Project Commands — ${projectName}\n${description}`,
    blocks: [{
      type: 'discord_embed',
      title: `📖 Project Commands — ${projectName}`,
      description,
      color: EMBED_COLOR,
    }],
  };
}

export function formatUnknownCommand(input: string, suggestions: string[]): MessageContent {
  let text = `❌ Unknown command: \`${input}\``;
  if (suggestions.length > 0) {
    text += `\nDid you mean: ${suggestions.map((s) => `\`${s}\``).join(', ')}?`;
  }
  text += '\nType `help` for a list of commands, or `menu` for clickable options.';
  return { text };
}

export function formatMenu(machineName: string): MessageContent {
  const text = `🛫 **Air Traffic — ${machineName}**\nWhat would you like to do?`;
  return {
    text,
    blocks: [
      {
        type: 'discord_embed',
        title: `🛫 Air Traffic — ${machineName}`,
        description: 'What would you like to do?',
        color: EMBED_COLOR,
      },
      {
        type: 'discord_action_row',
        components: [
          { style: 'primary', label: '📦 Create Project', customId: 'menu_create' },
          { style: 'secondary', label: '📋 List Projects', customId: 'menu_list' },
          { style: 'secondary', label: '🗑️ Delete Project', customId: 'menu_delete' },
          { style: 'secondary', label: '⚙️ Config', customId: 'menu_config' },
        ],
      },
      {
        type: 'discord_action_row',
        components: [
          { style: 'secondary', label: '📊 Status', customId: 'menu_status' },
          { style: 'secondary', label: '🤖 Models', customId: 'menu_models' },
          { style: 'secondary', label: '🔗 Sessions', customId: 'menu_sessions' },
          { style: 'secondary', label: '🔌 Join Session', customId: 'menu_join' },
        ],
      },
      {
        type: 'discord_action_row',
        components: [
          { style: 'secondary', label: '❓ Help', customId: 'menu_help' },
        ],
      },
    ],
  };
}

export function formatWelcome(machineName: string, version?: string): MessageContent {
  const versionTag = version ? ` (v${version})` : '';
  const description = [
    'I orchestrate GitHub Copilot on this machine. You can:',
    '- Type commands directly: `create my-app`, `status`, `list`',
    '- Use natural language: _"make a project called api-server"_',
    '- Type `menu` for clickable options',
    '',
    'In project channels, send messages as Copilot prompts or use `!` commands (`!model`, `!abort`).',
  ].join('\n');

  return {
    text: `🛫 Welcome to Air Traffic — ${machineName}!${versionTag}\n${description}`,
    blocks: [{
      type: 'discord_embed',
      title: `🛫 Welcome to Air Traffic — ${machineName}!${versionTag}`,
      description,
      color: EMBED_COLOR,
    }],
  };
}

export function formatError(message: string): MessageContent {
  return {
    text: `❌ **Error:** ${message}`,
    blocks: [{
      type: 'discord_embed',
      title: '❌ Error',
      description: message,
      color: 0xff0000,
    }],
  };
}

export interface ProjectStatusCardInfo {
  projectName: string;
  model: string;
  agent?: string;
  mode?: string;
  branch?: string;
}

export function formatProjectStatusCard(info: ProjectStatusCardInfo): MessageContent {
  const lines: string[] = [];
  if (info.branch) lines.push(`🔀 **Branch:** \`${info.branch}\``);
  lines.push(`🤖 **Model:** \`${info.model}\``);
  if (info.agent) lines.push(`🧑‍💻 **Agent:** \`${info.agent}\``);
  if (info.mode) lines.push(`🚦 **Mode:** \`${info.mode}\``);

  const text = lines.join('\n');
  const blocks: unknown[] = [
    {
      type: 'discord_embed',
      title: info.projectName,
      description: text,
      color: EMBED_COLOR,
    },
  ];

  const branchButtons: Array<{ style: string; label: string; customId: string }> = [];
  if (info.branch) {
    branchButtons.push(
      { style: 'primary', label: '🔀 Switch Branch', customId: `project_card_switch_branch_${info.projectName}` },
      { style: 'primary', label: '🌿 New Branch', customId: `project_card_new_branch_${info.projectName}` },
    );
  }

  const settingButtons = [
    { style: 'secondary', label: '🤖 Change Model', customId: `project_card_change_model_${info.projectName}` },
    { style: 'secondary', label: '🧑‍💻 Change Agent', customId: `project_card_change_agent_${info.projectName}` },
    { style: 'secondary', label: '🚦 Change Mode', customId: `project_card_change_mode_${info.projectName}` },
  ];

  if (branchButtons.length > 0) {
    blocks.push({ type: 'discord_action_row', components: branchButtons });
  }
  blocks.push({ type: 'discord_action_row', components: settingButtons });

  return { text, blocks };
}

export function formatDiff(diff: string): MessageContent {
  const truncated = diff.length > 1900 ? diff.slice(0, 1900) + '\n… (truncated)' : diff;
  const text = `📝 **Diff**\n\`\`\`diff\n${truncated}\n\`\`\``;
  return { text };
}

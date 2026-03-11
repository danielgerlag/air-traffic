import type { MessageContent, MachineStatus, ProjectStatusCardInfo } from '../types.js';

const STATUS_EMOJI: Record<string, string> = {
  running: '⏳',
  complete: '✅',
  error: '❌',
  idle: '💤',
};

export function formatTaskStatus(
  projectName: string,
  status: 'running' | 'complete' | 'error' | 'idle',
  detail?: string,
): MessageContent {
  const emoji = STATUS_EMOJI[status] ?? '❓';
  const text = `${emoji} *${projectName}* — ${status}${detail ? `: ${detail}` : ''}`;
  return {
    text,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text },
      },
      ...(detail
        ? [
            {
              type: 'context',
              elements: [{ type: 'mrkdwn', text: detail }],
            },
          ]
        : []),
    ],
  };
}

export function formatPermissionRequest(
  toolName: string,
  description: string,
  requestId: string,
  toolCategory?: string,
): MessageContent {
  const categoryLabel = toolCategory ? ` (${toolCategory})` : '';
  const text = `🔧 *Permission request* — \`${toolName}\`${categoryLabel}\n${description}`;
  return {
    text,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `🔧 *Permission request* — \`${toolName}\`${categoryLabel}\n${description}` },
      },
      {
        type: 'actions',
        block_id: `perm_${requestId}`,
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Allow' },
            style: 'primary',
            action_id: `perm_allow_${requestId}`,
            value: requestId,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Always Allow' },
            action_id: `perm_always_${requestId}`,
            value: requestId,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '❌ Deny' },
            style: 'danger',
            action_id: `perm_deny_${requestId}`,
            value: requestId,
          },
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
      type: 'section',
      text: { type: 'mrkdwn', text },
    },
  ];

  if (choices && choices.length > 0) {
    // Always use a numbered list + dropdown for reliability.
    // Slack buttons truncate text aggressively; dropdowns show the full label.
    const choiceList = choices.map((c, i) => `${i + 1}. ${c}`).join('\n');
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: choiceList }],
    });

    blocks.push({
      type: 'actions',
      block_id: `question_${requestId}`,
      elements: [
        {
          type: 'static_select',
          placeholder: { type: 'plain_text', text: 'Choose an option…' },
          action_id: `question_choice_${requestId}_0`,
          options: choices.map((choice, i) => ({
            text: {
              type: 'plain_text',
              text: choice.length > 75 ? choice.slice(0, 72) + '…' : choice,
            },
            value: choice.length > 75 ? `idx_${i}` : choice,
          })),
        },
      ],
    });
  } else {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '_Reply in this thread to answer._' }],
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
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: '📋 *No active projects.*' },
        },
      ],
    };
  }

  const lines = projects.map(
    (p) => `• *${p.name}* — model: \`${p.model}\` — ${STATUS_EMOJI[p.status] ?? '❓'} ${p.status}`,
  );
  const text = `📋 *Projects (${projects.length})*\n${lines.join('\n')}`;

  return {
    text,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text },
      },
    ],
  };
}

export function formatMachineStatus(machineName: string, status: MachineStatus): MessageContent {
  const onlineEmoji = status.online ? '🟢' : '🔴';
  const header = `🖥️ *${machineName}* ${onlineEmoji} ${status.online ? 'online' : 'offline'}`;
  const details = [
    `Active sessions: ${status.activeSessions}`,
    `Projects: ${status.projects.length > 0 ? status.projects.join(', ') : 'none'}`,
    `Last seen: ${status.lastSeen.toISOString()}`,
  ].join('\n');
  const text = `${header}\n${details}`;

  return {
    text,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: header },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: details }],
      },
    ],
  };
}

export function formatControlHelp(machineName: string): MessageContent {
  const text = [
    `📖 *Air Traffic Commands* — machine: \`${machineName}\``,
    '',
    '*Project management*',
    '`create <name> [--from <repo-url>]` — Create a new project',
    '`delete [name]` — Delete a project (picker if omitted)',
    '`list` — List all projects',
    '`config [project] [field] [value]` — Update config (guided wizard if omitted)',
    '',
    '*Machine*',
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
    text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text } },
    ],
  };
}

export function formatProjectHelp(projectName: string): MessageContent {
  const text = [
    `📖 *Project Commands* — \`${projectName}\``,
    '',
    '*Session*',
    '`!status` — Project & session status',
    '`!abort` — Abort the current session',
    '`!sessions` — List all Copilot CLI sessions',
    '`!join [session-id]` — Join a session (picker if omitted)',
    '`!leave` — Detach without killing the session',
    '`!history` — Show session history',
    '`!diff` — Show git diff',
    '',
    '*Config*',
    '`!model [name]` — Change model (picker if omitted)',
    '`!agent [name]` — Change agent (prompts if omitted)',
    '`!mode [normal|plan|autopilot]` — Change mode (picker if omitted)',
    '`!help` — Show this help',
    '',
    '_Omit parameters for an interactive picker. Or just type a message to send a prompt to Copilot._',
  ].join('\n');

  return {
    text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text } },
    ],
  };
}

export function formatUnknownCommand(input: string, suggestions: string[]): MessageContent {
  let text = `❌ Unknown command: \`${input}\``;
  if (suggestions.length > 0) {
    text += `\nDid you mean: ${suggestions.map((s) => `\`${s}\``).join(', ')}?`;
  }
  text += '\nType `help` for a list of commands, or `menu` for clickable options.';
  return {
    text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text } },
    ],
  };
}

export function formatMenu(machineName: string): MessageContent {
  const text = `🛫 *Air Traffic — ${machineName}*\nWhat would you like to do?`;
  return {
    text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text } },
      {
        type: 'actions',
        elements: [
          { type: 'button', text: { type: 'plain_text', text: '📦 Create Project', emoji: true }, action_id: 'menu_create', value: 'create' },
          { type: 'button', text: { type: 'plain_text', text: '📋 List Projects', emoji: true }, action_id: 'menu_list', value: 'list' },
          { type: 'button', text: { type: 'plain_text', text: '🗑️ Delete Project', emoji: true }, action_id: 'menu_delete', value: 'delete' },
          { type: 'button', text: { type: 'plain_text', text: '⚙️ Config', emoji: true }, action_id: 'menu_config', value: 'config' },
        ],
      },
      {
        type: 'actions',
        elements: [
          { type: 'button', text: { type: 'plain_text', text: '📊 Status', emoji: true }, action_id: 'menu_status', value: 'status' },
          { type: 'button', text: { type: 'plain_text', text: '🤖 Models', emoji: true }, action_id: 'menu_models', value: 'models' },
          { type: 'button', text: { type: 'plain_text', text: '🔗 Sessions', emoji: true }, action_id: 'menu_sessions', value: 'sessions' },
          { type: 'button', text: { type: 'plain_text', text: '🔌 Join Session', emoji: true }, action_id: 'menu_join', value: 'join' },
        ],
      },
      {
        type: 'actions',
        elements: [
          { type: 'button', text: { type: 'plain_text', text: '❓ Help', emoji: true }, action_id: 'menu_help', value: 'help' },
        ],
      },
    ],
  };
}

export function formatWelcome(machineName: string, version?: string): MessageContent {
  const versionTag = version ? ` (v${version})` : '';
  const text = [
    `🛫 *Welcome to Air Traffic — ${machineName}!*${versionTag}`,
    '',
    'I orchestrate GitHub Copilot on this machine. You can:',
    '• Type commands directly: `create my-app`, `status`, `list`',
    '• Use natural language: _"make a project called api-server"_',
    '• Type `menu` for clickable options',
    '',
    'In project channels, send messages as Copilot prompts or use `!` commands (`!model`, `!abort`).',
  ].join('\n');
  return {
    text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text } },
    ],
  };
}

export function formatError(message: string): MessageContent {
  const text = `❌ *Error:* ${message}`;
  return {
    text,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text },
      },
    ],
  };
}

export function formatProjectStatusCard(info: ProjectStatusCardInfo): MessageContent {
  const lines: string[] = [];
  if (info.branch) lines.push(`🔀 *Branch:* \`${info.branch}\``);
  lines.push(`🤖 *Model:* \`${info.model}\``);
  if (info.agent) lines.push(`🧑‍💻 *Agent:* \`${info.agent}\``);
  if (info.mode) lines.push(`🚦 *Mode:* \`${info.mode}\``);

  const text = lines.join('\n');
  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text } },
  ];

  const branchButtons: unknown[] = [];
  if (info.branch) {
    branchButtons.push(
      { type: 'button', text: { type: 'plain_text', text: '🔀 Switch Branch', emoji: true }, action_id: 'project_card_switch_branch', value: info.projectName },
      { type: 'button', text: { type: 'plain_text', text: '🌿 New Branch', emoji: true }, action_id: 'project_card_new_branch', value: info.projectName },
    );
  }

  const settingButtons: unknown[] = [
    { type: 'button', text: { type: 'plain_text', text: '🤖 Change Model', emoji: true }, action_id: 'project_card_change_model', value: info.projectName },
    { type: 'button', text: { type: 'plain_text', text: '🧑‍💻 Change Agent', emoji: true }, action_id: 'project_card_change_agent', value: info.projectName },
    { type: 'button', text: { type: 'plain_text', text: '🚦 Change Mode', emoji: true }, action_id: 'project_card_change_mode', value: info.projectName },
  ];

  if (branchButtons.length > 0) {
    blocks.push({ type: 'actions', elements: branchButtons });
  }
  blocks.push({ type: 'actions', elements: settingButtons });

  return { text, blocks };
}

export function formatDiff(diff: string): MessageContent {
  const truncated = diff.length > 2900 ? diff.slice(0, 2900) + '\n… (truncated)' : diff;
  const text = `📝 *Diff*\n\`\`\`\n${truncated}\n\`\`\``;
  return {
    text,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `📝 *Diff*` },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `\`\`\`\n${truncated}\n\`\`\`` },
      },
    ],
  };
}

import type { MessageContent, MachineStatus } from '../types.js';

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
              text: choice.length > 148 ? choice.slice(0, 145) + '…' : choice,
            },
            value: choice.length > 73 ? `idx_${i}` : choice,
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
    '`/atc create <name> [--from <repo-url>]` — Create a new project',
    '`/atc delete [name]` — Delete a project (picker if omitted)',
    '`/atc list` — List all projects',
    '`/atc config [project] [field] [value]` — Update config (guided wizard if omitted)',
    '',
    '*Machine*',
    '`/atc status` — Show machine status',
    '`/atc models` — List available models',
    '`/atc sessions` — List all Copilot CLI sessions',
    '`/atc join [session-id]` — Join a session (picker if omitted)',
    '`/atc help` — Show this help',
    '',
    '_Omit parameters for an interactive picker. In a project channel, commands apply to that project directly._',
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
    '`/atc status` — Project & session status',
    '`/atc abort` — Abort the current session',
    '`/atc sessions` — List all Copilot CLI sessions',
    '`/atc join [session-id]` — Join a session (picker if omitted)',
    '`/atc leave` — Detach without killing the session',
    '`/atc history` — Show session history',
    '`/atc diff` — Show git diff',
    '',
    '*Config*',
    '`/atc model [name]` — Change model (picker if omitted)',
    '`/atc agent [name]` — Change agent (prompts if omitted)',
    '`/atc mode [normal|plan|autopilot]` — Change mode (picker if omitted)',
    '`/atc help` — Show this help',
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
  text += '\nType `/atc help` for a list of commands.';
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

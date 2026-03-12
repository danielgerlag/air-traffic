import { describe, it, expect } from 'vitest';
import {
  formatControlHelp,
  formatProjectHelp,
  formatMenu,
  formatWelcome,
  formatPermissionRequest,
  formatQuestion,
  formatError,
  formatProjectStatusCard,
  formatProjectList,
  formatDiff,
} from '../../../src/messaging/discord/formatters.js';

describe('Discord formatControlHelp', () => {
  const help = formatControlHelp('desktop');

  it('includes machine name', () => {
    expect(help.text).toContain('desktop');
  });

  it('lists all control commands', () => {
    for (const cmd of ['create', 'delete', 'list', 'config', 'status', 'models', 'sessions', 'join', 'menu', 'help']) {
      expect(help.text).toContain(cmd);
    }
  });

  it('has discord embed blocks', () => {
    expect(help.blocks).toBeDefined();
    const embed = (help.blocks as any[]).find((b) => b.type === 'discord_embed');
    expect(embed).toBeDefined();
    expect(embed.title).toContain('desktop');
  });
});

describe('Discord formatProjectHelp', () => {
  const help = formatProjectHelp('my-app');

  it('includes project name', () => {
    expect(help.text).toContain('my-app');
  });

  it('lists all project commands', () => {
    for (const cmd of ['status', 'abort', 'sessions', 'join', 'leave', 'history', 'diff', 'model', 'agent', 'mode', 'help']) {
      expect(help.text).toContain(cmd);
    }
  });
});

describe('Discord formatMenu', () => {
  const menu = formatMenu('desktop');

  it('includes machine name', () => {
    expect(menu.text).toContain('desktop');
  });

  it('has action row blocks with buttons', () => {
    const actionRows = (menu.blocks as any[]).filter((b) => b.type === 'discord_action_row');
    expect(actionRows.length).toBeGreaterThan(0);
    const allIds = actionRows.flatMap((r: any) => r.components.map((c: any) => c.customId));
    expect(allIds).toContain('menu_create');
    expect(allIds).toContain('menu_list');
    expect(allIds).toContain('menu_status');
    expect(allIds).toContain('menu_help');
  });
});

describe('Discord formatWelcome', () => {
  it('includes a greeting', () => {
    const welcome = formatWelcome('desktop');
    expect(welcome.text).toMatch(/welcome|air traffic/i);
  });

  it('includes version when provided', () => {
    const welcome = formatWelcome('desktop', '1.2.3');
    expect(welcome.text).toContain('1.2.3');
  });
});

describe('Discord formatPermissionRequest', () => {
  const perm = formatPermissionRequest('bash', 'Run ls -la', 'req123', 'shell');

  it('includes tool name and description', () => {
    expect(perm.text).toContain('bash');
    expect(perm.text).toContain('Run ls -la');
  });

  it('has 3 permission buttons', () => {
    const actionRow = (perm.blocks as any[]).find((b) => b.type === 'discord_action_row');
    expect(actionRow).toBeDefined();
    expect(actionRow.components).toHaveLength(3);
    const ids = actionRow.components.map((c: any) => c.customId);
    expect(ids).toContain('perm_allow_req123');
    expect(ids).toContain('perm_always_req123');
    expect(ids).toContain('perm_deny_req123');
  });
});

describe('Discord formatQuestion', () => {
  it('includes question text', () => {
    const q = formatQuestion('Which model?', undefined, 'q1');
    expect(q.text).toContain('Which model?');
  });

  it('includes select menu with choices', () => {
    const q = formatQuestion('Pick one', ['A', 'B', 'C'], 'q2');
    const select = (q.blocks as any[]).find((b) => b.type === 'discord_select');
    expect(select).toBeDefined();
    expect(select.options).toHaveLength(3);
    expect(select.options[0].label).toBe('A');
  });

  it('shows freeform hint without choices', () => {
    const q = formatQuestion('Enter name', undefined, 'q3');
    const embeds = (q.blocks as any[]).filter((b) => b.type === 'discord_embed');
    const hasHint = embeds.some((e: any) => e.description?.includes('Reply'));
    expect(hasHint).toBe(true);
  });
});

describe('Discord formatError', () => {
  it('includes error message', () => {
    const err = formatError('Something went wrong');
    expect(err.text).toContain('Something went wrong');
    expect(err.text).toContain('❌');
  });
});

describe('Discord formatProjectStatusCard', () => {
  it('includes project info', () => {
    const card = formatProjectStatusCard({
      projectName: 'my-app',
      model: 'claude-sonnet-4.5',
      agent: 'coder',
      mode: 'autopilot',
      branch: 'main',
    });
    expect(card.text).toContain('claude-sonnet-4.5');
    expect(card.text).toContain('coder');
    expect(card.text).toContain('main');
    expect(card.text).toContain('autopilot');
  });

  it('has branch and settings buttons', () => {
    const card = formatProjectStatusCard({
      projectName: 'my-app',
      model: 'gpt-5',
      branch: 'main',
    });
    const rows = (card.blocks as any[]).filter((b) => b.type === 'discord_action_row');
    const allIds = rows.flatMap((r: any) => r.components.map((c: any) => c.customId));
    expect(allIds.some((id: string) => id.includes('switch_branch'))).toBe(true);
    expect(allIds.some((id: string) => id.includes('change_model'))).toBe(true);
  });
});

describe('Discord formatProjectList', () => {
  it('handles empty list', () => {
    const list = formatProjectList([]);
    expect(list.text).toContain('No active projects');
  });

  it('lists projects', () => {
    const list = formatProjectList([
      { name: 'app1', model: 'gpt-5', status: 'running' },
      { name: 'app2', model: 'claude-sonnet-4.5', status: 'idle' },
    ]);
    expect(list.text).toContain('app1');
    expect(list.text).toContain('app2');
    expect(list.text).toContain('2');
  });
});

describe('Discord formatDiff', () => {
  it('includes diff content', () => {
    const d = formatDiff('+ added line\n- removed line');
    expect(d.text).toContain('added line');
    expect(d.text).toContain('removed line');
  });

  it('truncates very long diffs', () => {
    const long = 'x'.repeat(3000);
    const d = formatDiff(long);
    expect(d.text).toContain('truncated');
  });
});

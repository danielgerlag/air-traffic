import { describe, it, expect } from 'vitest';
import {
  formatControlHelp,
  formatProjectHelp,
  formatMenu,
  formatWelcome,
} from '../../../src/messaging/slack/formatters.js';

describe('formatControlHelp', () => {
  const help = formatControlHelp('desktop');

  it('includes machine name', () => {
    expect(help.text).toContain('desktop');
  });

  it('lists all control commands', () => {
    expect(help.text).toContain('create');
    expect(help.text).toContain('delete');
    expect(help.text).toContain('list');
    expect(help.text).toContain('config');
    expect(help.text).toContain('status');
    expect(help.text).toContain('models');
    expect(help.text).toContain('sessions');
    expect(help.text).toContain('join');
    expect(help.text).toContain('menu');
    expect(help.text).toContain('help');
  });

  it('mentions picker behavior', () => {
    expect(help.text).toMatch(/picker/i);
  });

  it('includes Block Kit blocks', () => {
    expect(help.blocks).toBeDefined();
    expect(help.blocks!.length).toBeGreaterThan(0);
  });
});

describe('formatProjectHelp', () => {
  const help = formatProjectHelp('my-app');

  it('includes project name', () => {
    expect(help.text).toContain('my-app');
  });

  it('lists all project commands', () => {
    expect(help.text).toContain('status');
    expect(help.text).toContain('abort');
    expect(help.text).toContain('sessions');
    expect(help.text).toContain('join');
    expect(help.text).toContain('leave');
    expect(help.text).toContain('history');
    expect(help.text).toContain('diff');
    expect(help.text).toContain('model');
    expect(help.text).toContain('agent');
    expect(help.text).toContain('mode');
    expect(help.text).toContain('help');
  });

  it('mentions picker behavior', () => {
    expect(help.text).toMatch(/picker/i);
  });

  it('includes Block Kit blocks', () => {
    expect(help.blocks).toBeDefined();
    expect(help.blocks!.length).toBeGreaterThan(0);
  });
});

describe('formatMenu', () => {
  const menu = formatMenu('desktop');

  it('includes machine name', () => {
    expect(menu.text).toContain('desktop');
  });

  it('includes Block Kit blocks with action buttons', () => {
    expect(menu.blocks).toBeDefined();
    const actionsBlock = menu.blocks!.find((b: any) => b.type === 'actions');
    expect(actionsBlock).toBeDefined();
    expect((actionsBlock as any).elements.length).toBeGreaterThan(0);
  });

  it('has buttons for key commands', () => {
    const actionsBlocks = menu.blocks!.filter((b: any) => b.type === 'actions');
    const actionIds = actionsBlocks.flatMap((b: any) => b.elements.map((e: any) => e.action_id));
    expect(actionIds).toContain('menu_create');
    expect(actionIds).toContain('menu_list');
    expect(actionIds).toContain('menu_status');
    expect(actionIds).toContain('menu_help');
  });
});

describe('formatWelcome', () => {
  const welcome = formatWelcome('desktop');

  it('includes a greeting', () => {
    expect(welcome.text).toMatch(/welcome|air traffic|hello|hi/i);
  });

  it('includes Block Kit blocks', () => {
    expect(welcome.blocks).toBeDefined();
    expect(welcome.blocks!.length).toBeGreaterThan(0);
  });
});

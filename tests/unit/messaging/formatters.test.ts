import { describe, it, expect } from 'vitest';
import {
  formatControlHelp,
  formatProjectHelp,
} from '../../../src/messaging/slack/formatters.js';

describe('formatControlHelp', () => {
  const help = formatControlHelp('desktop');

  it('includes machine name', () => {
    expect(help.text).toContain('desktop');
  });

  it('lists all control commands', () => {
    expect(help.text).toContain('/wm create');
    expect(help.text).toContain('/wm delete');
    expect(help.text).toContain('/wm list');
    expect(help.text).toContain('/wm config');
    expect(help.text).toContain('/wm status');
    expect(help.text).toContain('/wm models');
    expect(help.text).toContain('/wm sessions');
    expect(help.text).toContain('/wm join');
    expect(help.text).toContain('/wm help');
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
    expect(help.text).toContain('/wm status');
    expect(help.text).toContain('/wm abort');
    expect(help.text).toContain('/wm sessions');
    expect(help.text).toContain('/wm join');
    expect(help.text).toContain('/wm leave');
    expect(help.text).toContain('/wm history');
    expect(help.text).toContain('/wm diff');
    expect(help.text).toContain('/wm model');
    expect(help.text).toContain('/wm agent');
    expect(help.text).toContain('/wm mode');
    expect(help.text).toContain('/wm help');
  });

  it('mentions picker behavior', () => {
    expect(help.text).toMatch(/picker/i);
  });

  it('includes Block Kit blocks', () => {
    expect(help.blocks).toBeDefined();
    expect(help.blocks!.length).toBeGreaterThan(0);
  });
});

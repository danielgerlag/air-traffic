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
    expect(help.text).toContain('/atc create');
    expect(help.text).toContain('/atc delete');
    expect(help.text).toContain('/atc list');
    expect(help.text).toContain('/atc config');
    expect(help.text).toContain('/atc status');
    expect(help.text).toContain('/atc models');
    expect(help.text).toContain('/atc sessions');
    expect(help.text).toContain('/atc join');
    expect(help.text).toContain('/atc help');
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
    expect(help.text).toContain('/atc status');
    expect(help.text).toContain('/atc abort');
    expect(help.text).toContain('/atc sessions');
    expect(help.text).toContain('/atc join');
    expect(help.text).toContain('/atc leave');
    expect(help.text).toContain('/atc history');
    expect(help.text).toContain('/atc diff');
    expect(help.text).toContain('/atc model');
    expect(help.text).toContain('/atc agent');
    expect(help.text).toContain('/atc mode');
    expect(help.text).toContain('/atc help');
  });

  it('mentions picker behavior', () => {
    expect(help.text).toMatch(/picker/i);
  });

  it('includes Block Kit blocks', () => {
    expect(help.blocks).toBeDefined();
    expect(help.blocks!.length).toBeGreaterThan(0);
  });
});

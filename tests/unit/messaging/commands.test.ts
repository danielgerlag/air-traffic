import { describe, it, expect } from 'vitest';
import {
  parseControlChannelMessage,
  parseProjectChannelMessage,
  isProjectChannel,
  extractProjectName,
} from '../../../src/messaging/slack/commands.js';

describe('parseControlChannelMessage', () => {
  it('parses targeted create command', () => {
    const result = parseControlChannelMessage('desktop: create my-app');
    expect(result).toEqual({
      type: 'targeted',
      targetMachine: 'desktop',
      command: 'create',
      args: ['my-app'],
    });
  });

  it('parses targeted create with --from arg', () => {
    const result = parseControlChannelMessage(
      'desktop: create my-app --from https://github.com/user/repo',
    );
    expect(result).toEqual({
      type: 'targeted',
      targetMachine: 'desktop',
      command: 'create',
      args: ['my-app', '--from', 'https://github.com/user/repo'],
    });
  });

  it('parses targeted list command', () => {
    const result = parseControlChannelMessage('desktop: list');
    expect(result).toEqual({
      type: 'targeted',
      targetMachine: 'desktop',
      command: 'list',
      args: [],
    });
  });

  it('parses targeted config command', () => {
    const result = parseControlChannelMessage('desktop: config my-app model gpt-5');
    expect(result).toEqual({
      type: 'targeted',
      targetMachine: 'desktop',
      command: 'config',
      args: ['my-app', 'model', 'gpt-5'],
    });
  });

  it('parses targeted delete command', () => {
    const result = parseControlChannelMessage('desktop: delete my-app');
    expect(result).toEqual({
      type: 'targeted',
      targetMachine: 'desktop',
      command: 'delete',
      args: ['my-app'],
    });
  });

  it('parses broadcast status command', () => {
    const result = parseControlChannelMessage('status');
    expect(result).toEqual({
      type: 'broadcast',
      command: 'status',
      args: [],
    });
  });

  it('parses broadcast machines command', () => {
    const result = parseControlChannelMessage('machines');
    expect(result).toEqual({
      type: 'broadcast',
      command: 'machines',
      args: [],
    });
  });

  it('parses models as broadcast command', () => {
    const result = parseControlChannelMessage('models');
    expect(result).toEqual({
      type: 'broadcast',
      command: 'models',
      args: [],
    });
  });

  it('returns null for empty string', () => {
    expect(parseControlChannelMessage('')).toBeNull();
  });

  it('returns null for unknown command', () => {
    expect(parseControlChannelMessage('hello world')).toBeNull();
  });
});

describe('parseProjectChannelMessage', () => {
  it('parses !model command', () => {
    expect(parseProjectChannelMessage('!model gpt-5')).toEqual({
      command: 'model',
      args: ['gpt-5'],
    });
  });

  it('parses !abort command', () => {
    expect(parseProjectChannelMessage('!abort')).toEqual({
      command: 'abort',
      args: [],
    });
  });

  it('parses !status command', () => {
    expect(parseProjectChannelMessage('!status')).toEqual({
      command: 'status',
      args: [],
    });
  });

  it('parses !diff command', () => {
    expect(parseProjectChannelMessage('!diff')).toEqual({
      command: 'diff',
      args: [],
    });
  });

  it('returns null for regular prompt text', () => {
    expect(parseProjectChannelMessage('Add JWT authentication')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseProjectChannelMessage('')).toBeNull();
  });
});

describe('isProjectChannel', () => {
  it('returns true for matching machine prefix', () => {
    expect(isProjectChannel('wm-desktop-my-app', 'desktop')).toBe(true);
  });

  it('returns false for different machine', () => {
    expect(isProjectChannel('wm-laptop-api', 'desktop')).toBe(false);
  });

  it('returns false for control channel', () => {
    expect(isProjectChannel('wingman-control', 'desktop')).toBe(false);
  });

  it('returns false when machine does not match', () => {
    expect(isProjectChannel('wm-desktop-my-app', 'laptop')).toBe(false);
  });
});

describe('extractProjectName', () => {
  it('extracts project name from matching channel', () => {
    expect(extractProjectName('wm-desktop-my-app', 'desktop')).toBe('my-app');
  });

  it('extracts complex project name', () => {
    expect(extractProjectName('wm-desktop-complex-name', 'desktop')).toBe('complex-name');
  });

  it('returns null for different machine', () => {
    expect(extractProjectName('wm-laptop-api', 'desktop')).toBeNull();
  });

  it('returns null for control channel', () => {
    expect(extractProjectName('wingman-control', 'desktop')).toBeNull();
  });
});

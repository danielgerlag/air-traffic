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

  // --- New commands added for sessions/join/help ---

  it('parses targeted sessions command', () => {
    const result = parseControlChannelMessage('desktop: sessions');
    expect(result).toEqual({
      type: 'targeted',
      targetMachine: 'desktop',
      command: 'sessions',
      args: [],
    });
  });

  it('parses sessions as broadcast command', () => {
    const result = parseControlChannelMessage('sessions');
    expect(result).toEqual({
      type: 'broadcast',
      command: 'sessions',
      args: [],
    });
  });

  it('parses targeted join command with session ID', () => {
    const result = parseControlChannelMessage('desktop: join abc12345');
    expect(result).toEqual({
      type: 'targeted',
      targetMachine: 'desktop',
      command: 'join',
      args: ['abc12345'],
    });
  });

  it('parses join without args as broadcast', () => {
    const result = parseControlChannelMessage('join');
    expect(result).toEqual({
      type: 'broadcast',
      command: 'join',
      args: [],
    });
  });

  it('parses targeted help command', () => {
    const result = parseControlChannelMessage('desktop: help');
    expect(result).toEqual({
      type: 'targeted',
      targetMachine: 'desktop',
      command: 'help',
      args: [],
    });
  });

  it('parses help as broadcast command', () => {
    const result = parseControlChannelMessage('help');
    expect(result).toEqual({
      type: 'broadcast',
      command: 'help',
      args: [],
    });
  });

  it('returns null for empty string', () => {
    expect(parseControlChannelMessage('')).toBeNull();
  });

  it('returns null for unknown command', () => {
    expect(parseControlChannelMessage('hello world')).toBeNull();
  });

  it('returns null for unknown targeted command', () => {
    expect(parseControlChannelMessage('desktop: foobar')).toBeNull();
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

  // --- New commands ---

  it('parses !mode command with arg', () => {
    expect(parseProjectChannelMessage('!mode plan')).toEqual({
      command: 'mode',
      args: ['plan'],
    });
  });

  it('parses !mode command without arg', () => {
    expect(parseProjectChannelMessage('!mode')).toEqual({
      command: 'mode',
      args: [],
    });
  });

  it('parses !sessions command', () => {
    expect(parseProjectChannelMessage('!sessions')).toEqual({
      command: 'sessions',
      args: [],
    });
  });

  it('parses !join command with session ID', () => {
    expect(parseProjectChannelMessage('!join abc12345')).toEqual({
      command: 'join',
      args: ['abc12345'],
    });
  });

  it('parses !join without session ID', () => {
    expect(parseProjectChannelMessage('!join')).toEqual({
      command: 'join',
      args: [],
    });
  });

  it('parses !leave command', () => {
    expect(parseProjectChannelMessage('!leave')).toEqual({
      command: 'leave',
      args: [],
    });
  });

  it('parses !agent command', () => {
    expect(parseProjectChannelMessage('!agent my-agent')).toEqual({
      command: 'agent',
      args: ['my-agent'],
    });
  });

  it('parses !history command', () => {
    expect(parseProjectChannelMessage('!history')).toEqual({
      command: 'history',
      args: [],
    });
  });

  it('parses !help command', () => {
    expect(parseProjectChannelMessage('!help')).toEqual({
      command: 'help',
      args: [],
    });
  });

  it('returns null for regular prompt text', () => {
    expect(parseProjectChannelMessage('Add JWT authentication')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseProjectChannelMessage('')).toBeNull();
  });

  it('returns null for unknown command', () => {
    expect(parseProjectChannelMessage('!foobar')).toBeNull();
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

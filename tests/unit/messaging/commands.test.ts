import { describe, it, expect } from 'vitest';
import {
  parseControlChannelMessage,
  parseProjectChannelMessage,
  isProjectChannel,
  extractProjectName,
} from '../../../src/messaging/slack/commands.js';

describe('parseControlChannelMessage', () => {
  it('parses create command', () => {
    const result = parseControlChannelMessage('create my-app');
    expect(result).toEqual({
      command: 'create',
      args: ['my-app'],
    });
  });

  it('parses create with --from arg', () => {
    const result = parseControlChannelMessage(
      'create my-app --from https://github.com/user/repo',
    );
    expect(result).toEqual({
      command: 'create',
      args: ['my-app', '--from', 'https://github.com/user/repo'],
    });
  });

  it('parses list command', () => {
    const result = parseControlChannelMessage('list');
    expect(result).toEqual({
      command: 'list',
      args: [],
    });
  });

  it('parses config command', () => {
    const result = parseControlChannelMessage('config my-app model gpt-5');
    expect(result).toEqual({
      command: 'config',
      args: ['my-app', 'model', 'gpt-5'],
    });
  });

  it('parses delete command', () => {
    const result = parseControlChannelMessage('delete my-app');
    expect(result).toEqual({
      command: 'delete',
      args: ['my-app'],
    });
  });

  it('parses status command', () => {
    const result = parseControlChannelMessage('status');
    expect(result).toEqual({
      command: 'status',
      args: [],
    });
  });

  it('parses models command', () => {
    const result = parseControlChannelMessage('models');
    expect(result).toEqual({
      command: 'models',
      args: [],
    });
  });

  it('parses sessions command', () => {
    const result = parseControlChannelMessage('sessions');
    expect(result).toEqual({
      command: 'sessions',
      args: [],
    });
  });

  it('parses join command with session ID', () => {
    const result = parseControlChannelMessage('join abc12345');
    expect(result).toEqual({
      command: 'join',
      args: ['abc12345'],
    });
  });

  it('parses join without args', () => {
    const result = parseControlChannelMessage('join');
    expect(result).toEqual({
      command: 'join',
      args: [],
    });
  });

  it('parses help command', () => {
    const result = parseControlChannelMessage('help');
    expect(result).toEqual({
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
    expect(isProjectChannel('atc-desktop-my-app', 'desktop')).toBe(true);
  });

  it('returns false for different machine', () => {
    expect(isProjectChannel('atc-laptop-api', 'desktop')).toBe(false);
  });

  it('returns false for control channel', () => {
    expect(isProjectChannel('air-traffic-control', 'desktop')).toBe(false);
  });

  it('returns false when machine does not match', () => {
    expect(isProjectChannel('atc-desktop-my-app', 'laptop')).toBe(false);
  });
});

describe('extractProjectName', () => {
  it('extracts project name from matching channel', () => {
    expect(extractProjectName('atc-desktop-my-app', 'desktop')).toBe('my-app');
  });

  it('extracts complex project name', () => {
    expect(extractProjectName('atc-desktop-complex-name', 'desktop')).toBe('complex-name');
  });

  it('returns null for different machine', () => {
    expect(extractProjectName('atc-laptop-api', 'desktop')).toBeNull();
  });

  it('returns null for control channel', () => {
    expect(extractProjectName('air-traffic-control', 'desktop')).toBeNull();
  });
});

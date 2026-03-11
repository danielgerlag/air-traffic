import { describe, it, expect } from 'vitest';
import { mrkdwnToDiscordMarkdown, truncateForDiscord } from '../../../src/messaging/discord/markdown.js';

describe('mrkdwnToDiscordMarkdown', () => {
  it('converts Slack bold *text* to Discord **text**', () => {
    expect(mrkdwnToDiscordMarkdown('This is *bold* text')).toBe('This is **bold** text');
  });

  it('converts Slack links <url|text> to Discord [text](url)', () => {
    expect(mrkdwnToDiscordMarkdown('<https://example.com|Click here>')).toBe('[Click here](https://example.com)');
  });

  it('converts bare Slack links <url> to plain url', () => {
    expect(mrkdwnToDiscordMarkdown('<https://example.com>')).toBe('https://example.com');
  });

  it('converts Slack strikethrough ~text~ to Discord ~~text~~', () => {
    expect(mrkdwnToDiscordMarkdown('This is ~deleted~ text')).toBe('This is ~~deleted~~ text');
  });

  it('converts bullet markers • to -', () => {
    const mrkdwn = '• First\n• Second\n• Third';
    expect(mrkdwnToDiscordMarkdown(mrkdwn)).toBe('- First\n- Second\n- Third');
  });

  it('converts Slack dividers ——— to ---', () => {
    expect(mrkdwnToDiscordMarkdown('———')).toBe('---');
  });

  it('preserves code blocks', () => {
    const mrkdwn = '```\nconst x = *1*;\n```';
    expect(mrkdwnToDiscordMarkdown(mrkdwn)).toBe('```\nconst x = *1*;\n```');
  });

  it('preserves inline code', () => {
    const mrkdwn = 'Use `*bold*` for emphasis';
    expect(mrkdwnToDiscordMarkdown(mrkdwn)).toBe('Use `*bold*` for emphasis');
  });

  it('passes through plain text unchanged', () => {
    const plain = 'Just a normal message with no formatting.';
    expect(mrkdwnToDiscordMarkdown(plain)).toBe(plain);
  });

  it('handles mixed content', () => {
    const mrkdwn = '*Title*\n• Item: <https://x.com|link>\n• ~old~ data';
    const expected = '**Title**\n- Item: [link](https://x.com)\n- ~~old~~ data';
    expect(mrkdwnToDiscordMarkdown(mrkdwn)).toBe(expected);
  });
});

describe('truncateForDiscord', () => {
  it('returns short text unchanged', () => {
    expect(truncateForDiscord('hello')).toBe('hello');
  });

  it('truncates text exceeding limit', () => {
    const long = 'x'.repeat(2100);
    const result = truncateForDiscord(long);
    expect(result.length).toBeLessThanOrEqual(2000);
    expect(result).toContain('truncated');
  });

  it('respects custom limit', () => {
    const text = 'x'.repeat(200);
    const result = truncateForDiscord(text, 100);
    expect(result.length).toBeLessThanOrEqual(100);
  });
});

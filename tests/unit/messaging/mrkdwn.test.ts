import { describe, it, expect } from 'vitest';
import { markdownToMrkdwn } from '../../../src/messaging/slack/mrkdwn.js';

describe('markdownToMrkdwn', () => {
  it('strips language identifier from fenced code blocks', () => {
    const md = '```typescript\nconst x = 1;\n```';
    expect(markdownToMrkdwn(md)).toBe('```\nconst x = 1;\n```');
  });

  it('keeps fenced code blocks without language', () => {
    const md = '```\nconst x = 1;\n```';
    expect(markdownToMrkdwn(md)).toBe('```\nconst x = 1;\n```');
  });

  it('converts headers to bold', () => {
    expect(markdownToMrkdwn('# Title')).toBe('*Title*');
    expect(markdownToMrkdwn('## Subtitle')).toBe('*Subtitle*');
    expect(markdownToMrkdwn('### Heading')).toBe('*Heading*');
  });

  it('converts bold **text** to *text*', () => {
    expect(markdownToMrkdwn('This is **bold** text')).toBe('This is *bold* text');
  });

  it('converts strikethrough ~~text~~ to ~text~', () => {
    expect(markdownToMrkdwn('This is ~~deleted~~ text')).toBe('This is ~deleted~ text');
  });

  it('converts markdown links to Slack links', () => {
    expect(markdownToMrkdwn('[Click here](https://example.com)')).toBe('<https://example.com|Click here>');
  });

  it('converts image syntax to Slack links', () => {
    expect(markdownToMrkdwn('![alt text](https://img.com/pic.png)')).toBe('<https://img.com/pic.png|alt text>');
  });

  it('converts unordered list markers to bullets', () => {
    const md = '- First\n- Second\n- Third';
    expect(markdownToMrkdwn(md)).toBe('• First\n• Second\n• Third');
  });

  it('converts horizontal rules', () => {
    expect(markdownToMrkdwn('---')).toBe('———');
    expect(markdownToMrkdwn('___')).toBe('———');
  });

  it('handles mixed content', () => {
    const md = [
      '## Summary',
      '',
      'Here is **important** info and a [link](https://x.com).',
      '',
      '```python',
      'print("hello")',
      '```',
    ].join('\n');

    const expected = [
      '*Summary*',
      '',
      'Here is *important* info and a <https://x.com|link>.',
      '',
      '```',
      'print("hello")',
      '```',
    ].join('\n');

    expect(markdownToMrkdwn(md)).toBe(expected);
  });

  it('passes through plain text unchanged', () => {
    const plain = 'Just a normal message with no formatting.';
    expect(markdownToMrkdwn(plain)).toBe(plain);
  });
});

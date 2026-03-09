import { describe, it, expect, vi } from 'vitest';

// Mock the Copilot SDK so we can import agent-session without the real SDK
vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: class {},
  CopilotSession: class {},
  approveAll: () => ({ permissionDecision: 'allow' }),
}));

describe('Agent session module', () => {
  it('loads without errors', async () => {
    const mod = await import('../../../src/copilot/agent-session.js');
    expect(mod.AgentSession).toBeDefined();
  });
});

describe('toolCallLabel extraction logic', () => {
  // We replicate the toolCallLabel logic here to test it in isolation,
  // since it is a module-private function.
  function toolCallLabel(toolName: string, toolArgs: Record<string, unknown>): string {
    const desc = (toolArgs.description ?? '') as string;
    if (desc) return desc;
    const p = (toolArgs.path ?? toolArgs.file_path ?? toolArgs.filename ?? '') as string;
    if (p) {
      // Simulate path.basename
      const parts = p.replace(/\\/g, '/').split('/');
      return parts[parts.length - 1] || p;
    }
    const pat = (toolArgs.pattern ?? toolArgs.query ?? '') as string;
    if (pat) return pat.length > 40 ? pat.slice(0, 37) + '…' : pat;
    return '';
  }

  it('extracts description when present', () => {
    expect(toolCallLabel('powershell', { description: 'Run build' })).toBe('Run build');
  });

  it('extracts basename from path', () => {
    expect(toolCallLabel('view', { path: 'C:\\dev\\air-traffic\\src\\daemon.ts' })).toBe('daemon.ts');
  });

  it('extracts basename from file_path', () => {
    expect(toolCallLabel('edit', { file_path: '/home/user/project/index.js' })).toBe('index.js');
  });

  it('extracts filename', () => {
    expect(toolCallLabel('create', { filename: 'screenshot.png' })).toBe('screenshot.png');
  });

  it('extracts pattern', () => {
    expect(toolCallLabel('grep', { pattern: 'handlePrompt' })).toBe('handlePrompt');
  });

  it('truncates long patterns', () => {
    const long = 'a'.repeat(60);
    const result = toolCallLabel('grep', { pattern: long });
    expect(result.length).toBe(38); // 37 chars + '…'
    expect(result.endsWith('…')).toBe(true);
  });

  it('extracts query', () => {
    expect(toolCallLabel('search', { query: 'auth endpoint' })).toBe('auth endpoint');
  });

  it('returns empty string when no relevant args', () => {
    expect(toolCallLabel('unknown_tool', { foo: 'bar' })).toBe('');
  });

  it('prefers description over path', () => {
    expect(toolCallLabel('powershell', {
      description: 'Install deps',
      path: '/some/path',
    })).toBe('Install deps');
  });

  it('prefers path over pattern', () => {
    expect(toolCallLabel('glob', {
      path: '/src/index.ts',
      pattern: '**/*.ts',
    })).toBe('index.ts');
  });
});

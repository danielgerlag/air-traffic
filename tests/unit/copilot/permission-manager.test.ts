import { describe, it, expect } from 'vitest';
import { PermissionManager } from '../../../src/copilot/permission-manager.js';
import type { PermissionPolicy, PermissionMode } from '../../../src/projects/types.js';
import { DEFAULT_PERMISSIONS } from '../../../src/projects/types.js';

describe('PermissionManager', () => {
  const pm = new PermissionManager();

  describe('categorize()', () => {
    it('maps edit to fileEdit', () => {
      expect(pm.categorize('edit')).toBe('fileEdit');
    });

    it('maps shell to shell', () => {
      expect(pm.categorize('shell')).toBe('shell');
    });

    it('maps git_push to git', () => {
      expect(pm.categorize('git_push')).toBe('git');
    });

    it('maps web_fetch to network', () => {
      expect(pm.categorize('web_fetch')).toBe('network');
    });

    it('maps unknown tool to default', () => {
      expect(pm.categorize('unknown_tool')).toBe('default');
    });
  });

  describe('shouldAsk()', () => {
    it('returns true when shell is ask', () => {
      const policy: PermissionPolicy = { ...DEFAULT_PERMISSIONS, shell: 'ask', default: 'auto' };
      expect(pm.shouldAsk('shell', policy)).toBe(true);
    });

    it('returns false when fileEdit is auto', () => {
      const policy: PermissionPolicy = { ...DEFAULT_PERMISSIONS, fileEdit: 'auto', default: 'ask' };
      expect(pm.shouldAsk('edit', policy)).toBe(false);
    });

    it('returns true when unknown tool falls back to ask default', () => {
      const policy: PermissionPolicy = { ...DEFAULT_PERMISSIONS, default: 'ask' };
      expect(pm.shouldAsk('unknown', policy)).toBe(true);
    });

    it('returns false when unknown tool falls back to auto default', () => {
      const policy: PermissionPolicy = { ...DEFAULT_PERMISSIONS, default: 'auto' };
      expect(pm.shouldAsk('unknown', policy)).toBe(false);
    });
  });

  describe('getMode()', () => {
    it('returns correct mode for known tool', () => {
      const policy: PermissionPolicy = { ...DEFAULT_PERMISSIONS, shell: 'ask' };
      expect(pm.getMode('shell', policy)).toBe('ask');
    });

    it('returns correct mode for fileEdit', () => {
      const policy: PermissionPolicy = { ...DEFAULT_PERMISSIONS, fileEdit: 'auto' };
      expect(pm.getMode('edit', policy)).toBe('auto');
    });

    it('returns default mode for unknown tool', () => {
      const policy: PermissionPolicy = { ...DEFAULT_PERMISSIONS, default: 'ask' };
      expect(pm.getMode('unknown_tool', policy)).toBe('ask');
    });
  });

  describe('always-allowed tools', () => {
    const allAskPolicy: PermissionPolicy = {
      fileEdit: 'ask', fileCreate: 'ask', shell: 'ask',
      git: 'ask', network: 'ask', default: 'ask',
    };

    it('never asks for ask_user regardless of policy', () => {
      expect(pm.shouldAsk('ask_user', allAskPolicy)).toBe(false);
    });

    it('never asks for report_intent regardless of policy', () => {
      expect(pm.shouldAsk('report_intent', allAskPolicy)).toBe(false);
    });

    it('never asks for sql regardless of policy', () => {
      expect(pm.shouldAsk('sql', allAskPolicy)).toBe(false);
    });

    it('returns auto mode for always-allowed tools', () => {
      expect(pm.getMode('ask_user', allAskPolicy)).toBe('auto');
      expect(pm.getMode('report_intent', allAskPolicy)).toBe('auto');
      expect(pm.getMode('sql', allAskPolicy)).toBe('auto');
    });

    it('isAlwaysAllowed returns true for listed tools', () => {
      expect(pm.isAlwaysAllowed('ask_user')).toBe(true);
      expect(pm.isAlwaysAllowed('report_intent')).toBe(true);
      expect(pm.isAlwaysAllowed('sql')).toBe(true);
    });

    it('isAlwaysAllowed returns false for other tools', () => {
      expect(pm.isAlwaysAllowed('shell')).toBe(false);
      expect(pm.isAlwaysAllowed('edit')).toBe(false);
    });
  });
});

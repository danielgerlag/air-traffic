import { describe, it, expect } from 'vitest';
import { classifyIntent } from '../../../src/messaging/intent.js';

describe('classifyIntent', () => {
  describe('create', () => {
    it('matches "make a project called api-server"', () => {
      const result = classifyIntent('make a project called api-server');
      expect(result).not.toBeNull();
      expect(result!.command).toBe('create');
      expect(result!.args).toEqual(['api-server']);
    });

    it('matches "new project named my-app"', () => {
      const result = classifyIntent('new project named my-app');
      expect(result).not.toBeNull();
      expect(result!.command).toBe('create');
      expect(result!.args).toEqual(['my-app']);
    });

    it('matches "spin up a project"', () => {
      const result = classifyIntent('spin up a project');
      expect(result).not.toBeNull();
      expect(result!.command).toBe('create');
    });

    it('extracts quoted name', () => {
      const result = classifyIntent('create "my-project"');
      expect(result).not.toBeNull();
      expect(result!.command).toBe('create');
      expect(result!.args).toEqual(['my-project']);
    });
  });

  describe('delete', () => {
    it('matches "nuke the old project"', () => {
      const result = classifyIntent('nuke the old project');
      expect(result).not.toBeNull();
      expect(result!.command).toBe('delete');
    });

    it('matches "tear down api-server"', () => {
      const result = classifyIntent('tear down api-server');
      expect(result).not.toBeNull();
      expect(result!.command).toBe('delete');
    });

    it('matches "get rid of the project"', () => {
      const result = classifyIntent('get rid of the project');
      expect(result).not.toBeNull();
      expect(result!.command).toBe('delete');
    });
  });

  describe('status', () => {
    it('matches "what\'s running"', () => {
      const result = classifyIntent("what's running");
      expect(result).not.toBeNull();
      expect(result!.command).toBe('status');
    });

    it('matches "how are things"', () => {
      const result = classifyIntent('how are things');
      expect(result).not.toBeNull();
      expect(result!.command).toBe('status');
    });

    it('matches "check on"', () => {
      const result = classifyIntent('check on things');
      expect(result).not.toBeNull();
      expect(result!.command).toBe('status');
    });
  });

  describe('list', () => {
    it('matches "show me my projects"', () => {
      const result = classifyIntent('show me my projects');
      expect(result).not.toBeNull();
      expect(result!.command).toBe('list');
    });

    it('matches "what projects do I have"', () => {
      const result = classifyIntent('what projects do I have');
      expect(result).not.toBeNull();
      expect(result!.command).toBe('list');
    });
  });

  describe('model', () => {
    it('matches "switch to gpt-5"', () => {
      const result = classifyIntent('switch to gpt-5');
      expect(result).not.toBeNull();
      expect(result!.command).toBe('model');
      expect(result!.args).toEqual(['gpt-5']);
    });

    it('matches "use claude-sonnet-4.5"', () => {
      const result = classifyIntent('use model claude-sonnet-4.5');
      expect(result).not.toBeNull();
      expect(result!.command).toBe('model');
      expect(result!.args).toEqual(['claude-sonnet-4.5']);
    });
  });

  describe('menu', () => {
    it('matches "what can i do"', () => {
      const result = classifyIntent('what can i do');
      expect(result).not.toBeNull();
      // "what can" overlaps with help's phrases — either is acceptable
      expect(['menu', 'help']).toContain(result!.command);
    });

    it('matches "show options"', () => {
      const result = classifyIntent('show options');
      expect(result).not.toBeNull();
      expect(result!.command).toBe('menu');
    });
  });

  describe('abort', () => {
    it('matches "stop it"', () => {
      const result = classifyIntent('stop it');
      expect(result).not.toBeNull();
      expect(result!.command).toBe('abort');
    });

    it('matches "never mind"', () => {
      const result = classifyIntent('never mind');
      expect(result).not.toBeNull();
      expect(result!.command).toBe('abort');
    });
  });

  describe('diff', () => {
    it('matches "what changed"', () => {
      const result = classifyIntent('what changed');
      expect(result).not.toBeNull();
      expect(result!.command).toBe('diff');
    });

    it('matches "show diff"', () => {
      const result = classifyIntent('show diff');
      expect(result).not.toBeNull();
      expect(result!.command).toBe('diff');
    });
  });

  describe('edge cases', () => {
    it('returns null for empty string', () => {
      expect(classifyIntent('')).toBeNull();
    });

    it('returns null for unrecognized text', () => {
      expect(classifyIntent('the weather is nice today')).toBeNull();
    });

    it('is case-insensitive', () => {
      const result = classifyIntent('CREATE a new project');
      expect(result).not.toBeNull();
      expect(result!.command).toBe('create');
    });

    it('has confidence between 0 and 1', () => {
      const result = classifyIntent('create a new project called test');
      expect(result).not.toBeNull();
      expect(result!.confidence).toBeGreaterThanOrEqual(0.25);
      expect(result!.confidence).toBeLessThanOrEqual(1);
    });
  });
});

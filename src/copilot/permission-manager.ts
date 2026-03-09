/**
 * Permission policy enforcement for Copilot tool calls.
 *
 * Maps Copilot SDK tool names to permission categories, then checks the
 * project's permission policy to decide whether to allow, deny, or ask.
 */

import type { PermissionPolicy, PermissionMode } from '../projects/types.js';

export type { PermissionPolicy, PermissionMode };

type PermissionCategory = keyof PermissionPolicy;

const TOOL_CATEGORIES: Record<string, PermissionCategory> = {
  // File operations
  edit: 'fileEdit',
  edit_file: 'fileEdit',
  create: 'fileCreate',
  create_file: 'fileCreate',
  write_file: 'fileCreate',

  // Shell
  powershell: 'shell',
  bash: 'shell',
  shell: 'shell',

  // Git
  git: 'git',
  git_commit: 'git',
  git_push: 'git',

  // Network
  web_fetch: 'network',
  web_search: 'network',
  fetch: 'network',
};

/**
 * Tools that are always auto-allowed regardless of project permission policy.
 * These are low-risk, internal tools that don't modify files or execute commands.
 */
const ALWAYS_ALLOW: Set<string> = new Set([
  'ask_user',
  'report_intent',
  'sql',
]);

export class PermissionManager {
  categorize(toolName: string): PermissionCategory {
    return TOOL_CATEGORIES[toolName] ?? 'default';
  }

  shouldAsk(toolName: string, policy: PermissionPolicy): boolean {
    if (ALWAYS_ALLOW.has(toolName)) return false;
    const category = this.categorize(toolName);
    const mode = policy[category] ?? policy.default;
    return mode === 'ask';
  }

  getMode(toolName: string, policy: PermissionPolicy): PermissionMode {
    if (ALWAYS_ALLOW.has(toolName)) return 'auto';
    const category = this.categorize(toolName);
    return policy[category] ?? policy.default;
  }

  isAlwaysAllowed(toolName: string): boolean {
    return ALWAYS_ALLOW.has(toolName);
  }
}

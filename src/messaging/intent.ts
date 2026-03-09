/**
 * Natural-language intent classifier for DM commands.
 *
 * Two-tier approach:
 *  1. Exact command match (handled by parseControlChannelMessage)
 *  2. Synonym / keyword map + arg extraction (this module)
 */

interface IntentMatch {
  command: string;
  args: string[];
  confidence: number; // 0-1
}

interface IntentPattern {
  command: string;
  keywords: string[];
  phrases: string[];         // multi-word phrases scored higher
  extractArgs?: (text: string) => string[];
}

function extractNameArg(text: string): string[] {
  // "called X", "named X", quoted strings, or last word that looks like a name
  const calledMatch = text.match(/(?:called|named)\s+["']?([a-zA-Z0-9_-]+)["']?/i);
  if (calledMatch) return [calledMatch[1]];

  const quoted = text.match(/["']([a-zA-Z0-9_-]+)["']/);
  if (quoted) return [quoted[1]];

  return [];
}

function extractModelArg(text: string): string[] {
  // Look for model-like identifiers: gpt-5, claude-sonnet-4.5, etc.
  const modelMatch = text.match(/\b(gpt[- ]?\d[\w.-]*|claude[- ]?\w[\w.-]*|o\d[\w.-]*|gemini[\w.-]*)/i);
  if (modelMatch) return [modelMatch[1].toLowerCase().replace(/\s+/g, '-')];
  return [];
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    command: 'create',
    keywords: ['create', 'make', 'new', 'start', 'setup', 'init', 'add', 'build', 'spin'],
    phrases: ['new project', 'create project', 'start project', 'spin up', 'set up'],
    extractArgs: extractNameArg,
  },
  {
    command: 'delete',
    keywords: ['delete', 'remove', 'kill', 'nuke', 'destroy', 'drop', 'tear'],
    phrases: ['tear down', 'get rid of', 'shut down'],
    extractArgs: extractNameArg,
  },
  {
    command: 'list',
    keywords: ['list', 'show', 'projects', 'all'],
    phrases: ['show projects', 'list projects', 'what projects', 'my projects', 'show me'],
  },
  {
    command: 'status',
    keywords: ['status', 'running', 'check', 'health', 'info'],
    phrases: ["what's running", "how are things", 'check on', "what's happening", "what's up", 'how is it going'],
  },
  {
    command: 'models',
    keywords: ['models', 'model'],
    phrases: ['available models', 'which models', 'what models', 'list models', 'show models'],
  },
  {
    command: 'help',
    keywords: ['help', 'commands', 'usage', 'how'],
    phrases: ['how to', 'how do i', 'what can', 'show me how'],
  },
  {
    command: 'menu',
    keywords: ['menu', 'options', 'actions'],
    phrases: ['what can i do', 'show options', 'main menu'],
  },
  {
    command: 'sessions',
    keywords: ['sessions', 'session'],
    phrases: ['active sessions', 'list sessions', 'show sessions'],
  },
  {
    command: 'abort',
    keywords: ['abort', 'stop', 'cancel', 'halt', 'quit'],
    phrases: ['stop it', 'cancel that', 'never mind', 'nevermind'],
  },
  {
    command: 'diff',
    keywords: ['diff', 'changes', 'changed'],
    phrases: ['what changed', 'show diff', 'show changes', 'git diff'],
  },
  {
    command: 'model',
    keywords: [],
    phrases: ['switch to', 'change model', 'use model', 'switch model'],
    extractArgs: extractModelArg,
  },
];

/**
 * Try to classify free-form text as a known command.
 * Returns null if no confident match.
 */
export function classifyIntent(text: string): IntentMatch | null {
  const lower = text.toLowerCase().trim();
  if (!lower) return null;

  let best: IntentMatch | null = null;

  for (const pattern of INTENT_PATTERNS) {
    let score = 0;

    // Phrase matches score highest
    for (const phrase of pattern.phrases) {
      if (lower.includes(phrase)) {
        score += 3;
        break; // one phrase match is enough
      }
    }

    // Keyword matches
    const words = lower.split(/\s+/);
    for (const keyword of pattern.keywords) {
      if (words.includes(keyword)) {
        score += 2;
      } else if (lower.includes(keyword)) {
        score += 1;
      }
    }

    if (score === 0) continue;

    // Normalize: shorter inputs with matches are higher confidence
    const confidence = Math.min(score / 4, 1);
    const args = pattern.extractArgs?.(text) ?? [];

    if (!best || confidence > best.confidence) {
      best = { command: pattern.command, args, confidence };
    }
  }

  // Only return if we have reasonable confidence
  if (best && best.confidence >= 0.25) return best;
  return null;
}

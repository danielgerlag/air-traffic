const CONTROL_COMMANDS = new Set(['create', 'list', 'delete', 'config', 'status', 'machines', 'models', 'sessions', 'join', 'help']);
const PROJECT_COMMANDS = new Set(['model', 'status', 'abort', 'diff', 'agent', 'mode', 'history', 'sessions', 'join', 'leave', 'help']);
const BROADCAST_COMMANDS = new Set(['status', 'machines']);

/**
 * Split text into command + args, respecting simple quoting/spacing.
 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    tokens.push(match[1] ?? match[0]);
  }
  return tokens;
}

export function parseControlChannelMessage(
  text: string,
): { type: 'targeted' | 'broadcast'; targetMachine?: string; command: string; args: string[] } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Check for machine-targeted format: "machine: command args..."
  const targetedMatch = trimmed.match(/^([a-zA-Z0-9_-]+):\s+(.+)$/);
  if (targetedMatch) {
    const targetMachine = targetedMatch[1].toLowerCase();
    const rest = targetedMatch[2];
    const tokens = tokenize(rest);
    if (tokens.length === 0) return null;
    const command = tokens[0].toLowerCase();
    if (!CONTROL_COMMANDS.has(command)) return null;
    return { type: 'targeted', targetMachine, command, args: tokens.slice(1) };
  }

  // Broadcast command (no target prefix)
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return null;
  const command = tokens[0].toLowerCase();
  if (!CONTROL_COMMANDS.has(command)) return null;

  if (BROADCAST_COMMANDS.has(command) && tokens.length === 1) {
    return { type: 'broadcast', command, args: [] };
  }

  // Non-broadcast control commands without a target are still valid broadcasts
  return { type: 'broadcast', command, args: tokens.slice(1) };
}

export function parseProjectChannelMessage(
  text: string,
): { command: string; args: string[] } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Commands are prefixed with !
  if (!trimmed.startsWith('!')) return null;

  const tokens = tokenize(trimmed.slice(1));
  if (tokens.length === 0) return null;

  const command = tokens[0].toLowerCase();
  if (!PROJECT_COMMANDS.has(command)) return null;

  return { command, args: tokens.slice(1) };
}

export function isProjectChannel(channelName: string, machineName: string): boolean {
  const prefix = `atc-${machineName}-`.toLowerCase();
  return channelName.toLowerCase().startsWith(prefix) && channelName.length > prefix.length;
}

export function extractProjectName(channelName: string, machineName: string): string | null {
  const prefix = `atc-${machineName}-`.toLowerCase();
  const lower = channelName.toLowerCase();
  if (!lower.startsWith(prefix)) return null;
  const project = channelName.slice(prefix.length);
  return project || null;
}

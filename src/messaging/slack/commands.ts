const CONTROL_COMMANDS = new Set(['create', 'list', 'delete', 'config', 'status', 'models', 'sessions', 'join', 'help', 'menu']);
const PROJECT_COMMANDS = new Set(['model', 'status', 'abort', 'diff', 'agent', 'mode', 'history', 'sessions', 'join', 'leave', 'help']);

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
): { command: string; args: string[] } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return null;
  const command = tokens[0].toLowerCase();
  if (!CONTROL_COMMANDS.has(command)) return null;

  return { command, args: tokens.slice(1) };
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

/** Match any atc-{machine}-{project} channel and extract the machine and project names. */
export function parseAnyProjectChannel(channelName: string): { machineName: string; projectName: string } | null {
  const match = channelName.toLowerCase().match(/^atc-([a-z0-9-]+?)-([a-z0-9-]+)$/);
  if (!match) return null;
  return { machineName: match[1], projectName: match[2] };
}

export function extractProjectName(channelName: string, machineName: string): string | null {
  const prefix = `atc-${machineName}-`.toLowerCase();
  const lower = channelName.toLowerCase();
  if (!lower.startsWith(prefix)) return null;
  const project = channelName.slice(prefix.length);
  return project || null;
}

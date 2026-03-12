/**
 * Convert Slack mrkdwn to Discord markdown.
 *
 * Key differences:
 * - Slack bold *text* → Discord **text**
 * - Slack links <url|text> → Discord [text](url)
 * - Slack list bullets • → Discord -
 * - Slack dividers ——— → Discord ---
 *
 * Standard markdown passes through largely unchanged since Discord
 * natively supports it.
 */
export function mrkdwnToDiscordMarkdown(mrkdwn: string): string {
  // Extract code blocks to protect them from transformation
  const codeBlocks: string[] = [];
  let result = mrkdwn.replace(/```[\s\S]*?```/g, (match) => {
    const idx = codeBlocks.length;
    codeBlocks.push(match);
    return `\x00CODEBLOCK_${idx}\x00`;
  });

  // Protect inline code
  const inlineCode: string[] = [];
  result = result.replace(/`[^`]+`/g, (match) => {
    const idx = inlineCode.length;
    inlineCode.push(match);
    return `\x00INLINE_${idx}\x00`;
  });

  // Slack links: <url|text> → [text](url)
  result = result.replace(/<([^|>]+)\|([^>]+)>/g, '[$2]($1)');

  // Bare Slack links: <url> → url
  result = result.replace(/<([^>]+)>/g, '$1');

  // Slack bold *text* → Discord **text**
  // Must not match already-double stars or code markers
  result = result.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '**$1**');

  // Slack strikethrough ~text~ → Discord ~~text~~
  result = result.replace(/(?<!~)~([^~\n]+)~(?!~)/g, '~~$1~~');

  // Slack list bullets • → Discord -
  result = result.replace(/^(\s*)•\s+/gm, '$1- ');

  // Slack dividers
  result = result.replace(/^———$/gm, '---');

  // Restore inline code
  result = result.replace(/\x00INLINE_(\d+)\x00/g, (_, idx) => inlineCode[parseInt(idx)]);

  // Restore code blocks
  result = result.replace(/\x00CODEBLOCK_(\d+)\x00/g, (_, idx) => codeBlocks[parseInt(idx)]);

  return result;
}

/**
 * Truncate text to fit within Discord's message size limit (2000 chars).
 * If truncated, appends an ellipsis indicator.
 */
export function truncateForDiscord(text: string, maxLen = 2000): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 15) + '\n… (truncated)';
}

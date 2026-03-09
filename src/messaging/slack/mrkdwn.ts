/**
 * Convert standard Markdown to Slack mrkdwn format.
 *
 * Key differences handled:
 * - Fenced code blocks (```lang → ```)
 * - Headers (### Title → *Title*)
 * - Bold (**text** → *text*)
 * - Strikethrough (~~text~~ → ~text~)
 * - Links ([text](url) → <url|text>)
 * - Images (![alt](url) → <url|alt>)
 * - Unordered lists (- item → • item)
 * - Horizontal rules (--- → ———)
 *
 * Note: Slack uses *bold*, _italic_, ~strikethrough~, and `code`.
 * Standard markdown ** bold and * italic map to Slack's * and _ respectively,
 * but since we can't reliably distinguish single-* italic from converted bold,
 * we leave single-* as Slack bold (which is the more common usage in Copilot output).
 */
export function markdownToMrkdwn(md: string): string {
  // Extract code blocks to protect them from transformation
  const codeBlocks: string[] = [];
  let result = md.replace(/```[\s\S]*?```/g, (match) => {
    const idx = codeBlocks.length;
    // Strip language identifier from opening fence
    const cleaned = match.replace(/```[a-zA-Z0-9_+-]*\n/, '```\n');
    codeBlocks.push(cleaned);
    return `\x00CODEBLOCK_${idx}\x00`;
  });

  // Also protect inline code
  const inlineCode: string[] = [];
  result = result.replace(/`[^`]+`/g, (match) => {
    const idx = inlineCode.length;
    inlineCode.push(match);
    return `\x00INLINE_${idx}\x00`;
  });

  // Headers: # Title → *Title*
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // Images before links: ![alt](url) → <url|alt>
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<$2|$1>');

  // Links: [text](url) → <url|text>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');

  // Bold: **text** → *text* (Slack uses single * for bold)
  result = result.replace(/\*\*(.+?)\*\*/g, '*$1*');

  // Strikethrough: ~~text~~ → ~text~
  result = result.replace(/~~(.+?)~~/g, '~$1~');

  // Unordered list markers: - item → • item (only at line start)
  result = result.replace(/^(\s*)[-]\s+/gm, '$1• ');

  // Horizontal rules (only bare --- or ___ lines)
  result = result.replace(/^-{3,}$/gm, '———');
  result = result.replace(/^_{3,}$/gm, '———');

  // Restore inline code
  result = result.replace(/\x00INLINE_(\d+)\x00/g, (_, idx) => inlineCode[parseInt(idx)]);

  // Restore code blocks
  result = result.replace(/\x00CODEBLOCK_(\d+)\x00/g, (_, idx) => codeBlocks[parseInt(idx)]);

  return result;
}

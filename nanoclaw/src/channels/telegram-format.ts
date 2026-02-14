/**
 * Telegram MarkdownV2 Formatter
 *
 * Converts AI-generated text (which may contain standard markdown)
 * into Telegram MarkdownV2 format.
 *
 * Telegram MarkdownV2 rules:
 * - Special chars must be escaped with \: _ * [ ] ( ) ~ ` > # + - = | { } . !
 * - But NOT inside code blocks or inline code
 * - *bold*, _italic_, ~strikethrough~, ||spoiler||, `code`, ```pre```
 * - [text](url), [text](tg://user?id=123)
 *
 * @see https://core.telegram.org/bots/api#markdownv2-style
 */

// Characters that need escaping in MarkdownV2 (outside of code/formatting)
const SPECIAL_CHARS = /([_\[\]()~>#+\-=|{}.!\\])/g;

/**
 * Escape special characters for MarkdownV2 (outside code blocks)
 */
function escapeMarkdownV2(text: string): string {
  return text.replace(SPECIAL_CHARS, '\\$1');
}

/**
 * Convert standard markdown / AI output to Telegram MarkdownV2.
 *
 * Strategy:
 * 1. Extract code blocks and inline code (protect from escaping)
 * 2. Convert **bold** → *bold* (Telegram uses single asterisks)
 * 3. Leave *bold* as-is (already Telegram-compatible)
 * 4. Leave _italic_ as-is
 * 5. Convert ## headings → *bold* text
 * 6. Escape remaining special chars
 * 7. Re-insert code blocks
 */
export function toTelegramMarkdownV2(input: string): string {
  if (!input) return '';

  // Step 1: Extract code blocks and inline code to protect them
  const codeBlocks: string[] = [];
  let text = input;

  // Extract fenced code blocks (```...```)
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const placeholder = `\x00CB${codeBlocks.length}\x00`;
    // In MarkdownV2, code blocks use ```lang\ncode``` — no escaping inside
    const langTag = lang ? `${lang}\n` : '';
    codeBlocks.push(`\`\`\`${langTag}${code.trimEnd()}\`\`\``);
    return placeholder;
  });

  // Extract inline code (`...`)
  text = text.replace(/`([^`\n]+)`/g, (_match, code) => {
    const placeholder = `\x00CB${codeBlocks.length}\x00`;
    codeBlocks.push(`\`${code}\``);
    return placeholder;
  });

  // Step 2: Convert markdown headings to bold
  // ## Heading → *Heading*
  text = text.replace(/^#{1,6}\s+(.+)$/gm, (_match, heading) => {
    return `\x00BOLD_START\x00${heading.trim()}\x00BOLD_END\x00`;
  });

  // Step 3: Convert **double asterisks** to Telegram bold markers
  // Must happen before escaping
  text = text.replace(/\*\*(.+?)\*\*/g, (_match, content) => {
    return `\x00BOLD_START\x00${content}\x00BOLD_END\x00`;
  });

  // Step 4: Protect existing *single bold* markers
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, (_match, content) => {
    return `\x00BOLD_START\x00${content}\x00BOLD_END\x00`;
  });

  // Step 5: Protect _italic_ markers
  text = text.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, (_match, content) => {
    return `\x00ITALIC_START\x00${content}\x00ITALIC_END\x00`;
  });

  // Step 6: Protect ~strikethrough~ markers
  text = text.replace(/~(.+?)~/g, (_match, content) => {
    return `\x00STRIKE_START\x00${content}\x00STRIKE_END\x00`;
  });

  // Step 7: Protect [text](url) links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, linkText, url) => {
    const placeholder = `\x00CB${codeBlocks.length}\x00`;
    // Escape text part but not URL
    codeBlocks.push(`[${escapeMarkdownV2(linkText)}](${url})`);
    return placeholder;
  });

  // Step 8: Escape all remaining special characters
  text = escapeMarkdownV2(text);

  // Step 9: Restore formatting markers (after escaping)
  text = text.replace(/\x00BOLD_START\x00/g, '*');
  text = text.replace(/\x00BOLD_END\x00/g, '*');
  text = text.replace(/\x00ITALIC_START\x00/g, '_');
  text = text.replace(/\x00ITALIC_END\x00/g, '_');
  text = text.replace(/\x00STRIKE_START\x00/g, '~');
  text = text.replace(/\x00STRIKE_END\x00/g, '~');

  // Step 10: Restore code blocks
  text = text.replace(/\x00CB(\d+)\x00/g, (_match, idx) => {
    return codeBlocks[parseInt(idx)];
  });

  return text;
}

/**
 * Strip all markdown formatting for plain text fallback.
 * Used when MarkdownV2 parsing fails.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```\w*\n?([\s\S]*?)```/g, '$1')  // Code blocks → just content
    .replace(/`([^`]+)`/g, '$1')                 // Inline code → just content
    .replace(/\*\*(.+?)\*\*/g, '$1')             // **bold** → plain
    .replace(/\*(.+?)\*/g, '$1')                 // *bold* → plain
    .replace(/_(.+?)_/g, '$1')                   // _italic_ → plain
    .replace(/~(.+?)~/g, '$1')                   // ~strike~ → plain
    .replace(/\|\|(.+?)\|\|/g, '$1')             // ||spoiler|| → plain
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')     // [text](url) → text
    .replace(/^#{1,6}\s+/gm, '');                // # headings → plain
}

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
 * Strategy: "hold" approach — convert each formatted segment into its final
 * MarkdownV2 form immediately, store it in a slot, and leave a safe Unicode
 * placeholder in the text. After escaping the remaining plain text, restore
 * all held slots.
 *
 * @see https://core.telegram.org/bots/api#markdownv2-style
 */

// All characters that need escaping in MarkdownV2 (per Telegram docs)
const SPECIAL_CHARS = /([_*\[\]()~`>#+\-=|{}.!\\])/g;

/**
 * Escape special characters for MarkdownV2 (outside code/formatting blocks)
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(SPECIAL_CHARS, '\\$1');
}

/**
 * Convert standard markdown / AI output to Telegram MarkdownV2.
 */
export function toTelegramMarkdownV2(input: string): string {
  if (!input) return '';

  // Slot array — each entry is a fully-formatted MarkdownV2 segment
  const slots: string[] = [];

  /** Store a pre-formatted segment and return a safe placeholder */
  function hold(formatted: string): string {
    const i = slots.length;
    slots.push(formatted);
    // Use Unicode Interlinear Annotation anchors as delimiters — they are
    // never in SPECIAL_CHARS and virtually never appear in real text.
    return `\uFFF9${i}\uFFFB`;
  }

  let text = input;

  // ── Phase 1: Protect code (no escaping inside) ──────────────────────

  // Fenced code blocks  ```lang\ncode```
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang: string, code: string) =>
    hold(`\`\`\`${lang ? lang + '\n' : ''}${code.trimEnd()}\`\`\``),
  );

  // Inline code `code`
  text = text.replace(/`([^`\n]+)`/g, (_m, code: string) => hold(`\`${code}\``));

  // ── Phase 2: Protect links ──────────────────────────────────────────

  // [text](url) — escape the visible text but not the URL
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t: string, url: string) =>
    hold(`[${escapeMarkdownV2(t)}](${url})`),
  );

  // ── Phase 3: Convert markdown formatting → MarkdownV2 ──────────────

  // ## Headings → *bold*
  text = text.replace(/^#{1,6}\s+(.+)$/gm, (_m, h: string) =>
    hold(`*${escapeMarkdownV2(h.trim())}*`),
  );

  // ***bold italic*** or ___bold italic___
  text = text.replace(/\*{3}(.+?)\*{3}/g, (_m, c: string) =>
    hold(`*_${escapeMarkdownV2(c)}_*`),
  );

  // **bold**
  text = text.replace(/\*\*(.+?)\*\*/g, (_m, c: string) =>
    hold(`*${escapeMarkdownV2(c)}*`),
  );

  // *text* (single-asterisk bold — only if not already held)
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, (_m, c: string) =>
    hold(`*${escapeMarkdownV2(c)}*`),
  );

  // _italic_
  text = text.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, (_m, c: string) =>
    hold(`_${escapeMarkdownV2(c)}_`),
  );

  // ~strikethrough~
  text = text.replace(/~(.+?)~/g, (_m, c: string) =>
    hold(`~${escapeMarkdownV2(c)}~`),
  );

  // ── Phase 4: Escape all remaining plain text ───────────────────────

  text = escapeMarkdownV2(text);

  // ── Phase 5: Restore held segments ─────────────────────────────────

  text = text.replace(/\uFFF9(\d+)\uFFFB/g, (_m, i: string) => slots[parseInt(i)]);

  return text;
}

/**
 * Strip all markdown formatting for plain text fallback.
 * Used when MarkdownV2 parsing fails.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```\w*\n?([\s\S]*?)```/g, '$1') // Code blocks → just content
    .replace(/`([^`]+)`/g, '$1')               // Inline code → just content
    .replace(/\*{3}(.+?)\*{3}/g, '$1')         // ***bold italic*** → plain
    .replace(/\*\*(.+?)\*\*/g, '$1')           // **bold** → plain
    .replace(/\*(.+?)\*/g, '$1')               // *bold* → plain
    .replace(/_(.+?)_/g, '$1')                 // _italic_ → plain
    .replace(/~(.+?)~/g, '$1')                 // ~strike~ → plain
    .replace(/\|\|(.+?)\|\|/g, '$1')           // ||spoiler|| → plain
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')   // [text](url) → text
    .replace(/^#{1,6}\s+/gm, '');              // # headings → plain
}

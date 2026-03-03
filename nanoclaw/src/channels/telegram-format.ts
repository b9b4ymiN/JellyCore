/**
 * Telegram MarkdownV2 Formatter
 *
 * Converts AI-generated text (standard Markdown) into Telegram MarkdownV2.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Telegram MarkdownV2 Quick Reference                                    │
 * │                                                                         │
 * │  Formatting  │  Syntax                                                  │
 * │  ────────────┼──────────────────────────────────────────────────────    │
 * │  Bold        │  *bold*                                                  │
 * │  Italic      │  _italic_                                                │
 * │  Bold Italic │  *_bold italic_*                                         │
 * │  Strike      │  ~strikethrough~                                         │
 * │  Spoiler     │  ||spoiler||                                             │
 * │  Inline code │  `code`                                                  │
 * │  Code block  │  ```lang\ncode```                                        │
 * │  Blockquote  │  > quote                                                 │
 * │  Link        │  [text](url)                                             │
 * │                                                                         │
 * │  Special chars that MUST be escaped (outside code/formatting):         │
 * │  _ * [ ] ( ) ~ ` > # + - = | { } . ! \                                │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ## Conversion Strategy: "Hold Slots"
 *
 * The core challenge: we need to escape special characters in plain text, but
 * NOT inside already-formatted segments (code blocks, bold text, links, etc.).
 *
 * Solution — process in 5 phases:
 *   1. Extract protected segments (code, links, formatting) → store in `slots[]`
 *      and leave a safe Unicode placeholder in their place.
 *   2. Escape ALL remaining plain text (now safe, no formatting chars left).
 *   3. Re-inject the held segments by replacing placeholders with slot values.
 *
 * Placeholder format: U+FFF9 <index> U+FFFB
 *   These "Interlinear Annotation" codepoints are chosen because:
 *   - They are NOT in Telegram's special char set (no escaping needed)
 *   - They virtually never appear in real-world text
 *   - They survive the escaping pass untouched
 *
 * @see https://core.telegram.org/bots/api#markdownv2-style
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All characters Telegram MarkdownV2 requires to be escaped with a backslash.
 * @see https://core.telegram.org/bots/api#markdownv2-style
 */
const SPECIAL_CHARS_RE = /([_*\[\]()~`>#+\-=|{}.!\\])/g;

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escape special MarkdownV2 characters in a plain-text string.
 *
 * Use this ONLY on raw text segments — never on already-formatted MarkdownV2,
 * as it will double-escape the backslashes.
 *
 * @example
 * escapeMarkdownV2("Hello, World!")  // "Hello, World\\!"
 * escapeMarkdownV2("1 + 1 = 2")     // "1 \\+ 1 \\= 2"
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(SPECIAL_CHARS_RE, '\\$1');
}

/**
 * Convert standard Markdown (as produced by AI models) to Telegram MarkdownV2.
 *
 * Handles:
 *  - Fenced code blocks  (```lang\ncode```)
 *  - Inline code         (`code`)
 *  - Markdown tables     → ASCII art inside a code block
 *  - Links               ([text](url))
 *  - Blockquotes         (> text)
 *  - Headings            (# H1 … ###### H6) → *bold*
 *  - Bold italic         (***text***)
 *  - Bold                (**text** or *text*)
 *  - Italic              (_text_)
 *  - Strikethrough       (~text~)
 *  - Spoilers            (||text||)
 *  - Unordered lists     (- item / * item / + item)
 *  - Ordered lists       (1. item)
 *  - Horizontal rules    (--- / *** / ___) → plain separator
 *
 * @param input  Raw Markdown string from an AI or user
 * @returns      Telegram-ready MarkdownV2 string
 */
export function toTelegramMarkdownV2(input: string): string {
  if (!input) return '';

  // Each slot holds one fully-formatted MarkdownV2 segment.
  const slots: string[] = [];

  /**
   * Store a pre-formatted MarkdownV2 segment and return a safe placeholder.
   * The placeholder survives the plain-text escaping pass unchanged.
   */
  function hold(formatted: string): string {
    slots.push(formatted);
    return `\uFFF9${slots.length - 1}\uFFFB`;
  }

  let text = input;

  // ── Phase 1a: Protect code blocks (content must NOT be escaped) ──────────

  // Fenced code blocks: ```lang\ncode```
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang: string, code: string) => {
    const langPrefix = lang ? `${lang}\n` : '';
    return hold(`\`\`\`${langPrefix}${code.trimEnd()}\`\`\``);
  });

  // Inline code: `code`
  text = text.replace(/`([^`\n]+)`/g, (_m, code: string) => hold(`\`${code}\``));

  // ── Phase 1b: Convert Markdown tables → ASCII art code blocks ────────────

  // Tables must be processed before bold/italic so that formatting inside
  // header cells does not interfere with column detection.
  text = convertMarkdownTables(text, hold);

  // ── Phase 2: Protect links ───────────────────────────────────────────────

  // [text](url) — escape visible text, leave URL untouched
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) =>
    hold(`[${escapeMarkdownV2(label)}](${url})`),
  );

  // ── Phase 3: Convert structural Markdown → MarkdownV2 ───────────────────

  // Horizontal rules (--- / *** / ___ on their own line) → plain separator
  text = text.replace(/^[ \t]*([*\-_][ \t]*){3,}[ \t]*$/gm, () =>
    hold(escapeMarkdownV2('────────────────────')),
  );

  // Blockquotes: "> text" → Telegram's ">text" (must be on its own line)
  text = text.replace(/^>[ \t]?(.+)$/gm, (_m, content: string) =>
    hold(`>${escapeMarkdownV2(content.trim())}`),
  );

  // Headings (# … ######) → *bold*
  text = text.replace(/^#{1,6}[ \t]+(.+)$/gm, (_m, heading: string) =>
    hold(`*${escapeMarkdownV2(heading.trim())}*`),
  );

  // Unordered list items: - / * / + at line start
  // Converts to a plain bullet (•) followed by escaped content.
  text = text.replace(/^[ \t]*[-*+][ \t]+(.+)$/gm, (_m, content: string) =>
    hold(`• ${escapeMarkdownV2(content.trim())}`),
  );

  // Ordered list items: 1. / 2. / etc. at line start
  text = text.replace(/^[ \t]*(\d+)\.[ \t]+(.+)$/gm, (_m, num: string, content: string) =>
    hold(`${num}\\. ${escapeMarkdownV2(content.trim())}`),
  );

  // ── Phase 4: Convert inline formatting → MarkdownV2 ─────────────────────

  // Spoilers: ||text|| (before strikethrough to avoid ~ confusion)
  text = text.replace(/\|\|(.+?)\|\|/g, (_m, content: string) =>
    hold(`||${escapeMarkdownV2(content)}||`),
  );

  // Bold italic: ***text*** or ___text___
  text = text.replace(/(\*{3}|_{3})(.+?)\1/g, (_m, _delim: string, content: string) =>
    hold(`*_${escapeMarkdownV2(content)}_*`),
  );

  // Bold: **text**
  text = text.replace(/\*\*(.+?)\*\*/g, (_m, content: string) =>
    hold(`*${escapeMarkdownV2(content)}*`),
  );

  // Bold: *text* (single asterisk — only when not already consumed above)
  // The negative lookaheads/lookbehinds prevent matching inside **text**.
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, (_m, content: string) =>
    hold(`*${escapeMarkdownV2(content)}*`),
  );

  // Italic: _text_ (single underscore, not doubled)
  text = text.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, (_m, content: string) =>
    hold(`_${escapeMarkdownV2(content)}_`),
  );

  // Strikethrough: ~text~
  text = text.replace(/~(.+?)~/g, (_m, content: string) =>
    hold(`~${escapeMarkdownV2(content)}~`),
  );

  // ── Phase 5: Escape all remaining plain text ─────────────────────────────

  text = escapeMarkdownV2(text);

  // ── Phase 6: Restore held segments ──────────────────────────────────────

  text = text.replace(/\uFFF9(\d+)\uFFFB/g, (_m, idx: string) => slots[parseInt(idx, 10)]);

  return text;
}

/**
 * Strip all Markdown formatting and return clean plain text.
 *
 * Useful as a fallback when Telegram rejects the MarkdownV2 parse (e.g. the
 * message contains unmatched formatting markers) — send unformatted instead.
 *
 * Stripping order matters: longer/more-specific patterns first to avoid
 * leaving stray delimiters from partial matches.
 */
export function stripMarkdown(text: string): string {
  return text
    // Structural
    .replace(/```\w*\n?([\s\S]*?)```/g, '$1')       // Code block → content only
    .replace(/`([^`]+)`/g, '$1')                     // Inline code → content only
    .replace(/^#{1,6}[ \t]+/gm, '')                 // # Headings → plain text
    .replace(/^[ \t]*[-*+][ \t]+/gm, '• ')          // Unordered lists → bullet
    .replace(/^[ \t]*\d+\.[ \t]+/gm, '')            // Ordered lists → plain
    .replace(/^[ \t]*([*\-_][ \t]*){3,}[ \t]*$/gm, '─────────') // HR → separator
    .replace(/^>[ \t]?/gm, '')                      // Blockquotes → plain
    // Inline (longest delimiter first)
    .replace(/\|\|(.+?)\|\|/g, '$1')                // ||spoiler|| → plain
    .replace(/(\*{3}|_{3})(.+?)\1/g, '$2')          // ***bold italic*** → plain
    .replace(/\*\*(.+?)\*\*/g, '$1')                // **bold** → plain
    .replace(/\*(.+?)\*/g, '$1')                    // *bold* → plain
    .replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '$1') // _italic_ → plain
    .replace(/~(.+?)~/g, '$1')                      // ~strike~ → plain
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');       // [text](url) → text
}

// ─────────────────────────────────────────────────────────────────────────────
// Table Conversion (internal)
// ─────────────────────────────────────────────────────────────────────────────

/** Column text alignment, as specified in the separator row. */
type TableAlignment = 'left' | 'center' | 'right';

/**
 * Return true if `line` looks like a Markdown table separator row.
 *
 * Valid examples:  | --- | :---: | ---: |
 *                  |-----|-------|------|
 */
function isTableSeparator(line: string): boolean {
  const t = line.trim();
  return t.includes('|') && t.includes('-') && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(t);
}

/**
 * Split a Markdown table row into trimmed cell strings.
 * Leading/trailing pipes are removed before splitting.
 *
 * @example
 * parseTableCells("| Foo | Bar |")  // ["Foo", "Bar"]
 */
function parseTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/**
 * Derive column alignments from the separator row.
 * Falls back to `'left'` for any column that doesn't match `:---:` / `---:`.
 */
function parseAlignments(separatorLine: string, columnCount: number): TableAlignment[] {
  const tokens = parseTableCells(separatorLine);
  return Array.from({ length: columnCount }, (_, i) => {
    const token = (tokens[i] ?? '').trim();
    if (/^:-{3,}:$/.test(token)) return 'center';
    if (/^-{3,}:$/.test(token)) return 'right';
    return 'left';
  });
}

/**
 * Pad `value` to `width` characters according to `alignment`.
 */
function padCell(value: string, width: number, alignment: TableAlignment): string {
  const extra = width - value.length;
  if (extra <= 0) return value;
  if (alignment === 'right')  return ' '.repeat(extra) + value;
  if (alignment === 'center') {
    const left = Math.floor(extra / 2);
    return ' '.repeat(left) + value + ' '.repeat(extra - left);
  }
  return value + ' '.repeat(extra);
}

/**
 * Render a Markdown table as a fixed-width ASCII table.
 *
 * Input:
 *   headers      — parsed header cells
 *   rowLines     — raw row strings (unparsed)
 *   separatorLine — the `| --- | --- |` row (used for alignment only)
 *
 * Output (example):
 *   +-------+-------+
 *   | Name  | Score |
 *   +-------+-------+
 *   | Alice |    42 |
 *   | Bob   |     7 |
 *   +-------+-------+
 */
function renderAsciiTable(
  headers: string[],
  rowLines: string[],
  separatorLine: string,
): string {
  const rawRows = rowLines.map(parseTableCells);
  const colCount = Math.max(headers.length, ...rawRows.map((r) => r.length));

  // Normalize headers and rows to the same column count
  const normalHeaders = Array.from(
    { length: colCount },
    (_, i) => headers[i] ?? `Col ${i + 1}`,
  );
  const rows = rawRows.map((cells) =>
    Array.from({ length: colCount }, (_, i) => cells[i] ?? ''),
  );

  const alignments = parseAlignments(separatorLine, colCount);

  // Column widths = max content width across header + all rows
  const widths = normalHeaders.map((header, col) =>
    Math.max(header.length, ...rows.map((row) => row[col].length)),
  );

  const divider   = `+${widths.map((w) => '-'.repeat(w + 2)).join('+')}+`;
  const headerRow = `| ${normalHeaders.map((h, i) => padCell(h, widths[i], 'left')).join(' | ')} |`;
  const bodyRows  = rows.map(
    (row) => `| ${row.map((cell, i) => padCell(cell, widths[i], alignments[i])).join(' | ')} |`,
  );

  return [divider, headerRow, divider, ...bodyRows, divider].join('\n');
}

/**
 * Scan `text` for Markdown tables, convert each one to an ASCII art code block,
 * hold it, and return the modified text.
 *
 * This must run BEFORE inline formatting replacements so that pipe characters
 * inside table rows are not misidentified as formatting delimiters.
 */
function convertMarkdownTables(text: string, hold: (s: string) => string): string {
  const lines = text.split('\n');
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const current = lines[i];
    const next    = lines[i + 1] ?? '';

    // A table starts when: current line contains "|" AND next line is a separator
    if (!current.includes('|') || !isTableSeparator(next)) {
      out.push(current);
      i++;
      continue;
    }

    const headers      = parseTableCells(current);
    const separatorLine = next;
    i += 2; // consume header + separator

    // Collect data rows (stop at blank line or non-pipe line)
    const dataRows: string[] = [];
    while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
      dataRows.push(lines[i]);
      i++;
    }

    if (headers.length === 0 || dataRows.length === 0) {
      // Not a valid table — restore and continue
      out.push(current, separatorLine);
      continue;
    }

    const ascii = renderAsciiTable(headers, dataRows, separatorLine);
    out.push(hold(`\`\`\`\n${ascii}\n\`\`\``));
  }

  return out.join('\n');
}

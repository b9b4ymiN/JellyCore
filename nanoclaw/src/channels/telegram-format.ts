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

  // Normalize unsupported markdown tables into plain readable lines.
  // Telegram MarkdownV2 has no table rendering.
  text = convertMarkdownTables(text, hold);

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

function isMarkdownTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('-') || !trimmed.includes('|')) return false;
  // e.g. | --- | :---: | ---: |
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed);
}

function parseTableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

type TableAlignment = 'left' | 'right' | 'center';

function parseTableAlignments(separatorLine: string, columnCount: number): TableAlignment[] {
  const tokens = parseTableCells(separatorLine);
  const alignments: TableAlignment[] = [];

  for (let i = 0; i < columnCount; i++) {
    const token = (tokens[i] ?? '').trim();
    if (/^:-{3,}:$/.test(token)) {
      alignments.push('center');
      continue;
    }
    if (/^-{3,}:$/.test(token)) {
      alignments.push('right');
      continue;
    }
    alignments.push('left');
  }

  return alignments;
}

function padCell(value: string, width: number, alignment: TableAlignment): string {
  if (value.length >= width) return value;
  const extra = width - value.length;

  if (alignment === 'right') {
    return `${' '.repeat(extra)}${value}`;
  }

  if (alignment === 'center') {
    const left = Math.floor(extra / 2);
    const right = extra - left;
    return `${' '.repeat(left)}${value}${' '.repeat(right)}`;
  }

  return `${value}${' '.repeat(extra)}`;
}

function renderAsciiTable(headers: string[], rowLines: string[], separatorLine: string): string {
  const rawRows = rowLines.map((line) => parseTableCells(line));
  const columnCount = Math.max(headers.length, ...rawRows.map((r) => r.length));
  const normalizedHeaders = Array.from(
    { length: columnCount },
    (_unused, idx) => headers[idx]?.trim() || `Column ${idx + 1}`,
  );
  const rows = rawRows.map((cells) =>
    Array.from({ length: columnCount }, (_unused, idx) => cells[idx]?.trim() || '-'),
  );
  const alignments = parseTableAlignments(separatorLine, columnCount);

  const widths = normalizedHeaders.map((header, col) =>
    Math.max(header.length, ...rows.map((row) => row[col].length)),
  );

  const border = `+${widths.map((w) => '-'.repeat(w + 2)).join('+')}+`;
  const headerLine = `| ${normalizedHeaders
    .map((cell, col) => padCell(cell, widths[col], 'left'))
    .join(' | ')} |`;
  const bodyLines = rows.map(
    (row) =>
      `| ${row
        .map((cell, col) => padCell(cell, widths[col], alignments[col] ?? 'left'))
        .join(' | ')} |`,
  );

  return [border, headerLine, border, ...bodyLines, border].join('\n');
}

function convertMarkdownTables(text: string, hold: (formatted: string) => string): string {
  const lines = text.split('\n');
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const current = lines[i];
    const next = i + 1 < lines.length ? lines[i + 1] : '';

    const maybeHeader = current.includes('|');
    const isSeparator = isMarkdownTableSeparator(next);
    if (!maybeHeader || !isSeparator) {
      out.push(current);
      continue;
    }

    const headers = parseTableCells(current);
    const rows: string[] = [];
    const separatorLine = next;
    i += 1; // consume separator

    while (i + 1 < lines.length) {
      const rowLine = lines[i + 1];
      if (!rowLine.includes('|') || rowLine.trim() === '') break;
      i += 1;
      rows.push(rowLine);
    }

    if (headers.length === 0 || rows.length === 0) {
      out.push(current);
      continue;
    }

    const table = renderAsciiTable(headers, rows, separatorLine);
    out.push(hold(`\`\`\`\n${table}\n\`\`\``));
  }

  return out.join('\n');
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

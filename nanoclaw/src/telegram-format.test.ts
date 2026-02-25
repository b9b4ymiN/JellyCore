import { describe, expect, it } from 'vitest';

import { toTelegramMarkdownV2 } from './channels/telegram-format.js';

describe('telegram-format markdown table handling', () => {
  it('converts markdown table to readable list text', () => {
    const input = [
      '| Name | Score |',
      '| --- | ---: |',
      '| Alice | 95 |',
      '| Bob | 88 |',
    ].join('\n');

    const out = toTelegramMarkdownV2(input);

    expect(out).toContain('Table converted from markdown for Telegram readability');
    expect(out).toContain('Name: Alice');
    expect(out).toContain('Score: 95');
    expect(out).not.toContain('\| \-\-\-');
  });

  it('keeps regular lines with pipes when not a markdown table', () => {
    const input = 'A | B | C but this is not a table';
    const out = toTelegramMarkdownV2(input);
    expect(out).not.toContain('Table converted from markdown for Telegram readability');
  });

  it('does not convert table-like text inside fenced code blocks', () => {
    const input = [
      '```',
      '| Name | Score |',
      '| --- | --- |',
      '| Alice | 95 |',
      '```',
    ].join('\n');

    const out = toTelegramMarkdownV2(input);
    expect(out).toContain('```');
    expect(out).toContain('| Name | Score |');
    expect(out).not.toContain('Table converted from markdown for Telegram readability');
  });
});

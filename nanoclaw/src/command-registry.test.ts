import { describe, expect, it } from 'vitest';

import { COMMAND_DEFINITIONS, TELEGRAM_COMMANDS } from './command-registry.js';

describe('command registry invariants', () => {
  it('has unique command names', () => {
    const names = COMMAND_DEFINITIONS.map((c) => c.command);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('uses Telegram-compatible command names', () => {
    for (const def of COMMAND_DEFINITIONS) {
      expect(def.command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  it('menu payload is synchronized with registry', () => {
    expect(TELEGRAM_COMMANDS.map((c) => c.command)).toEqual(
      COMMAND_DEFINITIONS.map((c) => c.command),
    );
  });
});

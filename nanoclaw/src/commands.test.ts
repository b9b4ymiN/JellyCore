/**
 * Tests for Telegram slash commands and query routing of new commands.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestDatabase } from './db.js';
import { classifyQuery } from './query-router.js';
import { handleInline, InlineResult, TELEGRAM_COMMANDS } from './inline-handler.js';

beforeEach(() => {
  _initTestDatabase();
});

// ─── Query Router: new commands ─────────────────────────────────────

describe('Query Router — new commands', () => {
  const newCmds = ['/clear', '/session', '/ping', '/model'];
  for (const cmd of newCmds) {
    it(`routes ${cmd} to inline tier`, () => {
      const result = classifyQuery(cmd);
      expect(result.tier).toBe('inline');
      expect(result.reason).toBe('admin-cmd');
    });
  }

  it('routes /clear with extra text to inline', () => {
    const result = classifyQuery('/clear now');
    expect(result.tier).toBe('inline');
  });

  it('routes Telegram command with @bot suffix to inline', () => {
    const result = classifyQuery('/help@my_bot');
    expect(result.tier).toBe('inline');
    expect(result.reason).toBe('admin-cmd');
  });

  it('routes existing commands unchanged', () => {
    expect(classifyQuery('/help').tier).toBe('inline');
    expect(classifyQuery('/status').tier).toBe('inline');
    expect(classifyQuery('/usage').tier).toBe('inline');
    expect(classifyQuery('/cost').tier).toBe('inline');
    expect(classifyQuery('/budget').tier).toBe('inline');
  });

  it('routes unknown slash commands to inline (fast failure path)', () => {
    const result = classifyQuery('/unknown_command');
    expect(result.tier).toBe('inline');
    expect(result.reason).toBe('admin-cmd');
  });
});

// ─── Inline Handler: /ping ──────────────────────────────────────────

describe('/ping command', () => {
  it('returns pong', () => {
    const result = handleInline('admin-cmd', '/ping');
    expect(result).toBe('pong 🏓');
  });
});

// ─── Inline Handler: /session ───────────────────────────────────────

describe('/session command', () => {
  it('returns session info with status indicator', () => {
    const result = handleInline('admin-cmd', '/session', 'test-jid', 'main');
    expect(typeof result).toBe('string');
    const text = result as string;
    expect(text).toContain('Session Info');
    expect(text).toContain('Session age');
    expect(text).toContain('Messages today');
    expect(text).toContain('/clear');
  });

  it('shows green status when context is low', () => {
    const result = handleInline('admin-cmd', '/session', 'test-jid', 'main') as string;
    expect(result).toContain('🟢');
  });
});

// ─── Inline Handler: /clear ─────────────────────────────────────────

describe('/clear command', () => {
  it('returns InlineResult with clear-session action', () => {
    const result = handleInline('admin-cmd', '/clear', 'test-jid', 'main');
    expect(typeof result).toBe('object');
    const obj = result as InlineResult;
    expect(obj.action).toBe('clear-session');
    expect(obj.reply).toContain('ล้าง Session สำเร็จ');
  });
});

// ─── Inline Handler: /model ─────────────────────────────────────────

describe('/model command', () => {
  it('shows model mapping info', () => {
    const result = handleInline('admin-cmd', '/model') as string;
    expect(result).toContain('Model Configuration');
    expect(result).toContain('sonnet');
    expect(result).toContain('haiku');
    expect(result).toContain('Query Routing');
  });
});

// ─── Inline Handler: /help includes new commands ────────────────────

describe('/help command', () => {
  it('lists all commands including new ones', () => {
    const result = handleInline('admin-cmd', '/help') as string;
    expect(result).toContain('/clear');
    expect(result).toContain('/session');
    expect(result).toContain('/ping');
    expect(result).toContain('/model');
    expect(result).toContain('/usage');
    expect(result).toContain('/cost');
    expect(result).toContain('/budget');
  });
});

// ─── Command registry coverage ───────────────────────────────────────

describe('Telegram command coverage', () => {
  it('every registered Telegram command has inline routing + response', () => {
    for (const def of TELEGRAM_COMMANDS) {
      const cmd = `/${def.command}`;
      const routed = classifyQuery(cmd);
      expect(routed.tier).toBe('inline');
      expect(routed.reason).toBe('admin-cmd');

      const result = handleInline('admin-cmd', cmd, 'tg:123', 'main');
      if (typeof result === 'string') {
        expect(result.length).toBeGreaterThan(0);
      } else {
        expect(result.reply.length).toBeGreaterThan(0);
      }
    }
  });

  it('unknown command returns a professional recovery message', () => {
    const result = handleInline('admin-cmd', '/not_exists');
    expect(typeof result).toBe('string');
    expect(result as string).toContain('ไม่รู้จักคำสั่ง');
    expect(result as string).toContain('/help');
  });
});

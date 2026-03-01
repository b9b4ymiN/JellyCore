/**
 * Tests for Telegram slash commands and query routing of new commands.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestDatabase } from './db.js';
import { classifyQuery } from './query-router.js';
import { handleInline, InlineResult, TELEGRAM_COMMANDS } from './inline-handler.js';
import { getTelegramMediaConfig, patchTelegramMediaConfig } from './telegram-media-config.js';

beforeEach(() => {
  _initTestDatabase();
  const cfg = getTelegramMediaConfig();
  patchTelegramMediaConfig({
    enabled: true,
    downloadEnabled: cfg.downloadEnabled,
    maxDownloadBytes: cfg.maxDownloadBytes,
    maxSendBytes: cfg.maxSendBytes,
    mediaDir: cfg.mediaDir,
  });
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
    expect(result).toContain('/heartbeat');
    expect(result).toContain('/hbjob');
    expect(result).toContain('/tgmedia');
    expect(result).toContain('/tgsendfile');
    expect(result).toContain('/tgsendphoto');
  });
});

describe('/tgmedia command', () => {
  it('shows media status and can disable/enable media runtime', () => {
    const status = handleInline('admin-cmd', '/tgmedia status') as string;
    expect(status).toContain('Telegram media status');

    const disabled = handleInline('admin-cmd', '/tgmedia disable') as string;
    expect(disabled).toContain('enabled: false');

    const enabled = handleInline('admin-cmd', '/tgmedia enable') as string;
    expect(enabled).toContain('enabled: true');
  });
});

describe('/tgsend* commands', () => {
  it('returns action payload for sending file/photo', () => {
    const fileResult = handleInline(
      'admin-cmd',
      '/tgsendfile notes/report.pdf Monthly report',
      'tg:1',
      'main',
    ) as InlineResult;
    expect(typeof fileResult).toBe('object');
    expect(fileResult.action).toEqual(
      expect.objectContaining({
        type: 'send-telegram-media',
        kind: 'document',
        relativePath: 'notes/report.pdf',
      }),
    );

    const photoResult = handleInline(
      'admin-cmd',
      '/tgsendphoto images/chart.jpg latest chart',
      'tg:1',
      'main',
    ) as InlineResult;
    expect(photoResult.action).toEqual(
      expect.objectContaining({
        type: 'send-telegram-media',
        kind: 'photo',
        relativePath: 'images/chart.jpg',
      }),
    );
  });
});

describe('/heartbeat command', () => {
  it('shows status by default', () => {
    const result = handleInline('admin-cmd', '/heartbeat', 'tg:1', 'main') as string;
    expect(result).toContain('Heartbeat status');
    expect(result).toContain('enabled:');
  });

  it('can turn heartbeat off and on from main group', () => {
    const off = handleInline('admin-cmd', '/heartbeat off', 'tg:1', 'main') as string;
    expect(off).toContain('enabled: false');

    const on = handleInline('admin-cmd', '/heartbeat on', 'tg:1', 'main') as string;
    expect(on).toContain('enabled: true');
  });

  it('blocks non-main group config updates', () => {
    const result = handleInline('admin-cmd', '/heartbeat off', 'tg:1', 'team-a') as string;
    expect(result).toContain('Only main group');
  });
});

describe('/hbjob command', () => {
  it('creates, lists, updates, pauses, resumes, and removes a job', () => {
    const add = handleInline(
      'admin-cmd',
      '/hbjob add Daily Check|monitor|15|Check key metrics and summarize',
      'tg:1',
      'main',
    ) as string;
    expect(add).toContain('Heartbeat job created');

    const list1 = handleInline('admin-cmd', '/hbjob list', 'tg:1', 'main') as string;
    expect(list1).toContain('Daily Check');

    const match = list1.match(/\[([a-z0-9-]{8})\]/i);
    expect(match).toBeTruthy();
    const shortId = match![1];

    const label = handleInline('admin-cmd', `/hbjob label ${shortId} Updated Label`, 'tg:1', 'main') as string;
    expect(label).toContain('label updated');

    const prompt = handleInline(
      'admin-cmd',
      `/hbjob prompt ${shortId} New prompt payload`,
      'tg:1',
      'main',
    ) as string;
    expect(prompt).toContain('prompt updated');

    const interval = handleInline('admin-cmd', `/hbjob interval ${shortId} 30`, 'tg:1', 'main') as string;
    expect(interval).toContain('interval updated');

    const category = handleInline('admin-cmd', `/hbjob category ${shortId} health`, 'tg:1', 'main') as string;
    expect(category).toContain('category updated');

    const pause = handleInline('admin-cmd', `/hbjob pause ${shortId}`, 'tg:1', 'main') as string;
    expect(pause).toContain('paused');

    const resume = handleInline('admin-cmd', `/hbjob resume ${shortId}`, 'tg:1', 'main') as string;
    expect(resume).toContain('resumed');

    const remove = handleInline('admin-cmd', `/hbjob remove ${shortId}`, 'tg:1', 'main') as string;
    expect(remove).toContain('removed');
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

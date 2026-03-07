import { beforeEach, describe, expect, it } from 'vitest';

import {
  getNonFatalErrorStats,
  recordNonFatalError,
  recordNonFatalNote,
  resetNonFatalErrorStatsForTest,
} from './non-fatal-errors.js';

describe('non-fatal error metrics', () => {
  beforeEach(() => {
    resetNonFatalErrorStatsForTest();
  });

  it('tracks classified error counts', () => {
    recordNonFatalError('container.spawn_failed', new Error('spawn timeout'));
    recordNonFatalError('container.spawn_failed', new Error('spawn timeout'));
    recordNonFatalError('state.parse_failed', new Error('bad json'), {}, 'debug');

    const stats = getNonFatalErrorStats();
    expect(stats.total).toBe(3);
    expect(stats.byCategory['container.spawn_failed']).toBe(2);
    expect(stats.byCategory['state.parse_failed']).toBe(1);
  });

  it('tracks non-fatal notes in recent entries', () => {
    recordNonFatalNote('typing.refresh', 'typing refresh failed', { chatJid: 'tg:1' }, 'debug');

    const stats = getNonFatalErrorStats();
    expect(stats.total).toBe(1);
    expect(stats.recent.length).toBe(1);
    expect(stats.recent[0].category).toBe('typing.refresh');
    expect(stats.recent[0].message).toContain('typing refresh failed');
  });
});

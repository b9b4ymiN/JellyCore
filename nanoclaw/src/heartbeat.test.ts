import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  _initTestDatabase,
  createHeartbeatJob,
  getHeartbeatJob,
  getActiveHeartbeatJobs,
  getAllHeartbeatJobs,
  getDueHeartbeatJobs,
  updateHeartbeatJob,
  updateHeartbeatJobResult,
  deleteHeartbeatJob,
} from './db.js';
import type { HeartbeatJob } from './types.js';

beforeEach(() => {
  _initTestDatabase();
});

// --- Heartbeat Jobs CRUD ---

function createTestJob(overrides: Partial<HeartbeatJob> = {}): HeartbeatJob {
  const defaults: HeartbeatJob = {
    id: `hb-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    chat_jid: 'test@g.us',
    label: 'Test Job',
    prompt: 'Do something useful',
    category: 'custom',
    status: 'active',
    interval_ms: null,
    last_run: null,
    last_result: null,
    created_at: new Date().toISOString(),
    created_by: 'main',
  };
  return { ...defaults, ...overrides };
}

describe('createHeartbeatJob', () => {
  it('creates and retrieves a job', () => {
    const job = createTestJob({ id: 'hb-001', label: 'Learn AI' });
    createHeartbeatJob(job);

    const retrieved = getHeartbeatJob('hb-001');
    expect(retrieved).toBeDefined();
    expect(retrieved!.label).toBe('Learn AI');
    expect(retrieved!.category).toBe('custom');
    expect(retrieved!.status).toBe('active');
  });

  it('stores all fields correctly', () => {
    const job = createTestJob({
      id: 'hb-002',
      category: 'monitor',
      interval_ms: 1800000,
      prompt: 'Check NVDA price',
    });
    createHeartbeatJob(job);

    const retrieved = getHeartbeatJob('hb-002');
    expect(retrieved).toBeDefined();
    expect(retrieved!.category).toBe('monitor');
    expect(retrieved!.interval_ms).toBe(1800000);
    expect(retrieved!.prompt).toBe('Check NVDA price');
  });
});

describe('getActiveHeartbeatJobs', () => {
  it('returns only active jobs', () => {
    createHeartbeatJob(createTestJob({ id: 'hb-a1', status: 'active', label: 'Active 1' }));
    createHeartbeatJob(createTestJob({ id: 'hb-a2', status: 'paused', label: 'Paused' }));
    createHeartbeatJob(createTestJob({ id: 'hb-a3', status: 'active', label: 'Active 2' }));

    const active = getActiveHeartbeatJobs();
    expect(active).toHaveLength(2);
    expect(active.map(j => j.id)).toContain('hb-a1');
    expect(active.map(j => j.id)).toContain('hb-a3');
  });
});

describe('getAllHeartbeatJobs', () => {
  it('returns all jobs including paused', () => {
    createHeartbeatJob(createTestJob({ id: 'hb-all1', status: 'active' }));
    createHeartbeatJob(createTestJob({ id: 'hb-all2', status: 'paused' }));

    const all = getAllHeartbeatJobs();
    expect(all).toHaveLength(2);
  });
});

describe('getDueHeartbeatJobs', () => {
  it('returns jobs that have never run', () => {
    createHeartbeatJob(createTestJob({ id: 'hb-due1', last_run: null }));

    const due = getDueHeartbeatJobs(3600000); // 1 hour default
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe('hb-due1');
  });

  it('returns jobs whose interval has elapsed', () => {
    const pastTime = new Date(Date.now() - 7200000).toISOString(); // 2 hours ago
    createHeartbeatJob(createTestJob({
      id: 'hb-due2',
      last_run: pastTime,
      interval_ms: 3600000, // 1 hour interval
    }));

    const due = getDueHeartbeatJobs(3600000);
    expect(due).toHaveLength(1);
  });

  it('does not return jobs that ran recently', () => {
    const recentTime = new Date(Date.now() - 60000).toISOString(); // 1 min ago
    createHeartbeatJob(createTestJob({
      id: 'hb-notdue',
      last_run: recentTime,
      interval_ms: 3600000, // 1 hour interval
    }));

    const due = getDueHeartbeatJobs(3600000);
    expect(due).toHaveLength(0);
  });

  it('uses default interval when job interval_ms is null', () => {
    const pastTime = new Date(Date.now() - 7200000).toISOString(); // 2 hours ago
    createHeartbeatJob(createTestJob({
      id: 'hb-default-interval',
      last_run: pastTime,
      interval_ms: null, // use default
    }));

    // Default is 1 hour, last ran 2 hours ago → should be due
    const due = getDueHeartbeatJobs(3600000);
    expect(due).toHaveLength(1);

    // Default is 3 hours, last ran 2 hours ago → should NOT be due
    const notDue = getDueHeartbeatJobs(3 * 3600000);
    expect(notDue).toHaveLength(0);
  });

  it('skips paused jobs', () => {
    createHeartbeatJob(createTestJob({ id: 'hb-paused', last_run: null, status: 'paused' }));

    const due = getDueHeartbeatJobs(3600000);
    expect(due).toHaveLength(0);
  });
});

describe('updateHeartbeatJob', () => {
  it('updates label and prompt', () => {
    createHeartbeatJob(createTestJob({ id: 'hb-upd1', label: 'Old', prompt: 'old prompt' }));

    updateHeartbeatJob('hb-upd1', { label: 'New', prompt: 'new prompt' });

    const job = getHeartbeatJob('hb-upd1');
    expect(job!.label).toBe('New');
    expect(job!.prompt).toBe('new prompt');
  });

  it('updates status to paused', () => {
    createHeartbeatJob(createTestJob({ id: 'hb-upd2', status: 'active' }));

    updateHeartbeatJob('hb-upd2', { status: 'paused' });

    const job = getHeartbeatJob('hb-upd2');
    expect(job!.status).toBe('paused');
  });

  it('updates interval_ms', () => {
    createHeartbeatJob(createTestJob({ id: 'hb-upd3', interval_ms: null }));

    updateHeartbeatJob('hb-upd3', { interval_ms: 1800000 });

    const job = getHeartbeatJob('hb-upd3');
    expect(job!.interval_ms).toBe(1800000);
  });
});

describe('updateHeartbeatJobResult', () => {
  it('updates last_run and last_result', () => {
    createHeartbeatJob(createTestJob({ id: 'hb-res1' }));

    const before = Date.now();
    updateHeartbeatJobResult('hb-res1', 'NVDA price $950');

    const job = getHeartbeatJob('hb-res1');
    expect(job!.last_result).toBe('NVDA price $950');
    expect(job!.last_run).toBeDefined();

    const lastRunTime = new Date(job!.last_run!).getTime();
    expect(lastRunTime).toBeGreaterThanOrEqual(before - 1000);
    expect(lastRunTime).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe('deleteHeartbeatJob', () => {
  it('removes a job', () => {
    createHeartbeatJob(createTestJob({ id: 'hb-del1' }));
    expect(getHeartbeatJob('hb-del1')).toBeDefined();

    deleteHeartbeatJob('hb-del1');
    expect(getHeartbeatJob('hb-del1')).toBeUndefined();
  });

  it('does not affect other jobs', () => {
    createHeartbeatJob(createTestJob({ id: 'hb-del2' }));
    createHeartbeatJob(createTestJob({ id: 'hb-del3' }));

    deleteHeartbeatJob('hb-del2');

    expect(getHeartbeatJob('hb-del2')).toBeUndefined();
    expect(getHeartbeatJob('hb-del3')).toBeDefined();
  });
});

// --- Heartbeat Job Categories ---

describe('heartbeat job categories', () => {
  it('supports all four categories', () => {
    const categories = ['learning', 'monitor', 'health', 'custom'] as const;

    for (const category of categories) {
      const id = `hb-cat-${category}`;
      createHeartbeatJob(createTestJob({ id, category }));
      const job = getHeartbeatJob(id);
      expect(job!.category).toBe(category);
    }
  });
});

// --- Edge cases ---

describe('heartbeat edge cases', () => {
  it('handles job with very long prompt', () => {
    const longPrompt = 'A'.repeat(10000);
    createHeartbeatJob(createTestJob({ id: 'hb-long', prompt: longPrompt }));

    const job = getHeartbeatJob('hb-long');
    expect(job!.prompt).toBe(longPrompt);
  });

  it('handles multiple due jobs correctly', () => {
    for (let i = 0; i < 5; i++) {
      createHeartbeatJob(createTestJob({
        id: `hb-multi-${i}`,
        last_run: null,
        label: `Job ${i}`,
      }));
    }

    const due = getDueHeartbeatJobs(3600000);
    expect(due).toHaveLength(5);
  });

  it('getDueHeartbeatJobs returns jobs ordered by creation', () => {
    createHeartbeatJob(createTestJob({ id: 'hb-order-1', last_run: null }));
    createHeartbeatJob(createTestJob({ id: 'hb-order-2', last_run: null }));
    createHeartbeatJob(createTestJob({ id: 'hb-order-3', last_run: null }));

    const due = getDueHeartbeatJobs(3600000);
    expect(due[0].id).toBe('hb-order-1');
    expect(due[1].id).toBe('hb-order-2');
    expect(due[2].id).toBe('hb-order-3');
  });
});

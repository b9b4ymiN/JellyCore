import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import {
  _initTestDatabase,
  cancelTask,
  claimTask,
  createTask,
  getDueTasks,
  getTaskById,
  recoverStaleClaims,
  updateTask,
  updateTaskAfterRun,
} from './db.js';

// ---- DB-level claim tests ----

describe('claimTask (DB-level atomic claim)', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  function insertDueTask(id: string, nextRun?: string) {
    createTask({
      id,
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: `Task ${id}`,
      schedule_type: 'once',
      schedule_value: nextRun ?? '2020-01-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: nextRun ?? '2020-01-01T00:00:00.000Z', // past = due
      status: 'active',
      created_at: '2020-01-01T00:00:00.000Z',
    });
  }

  it('claims a due task and sets sentinel next_run', () => {
    insertDueTask('task-1');

    // Task should be due
    expect(getDueTasks()).toHaveLength(1);

    // Claim it
    const claimed = claimTask('task-1');
    expect(claimed).toBe(true);

    // After claiming, getDueTasks should return empty (sentinel is far future)
    expect(getDueTasks()).toHaveLength(0);

    // Task should still be active
    const task = getTaskById('task-1');
    expect(task?.status).toBe('active');
    expect(task?.next_run).toBe('9999-12-31T23:59:59.999Z');
  });

  it('second claim on same task fails (idempotent)', () => {
    insertDueTask('task-1');

    const first = claimTask('task-1');
    expect(first).toBe(true);

    // Second claim should fail because next_run is now the sentinel (far future)
    const second = claimTask('task-1');
    expect(second).toBe(false);
  });

  it('does not claim a paused task', () => {
    insertDueTask('task-1');
    updateTask('task-1', { status: 'paused' });

    const claimed = claimTask('task-1');
    expect(claimed).toBe(false);
  });

  it('does not claim a cancelled task', () => {
    insertDueTask('task-1');
    cancelTask('task-1');

    const claimed = claimTask('task-1');
    expect(claimed).toBe(false);
  });

  it('does not claim a task with future next_run', () => {
    insertDueTask('task-1', '2999-01-01T00:00:00.000Z');

    const claimed = claimTask('task-1');
    expect(claimed).toBe(false);
  });

  it('handles concurrent claims — only one succeeds', () => {
    insertDueTask('task-1');

    // Simulate two concurrent claims
    const results = [claimTask('task-1'), claimTask('task-1')];
    const successes = results.filter(Boolean);

    // Exactly one should succeed
    expect(successes).toHaveLength(1);
  });
});

describe('recoverStaleClaims', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  function insertClaimedTask(id: string) {
    createTask({
      id,
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: `Task ${id}`,
      schedule_type: 'cron',
      schedule_value: '0 9 * * *',
      context_mode: 'isolated',
      next_run: '9999-12-31T23:59:59.999Z', // sentinel = claimed
      status: 'active',
      created_at: '2020-01-01T00:00:00.000Z',
    });
  }

  it('recovers tasks with sentinel next_run', () => {
    insertClaimedTask('task-stale');

    // Task should NOT be found by getDueTasks (sentinel is far future)
    expect(getDueTasks()).toHaveLength(0);

    // Recover
    const count = recoverStaleClaims();
    expect(count).toBe(1);

    // Now it should be due
    expect(getDueTasks()).toHaveLength(1);
  });

  it('does not affect tasks with normal next_run', () => {
    createTask({
      id: 'task-normal',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'Normal task',
      schedule_type: 'cron',
      schedule_value: '0 9 * * *',
      context_mode: 'isolated',
      next_run: '2999-01-01T00:00:00.000Z', // future but NOT sentinel
      status: 'active',
      created_at: '2020-01-01T00:00:00.000Z',
    });

    const count = recoverStaleClaims();
    expect(count).toBe(0);
  });

  it('does not recover cancelled tasks', () => {
    insertClaimedTask('task-cancelled');
    cancelTask('task-cancelled');

    const count = recoverStaleClaims();
    expect(count).toBe(0); // cancelled tasks are not recovered
  });
});

describe('claim + updateTaskAfterRun flow', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('full lifecycle: due → claim → run → update next_run', () => {
    // Create a due cron task
    createTask({
      id: 'task-cron',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'Daily report',
      schedule_type: 'cron',
      schedule_value: '0 9 * * *',
      context_mode: 'isolated',
      next_run: '2020-01-01T09:00:00.000Z', // past = due now
      status: 'active',
      created_at: '2020-01-01T00:00:00.000Z',
    });

    // 1. Due tasks found
    const due = getDueTasks();
    expect(due).toHaveLength(1);

    // 2. Claim
    expect(claimTask('task-cron')).toBe(true);
    expect(getDueTasks()).toHaveLength(0); // no longer due

    // 3. Second claim fails
    expect(claimTask('task-cron')).toBe(false);

    // 4. Task runs... then update next_run
    const nextRun = '2026-02-21T09:00:00.000Z';
    updateTaskAfterRun('task-cron', nextRun, 'Success');

    // 5. Task has correct next_run
    const task = getTaskById('task-cron');
    expect(task?.next_run).toBe(nextRun);
    expect(task?.status).toBe('active');
    expect(task?.last_result).toBe('Success');
  });

  it('once task: claim → run → status becomes completed', () => {
    createTask({
      id: 'task-once',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'One-time reminder',
      schedule_type: 'once',
      schedule_value: '2020-06-01T15:00:00.000Z',
      context_mode: 'isolated',
      next_run: '2020-06-01T15:00:00.000Z',
      status: 'active',
      created_at: '2020-01-01T00:00:00.000Z',
    });

    expect(claimTask('task-once')).toBe(true);

    // Once tasks set next_run to null → status becomes 'completed'
    updateTaskAfterRun('task-once', null, 'Done');

    const task = getTaskById('task-once');
    expect(task?.status).toBe('completed');
    expect(task?.next_run).toBeNull();
  });
});

// ---- GroupQueue running task tracking tests ----

describe('GroupQueue runningTaskIds tracking', () => {
  // These tests use the GroupQueue directly
  let GroupQueueModule: typeof import('./group-queue.js');

  beforeEach(async () => {
    vi.mock('./config.js', () => ({
      DATA_DIR: '/tmp/nanoclaw-test-data',
      MAIN_GROUP_FOLDER: 'main',
      MAX_CONCURRENT_CONTAINERS: 5,
      MAX_QUEUE_SIZE: 20,
      USER_MESSAGE_RETRY_SCHEDULE_MS: [5000, 30000],
      USER_MESSAGE_RETRY_JITTER_PCT: 0,
    }));

    vi.mock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        default: {
          ...actual,
          mkdirSync: vi.fn(),
          writeFileSync: vi.fn(),
          renameSync: vi.fn(),
        },
      };
    });

    GroupQueueModule = await import('./group-queue.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('rejects duplicate enqueue of a running task', async () => {
    const queue = new GroupQueueModule.GroupQueue();
    let resolveTask: () => void;

    const taskFn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveTask = resolve;
        }),
    );

    // Enqueue and start running
    queue.enqueueTask('group@g.us', 'task-1', taskFn);

    // Wait for task to start
    await new Promise((r) => setTimeout(r, 10));

    // Task should be running now
    expect(queue.isTaskRunning('task-1')).toBe(true);

    // Try to enqueue again — should be silently rejected
    const secondFn = vi.fn(async () => {});
    queue.enqueueTask('group@g.us', 'task-1', secondFn);

    // Complete the first task
    resolveTask!();
    await new Promise((r) => setTimeout(r, 10));

    // Only the first fn should have been called
    expect(taskFn).toHaveBeenCalledTimes(1);
    expect(secondFn).not.toHaveBeenCalled();
    expect(queue.isTaskRunning('task-1')).toBe(false);
  });
});

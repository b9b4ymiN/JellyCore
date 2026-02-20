/**
 * Scheduler Integration Test
 *
 * Verifies the scheduler claim mechanism prevents duplicate task execution
 * and that tasks fire within an acceptable delay window.
 *
 * This test runs in-process (no Docker needed for the scheduler itself),
 * simulating multiple rapid poll cycles against the same due tasks.
 *
 * Run: npx vitest run src/scheduler-integration.test.ts
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import {
  _initTestDatabase,
  claimTask,
  createTask,
  getDueTasks,
  getTaskById,
  recoverStaleClaims,
  updateTaskAfterRun,
  logTaskRun,
  resetRetryCount,
} from './db.js';
import { GroupQueue } from './group-queue.js';

// Mock config
vi.mock('./config.js', () => ({
  DATA_DIR: '/tmp/nanoclaw-test-data',
  MAIN_GROUP_FOLDER: 'main',
  MAX_CONCURRENT_CONTAINERS: 5,
  MAX_QUEUE_SIZE: 20,
  SCHEDULER_POLL_INTERVAL: 100, // Fast poll for testing
}));

// Mock fs for GroupQueue
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

describe('Scheduler: no duplicate execution under rapid polling', () => {
  let queue: GroupQueue;

  beforeEach(() => {
    _initTestDatabase();
    queue = new GroupQueue();
  });

  function insertDueTask(id: string, prompt = 'test task') {
    createTask({
      id,
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt,
      schedule_type: 'once',
      schedule_value: '2020-01-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: '2020-01-01T00:00:00.000Z', // past = due
      status: 'active',
      created_at: '2020-01-01T00:00:00.000Z',
    });
  }

  it('5 rapid poll cycles only execute each task once', async () => {
    // Insert 3 due tasks
    insertDueTask('task-a', 'Task A');
    insertDueTask('task-b', 'Task B');
    insertDueTask('task-c', 'Task C');

    const executionLog: string[] = [];

    // Simulate 5 rapid poll cycles (like the scheduler running every 10s
    // while tasks take minutes to complete)
    for (let cycle = 0; cycle < 5; cycle++) {
      const dueTasks = getDueTasks();

      for (const task of dueTasks) {
        // Atomic claim — this is the key fix
        if (!claimTask(task.id)) continue;

        const currentTask = getTaskById(task.id);
        if (!currentTask || currentTask.status !== 'active') continue;

        queue.enqueueTask(currentTask.chat_jid, currentTask.id, async () => {
          executionLog.push(currentTask.id);
          // Simulate task execution time
          await new Promise((r) => setTimeout(r, 50));
          updateTaskAfterRun(currentTask.id, null, 'Done');
        });
      }
    }

    // Wait for all tasks to complete
    await new Promise((r) => setTimeout(r, 500));

    // Each task should appear exactly once
    expect(executionLog.sort()).toEqual(['task-a', 'task-b', 'task-c']);
    expect(executionLog).toHaveLength(3);
  });

  it('cron task: claim prevents re-queue during execution', async () => {
    createTask({
      id: 'cron-1',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'Daily report',
      schedule_type: 'cron',
      schedule_value: '0 9 * * *',
      context_mode: 'isolated',
      next_run: '2020-01-01T09:00:00.000Z', // past = due
      status: 'active',
      created_at: '2020-01-01T00:00:00.000Z',
    });

    let executionCount = 0;
    let resolveTask: () => void;
    const taskPromise = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });

    // Cycle 1: claim and start running
    const dueTasks1 = getDueTasks();
    expect(dueTasks1).toHaveLength(1);
    expect(claimTask('cron-1')).toBe(true);

    queue.enqueueTask('group@g.us', 'cron-1', async () => {
      executionCount++;
      await taskPromise; // Block until we release it
      updateTaskAfterRun('cron-1', '2020-01-02T09:00:00.000Z', 'Done');
    });

    await new Promise((r) => setTimeout(r, 10));

    // Cycle 2: try to pick up the same task
    const dueTasks2 = getDueTasks();
    expect(dueTasks2).toHaveLength(0); // Claimed task not visible

    // Also try to force-claim
    expect(claimTask('cron-1')).toBe(false);

    // Also try to re-enqueue
    queue.enqueueTask('group@g.us', 'cron-1', async () => {
      executionCount++;
    });

    // Release the running task
    resolveTask!();
    await new Promise((r) => setTimeout(r, 50));

    expect(executionCount).toBe(1);

    // After completion, task should have new next_run
    const task = getTaskById('cron-1');
    expect(task?.next_run).toBe('2020-01-02T09:00:00.000Z');
  });

  it('crash recovery restores claimed tasks', () => {
    // Simulate: 3 tasks are claimed but process crashes before completion
    insertDueTask('crash-a');
    insertDueTask('crash-b');
    insertDueTask('crash-c');

    // Claim all 3
    expect(claimTask('crash-a')).toBe(true);
    expect(claimTask('crash-b')).toBe(true);
    expect(claimTask('crash-c')).toBe(true);

    // None should be due (they have sentinel next_run)
    expect(getDueTasks()).toHaveLength(0);

    // "Restart" — recover stale claims
    const recovered = recoverStaleClaims();
    expect(recovered).toBe(3);

    // Now they should be due again
    expect(getDueTasks()).toHaveLength(3);
  });

  it('interval task delay: once → claim → run is < 50ms', async () => {
    const start = Date.now();

    createTask({
      id: 'perf-1',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'Performance test',
      schedule_type: 'once',
      schedule_value: new Date(start - 1000).toISOString(),
      context_mode: 'isolated',
      next_run: new Date(start - 1000).toISOString(), // due 1s ago
      status: 'active',
      created_at: new Date(start - 2000).toISOString(),
    });

    // Measure time from getDueTasks to claim
    const pollStart = Date.now();
    const due = getDueTasks();
    expect(due).toHaveLength(1);

    const claimed = claimTask(due[0].id);
    expect(claimed).toBe(true);
    const claimTime = Date.now() - pollStart;

    // DB-level operations should be < 50ms
    expect(claimTime).toBeLessThan(50);
  });
});

describe('Scheduler: GroupQueue running task prevention', () => {
  let queue: GroupQueue;

  beforeEach(() => {
    _initTestDatabase();
    queue = new GroupQueue();
  });

  it('running + pending + claim = triple protection against duplicates', async () => {
    createTask({
      id: 'triple-1',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'Triple-protected task',
      schedule_type: 'once',
      schedule_value: '2020-01-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: '2020-01-01T00:00:00.000Z',
      status: 'active',
      created_at: '2020-01-01T00:00:00.000Z',
    });

    let execCount = 0;
    let resolveTask: () => void;

    // Layer 1: DB claim
    expect(claimTask('triple-1')).toBe(true);
    expect(claimTask('triple-1')).toBe(false); // ✓ DB blocks second claim

    // Layer 2: Queue pending check
    queue.enqueueTask('group@g.us', 'triple-1', async () => {
      execCount++;
      await new Promise<void>((r) => {
        resolveTask = r;
      });
    });
    await new Promise((r) => setTimeout(r, 10));

    // Layer 3: Running task check
    expect(queue.isTaskRunning('triple-1')).toBe(true);
    queue.enqueueTask('group@g.us', 'triple-1', async () => {
      execCount++; // Should never execute
    });

    resolveTask!();
    await new Promise((r) => setTimeout(r, 50));

    expect(execCount).toBe(1);
    expect(queue.isTaskRunning('triple-1')).toBe(false);
  });
});

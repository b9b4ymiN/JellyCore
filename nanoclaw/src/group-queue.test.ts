import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { GroupQueue } from './group-queue.js';

vi.mock('./config.js', () => ({
  DATA_DIR: '/tmp/nanoclaw-test-data',
  MAIN_GROUP_FOLDER: 'main',
  MAX_CONCURRENT_CONTAINERS: 2,
  MAX_QUEUE_SIZE: 20,
  USER_MESSAGE_RETRY_SCHEDULE_MS: [5000, 30000],
  USER_MESSAGE_RETRY_JITTER_PCT: 0,
}));

vi.mock('./resource-monitor.js', () => ({
  resourceMonitor: {
    update: vi.fn(() => 2),
    stats: {
      currentMax: 2,
      cpuUsage: '0%',
      memoryFree: '100%',
    },
  },
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

describe('GroupQueue', () => {
  let queue: GroupQueue;

  beforeEach(() => {
    vi.useFakeTimers();
    queue = new GroupQueue();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('only runs one container per group at a time', async () => {
    let concurrentCount = 0;
    let maxConcurrent = 0;

    const processMessages = vi.fn(async () => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await new Promise((resolve) => setTimeout(resolve, 100));
      concurrentCount--;
      return true;
    });

    queue.setProcessMessagesFn(processMessages);
    queue.enqueueMessageCheck('group1@g.us');
    queue.enqueueMessageCheck('group1@g.us');
    await vi.advanceTimersByTimeAsync(200);
    expect(maxConcurrent).toBe(1);
  });

  it('respects global concurrency limit', async () => {
    let activeCount = 0;
    let maxActive = 0;
    const completionCallbacks: Array<() => void> = [];

    const processMessages = vi.fn(async () => {
      activeCount++;
      maxActive = Math.max(maxActive, activeCount);
      await new Promise<void>((resolve) => completionCallbacks.push(resolve));
      activeCount--;
      return true;
    });

    queue.setProcessMessagesFn(processMessages);
    queue.enqueueMessageCheck('group1@g.us');
    queue.enqueueMessageCheck('group2@g.us');
    queue.enqueueMessageCheck('group3@g.us');
    await vi.advanceTimersByTimeAsync(10);

    expect(maxActive).toBe(2);
    expect(activeCount).toBe(2);

    completionCallbacks[0]();
    await vi.advanceTimersByTimeAsync(10);
    expect(processMessages).toHaveBeenCalledTimes(3);
  });

  it('keeps user messages ahead of scheduler tasks when both are pending', async () => {
    const executionOrder: string[] = [];
    let resolveFirst: () => void;

    const processMessages = vi.fn(async () => {
      if (executionOrder.length === 0) {
        await new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });
      }
      executionOrder.push('messages');
      return true;
    });

    queue.setProcessMessagesFn(processMessages);
    queue.enqueueMessageCheck('group1@g.us');
    await vi.advanceTimersByTimeAsync(10);

    const taskFn = vi.fn(async () => {
      executionOrder.push('task');
    });
    queue.enqueueTask('group1@g.us', 'task-1', taskFn, 'scheduler');
    queue.enqueueMessageCheck('group1@g.us');

    resolveFirst!();
    await vi.advanceTimersByTimeAsync(20);

    expect(executionOrder[0]).toBe('messages');
    expect(executionOrder[1]).toBe('messages');
    expect(executionOrder).toContain('task');
  });

  it('retries with 5s then 30s backoff on failure', async () => {
    let callCount = 0;

    const processMessages = vi.fn(async () => {
      callCount++;
      return false;
    });

    queue.setProcessMessagesFn(processMessages);
    queue.enqueueMessageCheck('group1@g.us');

    await vi.advanceTimersByTimeAsync(10);
    expect(callCount).toBe(1);

    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(10);
    expect(callCount).toBe(2);

    await vi.advanceTimersByTimeAsync(30000);
    await vi.advanceTimersByTimeAsync(10);
    expect(callCount).toBe(3);
  });

  it('prevents new enqueues after shutdown', async () => {
    const processMessages = vi.fn(async () => true);
    queue.setProcessMessagesFn(processMessages);

    await queue.shutdown(1000);
    queue.enqueueMessageCheck('group1@g.us');
    await vi.advanceTimersByTimeAsync(100);
    expect(processMessages).not.toHaveBeenCalled();
  });

  it('stops retrying after configured retry budget', async () => {
    let callCount = 0;
    const processMessages = vi.fn(async () => {
      callCount++;
      return false;
    });

    queue.setProcessMessagesFn(processMessages);
    queue.enqueueMessageCheck('group1@g.us');

    await vi.advanceTimersByTimeAsync(10);
    expect(callCount).toBe(1);

    const retryDelays = [5000, 30000];
    for (let i = 0; i < retryDelays.length; i++) {
      await vi.advanceTimersByTimeAsync(retryDelays[i] + 10);
      expect(callCount).toBe(i + 2);
    }

    const countAfterMaxRetries = callCount;
    await vi.advanceTimersByTimeAsync(200000);
    expect(callCount).toBe(countAfterMaxRetries);
  });

  it('drains waiting groups when slots free up', async () => {
    const processed: string[] = [];
    const completionCallbacks: Array<() => void> = [];

    const processMessages = vi.fn(async (groupJid: string) => {
      processed.push(groupJid);
      await new Promise<void>((resolve) => completionCallbacks.push(resolve));
      return true;
    });

    queue.setProcessMessagesFn(processMessages);

    queue.enqueueMessageCheck('group1@g.us');
    queue.enqueueMessageCheck('group2@g.us');
    await vi.advanceTimersByTimeAsync(10);

    queue.enqueueMessageCheck('group3@g.us');
    await vi.advanceTimersByTimeAsync(10);
    expect(processed).toEqual(['group1@g.us', 'group2@g.us']);

    completionCallbacks[0]();
    await vi.advanceTimersByTimeAsync(10);
    expect(processed).toContain('group3@g.us');
  });
});

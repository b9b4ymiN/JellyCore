import { ChildProcess } from 'child_process';
import { CronExpressionParser } from 'cron-parser';
import fs from 'fs';
import path from 'path';

import {
  GROUPS_DIR,
  IDLE_TIMEOUT,
  MAIN_GROUP_FOLDER,
  ORACLE_BASE_URL,
  SCHEDULER_POLL_INTERVAL,
  TASK_DEFAULT_MAX_RETRIES,
  TASK_DEFAULT_RETRY_DELAY_MS,
  TASK_DEFAULT_TIMEOUT_MS,
  TIMEZONE,
} from './config.js';
import { ContainerOutput, runContainerAgent, writeTasksSnapshot } from './container-runner.js';
import {
  getAllTasks,
  getDueTasks,
  claimTask,
  recoverStaleClaims,
  getTaskById,
  logTaskRun,
  resetRetryCount,
  scheduleRetry,
  updateTask,
  updateTaskAfterRun,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { logger } from './logger.js';
import { RegisteredGroup, ScheduledTaskView } from './types.js';

export interface SchedulerDependencies {
  registeredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Record<string, string>;
  queue: GroupQueue;
  onProcess: (groupJid: string, proc: ChildProcess, containerName: string, groupFolder: string) => void;
  sendMessage: (jid: string, text: string) => Promise<void>;
}

/** Enrich a task for container snapshot: human-readable next_run + timezone context. */
function enrichTaskView(task: ReturnType<typeof getAllTasks>[number]): ScheduledTaskView {
  const next_run_local = task.next_run
    ? new Date(task.next_run).toLocaleString('th-TH', {
        timeZone: TIMEZONE,
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : null;
  return { ...task, next_run_local, timezone: TIMEZONE };
}

async function runTask(
  task: ReturnType<typeof getTaskById>,
  deps: SchedulerDependencies,
): Promise<void> {
  if (!task) return;

  const startTime = Date.now();
  const groupDir = path.join(GROUPS_DIR, task.group_folder);
  fs.mkdirSync(groupDir, { recursive: true });

  const effectiveTimeout = task.task_timeout_ms ?? TASK_DEFAULT_TIMEOUT_MS;
  const effectiveMaxRetries = task.max_retries ?? TASK_DEFAULT_MAX_RETRIES;
  const effectiveRetryDelay = task.retry_delay_ms ?? TASK_DEFAULT_RETRY_DELAY_MS;

  logger.info(
    { taskId: task.id, group: task.group_folder, label: task.label, timeout: effectiveTimeout },
    'Running scheduled task',
  );

  const groups = deps.registeredGroups();
  const group = Object.values(groups).find(
    (g) => g.folder === task.group_folder,
  );

  if (!group) {
    logger.error(
      { taskId: task.id, groupFolder: task.group_folder },
      'Group not found for task',
    );
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'error',
      result: null,
      error: `Group not found: ${task.group_folder}`,
    });
    return;
  }

  // Update tasks snapshot for container to read (filtered by group)
  const isMain = task.group_folder === MAIN_GROUP_FOLDER;
  const tasks = getAllTasks();
  writeTasksSnapshot(
    task.group_folder,
    isMain,
    tasks
      .filter((t) => t.status !== 'cancelled')
      .map((t) => {
        const view = enrichTaskView(t);
        return {
          id: view.id,
          groupFolder: view.group_folder, // writeTasksSnapshot expects camelCase
          prompt: view.prompt,
          schedule_type: view.schedule_type,
          schedule_value: view.schedule_value,
          status: view.status,
          next_run: view.next_run,
          next_run_local: view.next_run_local,
          timezone: view.timezone,
          label: view.label ?? null,
        };
      }),
  );

  let result: string | null = null;
  let error: string | null = null;

  // Hard timeout guard — prevents a hung container from blocking the scheduler forever
  let hardTimeoutFired = false;
  const hardTimeoutTimer = setTimeout(() => {
    hardTimeoutFired = true;
    logger.error({ taskId: task.id, timeoutMs: effectiveTimeout }, 'Task hard timeout — forcing stdin close');
    deps.queue.closeStdin('_sched_' + task.id);
  }, effectiveTimeout);

  // For group context mode, use the group's current session
  const sessions = deps.getSessions();
  const sessionId =
    task.context_mode === 'group' ? sessions[task.group_folder] : undefined;

  // Idle timer: writes _close sentinel after IDLE_TIMEOUT of no output
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug({ taskId: task.id }, 'Scheduled task idle timeout, closing container stdin');
      deps.queue.closeStdin('_sched_' + task.id);
    }, IDLE_TIMEOUT);
  };

  try {
    const output = await runContainerAgent(
      group,
      {
        prompt: task.prompt,
        sessionId,
        groupFolder: task.group_folder,
        chatJid: task.chat_jid,
        isMain,
        isScheduledTask: true,
      },
      (proc, containerName) => deps.onProcess('_sched_' + task.id, proc, containerName, task.group_folder),
      async (streamedOutput: ContainerOutput) => {
        if (streamedOutput.result) {
          result = streamedOutput.result;
          await deps.sendMessage(task.chat_jid, streamedOutput.result);
          resetIdleTimer();
        }
        if (streamedOutput.status === 'error') {
          error = streamedOutput.error || 'Unknown error';
        }
      },
    );

    if (idleTimer) clearTimeout(idleTimer);

    if (output.status === 'error') {
      error = output.error || 'Unknown error';
    } else if (output.result) {
      result = output.result;
    }

    if (hardTimeoutFired) {
      error = `Hard timeout after ${effectiveTimeout}ms`;
    }

    logger.info(
      { taskId: task.id, durationMs: Date.now() - startTime },
      'Task completed',
    );
  } catch (err) {
    if (idleTimer) clearTimeout(idleTimer);
    error = err instanceof Error ? err.message : String(err);
    logger.error({ taskId: task.id, error }, 'Task failed');
  } finally {
    clearTimeout(hardTimeoutTimer);
  }

  const durationMs = Date.now() - startTime;

  // --- Retry logic ---
  if (error) {
    const currentRetryCount = task.retry_count ?? 0;
    if (effectiveMaxRetries > 0 && currentRetryCount < effectiveMaxRetries) {
      // Schedule a retry
      scheduleRetry(task.id, effectiveRetryDelay);
      logTaskRun({
        task_id: task.id,
        run_at: new Date().toISOString(),
        duration_ms: durationMs,
        status: 'error',
        result: null,
        error: `${error} (retry ${currentRetryCount + 1}/${effectiveMaxRetries} in ${effectiveRetryDelay / 1000}s)`,
      });
      logger.warn(
        { taskId: task.id, attempt: currentRetryCount + 1, maxRetries: effectiveMaxRetries },
        'Task failed — retry scheduled',
      );
      return;
    }
    // Exhausted retries or no retry configured
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: durationMs,
      status: 'error',
      result: null,
      error,
    });
    // Auto-pause tasks that have exhausted their retry budget to prevent infinite failure loops
    if (effectiveMaxRetries > 0) {
      updateTask(task.id, { status: 'paused' });
      logger.warn({ taskId: task.id, maxRetries: effectiveMaxRetries }, 'Task auto-paused after retry exhaustion');
      try {
        await deps.sendMessage(
          task.chat_jid,
          `⚠️ Task "${task.label ?? task.id.slice(0, 8)}" has failed ${effectiveMaxRetries} times in a row\n\nReason: ${error}\n\nUse resume_task to start again`,
        );
      } catch { /* non-fatal */ }
    }
  } else {
    // Success — reset retry counter
    resetRetryCount(task.id);
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: durationMs,
      status: 'success',
      result,
      error: null,
    });
  }

  // --- Compute next_run ---
  let nextRun: string | null = null;
  if (task.schedule_type === 'cron') {
    const interval = CronExpressionParser.parse(task.schedule_value, {
      tz: TIMEZONE,
    });
    nextRun = interval.next().toISOString();
  } else if (task.schedule_type === 'interval') {
    const ms = parseInt(task.schedule_value, 10);
    nextRun = new Date(Date.now() + ms).toISOString();
  }
  // 'once' tasks: nextRun = null → status becomes 'completed'

  const resultSummary = error
    ? `Error: ${error}`
    : result
      ? result.slice(0, 200)
      : 'Completed';
  updateTaskAfterRun(task.id, nextRun, resultSummary);
}

let schedulerRunning = false;

export function startSchedulerLoop(deps: SchedulerDependencies): void {
  if (schedulerRunning) {
    logger.debug('Scheduler loop already running, skipping duplicate start');
    return;
  }
  schedulerRunning = true;

  // Crash recovery: release any tasks that were claimed but never completed
  // (e.g. process crashed between claim and updateTaskAfterRun)
  const recovered = recoverStaleClaims();
  if (recovered > 0) {
    logger.warn({ recovered }, 'Recovered stale task claims from previous crash');
  }

  logger.info({ pollIntervalMs: SCHEDULER_POLL_INTERVAL }, 'Scheduler loop started');

  const loop = async () => {
    try {
      const dueTasks = getDueTasks();
      if (dueTasks.length > 0) {
        logger.info({ count: dueTasks.length }, 'Found due tasks');
      }

      for (const task of dueTasks) {
        // Atomically claim this task — sets next_run to a far-future sentinel
        // so no subsequent poll cycle can re-discover it.
        if (!claimTask(task.id)) {
          logger.debug({ taskId: task.id }, 'Task already claimed, skipping');
          continue;
        }

        logger.info({ taskId: task.id, label: task.label }, 'Task claimed, enqueuing for execution');

        // Re-fetch to get latest status (might have been paused/cancelled concurrently)
        const currentTask = getTaskById(task.id);
        if (!currentTask || currentTask.status !== 'active') {
          continue;
        }

        // Use a virtual JID so scheduled tasks never block the user's message queue
        deps.queue.enqueueTask(
          '_sched_' + currentTask.id,
          currentTask.id,
          () => runTask(currentTask, deps),
        );
      }

      // After enqueuing all due tasks, ensure idle containers are preempted
      // so tasks don't wait behind a 30-min idle timeout.
      if (dueTasks.length > 0) {
        deps.queue.preemptForPendingTasks();
      }
    } catch (err) {
      logger.error({ err }, 'Error in scheduler loop');
    }

    setTimeout(loop, SCHEDULER_POLL_INTERVAL);
  };

  loop();
}

/** Fetch Oracle health summary for use in heartbeat messages. */
export async function fetchOracleSummary(): Promise<string | null> {
  try {
    const res = await fetch(`${ORACLE_BASE_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return `Oracle: HTTP ${res.status}`;
    const data = await res.json() as Record<string, unknown>;
    const status = data['status'] ?? 'unknown';
    const uptimeSec = typeof data['uptime'] === 'number' ? data['uptime'] : null;
    const uptimeStr = uptimeSec !== null
      ? `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`
      : '?';
    return `Oracle ${status} (uptime ${uptimeStr})`;
  } catch {
    return 'Oracle unreachable';
  }
}


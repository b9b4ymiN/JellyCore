import { ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

import { DATA_DIR, MAIN_GROUP_FOLDER, MAX_CONCURRENT_CONTAINERS, MAX_QUEUE_SIZE } from './config.js';
import { logger } from './logger.js';
import { resourceMonitor } from './resource-monitor.js';

interface QueuedTask {
  id: string;
  groupJid: string;
  fn: () => Promise<void>;
}

const MAX_RETRIES = 5;
const BASE_RETRY_MS = 5000;

interface GroupState {
  active: boolean;
  pendingMessages: boolean;
  pendingTasks: QueuedTask[];
  process: ChildProcess | null;
  containerName: string | null;
  groupFolder: string | null;
  retryCount: number;
}

export class GroupQueue {
  private groups = new Map<string, GroupState>();
  private activeCount = 0;
  private waitingGroups: string[] = [];
  private processMessagesFn: ((groupJid: string, retryCount: number) => Promise<boolean>) | null =
    null;
  private shuttingDown = false;
  private onQueuedCallback: ((groupJid: string, position: number) => void) | null = null;
  private onRejectedCallback: ((groupJid: string) => void) | null = null;
  private onMaxRetriesCallback: ((groupJid: string) => void) | null = null;
  // Track group folders for priority (set by caller)
  private groupFolders = new Map<string, string>();
  // Track task IDs that are currently executing (defense-in-depth against re-enqueue)
  private runningTaskIds = new Set<string>();

  /**
   * Register callbacks for queue feedback
   */
  onQueued(cb: (groupJid: string, position: number) => void): void {
    this.onQueuedCallback = cb;
  }

  onRejected(cb: (groupJid: string) => void): void {
    this.onRejectedCallback = cb;
  }

  onMaxRetriesExceeded(cb: (groupJid: string) => void): void {
    this.onMaxRetriesCallback = cb;
  }

  /**
   * Set group folder for priority calculation
   */
  setGroupFolder(groupJid: string, folder: string): void {
    this.groupFolders.set(groupJid, folder);
  }

  private getPriority(groupJid: string): number {
    const folder = this.groupFolders.get(groupJid) || this.getGroup(groupJid).groupFolder;
    if (folder === MAIN_GROUP_FOLDER) return 0; // highest
    return 1; // normal
  }

  private get effectiveConcurrency(): number {
    return resourceMonitor.update();
  }

  private getGroup(groupJid: string): GroupState {
    let state = this.groups.get(groupJid);
    if (!state) {
      state = {
        active: false,
        pendingMessages: false,
        pendingTasks: [],
        process: null,
        containerName: null,
        groupFolder: null,
        retryCount: 0,
      };
      this.groups.set(groupJid, state);
    }
    return state;
  }

  setProcessMessagesFn(fn: (groupJid: string, retryCount: number) => Promise<boolean>): void {
    this.processMessagesFn = fn;
  }

  enqueueMessageCheck(groupJid: string): void {
    if (this.shuttingDown) return;

    const state = this.getGroup(groupJid);

    if (state.active) {
      state.pendingMessages = true;
      logger.debug({ groupJid }, 'Container active, message queued');
      return;
    }

    if (this.activeCount >= this.effectiveConcurrency) {
      // Check queue size limit
      if (this.waitingGroups.length >= MAX_QUEUE_SIZE) {
        logger.warn({ groupJid, queueSize: this.waitingGroups.length }, 'Queue full, rejecting');
        this.onRejectedCallback?.(groupJid);
        return;
      }

      state.pendingMessages = true;
      if (!this.waitingGroups.includes(groupJid)) {
        // Priority insertion: main group goes first
        const priority = this.getPriority(groupJid);
        if (priority === 0) {
          // High priority — insert at front
          this.waitingGroups.unshift(groupJid);
        } else {
          this.waitingGroups.push(groupJid);
        }
        const position = this.waitingGroups.indexOf(groupJid) + 1;
        this.onQueuedCallback?.(groupJid, position);
      }
      logger.debug(
        { groupJid, activeCount: this.activeCount, queueSize: this.waitingGroups.length },
        'At concurrency limit, message queued',
      );
      return;
    }

    this.runForGroup(groupJid, 'messages');
  }

  enqueueTask(groupJid: string, taskId: string, fn: () => Promise<void>): void {
    if (this.shuttingDown) return;

    const state = this.getGroup(groupJid);

    // Prevent double-queuing of the same task (pending OR already running)
    if (this.runningTaskIds.has(taskId)) {
      logger.debug({ groupJid, taskId }, 'Task already running, skipping');
      return;
    }
    if (state.pendingTasks.some((t) => t.id === taskId)) {
      logger.debug({ groupJid, taskId }, 'Task already queued, skipping');
      return;
    }

    if (state.active) {
      state.pendingTasks.push({ id: taskId, groupJid, fn });
      logger.info({ groupJid, taskId }, 'Container active, task queued — preempting idle container');
      // Preempt the idle container: write _close sentinel so it wraps up
      // quickly and drainGroup() can run the pending task. Any pending
      // messages will be handled in a fresh container after the task runs.
      this.closeStdin(groupJid);
      return;
    }

    if (this.activeCount >= this.effectiveConcurrency) {
      state.pendingTasks.push({ id: taskId, groupJid, fn });
      if (!this.waitingGroups.includes(groupJid)) {
        this.waitingGroups.push(groupJid);
      }
      logger.debug(
        { groupJid, taskId, activeCount: this.activeCount },
        'At concurrency limit, task queued',
      );
      return;
    }

    // Run immediately
    this.runTask(groupJid, { id: taskId, groupJid, fn });
  }

  registerProcess(groupJid: string, proc: ChildProcess, containerName: string, groupFolder?: string): void {
    const state = this.getGroup(groupJid);
    state.process = proc;
    state.containerName = containerName;
    if (groupFolder) state.groupFolder = groupFolder;
  }

  /**
   * Send a follow-up message to the active container via IPC file.
   * Returns true if the message was written, false if no active container.
   */
  sendMessage(groupJid: string, text: string): boolean {
    const state = this.getGroup(groupJid);
    if (!state.active || !state.groupFolder) return false;

    const inputDir = path.join(DATA_DIR, 'ipc', state.groupFolder, 'input');
    try {
      fs.mkdirSync(inputDir, { recursive: true });
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`;
      const filepath = path.join(inputDir, filename);
      const tempPath = `${filepath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify({ type: 'message', text }));
      fs.renameSync(tempPath, filepath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Signal the active container to wind down by writing a close sentinel.
   */
  closeStdin(groupJid: string): void {
    const state = this.getGroup(groupJid);
    if (!state.active || !state.groupFolder) return;

    const inputDir = path.join(DATA_DIR, 'ipc', state.groupFolder, 'input');
    try {
      fs.mkdirSync(inputDir, { recursive: true });
      fs.writeFileSync(path.join(inputDir, '_close'), '');
    } catch {
      // ignore
    }
  }

  private async runForGroup(
    groupJid: string,
    reason: 'messages' | 'drain',
  ): Promise<void> {
    const state = this.getGroup(groupJid);
    state.active = true;
    state.pendingMessages = false;
    this.activeCount++;

    logger.debug(
      { groupJid, reason, activeCount: this.activeCount },
      'Starting container for group',
    );

    try {
      if (this.processMessagesFn) {
        const success = await this.processMessagesFn(groupJid, state.retryCount);
        if (success) {
          state.retryCount = 0;
        } else {
          this.scheduleRetry(groupJid, state);
        }
      }
    } catch (err) {
      logger.error({ groupJid, err }, 'Error processing messages for group');
      this.scheduleRetry(groupJid, state);
    } finally {
      state.active = false;
      state.process = null;
      state.containerName = null;
      state.groupFolder = null;
      this.activeCount--;
      this.drainGroup(groupJid);
    }
  }

  private async runTask(groupJid: string, task: QueuedTask): Promise<void> {
    const state = this.getGroup(groupJid);
    state.active = true;
    this.activeCount++;
    this.runningTaskIds.add(task.id);

    logger.debug(
      { groupJid, taskId: task.id, activeCount: this.activeCount },
      'Running queued task',
    );

    try {
      await task.fn();
    } catch (err) {
      logger.error({ groupJid, taskId: task.id, err }, 'Error running task');
    } finally {
      this.runningTaskIds.delete(task.id);
      state.active = false;
      state.process = null;
      state.containerName = null;
      state.groupFolder = null;
      this.activeCount--;
      this.drainGroup(groupJid);
    }
  }

  private scheduleRetry(groupJid: string, state: GroupState): void {
    state.retryCount++;
    if (state.retryCount > MAX_RETRIES) {
      logger.error(
        { groupJid, retryCount: state.retryCount },
        'Max retries exceeded, dropping messages (will retry on next incoming message)',
      );
      state.retryCount = 0;
      this.onMaxRetriesCallback?.(groupJid);
      return;
    }

    const delayMs = BASE_RETRY_MS * Math.pow(2, state.retryCount - 1);
    logger.info(
      { groupJid, retryCount: state.retryCount, delayMs },
      'Scheduling retry with backoff',
    );
    setTimeout(() => {
      if (!this.shuttingDown) {
        this.enqueueMessageCheck(groupJid);
      }
    }, delayMs);
  }

  private drainGroup(groupJid: string): void {
    if (this.shuttingDown) return;

    const state = this.getGroup(groupJid);

    // Tasks first (they won't be re-discovered from SQLite like messages)
    if (state.pendingTasks.length > 0) {
      const task = state.pendingTasks.shift()!;
      this.runTask(groupJid, task);
      return;
    }

    // Then pending messages
    if (state.pendingMessages) {
      this.runForGroup(groupJid, 'drain');
      return;
    }

    // Nothing pending for this group; check if other groups are waiting for a slot
    this.drainWaiting();
  }

  private drainWaiting(): void {
    while (
      this.waitingGroups.length > 0 &&
      this.activeCount < MAX_CONCURRENT_CONTAINERS
    ) {
      const nextJid = this.waitingGroups.shift()!;
      const state = this.getGroup(nextJid);

      // Prioritize tasks over messages
      if (state.pendingTasks.length > 0) {
        const task = state.pendingTasks.shift()!;
        this.runTask(nextJid, task);
      } else if (state.pendingMessages) {
        this.runForGroup(nextJid, 'drain');
      }
      // If neither pending, skip this group
    }
  }

  async shutdown(_gracePeriodMs: number): Promise<void> {
    this.shuttingDown = true;

    // Count active containers but don't kill them — they'll finish on their own
    // via idle timeout or container timeout. The --rm flag cleans them up on exit.
    // This prevents WhatsApp reconnection restarts from killing working agents.
    const activeContainers: string[] = [];
    for (const [jid, state] of this.groups) {
      if (state.process && !state.process.killed && state.containerName) {
        activeContainers.push(state.containerName);
      }
    }

    logger.info(
      { activeCount: this.activeCount, detachedContainers: activeContainers },
      'GroupQueue shutting down (containers detached, not killed)',
    );
  }

  /** Get current active container count */
  getActiveCount(): number {
    return this.activeCount;
  }

  /** Get current queue depth (waiting groups) */
  getQueueDepth(): number {
    return this.waitingGroups.length;
  }

  /** Check if a task is currently running */
  isTaskRunning(taskId: string): boolean {
    return this.runningTaskIds.has(taskId);
  }

  /**
   * Preempt idle containers for all groups that have pending tasks.
   * Called by the scheduler after enqueuing due tasks to ensure
   * containers don't sit idle for 30 minutes while tasks wait.
   */
  preemptForPendingTasks(): void {
    for (const [groupJid, state] of this.groups) {
      if (state.active && state.pendingTasks.length > 0 && state.groupFolder) {
        logger.debug(
          { groupJid, pendingTasks: state.pendingTasks.length },
          'Preempting idle container for pending tasks',
        );
        this.closeStdin(groupJid);
      }
    }
  }
}

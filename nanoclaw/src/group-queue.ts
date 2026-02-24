import { ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  DATA_DIR,
  MAIN_GROUP_FOLDER,
  MAX_QUEUE_SIZE,
  USER_MESSAGE_RETRY_JITTER_PCT,
  USER_MESSAGE_RETRY_SCHEDULE_MS,
} from './config.js';
import { logger } from './logger.js';
import { resourceMonitor } from './resource-monitor.js';
import { LaneType } from './types.js';

interface QueuedTask {
  id: string;
  groupJid: string;
  lane: LaneType;
  enqueuedAt: number;
  fn: () => Promise<void>;
}

interface GroupState {
  active: boolean;
  activeLane: LaneType | null;
  pendingMessages: boolean;
  pendingTasks: QueuedTask[];
  process: ChildProcess | null;
  containerName: string | null;
  groupFolder: string | null;
  retryCount: number;
}

interface LaneCounters {
  user: number;
  scheduler: number;
  heartbeat: number;
}

const BACKGROUND_STARVATION_MS = 15 * 60 * 1000;

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
  private groupFolders = new Map<string, string>();
  private runningTaskIds = new Set<string>();
  private laneActiveCounts: LaneCounters = { user: 0, scheduler: 0, heartbeat: 0 };

  onQueued(cb: (groupJid: string, position: number) => void): void {
    this.onQueuedCallback = cb;
  }

  onRejected(cb: (groupJid: string) => void): void {
    this.onRejectedCallback = cb;
  }

  onMaxRetriesExceeded(cb: (groupJid: string) => void): void {
    this.onMaxRetriesCallback = cb;
  }

  setGroupFolder(groupJid: string, folder: string): void {
    this.groupFolders.set(groupJid, folder);
  }

  private getPriority(groupJid: string): number {
    const folder = this.groupFolders.get(groupJid) || this.getGroup(groupJid).groupFolder;
    if (folder === MAIN_GROUP_FOLDER) return 0;
    return 1;
  }

  private get effectiveConcurrency(): number {
    return resourceMonitor.update();
  }

  private getGroup(groupJid: string): GroupState {
    let state = this.groups.get(groupJid);
    if (!state) {
      state = {
        active: false,
        activeLane: null,
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

  private userReservedSlots(totalSlots: number): number {
    return Math.max(1, Math.ceil(totalSlots * 0.8));
  }

  private hasPendingUserWork(): boolean {
    for (const [jid, state] of this.groups) {
      if (state.pendingMessages) return true;
      if (this.waitingGroups.includes(jid) && state.pendingMessages) return true;
    }
    return false;
  }

  private oldestBackgroundPendingAt(): number | null {
    let oldest: number | null = null;
    for (const state of this.groups.values()) {
      for (const task of state.pendingTasks) {
        if (task.lane === 'user') continue;
        if (oldest === null || task.enqueuedAt < oldest) oldest = task.enqueuedAt;
      }
    }
    return oldest;
  }

  private canStartLane(lane: LaneType): boolean {
    const totalSlots = this.effectiveConcurrency;
    if (this.activeCount >= totalSlots) return false;
    if (lane === 'user') return true;

    if (lane === 'scheduler' && this.laneActiveCounts.scheduler >= 1) return false;
    if (lane === 'heartbeat' && this.laneActiveCounts.heartbeat >= 1) return false;

    const userPending = this.hasPendingUserWork();
    if (!userPending) return true;

    const activeUser = this.laneActiveCounts.user;
    const reserved = this.userReservedSlots(totalSlots);
    if (activeUser >= reserved) return true;

    const oldestBg = this.oldestBackgroundPendingAt();
    const starving = oldestBg !== null && Date.now() - oldestBg > BACKGROUND_STARVATION_MS;
    return starving && activeUser === 0;
  }

  private incLane(lane: LaneType): void {
    this.laneActiveCounts[lane] += 1;
  }

  private decLane(lane: LaneType): void {
    this.laneActiveCounts[lane] = Math.max(0, this.laneActiveCounts[lane] - 1);
  }

  setProcessMessagesFn(fn: (groupJid: string, retryCount: number) => Promise<boolean>): void {
    this.processMessagesFn = fn;
  }

  enqueueMessageCheck(groupJid: string): boolean {
    if (this.shuttingDown) return false;

    const state = this.getGroup(groupJid);

    if (state.active) {
      state.pendingMessages = true;
      logger.debug({ groupJid }, 'Container active, message queued');
      return true;
    }

    if (!this.canStartLane('user')) {
      if (this.waitingGroups.length >= MAX_QUEUE_SIZE) {
        logger.warn({ groupJid, queueSize: this.waitingGroups.length }, 'Queue full, rejecting');
        this.onRejectedCallback?.(groupJid);
        return false;
      }

      state.pendingMessages = true;
      if (!this.waitingGroups.includes(groupJid)) {
        const priority = this.getPriority(groupJid);
        if (priority === 0) this.waitingGroups.unshift(groupJid);
        else this.waitingGroups.push(groupJid);
        const position = this.waitingGroups.indexOf(groupJid) + 1;
        this.onQueuedCallback?.(groupJid, position);
      }
      logger.debug(
        { groupJid, activeCount: this.activeCount, queueSize: this.waitingGroups.length },
        'At concurrency/priority limit, message queued',
      );
      return true;
    }

    this.runForGroup(groupJid, 'messages');
    return true;
  }

  enqueueTask(
    groupJid: string,
    taskId: string,
    fn: () => Promise<void>,
    lane: LaneType = 'scheduler',
  ): boolean {
    if (this.shuttingDown) return false;

    const state = this.getGroup(groupJid);

    if (this.runningTaskIds.has(taskId)) {
      logger.debug({ groupJid, taskId }, 'Task already running, skipping');
      return false;
    }
    if (state.pendingTasks.some((t) => t.id === taskId)) {
      logger.debug({ groupJid, taskId }, 'Task already queued, skipping');
      return false;
    }

    const queuedTask: QueuedTask = {
      id: taskId,
      groupJid,
      lane,
      enqueuedAt: Date.now(),
      fn,
    };

    if (state.active) {
      state.pendingTasks.push(queuedTask);
      logger.info({ groupJid, taskId, lane }, 'Container active, task queued');
      this.closeStdin(groupJid);
      return true;
    }

    if (!this.canStartLane(lane)) {
      state.pendingTasks.push(queuedTask);
      if (!this.waitingGroups.includes(groupJid)) {
        this.waitingGroups.push(groupJid);
      }
      logger.debug(
        { groupJid, taskId, lane, activeCount: this.activeCount },
        'Task queued by lane arbitration policy',
      );
      return true;
    }

    this.runTask(groupJid, queuedTask);
    return true;
  }

  registerProcess(
    groupJid: string,
    proc: ChildProcess,
    containerName: string,
    groupFolder?: string,
  ): void {
    const state = this.getGroup(groupJid);
    state.process = proc;
    state.containerName = containerName;
    if (groupFolder) state.groupFolder = groupFolder;
  }

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

  private async runForGroup(groupJid: string, reason: 'messages' | 'drain'): Promise<void> {
    const state = this.getGroup(groupJid);
    state.active = true;
    state.activeLane = 'user';
    state.pendingMessages = false;
    this.activeCount++;
    this.incLane('user');

    logger.debug(
      { groupJid, reason, activeCount: this.activeCount, lane: 'user' },
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
      state.activeLane = null;
      state.process = null;
      state.containerName = null;
      state.groupFolder = null;
      this.activeCount--;
      this.decLane('user');
      this.drainGroup(groupJid);
    }
  }

  private async runTask(groupJid: string, task: QueuedTask): Promise<void> {
    const state = this.getGroup(groupJid);
    state.active = true;
    state.activeLane = task.lane;
    this.activeCount++;
    this.incLane(task.lane);
    this.runningTaskIds.add(task.id);

    logger.debug(
      { groupJid, taskId: task.id, lane: task.lane, activeCount: this.activeCount },
      'Running queued task',
    );

    try {
      await task.fn();
    } catch (err) {
      logger.error({ groupJid, taskId: task.id, lane: task.lane, err }, 'Error running task');
    } finally {
      this.runningTaskIds.delete(task.id);
      state.active = false;
      state.activeLane = null;
      state.process = null;
      state.containerName = null;
      state.groupFolder = null;
      this.activeCount--;
      this.decLane(task.lane);
      this.drainGroup(groupJid);
    }
  }

  private scheduleRetry(groupJid: string, state: GroupState): void {
    state.retryCount++;
    const maxRetries = Math.max(1, USER_MESSAGE_RETRY_SCHEDULE_MS.length);
    if (state.retryCount > maxRetries) {
      logger.error(
        { groupJid, retryCount: state.retryCount },
        'Max retries exceeded, moving message flow to dead-letter callback',
      );
      state.retryCount = 0;
      this.onMaxRetriesCallback?.(groupJid);
      return;
    }

    const scheduleIndex = Math.min(state.retryCount - 1, USER_MESSAGE_RETRY_SCHEDULE_MS.length - 1);
    const baseDelay = USER_MESSAGE_RETRY_SCHEDULE_MS[scheduleIndex] || 5000;
    const jitterRange = (baseDelay * USER_MESSAGE_RETRY_JITTER_PCT) / 100;
    const jitter = Math.round((Math.random() * 2 - 1) * jitterRange);
    const delayMs = Math.max(1000, baseDelay + jitter);

    logger.info(
      { groupJid, retryCount: state.retryCount, delayMs, baseDelay },
      'Scheduling retry with jittered backoff',
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

    if (state.pendingTasks.length > 0) {
      const runnableIdx = state.pendingTasks.findIndex((task) => this.canStartLane(task.lane));
      if (runnableIdx !== -1) {
        const task = state.pendingTasks.splice(runnableIdx, 1)[0];
        this.runTask(groupJid, task);
        return;
      }
    }

    if (state.pendingMessages) {
      if (this.canStartLane('user')) {
        this.runForGroup(groupJid, 'drain');
      } else if (!this.waitingGroups.includes(groupJid)) {
        this.waitingGroups.push(groupJid);
      }
      return;
    }

    this.drainWaiting();
  }

  private drainWaiting(): void {
    let progressed = true;
    while (progressed && this.waitingGroups.length > 0 && this.activeCount < this.effectiveConcurrency) {
      progressed = false;
      const scanCount = this.waitingGroups.length;

      for (let i = 0; i < scanCount; i++) {
        if (this.activeCount >= this.effectiveConcurrency || this.waitingGroups.length === 0) break;

        const nextJid = this.waitingGroups.shift()!;
        const state = this.getGroup(nextJid);
        let started = false;

        if (state.pendingTasks.length > 0) {
          const runnableIdx = state.pendingTasks.findIndex((task) => this.canStartLane(task.lane));
          if (runnableIdx !== -1) {
            const task = state.pendingTasks.splice(runnableIdx, 1)[0];
            this.runTask(nextJid, task);
            started = true;
            progressed = true;
          }
        }

        if (!started && state.pendingMessages && this.canStartLane('user')) {
          this.runForGroup(nextJid, 'drain');
          started = true;
          progressed = true;
        }

        if (!started && (state.pendingMessages || state.pendingTasks.length > 0)) {
          this.waitingGroups.push(nextJid);
        }
      }
    }
  }

  async shutdown(_gracePeriodMs: number): Promise<void> {
    this.shuttingDown = true;

    const activeContainers: string[] = [];
    for (const state of this.groups.values()) {
      if (state.process && !state.process.killed && state.containerName) {
        activeContainers.push(state.containerName);
      }
    }

    logger.info(
      { activeCount: this.activeCount, detachedContainers: activeContainers },
      'GroupQueue shutting down (containers detached, not killed)',
    );
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  getQueueDepth(): number {
    return this.waitingGroups.length;
  }

  getLaneStats(): {
    active: LaneCounters;
    queueDepth: LaneCounters;
    reservedUserSlots: number;
    maxConcurrency: number;
  } {
    const queued: LaneCounters = { user: 0, scheduler: 0, heartbeat: 0 };
    for (const state of this.groups.values()) {
      if (state.pendingMessages) queued.user += 1;
      for (const task of state.pendingTasks) {
        if (task.lane === 'scheduler') queued.scheduler += 1;
        else if (task.lane === 'heartbeat') queued.heartbeat += 1;
        else queued.user += 1;
      }
    }

    const maxConcurrency = this.effectiveConcurrency;
    return {
      active: { ...this.laneActiveCounts },
      queueDepth: queued,
      reservedUserSlots: this.userReservedSlots(maxConcurrency),
      maxConcurrency,
    };
  }

  getActiveContainerNames(): Set<string> {
    const names = new Set<string>();
    for (const state of this.groups.values()) {
      if (state.process && !state.process.killed && state.containerName) {
        names.add(state.containerName);
      }
    }
    return names;
  }

  isTaskRunning(taskId: string): boolean {
    return this.runningTaskIds.has(taskId);
  }

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

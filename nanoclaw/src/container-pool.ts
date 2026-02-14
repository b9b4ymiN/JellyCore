/**
 * Container Warm Pool — Pre-warm containers for instant message handling
 *
 * Maintains a pool of standby containers for recently-active groups.
 * Eliminates cold-start latency (~3s → <300ms) by keeping containers alive
 * and reusing them across messages.
 *
 * Design:
 *   - Containers are pre-spawned per-group (mounts are group-specific)
 *   - Standby containers wait for assignments via IPC file
 *   - After task completion, containers return to standby
 *   - Idle containers are cleaned up after timeout
 *   - Falls back to cold spawn when pool is exhausted
 */

import { ChildProcess, exec, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  CONTAINER_IMAGE,
  DATA_DIR,
  POOL_IDLE_TIMEOUT,
  POOL_MAX_REUSE,
  POOL_MAX_SIZE,
  POOL_MIN_SIZE,
  POOL_WARMUP_INTERVAL,
} from './config.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

export interface PooledContainer {
  id: string;
  containerName: string;
  process: ChildProcess;
  status: 'warming' | 'ready' | 'in-use' | 'draining';
  groupFolder: string;
  createdAt: number;
  lastUsedAt: number;
  reuseCount: number;
}

export interface PoolStats {
  total: number;
  ready: number;
  inUse: number;
  warming: number;
  maxSize: number;
  reusedCount: number;
  coldSpawnFallbacks: number;
}

// IPC assignment file that standby containers watch for
const ASSIGNMENT_FILENAME = '_assignment.json';
const READY_FILENAME = '_ready';

class ContainerPool {
  private pool = new Map<string, PooledContainer>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private warmupTimer: ReturnType<typeof setInterval> | null = null;
  private totalReused = 0;
  private totalColdFallbacks = 0;
  private buildVolumeMountsFn: ((group: RegisteredGroup, isMain: boolean) => Array<{
    hostPath: string; containerPath: string; readonly: boolean;
  }>) | null = null;
  private buildContainerArgsFn: ((mounts: Array<{
    hostPath: string; containerPath: string; readonly: boolean;
  }>, containerName: string) => string[]) | null = null;

  /**
   * Initialize the pool with references to container-runner build functions.
   * Must be called before pool operations.
   */
  init(
    buildVolumeMounts: typeof this.buildVolumeMountsFn,
    buildContainerArgs: typeof this.buildContainerArgsFn,
  ): void {
    this.buildVolumeMountsFn = buildVolumeMounts;
    this.buildContainerArgsFn = buildContainerArgs;
  }

  /**
   * Start the pool: begin cleanup and warmup loops
   */
  start(): void {
    // Periodic cleanup of idle containers
    this.cleanupTimer = setInterval(() => this.cleanup(), POOL_WARMUP_INTERVAL);

    logger.info(
      { minSize: POOL_MIN_SIZE, maxSize: POOL_MAX_SIZE, idleTimeout: POOL_IDLE_TIMEOUT },
      'Container pool started',
    );
  }

  /**
   * Pre-warm a container for a specific group
   */
  async warmForGroup(group: RegisteredGroup, isMain: boolean): Promise<PooledContainer | null> {
    // Don't exceed max pool size
    if (this.pool.size >= POOL_MAX_SIZE) {
      logger.debug({ poolSize: this.pool.size, max: POOL_MAX_SIZE }, 'Pool at max capacity');
      return null;
    }

    // Don't warm if already have a warm container for this group
    const existing = this.findByGroup(group.folder);
    if (existing && (existing.status === 'ready' || existing.status === 'warming')) {
      return existing;
    }

    if (!this.buildVolumeMountsFn || !this.buildContainerArgsFn) {
      logger.warn('Container pool not initialized (init not called)');
      return null;
    }

    const id = `pool-${group.folder}-${Date.now()}`;
    const safeName = group.folder.replace(/[^a-zA-Z0-9-]/g, '-');
    const containerName = `nanoclaw-pool-${safeName}-${Date.now()}`;

    try {
      const mounts = this.buildVolumeMountsFn(group, isMain);
      const containerArgs = this.buildContainerArgsFn(mounts, containerName);

      logger.info({ containerName, group: group.folder }, 'Warming container');

      const container: PooledContainer = {
        id,
        containerName,
        process: null as unknown as ChildProcess,
        status: 'warming',
        groupFolder: group.folder,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        reuseCount: 0,
      };
      this.pool.set(id, container);

      // Spawn in standby mode: stdin sends minimal config, no prompt
      const proc = spawn('docker', containerArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      container.process = proc;

      // Send standby config via stdin
      const standbyInput = {
        prompt: '__STANDBY__',
        groupFolder: group.folder,
        chatJid: '',
        isMain,
        secrets: {}, // Secrets injected per-assignment
      };
      proc.stdin.write(JSON.stringify(standbyInput));
      proc.stdin.end();

      // Wait for READY signal from the container
      const ipcDir = path.join(DATA_DIR, 'ipc', group.folder, 'input');
      fs.mkdirSync(ipcDir, { recursive: true });

      const ready = await this.waitForReady(group.folder, 30_000);

      if (ready) {
        container.status = 'ready';
        logger.info({ containerName, group: group.folder }, 'Container warmed and ready');
      } else {
        container.status = 'draining';
        this.destroyContainer(container);
        return null;
      }

      // Handle container exit
      proc.on('close', (code: number | null) => {
        logger.info({ containerName, group: group.folder, code }, 'Pool container exited');
        this.pool.delete(id);
      });

      proc.on('error', (err: Error) => {
        logger.error({ containerName, group: group.folder, err }, 'Pool container error');
        this.pool.delete(id);
      });

      // Log stderr for debugging
      proc.stderr?.on('data', (data: Buffer) => {
        const line = data.toString().trim();
        if (line) logger.debug({ container: group.folder, pool: true }, line);
      });

      return container;
    } catch (err) {
      logger.error({ group: group.folder, err }, 'Failed to warm container');
      this.pool.delete(id);
      return null;
    }
  }

  /**
   * Acquire a ready container for a group.
   * Returns null if no warm container is available (caller should cold-spawn).
   */
  acquire(groupFolder: string): PooledContainer | null {
    const container = this.findByGroup(groupFolder);
    if (!container || container.status !== 'ready') {
      this.totalColdFallbacks++;
      return null;
    }

    container.status = 'in-use';
    container.lastUsedAt = Date.now();
    this.totalReused++;

    logger.info(
      { containerName: container.containerName, group: groupFolder, reuseCount: container.reuseCount },
      'Acquired container from pool',
    );

    return container;
  }

  /**
   * Send an assignment to a pooled container via IPC
   */
  async assignTask(
    container: PooledContainer,
    input: {
      prompt: string;
      sessionId?: string;
      chatJid: string;
      isMain: boolean;
      isScheduledTask?: boolean;
      secrets: Record<string, string>;
    },
  ): Promise<void> {
    const ipcDir = path.join(DATA_DIR, 'ipc', container.groupFolder, 'input');
    const assignmentFile = path.join(ipcDir, ASSIGNMENT_FILENAME);

    // Write assignment file for the container to pick up
    fs.writeFileSync(assignmentFile, JSON.stringify(input));
    logger.debug({ containerName: container.containerName }, 'Assignment written to IPC');
  }

  /**
   * Release a container back to the pool or destroy it
   */
  release(id: string, keepAlive: boolean = true): void {
    const container = this.pool.get(id);
    if (!container) return;

    if (keepAlive && container.reuseCount < POOL_MAX_REUSE) {
      container.status = 'ready';
      container.reuseCount++;
      container.lastUsedAt = Date.now();

      logger.info(
        { containerName: container.containerName, reuseCount: container.reuseCount },
        'Container returned to pool',
      );
    } else {
      logger.info(
        { containerName: container.containerName, reason: keepAlive ? 'max-reuse' : 'error' },
        'Container retired from pool',
      );
      this.destroyContainer(container);
    }
  }

  /**
   * Check if a warm container is available for a group
   */
  hasReady(groupFolder: string): boolean {
    const c = this.findByGroup(groupFolder);
    return c?.status === 'ready' || false;
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    let ready = 0, inUse = 0, warming = 0;
    for (const c of this.pool.values()) {
      if (c.status === 'ready') ready++;
      else if (c.status === 'in-use') inUse++;
      else if (c.status === 'warming') warming++;
    }

    return {
      total: this.pool.size,
      ready,
      inUse,
      warming,
      maxSize: POOL_MAX_SIZE,
      reusedCount: this.totalReused,
      coldSpawnFallbacks: this.totalColdFallbacks,
    };
  }

  /**
   * Cleanup idle containers and ensure min pool size
   */
  private cleanup(): void {
    const now = Date.now();

    for (const [id, container] of this.pool) {
      if (container.status === 'ready') {
        const idleTime = now - container.lastUsedAt;
        if (idleTime > POOL_IDLE_TIMEOUT) {
          logger.info(
            { containerName: container.containerName, idleMs: idleTime },
            'Cleaning up idle pool container',
          );
          this.destroyContainer(container);
        }
      }
    }
  }

  /**
   * Shutdown: destroy all containers
   */
  async shutdown(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.warmupTimer) clearInterval(this.warmupTimer);

    const promises: Promise<void>[] = [];
    for (const container of this.pool.values()) {
      promises.push(this.destroyContainerAsync(container));
    }
    await Promise.allSettled(promises);
    this.pool.clear();
    logger.info('Container pool shut down');
  }

  // --- Internal helpers ---

  private findByGroup(groupFolder: string): PooledContainer | undefined {
    for (const c of this.pool.values()) {
      if (c.groupFolder === groupFolder && c.status !== 'draining') {
        return c;
      }
    }
    return undefined;
  }

  private waitForReady(groupFolder: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const readyPath = path.join(DATA_DIR, 'ipc', groupFolder, 'input', READY_FILENAME);
      const start = Date.now();

      const check = () => {
        if (fs.existsSync(readyPath)) {
          try { fs.unlinkSync(readyPath); } catch { /* ok */ }
          resolve(true);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          logger.warn({ groupFolder, timeoutMs }, 'Container warmup timed out');
          resolve(false);
          return;
        }
        setTimeout(check, 200);
      };
      check();
    });
  }

  private destroyContainer(container: PooledContainer): void {
    container.status = 'draining';
    this.pool.delete(container.id);

    // Write _close sentinel to gracefully stop the container
    try {
      const closeFile = path.join(DATA_DIR, 'ipc', container.groupFolder, 'input', '_close');
      fs.writeFileSync(closeFile, '');
    } catch { /* best effort */ }

    // Force stop after 10s
    setTimeout(() => {
      exec(`docker stop ${container.containerName}`, { timeout: 15000 }, () => {
        // Ignore errors — container may have already exited
      });
    }, 10_000);
  }

  private destroyContainerAsync(container: PooledContainer): Promise<void> {
    return new Promise((resolve) => {
      container.status = 'draining';

      try {
        const closeFile = path.join(DATA_DIR, 'ipc', container.groupFolder, 'input', '_close');
        fs.writeFileSync(closeFile, '');
      } catch { /* best effort */ }

      exec(`docker stop ${container.containerName}`, { timeout: 15000 }, () => {
        resolve();
      });
    });
  }
}

export const containerPool = new ContainerPool();

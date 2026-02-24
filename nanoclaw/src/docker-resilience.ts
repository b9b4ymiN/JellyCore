import { execSync } from 'child_process';

import {
  DOCKER_HEALTH_PROBE_INTERVAL_MS,
  ORPHAN_SWEEP_INTERVAL_MS,
  SPAWN_CIRCUIT_COOLDOWN_MS,
  SPAWN_CIRCUIT_THRESHOLD,
  SPAWN_CIRCUIT_WINDOW_MS,
} from './config.js';
import { logger } from './logger.js';
import { LaneType } from './types.js';

type ActiveContainersProvider = () => Set<string>;

interface SpawnCircuitState {
  threshold: number;
  windowMs: number;
  cooldownMs: number;
  failureTimestamps: number[];
  openUntil: number;
  lastError: string | null;
}

class DockerResilience {
  private circuit: SpawnCircuitState = {
    threshold: SPAWN_CIRCUIT_THRESHOLD,
    windowMs: SPAWN_CIRCUIT_WINDOW_MS,
    cooldownMs: SPAWN_CIRCUIT_COOLDOWN_MS,
    failureTimestamps: [],
    openUntil: 0,
    lastError: null,
  };
  private dockerHealthy = true;
  private dockerErrorStreak = 0;
  private lastProbeAt = 0;
  private lastHealthyAt = Date.now();
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private orphanSweepTimer: ReturnType<typeof setInterval> | null = null;
  private activeContainersProvider: ActiveContainersProvider | null = null;
  private orphanSweepKills = 0;

  init(activeContainersProvider: ActiveContainersProvider): void {
    this.activeContainersProvider = activeContainersProvider;
    if (!this.probeTimer) {
      this.probeTimer = setInterval(
        () => this.probeDockerDaemon(),
        DOCKER_HEALTH_PROBE_INTERVAL_MS,
      );
    }
    if (!this.orphanSweepTimer) {
      this.orphanSweepTimer = setInterval(
        () => this.sweepOrphans(),
        ORPHAN_SWEEP_INTERVAL_MS,
      );
    }
    this.probeDockerDaemon();
  }

  stop(): void {
    if (this.probeTimer) {
      clearInterval(this.probeTimer);
      this.probeTimer = null;
    }
    if (this.orphanSweepTimer) {
      clearInterval(this.orphanSweepTimer);
      this.orphanSweepTimer = null;
    }
  }

  canSpawn(lane: LaneType): { allowed: boolean; reason?: string } {
    if (!this.dockerHealthy) {
      return { allowed: false, reason: 'Docker daemon unhealthy' };
    }

    if (this.isCircuitOpen()) {
      const remainingMs = Math.max(0, this.circuit.openUntil - Date.now());
      return {
        allowed: false,
        reason: `Spawn circuit open (${Math.ceil(remainingMs / 1000)}s remaining, lane=${lane})`,
      };
    }

    return { allowed: true };
  }

  recordSpawnFailure(error: string): void {
    const now = Date.now();
    this.circuit.lastError = error;
    this.circuit.failureTimestamps.push(now);
    this.circuit.failureTimestamps = this.circuit.failureTimestamps.filter(
      (t) => now - t <= this.circuit.windowMs,
    );

    if (this.circuit.failureTimestamps.length >= this.circuit.threshold) {
      this.circuit.openUntil = now + this.circuit.cooldownMs;
      logger.error(
        {
          failures: this.circuit.failureTimestamps.length,
          threshold: this.circuit.threshold,
          cooldownMs: this.circuit.cooldownMs,
          error,
        },
        'Spawn circuit opened',
      );
    }
  }

  recordSpawnSuccess(): void {
    this.circuit.failureTimestamps = [];
    this.circuit.lastError = null;
  }

  getState(): {
    healthy: boolean;
    errorStreak: number;
    lastProbeAt: number;
    lastHealthyAt: number;
    spawnFailureStreak: number;
    circuitOpen: boolean;
    circuitOpenUntil: number;
    circuitLastError: string | null;
    orphanSweepKills: number;
  } {
    return {
      healthy: this.dockerHealthy,
      errorStreak: this.dockerErrorStreak,
      lastProbeAt: this.lastProbeAt,
      lastHealthyAt: this.lastHealthyAt,
      spawnFailureStreak: this.circuit.failureTimestamps.length,
      circuitOpen: this.isCircuitOpen(),
      circuitOpenUntil: this.circuit.openUntil,
      circuitLastError: this.circuit.lastError,
      orphanSweepKills: this.orphanSweepKills,
    };
  }

  private isCircuitOpen(): boolean {
    return Date.now() < this.circuit.openUntil;
  }

  private probeDockerDaemon(): void {
    this.lastProbeAt = Date.now();
    try {
      execSync('docker info', { stdio: 'pipe', timeout: 5000 });
      if (!this.dockerHealthy) {
        logger.info('Docker daemon recovered');
      }
      this.dockerHealthy = true;
      this.dockerErrorStreak = 0;
      this.lastHealthyAt = Date.now();
    } catch (err) {
      this.dockerHealthy = false;
      this.dockerErrorStreak += 1;
      const msg = err instanceof Error ? err.message : String(err);
      if (this.dockerErrorStreak === 1 || this.dockerErrorStreak % 5 === 0) {
        logger.warn({ errorStreak: this.dockerErrorStreak, err: msg }, 'Docker health probe failed');
      }
      this.recordSpawnFailure(`docker_probe_failed: ${msg}`);
    }
  }

  private sweepOrphans(): void {
    if (!this.activeContainersProvider) return;
    try {
      const output = execSync(
        'docker ps --filter label=jellycore.managed=true --format "{{.Names}}"',
        { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8', timeout: 10000 },
      );
      const running = output.trim().split('\n').filter(Boolean);
      if (running.length === 0) return;

      const active = this.activeContainersProvider();
      const orphans = running.filter(
        (name) => !active.has(name) && !name.startsWith('nanoclaw-pool-'),
      );
      if (orphans.length === 0) return;

      for (const name of orphans) {
        try {
          execSync(`docker stop ${name}`, { stdio: 'pipe', timeout: 15000 });
          execSync(`docker rm -f ${name}`, { stdio: 'pipe', timeout: 10000 });
          this.orphanSweepKills += 1;
        } catch (err) {
          logger.warn({ name, err }, 'Failed to stop/remove orphan container');
        }
      }
      logger.warn({ orphans }, 'Orphan sweep removed unmanaged containers');
    } catch (err) {
      logger.debug({ err }, 'Orphan sweep skipped due to docker command failure');
    }
  }
}

export const dockerResilience = new DockerResilience();

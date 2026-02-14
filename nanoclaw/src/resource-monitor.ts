/**
 * Resource Monitor — Dynamic concurrency adjustment
 *
 * Monitors CPU and memory to dynamically adjust container concurrency.
 * Reduces concurrency under load, scales back up when resources free.
 */

import os from 'os';
import { MAX_CONCURRENT_CONTAINERS } from './config.js';

export class ResourceMonitor {
  private _currentMax: number;
  private readonly baseMax: number;

  constructor() {
    this.baseMax = MAX_CONCURRENT_CONTAINERS;
    this._currentMax = this.baseMax;
  }

  /**
   * Recalculate optimal concurrency based on system resources.
   * Called before each container spawn decision.
   */
  update(): number {
    let max = this.baseMax;

    // Check CPU load (1-minute average, normalized to CPU count)
    const loadAvg = os.loadavg()[0];
    const cpuCount = os.cpus().length;
    const cpuUsage = loadAvg / cpuCount;
    if (cpuUsage > 0.8) max--;

    // Check memory
    const freeRatio = os.freemem() / os.totalmem();
    if (freeRatio < 0.2) max--;

    // Clamp
    this._currentMax = Math.max(1, Math.min(max, this.baseMax));
    return this._currentMax;
  }

  get currentMax(): number {
    return this._currentMax;
  }

  get stats() {
    const loadAvg = os.loadavg()[0];
    const cpuCount = os.cpus().length;
    return {
      currentMax: this._currentMax,
      baseMax: this.baseMax,
      cpuUsage: ((loadAvg / cpuCount) * 100).toFixed(1) + '%',
      memoryFree: ((os.freemem() / os.totalmem()) * 100).toFixed(1) + '%',
    };
  }
}

export const resourceMonitor = new ResourceMonitor();

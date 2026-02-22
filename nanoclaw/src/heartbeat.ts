/**
 * Heartbeat barrel export (v3.0 -- modular)
 *
 * The heartbeat system is split into three focused modules:
 *   heartbeat-config.ts   -- runtime config + activity / error tracking
 *   heartbeat-reporter.ts -- status message building + scheduled timer
 *   heartbeat-jobs.ts     -- smart job runner (recurring AI tasks)
 *
 * Import from this file to access any heartbeat symbol.
 */

export type { HeartbeatRuntimeConfig } from './heartbeat-config.js';
export {
  patchHeartbeatConfig,
  getHeartbeatConfig,
  recordActivity,
  recordHeartbeatError,
  clearHeartbeatErrors,
  getLastActivityTime,
  getConsecutiveErrors,
  onHeartbeatConfigChange,
} from './heartbeat-config.js';

export type { HeartbeatStatusProvider, HeartbeatReason } from './heartbeat-reporter.js';
export {
  startHeartbeat,
  triggerManualHeartbeat,
} from './heartbeat-reporter.js';

export type { HeartbeatJobRunnerDeps } from './heartbeat-jobs.js';
export {
  startHeartbeatJobRunner,
  runDueHeartbeatJobs,
  getRecentJobResults,
} from './heartbeat-jobs.js';

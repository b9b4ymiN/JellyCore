/**
 * Heartbeat Runtime Configuration
 *
 * Manages live config that can be patched via IPC/HTTP, plus activity and error tracking.
 * Separated from the reporter/runner so each module can import config without
 * pulling in the full heartbeat dependency chain.
 */

import {
  HEARTBEAT_ENABLED,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_SILENCE_THRESHOLD_MS,
} from './config.js';
import { logger } from './logger.js';

// ── Config type ───────────────────────────────────────────────────────────────

export interface HeartbeatRuntimeConfig {
  enabled: boolean;
  intervalMs: number;
  silenceThresholdMs: number;
  /** JID of the chat that receives heartbeat messages */
  mainChatJid: string;
  /** Escalate frequency when consecutive errors exceed this count */
  escalateAfterErrors: number;
}

let runtimeConfig: HeartbeatRuntimeConfig = {
  enabled: HEARTBEAT_ENABLED,
  intervalMs: HEARTBEAT_INTERVAL_MS,
  silenceThresholdMs: HEARTBEAT_SILENCE_THRESHOLD_MS,
  mainChatJid: '',
  escalateAfterErrors: 3,
};

/** Callbacks invoked whenever config is patched (e.g. to restart timers). */
const onConfigChangeCallbacks: Array<() => void> = [];

/**
 * Register a callback to be called whenever patchHeartbeatConfig() is called.
 * Returns an unsubscribe function.
 */
export function onHeartbeatConfigChange(cb: () => void): () => void {
  onConfigChangeCallbacks.push(cb);
  return () => {
    const i = onConfigChangeCallbacks.indexOf(cb);
    if (i !== -1) onConfigChangeCallbacks.splice(i, 1);
  };
}

/** Patch heartbeat config at runtime (called by IPC heartbeat_config handler). */
export function patchHeartbeatConfig(patch: Partial<HeartbeatRuntimeConfig>): void {
  runtimeConfig = { ...runtimeConfig, ...patch };
  logger.info({ config: runtimeConfig }, 'Heartbeat config updated');
  for (const cb of onConfigChangeCallbacks) {
    try { cb(); } catch (err) { logger.warn({ err }, 'onHeartbeatConfigChange callback error'); }
  }
}

export function getHeartbeatConfig(): Readonly<HeartbeatRuntimeConfig> {
  return { ...runtimeConfig };
}

// ── Activity tracking ─────────────────────────────────────────────────────────

let lastActivityTime = Date.now();

/** Call this on every inbound message or successful task run. */
export function recordActivity(): void {
  lastActivityTime = Date.now();
}

export function getLastActivityTime(): number {
  return lastActivityTime;
}

// ── Error escalation tracking ─────────────────────────────────────────────────

let consecutiveErrors = 0;

/** Call this on task errors to enable auto-escalation. */
export function recordHeartbeatError(): void {
  consecutiveErrors += 1;
}

export function clearHeartbeatErrors(): void {
  consecutiveErrors = 0;
}

export function getConsecutiveErrors(): number {
  return consecutiveErrors;
}

/**
 * Heartbeat Reporter
 *
 * Alert-first heartbeat delivery with OpenClaw-style HEARTBEAT_OK semantics:
 * - "HEARTBEAT_OK" means healthy
 * - any other output is treated as an alert summary
 * - delivery honors showOk/showAlerts/useIndicator/deliveryMuted flags
 */

import {
  ORACLE_BASE_URL,
  TIMEZONE,
} from './config.js';
import { recentErrors } from './health-server.js';
import { logger } from './logger.js';
import {
  getHeartbeatConfig,
  getLastActivityTime,
  getConsecutiveErrors,
  clearHeartbeatErrors,
  onHeartbeatConfigChange,
} from './heartbeat-config.js';
import { getRecentJobResults } from './heartbeat-jobs.js';

interface OracleHealth {
  status?: string;
  uptime?: number;
}

interface OracleStats {
  total?: number;
  totalDocs?: number;
}

export type HeartbeatReason = 'scheduled' | 'silence' | 'escalated' | 'manual';

export interface HeartbeatStatusProvider {
  getStatus: () => {
    activeContainers: number;
    queueDepth: number;
    registeredGroups: string[];
    uptimeMs: number;
  };
  sendMessage: (jid: string, text: string) => Promise<void>;
}

interface HeartbeatCheckResult {
  raw: string;
  status: ReturnType<HeartbeatStatusProvider['getStatus']>;
  oracleHealth: OracleHealth | null;
  oracleStats: OracleStats | null;
  silentMin: number;
}

interface ParsedHeartbeatResult {
  ok: boolean;
  summary: string;
}

export interface HeartbeatVisibilityConfig {
  showOk: boolean;
  showAlerts: boolean;
  deliveryMuted: boolean;
}

let lastAlertSignature = '';
let lastAlertAt = 0;

function joinUrl(base: string, endpoint: string): string {
  const trimmedBase = base.replace(/\/+$/, '');
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${trimmedBase}${path}`;
}

async function fetchJsonWithFallback<T>(
  baseUrl: string,
  paths: string[],
): Promise<T | null> {
  for (const p of paths) {
    try {
      const res = await fetch(joinUrl(baseUrl, p), {
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      return (await res.json()) as T;
    } catch {
      // Try next candidate path.
    }
  }
  return null;
}

async function fetchOracleHealth(): Promise<OracleHealth | null> {
  return fetchJsonWithFallback<OracleHealth>(ORACLE_BASE_URL, [
    '/api/health',
    '/health',
  ]);
}

async function fetchOracleStats(): Promise<OracleStats | null> {
  return fetchJsonWithFallback<OracleStats>(ORACLE_BASE_URL, [
    '/api/stats',
    '/oracle/stats',
  ]);
}

function summarizeRecentSystemErrors(withinMs: number, limit: number): string[] {
  const cutoff = Date.now() - withinMs;
  const unique = new Set<string>();
  const out: string[] = [];

  for (let i = recentErrors.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const e = recentErrors[i];
    const ts = Date.parse(e.timestamp);
    if (Number.isFinite(ts) && ts < cutoff) continue;

    const normalized = e.message.trim().toLowerCase();
    if (!normalized || unique.has(normalized)) continue;

    unique.add(normalized);
    out.push(e.message.trim());
  }

  return out.reverse();
}

function summarizeRecentHeartbeatJobFailures(withinMs: number, limit: number): string[] {
  const recent = getRecentJobResults(withinMs);
  const unique = new Set<string>();
  const failures: string[] = [];

  for (let i = recent.length - 1; i >= 0 && failures.length < limit; i -= 1) {
    const r = recent[i];
    const txt = r.result.trim();
    const isFailure =
      txt.startsWith('\u274C') ||
      txt.toLowerCase().startsWith('error:');
    if (!isFailure) continue;

    const summary = `${r.label}: ${txt.replace(/^\u274C\s*/, '').replace(/^Error:\s*/i, '')}`;
    const normalized = summary.toLowerCase();
    if (unique.has(normalized)) continue;

    unique.add(normalized);
    failures.push(summary);
  }

  return failures.reverse();
}

function formatUptime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function parseHeartbeatOutput(raw: string, ackMaxChars: number): ParsedHeartbeatResult {
  const trimmed = raw.trim();
  if (trimmed === 'HEARTBEAT_OK') {
    return { ok: true, summary: 'HEARTBEAT_OK' };
  }

  const normalized = trimmed
    .replace(/^ALERT\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return { ok: false, summary: 'Heartbeat check reported an issue without details.' };
  }

  const maxLen = Math.max(80, Math.min(ackMaxChars, 1200));
  return {
    ok: false,
    summary: normalized.length > maxLen ? `${normalized.slice(0, maxLen)}...` : normalized,
  };
}

export function shouldDeliverHeartbeatResult(
  parsed: ParsedHeartbeatResult,
  cfg: HeartbeatVisibilityConfig,
): boolean {
  if (cfg.deliveryMuted) return false;
  if (parsed.ok) return cfg.showOk;
  return cfg.showAlerts;
}

function buildHeartbeatSignal(
  reason: HeartbeatReason,
  silentMin: number,
  consecutiveErrors: number,
  oracleHealth: OracleHealth | null,
  sysErrors: string[],
  heartbeatJobFailures: string[],
): string {
  const alerts: string[] = [];

  if (!oracleHealth) {
    alerts.push('Oracle health endpoint unreachable.');
  } else if (oracleHealth.status && !['ok', 'healthy'].includes(oracleHealth.status.toLowerCase())) {
    alerts.push(`Oracle status is ${oracleHealth.status}.`);
  }

  if (reason === 'escalated' || consecutiveErrors > 0) {
    alerts.push(`Consecutive errors: ${consecutiveErrors}.`);
  }

  for (const e of sysErrors) {
    alerts.push(`System error: ${e.slice(0, 140)}`);
  }

  for (const f of heartbeatJobFailures) {
    alerts.push(`Heartbeat job failed: ${f.slice(0, 140)}`);
  }

  // Inactivity is informational, not an outage.
  if (alerts.length === 0 && reason === 'silence' && silentMin > 0) {
    return `HEARTBEAT_OK\nNo user activity for ${silentMin} minutes.`;
  }

  if (alerts.length === 0) {
    return 'HEARTBEAT_OK';
  }

  return `ALERT: ${alerts.join(' | ')}`;
}

async function collectHeartbeatSignal(
  reason: HeartbeatReason,
  statusProvider: HeartbeatStatusProvider,
): Promise<HeartbeatCheckResult> {
  const status = statusProvider.getStatus();
  const [oracleHealth, oracleStats] = await Promise.all([
    fetchOracleHealth(),
    fetchOracleStats(),
  ]);

  const cfg = getHeartbeatConfig();
  const consecutiveErrors = getConsecutiveErrors();
  const silentMin = Math.floor((Date.now() - getLastActivityTime()) / 60_000);
  const sysErrors = summarizeRecentSystemErrors(
    Math.max(cfg.intervalMs, 30 * 60 * 1000),
    2,
  );
  const heartbeatJobFailures = summarizeRecentHeartbeatJobFailures(
    Math.max(cfg.intervalMs, 60 * 60 * 1000),
    1,
  );

  const raw = buildHeartbeatSignal(
    reason,
    silentMin,
    consecutiveErrors,
    oracleHealth,
    sysErrors,
    heartbeatJobFailures,
  );

  return {
    raw,
    status,
    oracleHealth,
    oracleStats,
    silentMin,
  };
}

function formatHeartbeatMessage(
  reason: HeartbeatReason,
  parsed: ParsedHeartbeatResult,
  check: HeartbeatCheckResult,
): string {
  const cfg = getHeartbeatConfig();
  const nowLabel = new Date().toLocaleString('th-TH', {
    timeZone: TIMEZONE,
    dateStyle: 'short',
    timeStyle: 'medium',
  });

  const reasonLabel: Record<HeartbeatReason, string> = {
    scheduled: 'scheduled',
    silence: 'silence',
    escalated: 'escalated',
    manual: 'manual',
  };

  const lines: string[] = [];
  if (parsed.ok) {
    const prefix = cfg.useIndicator ? '[OK] ' : '';
    lines.push(`${prefix}${parsed.summary}`);
    lines.push(`Mode: ${reasonLabel[reason]} | ${nowLabel}`);

    if (reason === 'silence') {
      lines.push(`No activity for ${check.silentMin} min.`);
    }

    lines.push(
      `Containers ${check.status.activeContainers} | Queue ${check.status.queueDepth} | Groups ${check.status.registeredGroups.length}`,
    );

    if (check.oracleHealth) {
      const status = check.oracleHealth.status || 'ok';
      const docs = check.oracleStats?.total ?? check.oracleStats?.totalDocs;
      if (docs !== undefined) {
        lines.push(`Oracle ${status} | Docs ${docs.toLocaleString()}`);
      } else {
        lines.push(`Oracle ${status}`);
      }
    }

    lines.push(`Uptime ${formatUptime(check.status.uptimeMs)}`);
    return lines.join('\n');
  }

  const prefix = cfg.useIndicator ? '[ALERT] ' : '';
  lines.push(`${prefix}Heartbeat alert`);
  lines.push(`Mode: ${reasonLabel[reason]} | ${nowLabel}`);
  lines.push(parsed.summary);

  if (check.status.queueDepth > 0) {
    lines.push(`Queue depth: ${check.status.queueDepth}`);
  }

  return lines.join('\n');
}

function makeAlertSignature(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d{1,2}:\d{2}(:\d{2})?/g, '<time>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

async function sendHeartbeat(
  reason: HeartbeatReason,
  provider: HeartbeatStatusProvider,
): Promise<void> {
  const cfg = getHeartbeatConfig();
  if (!cfg.enabled || !cfg.mainChatJid) return;

  const check = await collectHeartbeatSignal(reason, provider);
  const parsed = parseHeartbeatOutput(check.raw, cfg.ackMaxChars);

  if (!shouldDeliverHeartbeatResult(parsed, cfg)) {
    if (cfg.deliveryMuted) {
      logger.info({ reason, ok: parsed.ok }, 'Heartbeat delivery muted; check executed only');
    } else if (parsed.ok) {
      logger.debug({ reason }, 'Heartbeat OK suppressed by config');
    } else {
      logger.debug({ reason }, 'Heartbeat alert suppressed by config');
    }
    return;
  }

  if (!parsed.ok) {
    const signature = makeAlertSignature(parsed.summary);
    const now = Date.now();
    if (
      signature &&
      signature === lastAlertSignature &&
      now - lastAlertAt < cfg.alertRepeatCooldownMs
    ) {
      logger.info(
        {
          reason,
          cooldownMs: cfg.alertRepeatCooldownMs,
        },
        'Skipping repeated heartbeat alert in cooldown window',
      );
      return;
    }

    lastAlertSignature = signature;
    lastAlertAt = now;
  }

  try {
    const msg = formatHeartbeatMessage(reason, parsed, check);
    await provider.sendMessage(cfg.mainChatJid, msg);
    logger.info({ reason, ok: parsed.ok }, 'Heartbeat sent');
    if (reason === 'escalated') clearHeartbeatErrors();
  } catch (err) {
    logger.warn({ err }, 'Heartbeat send failed (non-fatal)');
  }
}

/**
 * Start the heartbeat system. Returns a cleanup function.
 * Timers automatically restart when patchHeartbeatConfig() is called.
 */
export function startHeartbeat(provider: HeartbeatStatusProvider): () => void {
  let timers: ReturnType<typeof setInterval>[] = [];
  let stopped = false;
  let lastSilenceAlert = 0;

  const startTimers = () => {
    for (const t of timers) clearInterval(t);
    timers = [];

    const cfg = getHeartbeatConfig();
    if (!cfg.enabled) return;

    const scheduledTimer = setInterval(() => {
      const reason: HeartbeatReason =
        getConsecutiveErrors() >= cfg.escalateAfterErrors ? 'escalated' : 'scheduled';
      void sendHeartbeat(reason, provider);
    }, cfg.intervalMs);
    timers.push(scheduledTimer);

    const silenceCheckInterval = Math.min(cfg.silenceThresholdMs / 4, 10 * 60 * 1000);
    const silenceTimer = setInterval(() => {
      const silentMs = Date.now() - getLastActivityTime();
      const cooldownMs = cfg.silenceThresholdMs;
      if (silentMs > cfg.silenceThresholdMs && Date.now() - lastSilenceAlert > cooldownMs) {
        lastSilenceAlert = Date.now();
        void sendHeartbeat('silence', provider);
      }
    }, silenceCheckInterval);
    timers.push(silenceTimer);
  };

  startTimers();

  const unsubscribe = onHeartbeatConfigChange(() => {
    if (!stopped) {
      logger.info('Heartbeat timers restarting due to config change');
      startTimers();
    }
  });

  logger.info(
    {
      enabled: getHeartbeatConfig().enabled,
      intervalH: getHeartbeatConfig().intervalMs / 3_600_000,
      silenceH: getHeartbeatConfig().silenceThresholdMs / 3_600_000,
    },
    'Heartbeat system started',
  );

  return () => {
    stopped = true;
    unsubscribe();
    for (const t of timers) clearInterval(t);
    logger.debug('Heartbeat system stopped');
  };
}

/** Trigger a manual heartbeat immediately (e.g. from IPC command or HTTP endpoint). */
export async function triggerManualHeartbeat(provider: HeartbeatStatusProvider): Promise<void> {
  await sendHeartbeat('manual', provider);
}

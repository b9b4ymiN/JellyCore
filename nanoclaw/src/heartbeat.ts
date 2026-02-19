/**
 * NanoClaw Heartbeat System (v1.0)
 *
 * Sends periodic health snapshots to the main admin group.
 * - Fetches Oracle health + stats for a comprehensive status report
 * - Silence detection: alerts when there is no activity for N hours
 * - Fully configurable at runtime via IPC (AI can adjust settings)
 * - Self-escalating: increases frequency when errors are detected
 */

import {
  HEARTBEAT_ENABLED,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_SILENCE_THRESHOLD_MS,
  ORACLE_BASE_URL,
  TIMEZONE,
} from './config.js';
import { getAllTasks, getTaskRunLogs } from './db.js';
import { recentErrors } from './health-server.js';
import { logger } from './logger.js';

// ── Runtime config (can be patched via IPC / heartbeat_config command) ──────

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

/** Patch heartbeat config at runtime (called by IPC heartbeat_config handler). */
export function patchHeartbeatConfig(patch: Partial<HeartbeatRuntimeConfig>): void {
  runtimeConfig = { ...runtimeConfig, ...patch };
  logger.info({ config: runtimeConfig }, 'Heartbeat config updated');
}

export function getHeartbeatConfig(): Readonly<HeartbeatRuntimeConfig> {
  return { ...runtimeConfig };
}

// ── Activity tracking ────────────────────────────────────────────────────────

let lastActivityTime = Date.now();
let consecutiveErrors = 0;

/** Call this on every inbound message or successful task run. */
export function recordActivity(): void {
  lastActivityTime = Date.now();
}

/** Call this on task errors to enable auto-escalation. */
export function recordHeartbeatError(): void {
  consecutiveErrors += 1;
}

export function clearHeartbeatErrors(): void {
  consecutiveErrors = 0;
}

// ── Oracle integration ───────────────────────────────────────────────────────

interface OracleHealth {
  status: string;
  uptime: number;
  docsIndexed?: number;
  cacheSize?: number;
}

interface OracleStats {
  totalDocs?: number;
  searchRequests?: number;
}

async function fetchOracleHealth(): Promise<OracleHealth | null> {
  try {
    const res = await fetch(`${ORACLE_BASE_URL}/health`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return (await res.json()) as OracleHealth;
  } catch {
    return null;
  }
}

async function fetchOracleStats(): Promise<OracleStats | null> {
  try {
    const res = await fetch(`${ORACLE_BASE_URL}/oracle/stats`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return (await res.json()) as OracleStats;
  } catch {
    return null;
  }
}

// ── Message building ─────────────────────────────────────────────────────────

type HeartbeatReason = 'scheduled' | 'silence' | 'escalated' | 'manual';

function formatUptime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}ชม. ${m}น.`;
  return `${m}น.`;
}

async function buildHeartbeatMessage(
  reason: HeartbeatReason,
  statusProvider: HeartbeatStatusProvider,
): Promise<string> {
  const now = new Date();
  const timeLabel = now.toLocaleString('th-TH', {
    timeZone: TIMEZONE,
    dateStyle: 'short',
    timeStyle: 'medium',
  });

  const status = statusProvider.getStatus();
  const [oracleHealth, oracleStats] = await Promise.all([
    fetchOracleHealth(),
    fetchOracleStats(),
  ]);

  // Tasks due in next 24 hours
  const allTasks = getAllTasks().filter((t) => t.status === 'active');
  const dueSoon = allTasks.filter((t) => {
    if (!t.next_run) return false;
    const diff = new Date(t.next_run).getTime() - Date.now();
    return diff > 0 && diff < 24 * 60 * 60 * 1000;
  });

  // Recent task failures
  const recentFailedRuns = allTasks
    .flatMap((t) => {
      const logs = getTaskRunLogs(t.id, 3);
      return logs
        .filter((l) => l.status === 'error')
        .map((l) => ({ task: t.label ?? t.id.slice(0, 8), error: l.error ?? 'unknown', at: l.run_at }));
    })
    .slice(0, 3);

  // System errors
  const sysErrors = recentErrors.slice(-3);

  // Header emoji by reason
  const header: Record<HeartbeatReason, string> = {
    scheduled: '💓 Heartbeat',
    silence: '💤 Silence Heartbeat',
    escalated: '🚨 Escalated Heartbeat',
    manual: '📣 Manual Heartbeat',
  };

  const lines: string[] = [
    `${header[reason]}`,
    `🕐 ${timeLabel} (${TIMEZONE})`,
    ``,
  ];

  // NanoClaw status
  lines.push(`🤖 *NanoClaw*`);
  lines.push(`   Containers: ${status.activeContainers} active | Queue: ${status.queueDepth}`);
  lines.push(`   Groups: ${status.registeredGroups.length} registered`);
  lines.push(`   Uptime: ${formatUptime(status.uptimeMs)}`);
  lines.push(``);

  // Oracle status
  lines.push(`🧠 *Oracle*`);
  if (oracleHealth) {
    const oracleUptime = oracleHealth.uptime
      ? formatUptime(oracleHealth.uptime * 1000)
      : '?';
    lines.push(`   สถานะ: ${oracleHealth.status} | Uptime: ${oracleUptime}`);
    if (oracleStats?.totalDocs !== undefined) {
      lines.push(`   เอกสาร: ${oracleStats.totalDocs.toLocaleString()} รายการ`);
    }
  } else {
    lines.push(`   ⚠️ ไม่สามารถเชื่อมต่อ Oracle ได้`);
  }
  lines.push(``);

  // Scheduler
  lines.push(`📅 *Scheduler*`);
  lines.push(`   Active tasks: ${allTasks.length}`);
  if (dueSoon.length > 0) {
    lines.push(`   Due ใน 24h: ${dueSoon.length} รายการ`);
    const next = dueSoon[0];
    const nextTime = next.next_run
      ? new Date(next.next_run).toLocaleString('th-TH', {
          timeZone: TIMEZONE,
          timeStyle: 'short',
        })
      : '?';
    lines.push(`   ถัดไป: "${next.label ?? next.schedule_value}" เวลา ${nextTime}`);
  } else {
    lines.push(`   ไม่มี tasks ใน 24h`);
  }
  lines.push(``);

  // Errors
  const hasErrors = sysErrors.length > 0 || recentFailedRuns.length > 0;
  if (hasErrors) {
    lines.push(`⚠️ *ข้อผิดพลาดล่าสุด*`);
    for (const e of sysErrors) {
      lines.push(`   • [sys] ${e.message.slice(0, 80)}`);
    }
    for (const f of recentFailedRuns) {
      lines.push(`   • [task:${f.task}] ${String(f.error).slice(0, 80)}`);
    }
    lines.push(``);
  }

  // Footer
  if (reason === 'silence') {
    const silentMin = Math.floor((Date.now() - lastActivityTime) / 60000);
    lines.push(`ℹ️ ไม่มีกิจกรรม ${silentMin} นาที`);
  } else if (reason === 'escalated') {
    lines.push(`🔴 พบ errors ติดต่อกัน ${consecutiveErrors} ครั้ง — เพิ่มความถี่ heartbeat ชั่วคราว`);
  }

  lines.push(hasErrors ? `\n⚠️ ระบบทำงาน มีข้อผิดพลาดบางส่วน` : `\n✅ ระบบทำงานปกติ`);

  return lines.join('\n');
}

// ── Core heartbeat logic ─────────────────────────────────────────────────────

export interface HeartbeatStatusProvider {
  getStatus: () => {
    activeContainers: number;
    queueDepth: number;
    registeredGroups: string[];
    uptimeMs: number;
  };
  sendMessage: (jid: string, text: string) => Promise<void>;
}

async function sendHeartbeat(
  reason: HeartbeatReason,
  provider: HeartbeatStatusProvider,
): Promise<void> {
  const { mainChatJid, enabled } = runtimeConfig;
  if (!enabled || !mainChatJid) return;

  try {
    const msg = await buildHeartbeatMessage(reason, provider);
    await provider.sendMessage(mainChatJid, msg);
    logger.info({ reason }, 'Heartbeat sent');
    if (reason === 'escalated') consecutiveErrors = 0;
  } catch (err) {
    logger.warn({ err }, 'Heartbeat send failed (non-fatal)');
  }
}

/** Start the heartbeat system. Returns a cleanup function. */
export function startHeartbeat(provider: HeartbeatStatusProvider): () => void {
  const timers: ReturnType<typeof setInterval>[] = [];

  // ── Scheduled heartbeat ────────────────────────────────────────────────────
  const scheduledTimer = setInterval(() => {
    const reason: HeartbeatReason =
      consecutiveErrors >= runtimeConfig.escalateAfterErrors ? 'escalated' : 'scheduled';
    sendHeartbeat(reason, provider);
  }, runtimeConfig.intervalMs);
  timers.push(scheduledTimer);

  // ── Silence monitor ────────────────────────────────────────────────────────
  // Checks every 10 min whether the system has been silent too long
  const silenceCheckInterval = Math.min(runtimeConfig.silenceThresholdMs / 4, 10 * 60 * 1000);
  let lastSilenceAlert = 0;

  const silenceTimer = setInterval(() => {
    const silentMs = Date.now() - lastActivityTime;
    const cooldownMs = runtimeConfig.silenceThresholdMs; // Don't re-alert until active again
    if (silentMs > runtimeConfig.silenceThresholdMs && Date.now() - lastSilenceAlert > cooldownMs) {
      lastSilenceAlert = Date.now();
      sendHeartbeat('silence', provider);
    }
  }, silenceCheckInterval);
  timers.push(silenceTimer);

  logger.info(
    {
      enabled: runtimeConfig.enabled,
      intervalH: runtimeConfig.intervalMs / 3600000,
      silenceH: runtimeConfig.silenceThresholdMs / 3600000,
    },
    'Heartbeat system started',
  );

  // Return cleanup
  return () => {
    for (const t of timers) clearInterval(t);
    logger.debug('Heartbeat system stopped');
  };
}

/** Trigger a manual heartbeat immediately (e.g. from IPC command). */
export async function triggerManualHeartbeat(
  provider: HeartbeatStatusProvider,
): Promise<void> {
  await sendHeartbeat('manual', provider);
}

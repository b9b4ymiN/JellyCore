/**
 * Heartbeat Reporter
 *
 * Builds comprehensive status messages and sends them to the main admin chat.
 * Handles four reasons: scheduled, silence, escalated, manual.
 *
 * Timer is restartable — calling patchHeartbeatConfig() automatically restarts
 * the timers with the new interval/threshold values.
 */

import {
  HEARTBEAT_JOB_DEFAULT_INTERVAL_MS,
  ORACLE_BASE_URL,
  TIMEZONE,
} from './config.js';
import { getAllTasks, getActiveHeartbeatJobs, getTaskRunLogs } from './db.js';
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

// ── Oracle integration ────────────────────────────────────────────────────────

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
    const res = await fetch(`${ORACLE_BASE_URL}/health`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return (await res.json()) as OracleHealth;
  } catch { return null; }
}

async function fetchOracleStats(): Promise<OracleStats | null> {
  try {
    const res = await fetch(`${ORACLE_BASE_URL}/oracle/stats`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return (await res.json()) as OracleStats;
  } catch { return null; }
}

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Message building ──────────────────────────────────────────────────────────

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
  const allTasks = getAllTasks().filter(t => t.status === 'active');
  const dueSoon = allTasks.filter(t => {
    if (!t.next_run) return false;
    const diff = new Date(t.next_run).getTime() - Date.now();
    return diff > 0 && diff < 24 * 60 * 60 * 1000;
  });

  // Recent task failures (last 3 tasks × last 3 logs each)
  const recentFailedRuns = allTasks
    .flatMap(t => {
      const logs = getTaskRunLogs(t.id, 3);
      return logs
        .filter(l => l.status === 'error')
        .map(l => ({ task: t.label ?? t.id.slice(0, 8), error: l.error ?? 'unknown', at: l.run_at }));
    })
    .slice(0, 3);

  const sysErrors = recentErrors.slice(-3);

  const header: Record<HeartbeatReason, string> = {
    scheduled: '💓 Heartbeat',
    silence: '💤 Silence Heartbeat',
    escalated: '🚨 Escalated Heartbeat',
    manual: '📣 Manual Heartbeat',
  };

  const lines: string[] = [
    `${header[reason]}`,
    `🕐 ${timeLabel} (${TIMEZONE})`,
    '',
  ];

  // NanoClaw status
  lines.push('🤖 *NanoClaw*');
  lines.push(`   Containers: ${status.activeContainers} active | Queue: ${status.queueDepth}`);
  lines.push(`   Groups: ${status.registeredGroups.length} registered`);
  lines.push(`   Uptime: ${formatUptime(status.uptimeMs)}`);
  lines.push('');

  // Oracle status
  lines.push('🧠 *Oracle*');
  if (oracleHealth) {
    const oracleUptime = oracleHealth.uptime ? formatUptime(oracleHealth.uptime * 1000) : '?';
    lines.push(`   สถานะ: ${oracleHealth.status} | Uptime: ${oracleUptime}`);
    if (oracleStats?.totalDocs !== undefined) {
      lines.push(`   เอกสาร: ${oracleStats.totalDocs.toLocaleString()} รายการ`);
    }
  } else {
    lines.push('   ⚠️ ไม่สามารถเชื่อมต่อ Oracle ได้');
  }
  lines.push('');

  // Scheduler
  lines.push('📅 *Scheduler*');
  lines.push(`   Active tasks: ${allTasks.length}`);
  if (dueSoon.length > 0) {
    lines.push(`   Due ใน 24h: ${dueSoon.length} รายการ`);
    const next = dueSoon[0];
    const nextTime = next.next_run
      ? new Date(next.next_run).toLocaleString('th-TH', { timeZone: TIMEZONE, timeStyle: 'short' })
      : '?';
    lines.push(`   ถัดไป: "${next.label ?? next.schedule_value}" เวลา ${nextTime}`);
  } else {
    lines.push('   ไม่มี tasks ใน 24h');
  }
  lines.push('');

  // Errors section
  const hasErrors = sysErrors.length > 0 || recentFailedRuns.length > 0;
  if (hasErrors) {
    lines.push('⚠️ *ข้อผิดพลาดล่าสุด*');
    for (const e of sysErrors) {
      lines.push(`   • [sys] ${e.message.slice(0, 80)}`);
    }
    for (const f of recentFailedRuns) {
      lines.push(`   • [task:${f.task}] ${String(f.error).slice(0, 80)}`);
    }
    lines.push('');
  }

  // Smart Heartbeat Jobs summary
  const activeJobs = getActiveHeartbeatJobs();
  if (activeJobs.length > 0) {
    const categoryEmoji: Record<string, string> = {
      learning: '📚',
      monitor: '📊',
      health: '🏥',
      custom: '🔧',
    };
    lines.push(`🧠 *Smart Jobs* (${activeJobs.length} active)`);
    for (const job of activeJobs.slice(0, 5)) {
      const emoji = categoryEmoji[job.category] ?? '🔧';
      let lastResult: string;
      if (job.last_result === '__RUNNING__') {
        lastResult = ' ⏳ กำลังทำงาน…';
      } else if (job.last_result) {
        const truncated = job.last_result.slice(0, 60);
        lastResult = ` → ${truncated}${job.last_result.length > 60 ? '…' : ''}`;
      } else {
        lastResult = ' (ยังไม่เคยทำงาน)';
      }
      const intervalMin = (job.interval_ms ?? HEARTBEAT_JOB_DEFAULT_INTERVAL_MS) / 60000;
      lines.push(`   ${emoji} ${job.label} (ทุก ${intervalMin}น.)${lastResult}`);
    }
    if (activeJobs.length > 5) {
      lines.push(`   … และอีก ${activeJobs.length - 5} งาน`);
    }
    lines.push('');
  }

  // Recent completed jobs (last 6h) in case reporter fires between job runs
  const recentResults = getRecentJobResults(6 * 60 * 60 * 1000);
  if (recentResults.length > 0) {
    lines.push(`📋 *งานล่าสุด (6ชม.)*`);
    for (const r of recentResults.slice(0, 3)) {
      const categoryEmoji: Record<string, string> = { learning: '📚', monitor: '📊', health: '🏥', custom: '🔧' };
      const emoji = categoryEmoji[r.category] ?? '🔧';
      const summary = r.result.startsWith('❌') ? r.result.slice(0, 60) : r.result.slice(0, 60);
      lines.push(`   ${emoji} ${r.label}: ${summary}`);
    }
    lines.push('');
  }

  // Footer
  const consecutiveErrors = getConsecutiveErrors();
  if (reason === 'silence') {
    const silentMin = Math.floor((Date.now() - getLastActivityTime()) / 60000);
    lines.push(`ℹ️ ไม่มีกิจกรรม ${silentMin} นาที`);
  } else if (reason === 'escalated') {
    lines.push(`🔴 พบ errors ติดต่อกัน ${consecutiveErrors} ครั้ง — เพิ่มความถี่ heartbeat ชั่วคราว`);
  }

  lines.push(hasErrors ? '\n⚠️ ระบบทำงาน มีข้อผิดพลาดบางส่วน' : '\n✅ ระบบทำงานปกติ');

  return lines.join('\n');
}

// ── Send ──────────────────────────────────────────────────────────────────────

async function sendHeartbeat(
  reason: HeartbeatReason,
  provider: HeartbeatStatusProvider,
): Promise<void> {
  const { mainChatJid, enabled } = getHeartbeatConfig();
  if (!enabled || !mainChatJid) return;

  try {
    const msg = await buildHeartbeatMessage(reason, provider);
    await provider.sendMessage(mainChatJid, msg);
    logger.info({ reason }, 'Heartbeat sent');
    if (reason === 'escalated') clearHeartbeatErrors();
  } catch (err) {
    logger.warn({ err }, 'Heartbeat send failed (non-fatal)');
  }
}

// ── Timer lifecycle ───────────────────────────────────────────────────────────

/**
 * Start the heartbeat system. Returns a cleanup function.
 * Timers automatically restart when patchHeartbeatConfig() is called.
 */
export function startHeartbeat(provider: HeartbeatStatusProvider): () => void {
  let timers: ReturnType<typeof setInterval>[] = [];
  let stopped = false;
  let lastSilenceAlert = 0;

  const startTimers = () => {
    // Clear any existing timers first
    for (const t of timers) clearInterval(t);
    timers = [];

    const cfg = getHeartbeatConfig();
    if (!cfg.enabled) return;

    // Scheduled heartbeat
    const scheduledTimer = setInterval(() => {
      const reason: HeartbeatReason =
        getConsecutiveErrors() >= cfg.escalateAfterErrors ? 'escalated' : 'scheduled';
      sendHeartbeat(reason, provider);
    }, cfg.intervalMs);
    timers.push(scheduledTimer);

    // Silence monitor — checks at most every 10 min
    const silenceCheckInterval = Math.min(cfg.silenceThresholdMs / 4, 10 * 60 * 1000);
    const silenceTimer = setInterval(() => {
      const silentMs = Date.now() - getLastActivityTime();
      const cooldownMs = cfg.silenceThresholdMs;
      if (silentMs > cfg.silenceThresholdMs && Date.now() - lastSilenceAlert > cooldownMs) {
        lastSilenceAlert = Date.now();
        sendHeartbeat('silence', provider);
      }
    }, silenceCheckInterval);
    timers.push(silenceTimer);
  };

  startTimers();

  // Auto-restart when config changes (interval, silence threshold, enabled flag)
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

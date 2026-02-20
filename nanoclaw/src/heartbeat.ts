/**
 * NanoClaw Heartbeat System (v2.0 — Smart Heartbeat)
 *
 * Sends periodic health snapshots to the main admin group.
 * Now with user-configurable "Heartbeat Jobs" that run on each cycle:
 * - Learning: AI research/study tasks
 * - Monitor: Stock tracking, price alerts, news monitoring
 * - Health: Personal health/wellness checks
 * - Custom: Any user-defined recurring intelligence task
 *
 * Users configure jobs via chat → AI uses MCP tools to manage them.
 * Jobs execute as lightweight prompts during each heartbeat cycle.
 *
 * Features:
 * - Fetches Oracle health + stats for a comprehensive status report
 * - Silence detection: alerts when there is no activity for N hours
 * - Fully configurable at runtime via IPC (AI can adjust settings)
 * - Self-escalating: increases frequency when errors are detected
 * - Smart Jobs: user-configurable tasks that run with each heartbeat
 */

import {
  HEARTBEAT_ENABLED,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_JOB_DEFAULT_INTERVAL_MS,
  HEARTBEAT_JOB_POLL_INTERVAL_MS,
  HEARTBEAT_SILENCE_THRESHOLD_MS,
  ORACLE_BASE_URL,
  TIMEZONE,
} from './config.js';
import { getAllTasks, getDueHeartbeatJobs, getActiveHeartbeatJobs, getTaskRunLogs, updateHeartbeatJobResult } from './db.js';
import { recentErrors } from './health-server.js';
import { logger } from './logger.js';
import { HeartbeatJob } from './types.js';

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
      const lastResult = job.last_result
        ? ` → ${job.last_result.slice(0, 60)}${job.last_result.length > 60 ? '…' : ''}`
        : ' (ยังไม่เคยทำงาน)';
      const intervalMin = (job.interval_ms ?? HEARTBEAT_JOB_DEFAULT_INTERVAL_MS) / 60000;
      lines.push(`   ${emoji} ${job.label} (ทุก ${intervalMin}น.)${lastResult}`);
    }
    if (activeJobs.length > 5) {
      lines.push(`   … และอีก ${activeJobs.length - 5} งาน`);
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

// ── Smart Heartbeat Job Runner ───────────────────────────────────────────────

/**
 * Dependencies for the heartbeat job runner.
 * Allows jobs to be executed through the existing container agent system.
 */
export interface HeartbeatJobRunnerDeps {
  /**
   * Execute a heartbeat job's prompt and return the result.
   * This should enqueue the job as a message/task and wait for the result.
   * Implementations can either:
   * 1. Run via container agent (full AI capabilities)
   * 2. Send as a message to the main group and collect response
   */
  executeJobPrompt: (job: HeartbeatJob) => Promise<string>;
  /** Send a message to a JID (for reporting results) */
  sendMessage: (jid: string, text: string) => Promise<void>;
}

/** Tracks recently completed job results for inclusion in heartbeat reports */
const recentJobResults: Array<{ jobId: string; label: string; result: string; category: string; completedAt: number }> = [];
const MAX_RECENT_RESULTS = 20;

function trackJobResult(job: HeartbeatJob, result: string): void {
  recentJobResults.push({
    jobId: job.id,
    label: job.label,
    result,
    category: job.category,
    completedAt: Date.now(),
  });
  // Keep only recent results
  while (recentJobResults.length > MAX_RECENT_RESULTS) {
    recentJobResults.shift();
  }
}

/** Get results from the last N hours for heartbeat reports */
export function getRecentJobResults(withinMs: number = 24 * 60 * 60 * 1000): typeof recentJobResults {
  const cutoff = Date.now() - withinMs;
  return recentJobResults.filter(r => r.completedAt > cutoff);
}

/**
 * Run a single heartbeat job.
 * Returns the result string or throws on failure.
 */
async function executeHeartbeatJob(
  job: HeartbeatJob,
  deps: HeartbeatJobRunnerDeps,
): Promise<string> {
  const startTime = Date.now();
  logger.info(
    { jobId: job.id, label: job.label, category: job.category },
    'Executing heartbeat job',
  );

  try {
    const result = await deps.executeJobPrompt(job);
    const durationMs = Date.now() - startTime;

    // Update job result in DB
    updateHeartbeatJobResult(job.id, result);
    trackJobResult(job, result);

    logger.info(
      { jobId: job.id, label: job.label, durationMs },
      'Heartbeat job completed',
    );

    return result;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    updateHeartbeatJobResult(job.id, `Error: ${errorMsg}`);
    trackJobResult(job, `❌ ${errorMsg}`);

    logger.error(
      { jobId: job.id, label: job.label, error: errorMsg, durationMs },
      'Heartbeat job failed',
    );

    throw err;
  }
}

/**
 * Poll for due heartbeat jobs and execute them in sequence.
 * Running in sequence avoids overloading the container queue.
 */
async function runDueHeartbeatJobs(deps: HeartbeatJobRunnerDeps): Promise<void> {
  const dueJobs = getDueHeartbeatJobs(HEARTBEAT_JOB_DEFAULT_INTERVAL_MS);

  if (dueJobs.length === 0) return;

  logger.info({ count: dueJobs.length }, 'Found due heartbeat jobs');

  const { mainChatJid } = runtimeConfig;

  for (const job of dueJobs) {
    try {
      const result = await executeHeartbeatJob(job, deps);

      // Optionally send job result to the job's originating chat
      if (mainChatJid && result) {
        const categoryEmoji: Record<string, string> = {
          learning: '📚',
          monitor: '📊',
          health: '🏥',
          custom: '🔧',
        };
        const emoji = categoryEmoji[job.category] ?? '🔧';
        const summary = result.length > 500 ? result.slice(0, 500) + '…' : result;
        await deps.sendMessage(
          job.chat_jid || mainChatJid,
          `${emoji} *${job.label}*\n${summary}`,
        );
      }
    } catch (err) {
      // Already logged in executeHeartbeatJob — continue with next job
      logger.debug({ jobId: job.id }, 'Continuing after job failure');
    }
  }
}

/**
 * Start the heartbeat job runner.
 * Polls for due jobs on a configurable interval (default 30s).
 * Returns a cleanup function.
 */
export function startHeartbeatJobRunner(deps: HeartbeatJobRunnerDeps): () => void {
  let running = false;
  let stopped = false;

  const poll = async () => {
    if (stopped || running) return;
    if (!runtimeConfig.enabled) return;

    running = true;
    try {
      await runDueHeartbeatJobs(deps);
    } catch (err) {
      logger.error({ err }, 'Heartbeat job runner error');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(poll, HEARTBEAT_JOB_POLL_INTERVAL_MS);

  // Run immediately on startup (after a short delay to let system initialize)
  setTimeout(poll, 5000);

  logger.info(
    {
      pollIntervalMs: HEARTBEAT_JOB_POLL_INTERVAL_MS,
      defaultJobIntervalMs: HEARTBEAT_JOB_DEFAULT_INTERVAL_MS,
    },
    'Heartbeat job runner started',
  );

  return () => {
    stopped = true;
    clearInterval(timer);
    logger.debug('Heartbeat job runner stopped');
  };
}

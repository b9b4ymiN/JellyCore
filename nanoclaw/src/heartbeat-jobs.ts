/**
 * Smart Heartbeat Job Runner
 *
 * Polls for due user-configured AI jobs and executes them via container agents.
 *
 * Reliability features:
 *   - Claim mechanism: stamps last_run=now before execution so a crash won't
 *     immediately re-run the same job on restart.
 *   - Execution timeout: kills stuck jobs after HEARTBEAT_JOB_TIMEOUT_MS (default 10 min).
 *   - Parallel execution: up to 2 jobs run concurrently per poll cycle.
 *   - Per-run logging: writes to heartbeat_job_log table for full observability.
 */

import {
  HEARTBEAT_JOB_DEFAULT_INTERVAL_MS,
  HEARTBEAT_JOB_POLL_INTERVAL_MS,
  HEARTBEAT_JOB_TIMEOUT_MS,
} from './config.js';
import {
  getDueHeartbeatJobs,
  updateHeartbeatJobResult,
  createHeartbeatJobLog,
  recoverStaleHeartbeatJobs,
} from './db.js';
import { logger } from './logger.js';
import { getHeartbeatConfig } from './heartbeat-config.js';
import type { HeartbeatJob } from './types.js';

// ── Recent results cache (for heartbeat reporter) ────────────────────────────

const recentJobResults: Array<{
  jobId: string;
  label: string;
  result: string;
  category: string;
  completedAt: number;
}> = [];
const MAX_RECENT_RESULTS = 20;

function trackJobResult(job: HeartbeatJob, result: string): void {
  recentJobResults.push({
    jobId: job.id,
    label: job.label,
    result,
    category: job.category,
    completedAt: Date.now(),
  });
  while (recentJobResults.length > MAX_RECENT_RESULTS) recentJobResults.shift();
}

/** Get results from the last N ms (default 24 hours) for heartbeat reports. */
export function getRecentJobResults(
  withinMs: number = 24 * 60 * 60 * 1000,
): typeof recentJobResults {
  const cutoff = Date.now() - withinMs;
  return recentJobResults.filter(r => r.completedAt > cutoff);
}

// ── Dependencies ──────────────────────────────────────────────────────────────

export interface HeartbeatJobRunnerDeps {
  /**
   * Execute a heartbeat job's prompt and return the result string.
   * Should enqueue the job as a container task and await the result.
   */
  executeJobPrompt: (job: HeartbeatJob) => Promise<string>;
  /** Send a message to a JID (for delivering results). */
  sendMessage: (jid: string, text: string) => Promise<void>;
}

// ── Single job execution ──────────────────────────────────────────────────────

async function executeHeartbeatJob(
  job: HeartbeatJob,
  deps: HeartbeatJobRunnerDeps,
): Promise<string> {
  const startTime = Date.now();
  logger.info({ jobId: job.id, label: job.label, category: job.category }, 'Executing heartbeat job');

  // Claim: update last_run to now so that if the process crashes mid-run the
  // job won't be considered "due again immediately" on the next startup.
  updateHeartbeatJobResult(job.id, '__RUNNING__');

  try {
    const result = await Promise.race([
      deps.executeJobPrompt(job),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Heartbeat job timed out after ${HEARTBEAT_JOB_TIMEOUT_MS / 60_000} min`)),
          HEARTBEAT_JOB_TIMEOUT_MS,
        ),
      ),
    ]);

    const durationMs = Date.now() - startTime;

    // Record success
    updateHeartbeatJobResult(job.id, result);
    trackJobResult(job, result);
    createHeartbeatJobLog({
      job_id: job.id,
      status: 'ok',
      result,
      duration_ms: durationMs,
      error: null,
    });

    logger.info({ jobId: job.id, label: job.label, durationMs }, 'Heartbeat job completed');
    return result;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);

    updateHeartbeatJobResult(job.id, `Error: ${errorMsg}`);
    trackJobResult(job, `❌ ${errorMsg}`);
    createHeartbeatJobLog({
      job_id: job.id,
      status: 'error',
      result: null,
      duration_ms: durationMs,
      error: errorMsg,
    });

    logger.error({ jobId: job.id, label: job.label, error: errorMsg, durationMs }, 'Heartbeat job failed');
    throw err;
  }
}

// ── Due-job poll ──────────────────────────────────────────────────────────────

const BATCH_CONCURRENCY = 2; // Max jobs running in parallel per poll cycle

/**
 * Run all currently due heartbeat jobs.
 * Up to BATCH_CONCURRENCY jobs run in parallel per poll cycle.
 *
 * Exported for direct use in tests and potential future CLI invocation.
 */
export async function runDueHeartbeatJobs(deps: HeartbeatJobRunnerDeps): Promise<number> {
  const dueJobs = getDueHeartbeatJobs(HEARTBEAT_JOB_DEFAULT_INTERVAL_MS);
  if (dueJobs.length === 0) return 0;

  logger.info({ count: dueJobs.length }, 'Found due heartbeat jobs');

  const { mainChatJid } = getHeartbeatConfig();
  const categoryEmoji: Record<string, string> = {
    learning: '📚',
    monitor: '📊',
    health: '🏥',
    custom: '🔧',
  };

  // Split into batches of BATCH_CONCURRENCY
  for (let i = 0; i < dueJobs.length; i += BATCH_CONCURRENCY) {
    const batch = dueJobs.slice(i, i + BATCH_CONCURRENCY);

    const batchResults = await Promise.allSettled(
      batch.map(async (job) => {
        const result = await executeHeartbeatJob(job, deps);

        // Deliver result to the job's originating chat
        if (mainChatJid && result && result !== '__RUNNING__') {
          const emoji = categoryEmoji[job.category] ?? '🔧';
          const summary = result.length > 500 ? result.slice(0, 500) + '…' : result;
          await deps.sendMessage(
            job.chat_jid || mainChatJid,
            `${emoji} *${job.label}*\n${summary}`,
          );
        }
        return result;
      }),
    );

    for (const r of batchResults) {
      if (r.status === 'rejected') {
        // Already logged inside executeHeartbeatJob
        logger.debug({ reason: r.reason }, 'Batch job failed, continuing with next batch');
      }
    }
  }

  return dueJobs.length;
}

// ── Runner lifecycle ──────────────────────────────────────────────────────────

/**
 * Start the heartbeat job runner.
 * Polls for due jobs on HEARTBEAT_JOB_POLL_INTERVAL_MS (default 30s).
 * Returns a cleanup function.
 */
export function startHeartbeatJobRunner(deps: HeartbeatJobRunnerDeps): () => void {
  let running = false;
  let stopped = false;

  // Clean up any jobs left in __RUNNING__ state from a previous crash / restart
  const recovered = recoverStaleHeartbeatJobs();
  if (recovered > 0) {
    logger.warn({ recovered }, 'Recovered stale __RUNNING__ heartbeat jobs from previous crash');
  }

  const poll = async () => {
    if (stopped || running) return;
    if (!getHeartbeatConfig().enabled) return;

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

  // First run after a short startup grace period
  setTimeout(poll, 5000);

  logger.info(
    {
      pollIntervalMs: HEARTBEAT_JOB_POLL_INTERVAL_MS,
      defaultJobIntervalMs: HEARTBEAT_JOB_DEFAULT_INTERVAL_MS,
      timeoutMs: HEARTBEAT_JOB_TIMEOUT_MS,
      batchConcurrency: BATCH_CONCURRENCY,
    },
    'Heartbeat job runner started',
  );

  return () => {
    stopped = true;
    clearInterval(timer);
    logger.debug('Heartbeat job runner stopped');
  };
}

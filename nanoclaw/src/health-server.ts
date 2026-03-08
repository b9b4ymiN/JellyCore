/**
 * NanoClaw Health & Status HTTP Server (v1.0-phase6)
 *
 * Lightweight Node.js built-in HTTP server for monitoring and task management.
 * Port: 47779 (internal only, not exposed outside Docker network)
 *
 * Endpoints:
 *   GET  /health                     â†’ { status, uptime, version }
 *   GET  /status                     â†’ { activeContainers, queueDepth, groups, resources, recentErrors }
 *   GET  /metrics                    â†’ Prometheus metrics snapshot
 *   GET  /scheduler/tasks            â†’ list tasks (qs: status, group)
 *   GET  /scheduler/tasks/:id        â†’ get task + recent run logs
 *   POST /scheduler/tasks/:id/pause  â†’ pause task
 *   POST /scheduler/tasks/:id/resume â†’ resume task
 *   POST /scheduler/tasks/:id/cancel â†’ cancel task (soft delete)
 *   POST /scheduler/tasks/:id/run    â†’ trigger immediate run
 *   GET  /scheduler/stats            â†’ scheduler statistics
 *   GET  /ops/tools                  â†’ runtime tools/skills/MCP inventory
 *   GET  /heartbeat/config           â†’ current heartbeat config
 *   POST /heartbeat/ping             â†’ trigger manual heartbeat
 */

import http from 'http';

import {
  cancelTask,
  createTask,
  getAllTasks,
  getAllRegisteredGroups,
  getTaskById,
  getTaskRunLogs,
  updateTask,
} from './db.js';
import { eventBus, type LiveEvent } from './event-bus.js';
import {
  getHeartbeatConfig,
  patchHeartbeatConfig,
  triggerManualHeartbeat,
  HeartbeatStatusProvider,
} from './heartbeat.js';
import { logger } from './logger.js';
import { getNonFatalErrorStats } from './non-fatal-errors.js';
import { createRequestId } from './request-id.js';

const PORT = parseInt(process.env.NANOCLAW_HEALTH_PORT || '47779', 10);
const VERSION = '1.0.0';
const startTime = Date.now();

// Circular buffer for recent errors (last 50)
const MAX_ERRORS = 50;
export const recentErrors: Array<{ timestamp: string; message: string; group?: string }> = [];
let lastHealthSignature = '';
const LATENCY_BUCKETS_MS = [100, 250, 500, 1000, 2500, 5000, 10000];

interface MessageLatencyMetric {
  count: number;
  sumMs: number;
  buckets: Map<number, number>;
}

const messageLatencyByChannel = new Map<string, MessageLatencyMetric>();

function getMessageLatencyMetric(channel: string): MessageLatencyMetric {
  const existing = messageLatencyByChannel.get(channel);
  if (existing) return existing;

  const metric: MessageLatencyMetric = {
    count: 0,
    sumMs: 0,
    buckets: new Map(LATENCY_BUCKETS_MS.map((bucket) => [bucket, 0])),
  };
  messageLatencyByChannel.set(channel, metric);
  return metric;
}

export function observeMessageLatency(latencyMs: number, channel: string = 'unknown'): void {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
  const metric = getMessageLatencyMetric(channel);
  metric.count += 1;
  metric.sumMs += latencyMs;
  for (const bucket of LATENCY_BUCKETS_MS) {
    if (latencyMs <= bucket) {
      metric.buckets.set(bucket, (metric.buckets.get(bucket) || 0) + 1);
    }
  }
}

/** Record an error for status reporting */
export function recordError(message: string, group?: string): void {
  recentErrors.push({
    timestamp: new Date().toISOString(),
    message: message.slice(0, 500),
    group,
  });
  if (recentErrors.length > MAX_ERRORS) recentErrors.shift();
}

export interface StatusProvider {
  getActiveContainers: () => number;
  getQueueDepth: () => number;
  getLaneStats?: () => {
    active: { user: number; scheduler: number; heartbeat: number };
    queueDepth: { user: number; scheduler: number; heartbeat: number };
    reservedUserSlots: number;
    maxConcurrency: number;
  };
  getRegisteredGroups: () => string[];
  getResourceStats: () => { currentMax: number; cpuUsage: string | number; memoryFree: string | number };
  getDockerResilience?: () => {
    healthy: boolean;
    errorStreak: number;
    lastProbeAt: number;
    lastHealthyAt: number;
    spawnFailureStreak: number;
    circuitOpen: boolean;
    circuitOpenUntil: number;
    circuitLastError: string | null;
    orphanSweepKills: number;
  };
  getDlqStats?: () => { open24h: number; open1h: number; retrying: number };
  getCapabilityHealth?: () => unknown;
  getCodexAuthStatus?: () => unknown;
  getCodexRuntimeStatus?: () => unknown;
  getCodexMetrics?: () => unknown;
  getUptimeMs: () => number;
}

export interface OpsProvider {
  getMessageTrace: (traceId: string) => unknown;
  listDeadLetters: (status: 'open' | 'retrying' | 'resolved') => unknown;
  retryDeadLetter: (traceId: string, retriedBy: string) => boolean;
  retryDeadLetterBatch: (
    limit: number,
    retriedBy: string,
  ) => { retried: number; requested: number };
}

export interface ToolsProvider {
  getToolsInventory: () => unknown;
}

export interface ChatProvider {
  processChat: (
    message: string,
    groupFolder?: string,
    requestId?: string,
  ) => Promise<{
    reply: string;
    groupFolder: string;
    latencyMs: number;
    tier: string;
    mode?: string;
  }>;
  getChatHistory: (
    groupFolder?: string,
    limit?: number,
  ) => {
    groupFolder: string;
    chatJid: string;
    messages: Array<{
      id: string;
      sender: string;
      senderName: string;
      content: string;
      timestamp: string;
      isFromMe: boolean;
      role: 'user' | 'assistant' | 'system';
    }>;
  } | null;
}

let statusProvider: StatusProvider | null = null;
let heartbeatProvider: HeartbeatStatusProvider | null = null;
let opsProvider: OpsProvider | null = null;
let toolsProvider: ToolsProvider | null = null;
let chatProvider: ChatProvider | null = null;

/** Register the status provider (called from main) */
export function setStatusProvider(provider: StatusProvider): void {
  statusProvider = provider;
}

/** Register the heartbeat provider so /heartbeat/ping can trigger it. */
export function setHeartbeatProvider(provider: HeartbeatStatusProvider): void {
  heartbeatProvider = provider;
}

/** Register ops provider for trace/dead-letter endpoints. */
export function setOpsProvider(provider: OpsProvider): void {
  opsProvider = provider;
}

/** Register tools provider for runtime inventory endpoint. */
export function setToolsProvider(provider: ToolsProvider): void {
  toolsProvider = provider;
}

/** Register chat provider for web chat endpoint. */
export function setChatProvider(provider: ChatProvider): void {
  chatProvider = provider;
}

// â”€â”€ Response helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function notFound(res: http.ServerResponse): void {
  json(res, 404, { error: 'Not found' });
}

function badRequest(res: http.ServerResponse, msg: string): void {
  json(res, 400, { error: msg });
}

function text(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function writeSseEvent(res: http.ServerResponse, event: LiveEvent): void {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event.data)}\n\n`);
}

function handleLiveEvents(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  const keepalive = setInterval(() => {
    if (!res.writableEnded) {
      res.write(': keepalive\n\n');
    }
  }, 30_000);

  const listener = (event: LiveEvent) => {
    try {
      writeSseEvent(res, event);
    } catch {
      cleanup();
    }
  };

  const cleanup = () => {
    clearInterval(keepalive);
    eventBus.off('live', listener);
    if (!res.writableEnded) {
      res.end();
    }
  };

  eventBus.on('live', listener);
  req.on('close', cleanup);
  req.on('error', cleanup);
}

// â”€â”€ /health â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function handleHealth(_req: http.IncomingMessage, res: http.ServerResponse): void {
  const codexAuth = statusProvider?.getCodexAuthStatus
    ? statusProvider.getCodexAuthStatus() as { ready?: boolean } | null
    : null;
  const codexRuntime = statusProvider?.getCodexRuntimeStatus
    ? statusProvider.getCodexRuntimeStatus() as {
        ready?: boolean;
        reason?: string;
        imageRevision?: string;
      } | null
    : null;

  json(res, 200, {
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: VERSION,
    agent: {
      codex: {
        auth_ready: Boolean(codexAuth?.ready),
        runtime_ready: Boolean(codexRuntime?.ready),
        runtime_reason: codexRuntime?.reason || null,
        image_revision: codexRuntime?.imageRevision || null,
      },
    },
    timestamp: new Date().toISOString(),
  });
}

function escapeMetricLabel(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');
}

function renderMetrics(): string {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  const nonFatal = getNonFatalErrorStats();
  const providerSnapshot = statusProvider
    ? {
        activeContainers: statusProvider.getActiveContainers(),
        queueDepth: statusProvider.getQueueDepth(),
        registeredGroups: statusProvider.getRegisteredGroups().length,
      }
    : {
        activeContainers: 0,
        queueDepth: 0,
        registeredGroups: 0,
      };

  const lines: string[] = [
    '# HELP nanoclaw_uptime_seconds Process uptime in seconds.',
    '# TYPE nanoclaw_uptime_seconds gauge',
    `nanoclaw_uptime_seconds ${uptimeSeconds}`,
    '# HELP nanoclaw_active_containers Active container count.',
    '# TYPE nanoclaw_active_containers gauge',
    `nanoclaw_active_containers ${providerSnapshot.activeContainers}`,
    '# HELP nanoclaw_queue_depth Queue depth across lanes.',
    '# TYPE nanoclaw_queue_depth gauge',
    `nanoclaw_queue_depth ${providerSnapshot.queueDepth}`,
    '# HELP nanoclaw_registered_groups Registered chat groups.',
    '# TYPE nanoclaw_registered_groups gauge',
    `nanoclaw_registered_groups ${providerSnapshot.registeredGroups}`,
    '# HELP nanoclaw_recent_errors_total Recent in-memory error buffer size.',
    '# TYPE nanoclaw_recent_errors_total gauge',
    `nanoclaw_recent_errors_total ${recentErrors.length}`,
    '# HELP nanoclaw_non_fatal_errors_total Total non-fatal runtime errors observed.',
    '# TYPE nanoclaw_non_fatal_errors_total counter',
    `nanoclaw_non_fatal_errors_total ${nonFatal.total}`,
    '# HELP nanoclaw_non_fatal_errors_by_category_total Non-fatal runtime errors by category.',
    '# TYPE nanoclaw_non_fatal_errors_by_category_total counter',
  ];

  for (const [category, count] of Object.entries(nonFatal.byCategory)) {
    lines.push(
      `nanoclaw_non_fatal_errors_by_category_total{category="${escapeMetricLabel(category)}"} ${count}`,
    );
  }

  lines.push(
    '# HELP nanoclaw_message_latency_ms Message processing latency in milliseconds.',
    '# TYPE nanoclaw_message_latency_ms histogram',
  );
  for (const [channel, metric] of messageLatencyByChannel.entries()) {
    const labels = `channel="${escapeMetricLabel(channel)}"`;
    for (const bucket of LATENCY_BUCKETS_MS) {
      lines.push(
        `nanoclaw_message_latency_ms_bucket{${labels},le="${bucket}"} ${metric.buckets.get(bucket) || 0}`,
      );
    }
    lines.push(`nanoclaw_message_latency_ms_bucket{${labels},le="+Inf"} ${metric.count}`);
    lines.push(`nanoclaw_message_latency_ms_sum{${labels}} ${metric.sumMs.toFixed(3)}`);
    lines.push(`nanoclaw_message_latency_ms_count{${labels}} ${metric.count}`);
  }

  return `${lines.join('\n')}\n`;
}

// â”€â”€ /status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function handleStatus(_req: http.IncomingMessage, res: http.ServerResponse): void {
  const stats = statusProvider
    ? {
        activeContainers: statusProvider.getActiveContainers(),
        queueDepth: statusProvider.getQueueDepth(),
        laneStats: statusProvider.getLaneStats ? statusProvider.getLaneStats() : null,
        registeredGroups: statusProvider.getRegisteredGroups(),
        resources: statusProvider.getResourceStats(),
        docker: statusProvider.getDockerResilience ? statusProvider.getDockerResilience() : null,
        dlq: statusProvider.getDlqStats ? statusProvider.getDlqStats() : null,
        capabilities: statusProvider.getCapabilityHealth ? statusProvider.getCapabilityHealth() : null,
        codexAuth: statusProvider.getCodexAuthStatus ? statusProvider.getCodexAuthStatus() : null,
        codexRuntime: statusProvider.getCodexRuntimeStatus ? statusProvider.getCodexRuntimeStatus() : null,
        codexMetrics: statusProvider.getCodexMetrics ? statusProvider.getCodexMetrics() : null,
      }
    : {
        activeContainers: 0,
        queueDepth: 0,
        laneStats: null,
        registeredGroups: [],
        resources: null,
        docker: null,
        dlq: null,
        capabilities: null,
        codexAuth: null,
        codexRuntime: null,
        codexMetrics: null,
      };

  const healthStatus: 'ok' | 'warn' | 'error' = !statusProvider
    ? 'error'
    : stats.docker
      && typeof stats.docker === 'object'
      && 'healthy' in stats.docker
      && stats.docker.healthy === false
      ? 'error'
      : recentErrors.length > 0
        ? 'warn'
        : 'ok';
  const healthSignature = `${healthStatus}:${stats.activeContainers}:${stats.queueDepth}`;
  if (healthSignature !== lastHealthSignature) {
    lastHealthSignature = healthSignature;
    eventBus.emit('live', {
      type: 'health:change',
      data: {
        status: healthStatus,
        activeContainers: stats.activeContainers,
        queueDepth: stats.queueDepth,
        timestamp: new Date().toISOString(),
      },
    });
  }

  json(res, 200, {
    ...stats,
    recentErrors: recentErrors.slice(-20),
    nonFatalErrors: getNonFatalErrorStats(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: VERSION,
    timestamp: new Date().toISOString(),
  });
}

function handleMetrics(_req: http.IncomingMessage, res: http.ServerResponse): void {
  text(res, 200, renderMetrics());
}

// â”€â”€ /scheduler/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function handleSchedulerTasks(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  const statusFilter = url.searchParams.get('status'); // e.g. ?status=active
  const groupFilter = url.searchParams.get('group');

  let tasks = getAllTasks();
  if (statusFilter) {
    tasks = tasks.filter((t) => t.status === statusFilter);
  } else {
    // Default: exclude cancelled (use ?status=cancelled to see them)
    tasks = tasks.filter((t) => t.status !== 'cancelled');
  }
  if (groupFilter) {
    tasks = tasks.filter((t) => t.group_folder === groupFilter);
  }

  json(res, 200, { tasks, count: tasks.length });
}

function handleSchedulerTask(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  taskId: string,
): void {
  const task = getTaskById(taskId);
  if (!task) { notFound(res); return; }
  const logs = getTaskRunLogs(taskId, 20);
  json(res, 200, { task, recentRuns: logs });
}

async function handleSchedulerTaskCreate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = (await readBody(req)) as {
    name?: string;
    group_folder?: string;
    prompt?: string;
    interval_ms?: number;
    status?: 'active' | 'paused';
  };

  const groupFolder = (body.group_folder || '').trim();
  const prompt = (body.prompt || '').trim();
  const taskName = (body.name || '').trim();
  const intervalMs = Number(body.interval_ms);
  const status = body.status === 'paused' ? 'paused' : 'active';

  if (!groupFolder) {
    badRequest(res, 'group_folder is required');
    return;
  }
  if (!prompt) {
    badRequest(res, 'prompt is required');
    return;
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 60_000 || intervalMs > 30 * 24 * 60 * 60 * 1000) {
    badRequest(res, 'interval_ms must be between 60,000 and 2,592,000,000');
    return;
  }

  const groups = getAllRegisteredGroups();
  const chatJid = Object.keys(groups).find((jid) => groups[jid]?.folder === groupFolder);
  if (!chatJid) {
    badRequest(res, `No registered group found for folder: ${groupFolder}`);
    return;
  }

  const now = Date.now();
  const taskId = `task_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  createTask({
    id: taskId,
    group_folder: groupFolder,
    chat_jid: chatJid,
    prompt,
    schedule_type: 'interval',
    schedule_value: String(Math.floor(intervalMs)),
    context_mode: 'group',
    next_run: new Date(now + intervalMs).toISOString(),
    status,
    created_at: new Date(now).toISOString(),
    retry_count: 0,
    max_retries: 0,
    retry_delay_ms: 300_000,
    task_timeout_ms: null,
    label: taskName || null,
  });

  const created = getTaskById(taskId);
  json(res, 201, { task: created });
}

async function handleSchedulerTaskUpdate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  taskId: string,
): Promise<void> {
  const task = getTaskById(taskId);
  if (!task) {
    notFound(res);
    return;
  }

  const body = (await readBody(req)) as {
    name?: string;
    prompt?: string;
    interval_ms?: number;
    status?: 'active' | 'paused' | 'cancelled';
  };

  const updates: Parameters<typeof updateTask>[1] = {};
  if (typeof body.name === 'string') updates.label = body.name.trim();
  if (typeof body.prompt === 'string' && body.prompt.trim()) updates.prompt = body.prompt.trim();
  if (body.status === 'active' || body.status === 'paused') updates.status = body.status;
  if (body.status === 'cancelled') {
    cancelTask(taskId);
    json(res, 200, { success: true, status: 'cancelled' });
    return;
  }

  if (body.interval_ms !== undefined) {
    const intervalMs = Number(body.interval_ms);
    if (!Number.isFinite(intervalMs) || intervalMs < 60_000 || intervalMs > 30 * 24 * 60 * 60 * 1000) {
      badRequest(res, 'interval_ms must be between 60,000 and 2,592,000,000');
      return;
    }
    updates.schedule_type = 'interval';
    updates.schedule_value = String(Math.floor(intervalMs));
    updates.next_run = new Date(Date.now() + intervalMs).toISOString();
  }

  updateTask(taskId, updates);
  json(res, 200, { task: getTaskById(taskId) });
}

async function handleSchedulerTaskAction(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  taskId: string,
  action: string,
): Promise<void> {
  const task = getTaskById(taskId);
  if (!task) { notFound(res); return; }

  switch (action) {
    case 'pause':
      if (task.status !== 'active') { badRequest(res, 'Task is not active'); return; }
      updateTask(taskId, { status: 'paused' });
      json(res, 200, { success: true, status: 'paused' });
      break;
    case 'resume':
      if (task.status !== 'paused') { badRequest(res, 'Task is not paused'); return; }
      updateTask(taskId, { status: 'active' });
      json(res, 200, { success: true, status: 'active' });
      break;
    case 'cancel':
      cancelTask(taskId);
      json(res, 200, { success: true, status: 'cancelled' });
      break;
    case 'run':
      // Trigger immediate run by setting next_run = now
      if (task.status !== 'active') { badRequest(res, 'Task is not active'); return; }
      updateTask(taskId, { next_run: new Date().toISOString() });
      json(res, 200, { success: true, message: 'Task queued for immediate run (next poll)' });
      break;
    default:
      notFound(res);
  }
}

function handleSchedulerStats(_req: http.IncomingMessage, res: http.ServerResponse): void {
  const all = getAllTasks();
  const now = Date.now();
  const in24h = 24 * 60 * 60 * 1000;

  const stats = {
    total: all.length,
    byStatus: {
      active: all.filter((t) => t.status === 'active').length,
      paused: all.filter((t) => t.status === 'paused').length,
      completed: all.filter((t) => t.status === 'completed').length,
      cancelled: all.filter((t) => t.status === 'cancelled').length,
    },
    dueSoon: all.filter((t) => {
      if (!t.next_run || t.status !== 'active') return false;
      const diff = new Date(t.next_run).getTime() - now;
      return diff > 0 && diff < in24h;
    }).length,
    overdue: all.filter((t) => {
      if (!t.next_run || t.status !== 'active') return false;
      return new Date(t.next_run).getTime() < now;
    }).length,
    withRetries: all.filter((t) => (t.retry_count ?? 0) > 0).length,
    timestamp: new Date().toISOString(),
  };

  json(res, 200, stats);
}

// â”€â”€ /heartbeat/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function handleHeartbeatConfig(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (req.method === 'GET') {
    json(res, 200, getHeartbeatConfig());
    return;
  }
  if (req.method === 'PATCH' || req.method === 'POST') {
    readBody(req)
      .then((body) => {
        patchHeartbeatConfig(body as Parameters<typeof patchHeartbeatConfig>[0]);
        json(res, 200, { success: true, config: getHeartbeatConfig() });
      })
      .catch((err) => badRequest(res, err.message));
    return;
  }
  notFound(res);
}

async function handleHeartbeatPing(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!heartbeatProvider) {
    json(res, 503, { error: 'Heartbeat provider not registered' });
    return;
  }
  try {
    await triggerManualHeartbeat(heartbeatProvider);
    json(res, 200, { success: true });
  } catch (err) {
    json(res, 500, { error: String(err) });
  }
}

async function handleChatSend(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requestId: string,
): Promise<void> {
  if (!chatProvider) {
    json(res, 503, { error: 'Chat provider not registered' });
    return;
  }

  try {
    const body = (await readBody(req)) as { message?: string; group_folder?: string };
    const message = (body.message || '').trim();
    const groupFolder = (body.group_folder || '').trim() || undefined;

    if (!message) {
      badRequest(res, 'message is required');
      return;
    }
    if (message.length > 10_000) {
      badRequest(res, 'message exceeds 10,000 characters');
      return;
    }

    const result = await chatProvider.processChat(message, groupFolder, requestId);
    observeMessageLatency(result.latencyMs, 'web');
    json(res, 200, result);
  } catch (err) {
    logger.error({ err }, 'Chat handler error');
    json(res, 500, { error: 'Failed to process chat request' });
  }
}

function handleChatHistory(
  url: URL,
  res: http.ServerResponse,
): void {
  if (!chatProvider) {
    json(res, 503, { error: 'Chat provider not registered' });
    return;
  }

  const groupFolder = (url.searchParams.get('group_folder') || '').trim() || undefined;
  const limitParam = Number.parseInt(url.searchParams.get('limit') || '120', 10);
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(500, limitParam)) : 120;
  const history = chatProvider.getChatHistory(groupFolder, limit);
  if (!history) {
    notFound(res);
    return;
  }
  json(res, 200, history);
}

// â”€â”€ Router â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function handleOpsMessageTrace(res: http.ServerResponse, traceId: string): void {
  if (!opsProvider) {
    json(res, 503, { error: 'Ops provider not registered' });
    return;
  }
  json(res, 200, opsProvider.getMessageTrace(traceId));
}

function handleOpsDlqList(res: http.ServerResponse, url: URL): void {
  if (!opsProvider) {
    json(res, 503, { error: 'Ops provider not registered' });
    return;
  }

  const statusParam = (url.searchParams.get('status') || 'open') as
    | 'open'
    | 'retrying'
    | 'resolved';
  if (!['open', 'retrying', 'resolved'].includes(statusParam)) {
    badRequest(res, 'Invalid status. Use open|retrying|resolved');
    return;
  }
  json(res, 200, { status: statusParam, items: opsProvider.listDeadLetters(statusParam) });
}

async function handleOpsDlqRetry(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  traceId: string,
): Promise<void> {
  if (!opsProvider) {
    json(res, 503, { error: 'Ops provider not registered' });
    return;
  }

  let retriedBy = 'ops-api';
  try {
    const body = await readBody(req) as { retriedBy?: string };
    if (body.retriedBy) retriedBy = body.retriedBy;
  } catch {
    // body optional
  }

  const success = opsProvider.retryDeadLetter(traceId, retriedBy);
  if (!success) {
    json(res, 409, { success: false, traceId });
    return;
  }
  json(res, 200, { success: true, traceId });
}

async function handleOpsDlqRetryBatch(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  if (!opsProvider) {
    json(res, 503, { error: 'Ops provider not registered' });
    return;
  }

  let limit = 10;
  let retriedBy = 'ops-api';
  try {
    const body = await readBody(req) as { limit?: number; retriedBy?: string };
    if (typeof body.limit === 'number') limit = body.limit;
    if (body.retriedBy) retriedBy = body.retriedBy;
  } catch {
    // body optional
  }

  const result = opsProvider.retryDeadLetterBatch(limit, retriedBy);
  json(res, 200, { success: true, ...result });
}

function handleOpsTools(res: http.ServerResponse): void {
  if (!toolsProvider) {
    json(res, 503, { error: 'Tools provider not registered' });
    return;
  }
  json(res, 200, toolsProvider.getToolsInventory());
}


/** Start the health/status HTTP server */
export function startHealthServer(): void {
  const server = http.createServer(async (req, res) => {
    const inboundRequestId = req.headers['x-request-id'];
    const requestId = Array.isArray(inboundRequestId)
      ? inboundRequestId[0]
      : inboundRequestId || createRequestId('health');

    res.setHeader('x-request-id', requestId);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    const parts = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);
    // parts[0] = section, parts[1] = resource, parts[2] = id, parts[3] = action

    try {
      // GET /health
      if (url.pathname === '/health' && req.method === 'GET') {
        handleHealth(req, res); return;
      }
      // GET /status
      if (url.pathname === '/status' && req.method === 'GET') {
        handleStatus(req, res); return;
      }
      // GET /metrics
      if (url.pathname === '/metrics' && req.method === 'GET') {
        handleMetrics(req, res); return;
      }
      // GET /events/live
      if (url.pathname === '/events/live' && req.method === 'GET') {
        handleLiveEvents(req, res); return;
      }
      // /scheduler/tasks
      if (parts[0] === 'scheduler' && parts[1] === 'tasks') {
        const taskId = parts[2];
        const action = parts[3];
        if (!taskId) {
          if (req.method === 'GET') {
            // GET /scheduler/tasks
            handleSchedulerTasks(req, res, url); return;
          }
          if (req.method === 'POST') {
            // POST /scheduler/tasks
            await handleSchedulerTaskCreate(req, res); return;
          }
          notFound(res); return;
        }
        if (!action) {
          if (req.method === 'GET') {
            // GET /scheduler/tasks/:id
            handleSchedulerTask(req, res, taskId); return;
          }
          if (req.method === 'PATCH' || req.method === 'POST') {
            // PATCH /scheduler/tasks/:id
            await handleSchedulerTaskUpdate(req, res, taskId); return;
          }
          notFound(res); return;
        }
        // POST /scheduler/tasks/:id/:action
        if (req.method === 'POST') {
          await handleSchedulerTaskAction(req, res, taskId, action); return;
        }
      }
      // GET /scheduler/stats
      if (parts[0] === 'scheduler' && parts[1] === 'stats' && req.method === 'GET') {
        handleSchedulerStats(req, res); return;
      }
      // /heartbeat/config
      if (parts[0] === 'heartbeat' && parts[1] === 'config') {
        handleHeartbeatConfig(req, res); return;
      }
      // POST /heartbeat/ping
      if (parts[0] === 'heartbeat' && parts[1] === 'ping' && req.method === 'POST') {
        await handleHeartbeatPing(req, res); return;
      }
      // POST /chat/send
      if (parts[0] === 'chat' && parts[1] === 'send' && req.method === 'POST') {
        await handleChatSend(req, res, requestId); return;
      }
      // GET /chat/history
      if (parts[0] === 'chat' && parts[1] === 'history' && req.method === 'GET') {
        handleChatHistory(url, res); return;
      }
      // GET /ops/tools
      if (parts[0] === 'ops' && parts[1] === 'tools' && req.method === 'GET') {
        handleOpsTools(res); return;
      }
      // GET /ops/messages/:traceId
      if (parts[0] === 'ops' && parts[1] === 'messages' && parts[2] && req.method === 'GET') {
        handleOpsMessageTrace(res, parts[2]); return;
      }
      // GET /ops/dlq?status=open
      if (parts[0] === 'ops' && parts[1] === 'dlq' && !parts[2] && req.method === 'GET') {
        handleOpsDlqList(res, url); return;
      }
      // POST /ops/dlq/retry-batch
      if (parts[0] === 'ops' && parts[1] === 'dlq' && parts[2] === 'retry-batch' && req.method === 'POST') {
        await handleOpsDlqRetryBatch(req, res); return;
      }
      // POST /ops/dlq/:traceId/retry
      if (parts[0] === 'ops' && parts[1] === 'dlq' && parts[2] && parts[3] === 'retry' && req.method === 'POST') {
        await handleOpsDlqRetry(req, res, parts[2]); return;
      }

      notFound(res);
    } catch (err) {
      logger.error({ err, path: url.pathname }, 'Health server handler error');
      json(res, 500, { error: 'Internal server error' });
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    logger.info({ port: PORT, version: VERSION }, 'Health/status server started');
  });

  server.on('error', (err) => {
    logger.warn({ err, port: PORT }, 'Health server error (non-fatal)');
  });
}


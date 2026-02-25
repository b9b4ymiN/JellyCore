/**
 * NanoClaw Health & Status HTTP Server (v1.0-phase6)
 *
 * Lightweight Node.js built-in HTTP server for monitoring and task management.
 * Port: 47779 (internal only, not exposed outside Docker network)
 *
 * Endpoints:
 *   GET  /health                     â†’ { status, uptime, version }
 *   GET  /status                     â†’ { activeContainers, queueDepth, groups, resources, recentErrors }
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
  getAllTasks,
  getTaskById,
  getTaskRunLogs,
  updateTask,
} from './db.js';
import {
  getHeartbeatConfig,
  patchHeartbeatConfig,
  triggerManualHeartbeat,
  HeartbeatStatusProvider,
} from './heartbeat.js';
import { logger } from './logger.js';

const PORT = parseInt(process.env.NANOCLAW_HEALTH_PORT || '47779', 10);
const VERSION = '1.0.0';
const startTime = Date.now();

// Circular buffer for recent errors (last 50)
const MAX_ERRORS = 50;
export const recentErrors: Array<{ timestamp: string; message: string; group?: string }> = [];

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

let statusProvider: StatusProvider | null = null;
let heartbeatProvider: HeartbeatStatusProvider | null = null;
let opsProvider: OpsProvider | null = null;
let toolsProvider: ToolsProvider | null = null;

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

// â”€â”€ /health â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function handleHealth(_req: http.IncomingMessage, res: http.ServerResponse): void {
  json(res, 200, {
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: VERSION,
    timestamp: new Date().toISOString(),
  });
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
      };

  json(res, 200, {
    ...stats,
    recentErrors: recentErrors.slice(-20),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: VERSION,
    timestamp: new Date().toISOString(),
  });
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
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
      // /scheduler/tasks
      if (parts[0] === 'scheduler' && parts[1] === 'tasks') {
        const taskId = parts[2];
        const action = parts[3];
        if (!taskId) {
          // GET /scheduler/tasks
          handleSchedulerTasks(req, res, url); return;
        }
        if (!action) {
          // GET /scheduler/tasks/:id
          handleSchedulerTask(req, res, taskId); return;
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


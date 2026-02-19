/**
 * NanoClaw Health & Status HTTP Server (v1.0-phase6)
 *
 * Lightweight Node.js built-in HTTP server for monitoring and task management.
 * Port: 47779 (internal only, not exposed outside Docker network)
 *
 * Endpoints:
 *   GET  /health                     → { status, uptime, version }
 *   GET  /status                     → { activeContainers, queueDepth, groups, resources, recentErrors }
 *   GET  /scheduler/tasks            → list tasks (qs: status, group)
 *   GET  /scheduler/tasks/:id        → get task + recent run logs
 *   POST /scheduler/tasks/:id/pause  → pause task
 *   POST /scheduler/tasks/:id/resume → resume task
 *   POST /scheduler/tasks/:id/cancel → cancel task (soft delete)
 *   POST /scheduler/tasks/:id/run    → trigger immediate run
 *   GET  /scheduler/stats            → scheduler statistics
 *   GET  /heartbeat/config           → current heartbeat config
 *   POST /heartbeat/ping             → trigger manual heartbeat
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
  getRegisteredGroups: () => string[];
  getResourceStats: () => { currentMax: number; cpuUsage: string | number; memoryFree: string | number };
  getUptimeMs: () => number;
}

let statusProvider: StatusProvider | null = null;
let heartbeatProvider: HeartbeatStatusProvider | null = null;

/** Register the status provider (called from main) */
export function setStatusProvider(provider: StatusProvider): void {
  statusProvider = provider;
}

/** Register the heartbeat provider so /heartbeat/ping can trigger it. */
export function setHeartbeatProvider(provider: HeartbeatStatusProvider): void {
  heartbeatProvider = provider;
}

// ── Response helpers ──────────────────────────────────────────────────────────

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

// ── /health ───────────────────────────────────────────────────────────────────

function handleHealth(_req: http.IncomingMessage, res: http.ServerResponse): void {
  json(res, 200, {
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: VERSION,
    timestamp: new Date().toISOString(),
  });
}

// ── /status ───────────────────────────────────────────────────────────────────

function handleStatus(_req: http.IncomingMessage, res: http.ServerResponse): void {
  const stats = statusProvider
    ? {
        activeContainers: statusProvider.getActiveContainers(),
        queueDepth: statusProvider.getQueueDepth(),
        registeredGroups: statusProvider.getRegisteredGroups(),
        resources: statusProvider.getResourceStats(),
      }
    : { activeContainers: 0, queueDepth: 0, registeredGroups: [], resources: null };

  json(res, 200, {
    ...stats,
    recentErrors: recentErrors.slice(-20),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: VERSION,
    timestamp: new Date().toISOString(),
  });
}

// ── /scheduler/* ─────────────────────────────────────────────────────────────

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

// ── /heartbeat/* ──────────────────────────────────────────────────────────────

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

// ── Router ────────────────────────────────────────────────────────────────────

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


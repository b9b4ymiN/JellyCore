/**
 * NanoClaw Health & Status HTTP Server (v0.7.1)
 *
 * Lightweight Node.js built-in HTTP server for monitoring.
 * Port: 47779 (internal only, not exposed outside Docker network)
 *
 * Endpoints:
 *   GET /health  → { status, uptime, version }
 *   GET /status  → { activeContainers, queueDepth, groups, resources, recentErrors }
 */

import http from 'http';
import { logger } from './logger.js';

const PORT = parseInt(process.env.NANOCLAW_HEALTH_PORT || '47779', 10);
const VERSION = '0.7.1';
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
}

let statusProvider: StatusProvider | null = null;

/** Register the status provider (called from main) */
export function setStatusProvider(provider: StatusProvider): void {
  statusProvider = provider;
}

function handleHealth(_req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: VERSION,
    timestamp: new Date().toISOString(),
  }));
}

function handleStatus(_req: http.IncomingMessage, res: http.ServerResponse): void {
  const stats = statusProvider
    ? {
        activeContainers: statusProvider.getActiveContainers(),
        queueDepth: statusProvider.getQueueDepth(),
        registeredGroups: statusProvider.getRegisteredGroups(),
        resources: statusProvider.getResourceStats(),
      }
    : { activeContainers: 0, queueDepth: 0, registeredGroups: [], resources: null };

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ...stats,
    recentErrors: recentErrors.slice(-20),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: VERSION,
    timestamp: new Date().toISOString(),
  }));
}

function handleNotFound(_req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

/** Start the health/status HTTP server */
export function startHealthServer(): void {
  const server = http.createServer((req, res) => {
    // CORS for internal requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const url = new URL(req.url || '/', `http://localhost:${PORT}`);

    switch (url.pathname) {
      case '/health':
        handleHealth(req, res);
        break;
      case '/status':
        handleStatus(req, res);
        break;
      default:
        handleNotFound(req, res);
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    logger.info({ port: PORT }, 'Health/status server started');
  });

  server.on('error', (err) => {
    logger.warn({ err, port: PORT }, 'Health server error (non-fatal)');
  });
}

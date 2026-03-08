/**
 * Oracle Nightly HTTP Server - Hono.js Version
 */

import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import fs from 'fs';
import path from 'path';

import {
  configure,
  performGracefulShutdown,
  registerSignalHandlers,
  removePidFile,
  writePidFile,
} from './process-manager/index.js';
import {
  ARTHUR_UI_PATH,
  DASHBOARD_PATH,
  PORT,
  REPO_ROOT,
  DB_PATH,
  UI_PATH,
  closeDb,
  initLoggingTables,
} from './server/db.js';
import { db, ensureSchema, indexingStatus } from './db/index.js';
import { eq } from 'drizzle-orm';
import { getEpisodicStore } from './memory/episodic.js';
import { refreshAllDecayScores } from './memory/decay.js';
import { registerApiV1Compatibility } from './server/routes/api-v1-compat.js';
import { registerSecurityMiddleware, renderHttpMetricsPrometheus } from './server/http-middleware.js';
import { registerLegacyUiRoutes } from './server/routes/legacy-ui.js';
import { registerLiveProxyRoutes } from './server/routes/live-proxy.js';
import { registerNanoclawProxyRoutes } from './server/routes/nanoclaw-proxy.js';
import { registerSchedulerProxyRoutes } from './server/routes/scheduler-proxy.js';
import { registerHeartbeatProxyRoutes } from './server/routes/heartbeat-proxy.js';
import { registerChatProxyRoutes } from './server/routes/chat-proxy.js';
import { registerMemoryRoutes } from './server/routes/memory-routes.js';
import { registerSearchRoutes } from './server/routes/search.js';
import { registerAdminRoutes } from './server/routes/admin.js';

const FRONTEND_DIST = path.join(import.meta.dirname || __dirname, '..', 'frontend', 'dist');

try {
  initLoggingTables();
  ensureSchema();
} catch (err) {
  console.error('Failed to initialize logging tables:', err);
}

try {
  db.update(indexingStatus)
    .set({ isIndexing: 0 })
    .where(eq(indexingStatus.id, 1))
    .run();
  console.log('🔮 Reset indexing status on startup');
} catch {
  // Table may not exist yet.
}

const dataDir = path.join(import.meta.dirname || __dirname, '..');
configure({ dataDir, pidFileName: 'oracle-http.pid' });

writePidFile({
  pid: process.pid,
  port: Number(PORT),
  startedAt: new Date().toISOString(),
  name: 'oracle-http',
});

registerSignalHandlers(async () => {
  console.log('\n🔮 Shutting down gracefully...');
  await performGracefulShutdown({
    closeables: [
      {
        name: 'database',
        close: () => {
          closeDb();
          return Promise.resolve();
        },
      },
    ],
  });
  removePidFile();
  console.log('👋 Oracle Nightly HTTP Server stopped.');
});

const app = new Hono();
registerApiV1Compatibility(app);

const ADMIN_AUTH_TOKEN = process.env.ORACLE_AUTH_TOKEN || '';
const NANOCLAW_INTERNAL_URL = process.env.NANOCLAW_URL || 'http://nanoclaw:47779';
const RATE_LIMIT_WINDOW_MS = Math.max(
  1000,
  Number.parseInt(process.env.ORACLE_RATE_LIMIT_WINDOW_MS || '60000', 10) || 60000,
);
const RATE_LIMIT_READ_LIMIT = Math.max(
  1,
  Number.parseInt(process.env.ORACLE_RATE_LIMIT_READ_LIMIT || '60', 10) || 60,
);
const RATE_LIMIT_WRITE_LIMIT = Math.max(
  1,
  Number.parseInt(process.env.ORACLE_RATE_LIMIT_WRITE_LIMIT || '30', 10) || 30,
);

const { adminAuth } = registerSecurityMiddleware(app, {
  adminAuthToken: ADMIN_AUTH_TOKEN,
  defaultCorsOrigins: [
    'http://localhost:47778',
    'http://127.0.0.1:47778',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ],
  allowedOriginsFromEnv: process.env.ORACLE_ALLOWED_ORIGINS || '',
  rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
  rateLimitReadLimit: RATE_LIMIT_READ_LIMIT,
  rateLimitWriteLimit: RATE_LIMIT_WRITE_LIMIT,
});

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', server: 'oracle-nightly', port: PORT, oracleV2: 'connected' });
});

app.get('/metrics', (c) => {
  return c.body(renderHttpMetricsPrometheus(), 200, {
    'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
  });
});

registerSearchRoutes(app, {
  dbPath: DB_PATH,
  repoRoot: REPO_ROOT,
});

registerAdminRoutes(app);
registerMemoryRoutes(app);

registerLegacyUiRoutes(app, {
  arthurPath: ARTHUR_UI_PATH,
  oracleUiPath: UI_PATH,
  dashboardPath: DASHBOARD_PATH,
});

registerNanoclawProxyRoutes(app, {
  adminAuth,
  nanoclawInternalUrl: NANOCLAW_INTERNAL_URL,
});

registerLiveProxyRoutes(app, {
  adminAuth,
  nanoclawInternalUrl: NANOCLAW_INTERNAL_URL,
  adminAuthToken: ADMIN_AUTH_TOKEN,
});

registerSchedulerProxyRoutes(app, {
  adminAuth,
  nanoclawInternalUrl: NANOCLAW_INTERNAL_URL,
});

registerHeartbeatProxyRoutes(app, {
  adminAuth,
  nanoclawInternalUrl: NANOCLAW_INTERNAL_URL,
});

registerChatProxyRoutes(app, {
  adminAuth,
  nanoclawInternalUrl: NANOCLAW_INTERNAL_URL,
});

app.use('/*', serveStatic({ root: FRONTEND_DIST }));

app.get('*', (c) => {
  const indexPath = path.join(FRONTEND_DIST, 'index.html');
  if (fs.existsSync(indexPath)) {
    return c.html(fs.readFileSync(indexPath, 'utf-8'));
  }
  return c.html(fs.readFileSync(ARTHUR_UI_PATH, 'utf-8'));
});

(async () => {
  try {
    const result = await refreshAllDecayScores();
    console.log(`[Memory] Initial decay refresh: ${result.updated} documents`);
  } catch (err) {
    console.warn('[Memory] Decay refresh failed on startup:', err);
  }
})();

setInterval(async () => {
  try {
    const result = await refreshAllDecayScores();
    console.log(`[Decay] Updated ${result.updated} documents`);

    const episodic = getEpisodicStore();
    const purged = await episodic.purgeExpired();
    if (purged.removed > 0 || purged.archived > 0) {
      console.log(`[Episodic] Purged ${purged.removed} expired, archived ${purged.archived}`);
    }
  } catch (err) {
    console.warn('[Memory] Background job error:', err);
  }
}, 6 * 60 * 60 * 1000);

console.log(`
🔮 Oracle Nightly HTTP Server running! (Hono.js)
   URL: http://localhost:${PORT}
`);

export default {
  port: Number(PORT),
  fetch: app.fetch,
};

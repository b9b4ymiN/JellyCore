import crypto from 'crypto';

import type { Hono } from 'hono';

type MiddlewareHandler = (c: any, next: any) => Promise<unknown>;

interface SecurityMiddlewareOptions {
  adminAuthToken: string;
  defaultCorsOrigins: string[];
  allowedOriginsFromEnv?: string;
  rateLimitWindowMs: number;
  rateLimitReadLimit: number;
  rateLimitWriteLimit: number;
}

interface RouteMetric {
  count: number;
  durationMsSum: number;
  statusCounts: Map<number, number>;
}

interface HttpMetricsState {
  requestsTotal: number;
  inFlight: number;
  generatedRequestIds: number;
  rateLimitedTotal: number;
  routes: Map<string, RouteMetric>;
}

const httpMetrics: HttpMetricsState = {
  requestsTotal: 0,
  inFlight: 0,
  generatedRequestIds: 0,
  rateLimitedTotal: 0,
  routes: new Map(),
};

function createRequestId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return `oracle-${crypto.randomUUID()}`;
  }
  return `oracle-${crypto.randomBytes(16).toString('hex')}`;
}

function requestOrigin(c: any): string {
  const proto = c.req.header('x-forwarded-proto') || 'http';
  const host = c.req.header('x-forwarded-host') || c.req.header('host') || '';
  return host ? `${proto}://${host}`.replace(/\/+$/, '') : '';
}

function buildCorsOriginSet(defaultOrigins: string[], allowedOriginsFromEnv?: string): Set<string> {
  const fromEnv = (allowedOriginsFromEnv || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const origins = fromEnv.length > 0 ? fromEnv : defaultOrigins;
  return new Set(origins.map((v) => v.replace(/\/+$/, '')));
}

function isCorsAllowed(origin: string, c: any, corsOrigins: Set<string>): boolean {
  const normalized = origin.replace(/\/+$/, '');
  if (corsOrigins.has(normalized)) return true;
  const sameOrigin = requestOrigin(c);
  return Boolean(sameOrigin) && sameOrigin === normalized;
}

function escapeMetricLabel(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');
}

function normalizeMetricPath(path: string): string {
  return path
    .replace(/\/[0-9]{1,19}(?=\/|$)/g, '/:id')
    .replace(/\/[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}(?=\/|$)/g, '/:id')
    .replace(/\/[a-zA-Z0-9_-]{20,}(?=\/|$)/g, '/:id');
}

function trackRouteMetric(method: string, rawPath: string, status: number, durationMs: number): void {
  const path = normalizeMetricPath(rawPath || '/');
  const key = `${method.toUpperCase()} ${path}`;
  const existing = httpMetrics.routes.get(key) || {
    count: 0,
    durationMsSum: 0,
    statusCounts: new Map<number, number>(),
  };
  existing.count += 1;
  existing.durationMsSum += durationMs;
  existing.statusCounts.set(status, (existing.statusCounts.get(status) || 0) + 1);
  httpMetrics.routes.set(key, existing);
}

function createRateLimiter(
  rateLimitStore: Map<string, { count: number; resetAt: number }>,
  rateLimitWindowMs: number,
  bucket: 'read' | 'write',
  limit: number,
  methods?: string[],
): MiddlewareHandler {
  const methodSet = methods ? new Set(methods.map((m) => m.toUpperCase())) : null;

  function rateLimitKey(c: any): string {
    const auth = c.req.header('Authorization');
    if (auth) return `auth:${auth}`;
    const forwarded = c.req.header('x-forwarded-for');
    if (forwarded) return `ip:${forwarded.split(',')[0].trim()}`;
    const remote = c.req.header('cf-connecting-ip') || c.req.header('x-real-ip');
    if (remote) return `ip:${remote}`;
    return 'anon';
  }

  return async (c, next) => {
    if (methodSet && !methodSet.has(c.req.method.toUpperCase())) return next();

    const now = Date.now();
    const key = `${bucket}:${rateLimitKey(c)}:${Math.floor(now / rateLimitWindowMs)}`;
    const existing = rateLimitStore.get(key);
    const resetAt = (Math.floor(now / rateLimitWindowMs) + 1) * rateLimitWindowMs;
    const nextCount = existing ? existing.count + 1 : 1;
    rateLimitStore.set(key, { count: nextCount, resetAt });

    c.header('X-RateLimit-Limit', String(limit));
    c.header('X-RateLimit-Remaining', String(Math.max(0, limit - nextCount)));
    c.header('X-RateLimit-Reset', String(Math.floor(resetAt / 1000)));

    if (nextCount > limit) {
      httpMetrics.rateLimitedTotal += 1;
      return c.json(
        {
          error: 'Too Many Requests',
          bucket,
          retry_after_ms: Math.max(0, resetAt - now),
        },
        429,
      );
    }
    return next();
  };
}

export function getHttpMiddlewareMetrics(): {
  requestsTotal: number;
  inFlight: number;
  generatedRequestIds: number;
  rateLimitedTotal: number;
} {
  return {
    requestsTotal: httpMetrics.requestsTotal,
    inFlight: httpMetrics.inFlight,
    generatedRequestIds: httpMetrics.generatedRequestIds,
    rateLimitedTotal: httpMetrics.rateLimitedTotal,
  };
}

export function renderHttpMetricsPrometheus(): string {
  const lines: string[] = [
    '# HELP oracle_http_requests_total Total HTTP requests handled.',
    '# TYPE oracle_http_requests_total counter',
    `oracle_http_requests_total ${httpMetrics.requestsTotal}`,
    '# HELP oracle_http_in_flight_requests Current in-flight HTTP requests.',
    '# TYPE oracle_http_in_flight_requests gauge',
    `oracle_http_in_flight_requests ${httpMetrics.inFlight}`,
    '# HELP oracle_http_generated_request_ids_total Request IDs generated by middleware.',
    '# TYPE oracle_http_generated_request_ids_total counter',
    `oracle_http_generated_request_ids_total ${httpMetrics.generatedRequestIds}`,
    '# HELP oracle_http_rate_limited_total Requests rejected by rate limiting.',
    '# TYPE oracle_http_rate_limited_total counter',
    `oracle_http_rate_limited_total ${httpMetrics.rateLimitedTotal}`,
    '# HELP oracle_http_requests_by_route_total Requests by normalized route and status code.',
    '# TYPE oracle_http_requests_by_route_total counter',
    '# HELP oracle_http_request_duration_ms_sum Cumulative request duration in milliseconds by route.',
    '# TYPE oracle_http_request_duration_ms_sum counter',
    '# HELP oracle_http_request_duration_ms_count Request duration sample count by route.',
    '# TYPE oracle_http_request_duration_ms_count counter',
  ];

  for (const [key, metric] of httpMetrics.routes.entries()) {
    const sep = key.indexOf(' ');
    const method = key.slice(0, sep);
    const path = key.slice(sep + 1);
    const labels = `method="${escapeMetricLabel(method)}",path="${escapeMetricLabel(path)}"`;
    lines.push(`oracle_http_request_duration_ms_sum{${labels}} ${metric.durationMsSum.toFixed(3)}`);
    lines.push(`oracle_http_request_duration_ms_count{${labels}} ${metric.count}`);
    for (const [status, count] of metric.statusCounts.entries()) {
      lines.push(
        `oracle_http_requests_by_route_total{${labels},status="${status}"} ${count}`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

export function resetHttpMiddlewareMetricsForTest(): void {
  httpMetrics.requestsTotal = 0;
  httpMetrics.inFlight = 0;
  httpMetrics.generatedRequestIds = 0;
  httpMetrics.rateLimitedTotal = 0;
  httpMetrics.routes.clear();
}

export function registerSecurityMiddleware(
  app: Hono,
  options: SecurityMiddlewareOptions,
): { adminAuth: MiddlewareHandler } {
  const corsOrigins = buildCorsOriginSet(options.defaultCorsOrigins, options.allowedOriginsFromEnv);

  // Correlation middleware: keep/propagate x-request-id + collect route metrics.
  app.use('*', async (c, next) => {
    const incomingRequestId = c.req.header('x-request-id') || c.req.header('X-Request-Id') || '';
    const requestId = incomingRequestId || createRequestId();
    if (!incomingRequestId) {
      httpMetrics.generatedRequestIds += 1;
    }

    (c as any).set?.('requestId', requestId);
    c.header('x-request-id', requestId);

    const startedAt = performance.now();
    httpMetrics.requestsTotal += 1;
    httpMetrics.inFlight += 1;
    try {
      await next();
    } finally {
      const durationMs = performance.now() - startedAt;
      httpMetrics.inFlight = Math.max(0, httpMetrics.inFlight - 1);
      trackRouteMetric(c.req.method, c.req.path, c.res?.status || 200, durationMs);
    }
  });

  // Strict CORS allowlist: same-origin + configured origins only.
  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin');
    const allowed = Boolean(origin && isCorsAllowed(origin, c, corsOrigins));

    if (c.req.method === 'OPTIONS') {
      if (!allowed) return c.body(null, 403);
      c.header('Access-Control-Allow-Origin', origin!);
      c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id');
      c.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      c.header('Access-Control-Max-Age', '600');
      c.header('Vary', 'Origin');
      return c.body(null, 204);
    }

    await next();
    if (allowed) {
      c.header('Access-Control-Allow-Origin', origin!);
      c.header('Vary', 'Origin');
    }
  });

  // Simple Bearer token auth for sensitive routes only.
  const adminAuth: MiddlewareHandler = async (c, next) => {
    if (!options.adminAuthToken) return next(); // No token = no auth (dev mode)
    const authHeader = c.req.header('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (token !== options.adminAuthToken) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    return next();
  };

  const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
  const readRateLimiter = createRateLimiter(
    rateLimitStore,
    options.rateLimitWindowMs,
    'read',
    options.rateLimitReadLimit,
    ['GET'],
  );
  const writeRateLimiter = createRateLimiter(
    rateLimitStore,
    options.rateLimitWindowMs,
    'write',
    options.rateLimitWriteLimit,
    ['POST', 'PATCH', 'PUT', 'DELETE'],
  );

  // Sensitive-route auth middleware.
  app.use('/api/nanoclaw/*', adminAuth);
  app.use('/api/logs', adminAuth);
  app.use('/api/user-model', adminAuth);
  app.use('/api/user-model/*', adminAuth);
  app.use('/api/procedural', adminAuth);
  app.use('/api/procedural/*', adminAuth);
  app.use('/api/episodic', adminAuth);
  app.use('/api/episodic/*', adminAuth);

  // Heavy endpoint rate limits.
  app.use('/api/search', readRateLimiter);
  app.use('/api/consult', readRateLimiter);
  app.use('/api/file', readRateLimiter);
  app.use('/api/nanoclaw/*', readRateLimiter);
  app.use('/api/learn', writeRateLimiter);
  app.use('/api/thread', writeRateLimiter);
  app.use('/api/thread/*', writeRateLimiter);
  app.use('/api/decisions', writeRateLimiter);
  app.use('/api/decisions/*', writeRateLimiter);
  app.use('/api/supersede', writeRateLimiter);
  app.use('/api/traces/*', writeRateLimiter);
  app.use('/api/chat/*', writeRateLimiter);
  app.use('/api/user-model', writeRateLimiter);
  app.use('/api/user-model/*', writeRateLimiter);
  app.use('/api/procedural', writeRateLimiter);
  app.use('/api/procedural/*', writeRateLimiter);
  app.use('/api/episodic', writeRateLimiter);
  app.use('/api/episodic/*', writeRateLimiter);

  return { adminAuth };
}

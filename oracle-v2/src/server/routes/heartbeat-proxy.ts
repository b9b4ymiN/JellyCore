import type { Hono } from 'hono';

interface HeartbeatProxyOptions {
  adminAuth: (c: any, next: any) => Promise<unknown>;
  nanoclawInternalUrl: string;
}

function forwardedRequestId(c: any): string {
  return c.get('requestId') || c.req.header('x-request-id') || '';
}

async function proxyJson(
  c: any,
  targetUrl: string,
  init?: RequestInit,
) {
  try {
    const requestId = forwardedRequestId(c);
    const headers = new Headers(init?.headers || {});
    if (requestId) {
      headers.set('x-request-id', requestId);
    }
    const upstream = await fetch(targetUrl, {
      ...init,
      headers,
    });
    const contentType = upstream.headers.get('content-type') || 'application/json';
    const payload = await upstream.text();
    return c.body(payload, upstream.status, {
      'Content-Type': contentType,
    });
  } catch (err: any) {
    return c.json(
      { error: 'Heartbeat upstream unavailable', detail: err?.message || String(err) },
      503,
    );
  }
}

export function registerHeartbeatProxyRoutes(
  app: Hono,
  options: HeartbeatProxyOptions,
): void {
  app.get('/api/heartbeat/config', options.adminAuth, async (c) => {
    return proxyJson(c, `${options.nanoclawInternalUrl}/heartbeat/config`, {
      method: 'GET',
    });
  });

  app.patch('/api/heartbeat/config', options.adminAuth, async (c) => {
    const body = await c.req.text();
    return proxyJson(c, `${options.nanoclawInternalUrl}/heartbeat/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  });

  app.post('/api/heartbeat/ping', options.adminAuth, async (c) => {
    return proxyJson(c, `${options.nanoclawInternalUrl}/heartbeat/ping`, {
      method: 'POST',
    });
  });
}

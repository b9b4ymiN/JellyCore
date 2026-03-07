import type { Hono } from 'hono';

interface SchedulerProxyOptions {
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
      { error: 'Scheduler upstream unavailable', detail: err?.message || String(err) },
      503,
    );
  }
}

export function registerSchedulerProxyRoutes(
  app: Hono,
  options: SchedulerProxyOptions,
): void {
  app.get('/api/scheduler/tasks', options.adminAuth, async (c) => {
    const status = c.req.query('status');
    const group = c.req.query('group');
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (group) params.set('group', group);
    const query = params.toString();
    const url = `${options.nanoclawInternalUrl}/scheduler/tasks${query ? `?${query}` : ''}`;
    return proxyJson(c, url, { method: 'GET' });
  });

  app.get('/api/scheduler/tasks/:id', options.adminAuth, async (c) => {
    const id = encodeURIComponent(c.req.param('id'));
    return proxyJson(c, `${options.nanoclawInternalUrl}/scheduler/tasks/${id}`, {
      method: 'GET',
    });
  });

  app.post('/api/scheduler/tasks', options.adminAuth, async (c) => {
    const body = await c.req.text();
    return proxyJson(c, `${options.nanoclawInternalUrl}/scheduler/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  });

  app.patch('/api/scheduler/tasks/:id', options.adminAuth, async (c) => {
    const id = encodeURIComponent(c.req.param('id'));
    const body = await c.req.text();
    return proxyJson(c, `${options.nanoclawInternalUrl}/scheduler/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  });

  app.post('/api/scheduler/tasks/:id/pause', options.adminAuth, async (c) => {
    const id = encodeURIComponent(c.req.param('id'));
    return proxyJson(c, `${options.nanoclawInternalUrl}/scheduler/tasks/${id}/pause`, {
      method: 'POST',
    });
  });

  app.post('/api/scheduler/tasks/:id/resume', options.adminAuth, async (c) => {
    const id = encodeURIComponent(c.req.param('id'));
    return proxyJson(c, `${options.nanoclawInternalUrl}/scheduler/tasks/${id}/resume`, {
      method: 'POST',
    });
  });

  app.post('/api/scheduler/tasks/:id/cancel', options.adminAuth, async (c) => {
    const id = encodeURIComponent(c.req.param('id'));
    return proxyJson(c, `${options.nanoclawInternalUrl}/scheduler/tasks/${id}/cancel`, {
      method: 'POST',
    });
  });

  app.post('/api/scheduler/tasks/:id/run', options.adminAuth, async (c) => {
    const id = encodeURIComponent(c.req.param('id'));
    return proxyJson(c, `${options.nanoclawInternalUrl}/scheduler/tasks/${id}/run`, {
      method: 'POST',
    });
  });

  app.get('/api/scheduler/stats', options.adminAuth, async (c) => {
    return proxyJson(c, `${options.nanoclawInternalUrl}/scheduler/stats`, {
      method: 'GET',
    });
  });
}

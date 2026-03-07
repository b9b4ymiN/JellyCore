import type { Hono } from 'hono';

interface LiveProxyOptions {
  adminAuth: (c: any, next: any) => Promise<unknown>;
  nanoclawInternalUrl: string;
  adminAuthToken: string;
}

function forwardedRequestId(c: any): string {
  return c.get('requestId') || c.req.header('x-request-id') || '';
}

function isAuthorized(c: any, adminAuthToken: string): boolean {
  if (!adminAuthToken) return true;
  const headerToken = (c.req.header('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const queryToken = (c.req.query('token') || '').trim();
  return headerToken === adminAuthToken || queryToken === adminAuthToken;
}

export function registerLiveProxyRoutes(app: Hono, options: LiveProxyOptions): void {
  app.get('/api/live/events', async (c) => {
    if (!isAuthorized(c, options.adminAuthToken)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const requestId = forwardedRequestId(c);
    const upstream = await fetch(`${options.nanoclawInternalUrl}/events/live`, {
      headers: requestId ? { 'x-request-id': requestId } : undefined,
    });

    if (!upstream.ok || !upstream.body) {
      const details = await upstream.text().catch(() => '');
      return new Response(
        JSON.stringify({
          error: 'Failed to connect to live event stream',
          status: upstream.status,
          details: details || undefined,
        }),
        {
          status: upstream.status || 502,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  });
}

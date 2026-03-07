import type { Hono } from 'hono';

interface ChatProxyOptions {
  adminAuth: (c: any, next: any) => Promise<unknown>;
  nanoclawInternalUrl: string;
}

const CHAT_PROXY_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.ORACLE_CHAT_PROXY_TIMEOUT_MS || '900000', 10);
  if (!Number.isFinite(parsed) || parsed < 30_000) {
    return 900_000;
  }
  return parsed;
})();

function forwardedRequestId(c: any): string {
  return c.get('requestId') || c.req.header('x-request-id') || '';
}

export function registerChatProxyRoutes(
  app: Hono,
  options: ChatProxyOptions,
): void {
  app.get('/api/chat/history', options.adminAuth, async (c) => {
    try {
      const requestId = forwardedRequestId(c);
      const headers = new Headers();
      if (requestId) {
        headers.set('x-request-id', requestId);
      }

      const params = new URLSearchParams();
      const groupFolder = c.req.query('group_folder');
      const limit = c.req.query('limit');
      if (groupFolder) params.set('group_folder', groupFolder);
      if (limit) params.set('limit', limit);
      const query = params.toString();
      const url = `${options.nanoclawInternalUrl}/chat/history${query ? `?${query}` : ''}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CHAT_PROXY_TIMEOUT_MS);

      try {
        const upstream = await fetch(url, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });
        const payload = await upstream.text();
        return new Response(payload, {
          status: upstream.status || 502,
          headers: {
            'Content-Type': upstream.headers.get('content-type') || 'application/json',
          },
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (err: any) {
      return c.json(
        { error: 'Chat upstream unavailable', detail: err?.message || String(err) },
        503,
      );
    }
  });

  app.post('/api/chat/send', options.adminAuth, async (c) => {
    try {
      const requestId = forwardedRequestId(c);
      const body = await c.req.text();
      const headers = new Headers({ 'Content-Type': 'application/json' });
      if (requestId) {
        headers.set('x-request-id', requestId);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CHAT_PROXY_TIMEOUT_MS);
      try {
        const upstream = await fetch(`${options.nanoclawInternalUrl}/chat/send`, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });
        const payload = await upstream.text();
        return new Response(payload, {
          status: upstream.status || 502,
          headers: {
            'Content-Type': upstream.headers.get('content-type') || 'application/json',
          },
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (err: any) {
      return c.json(
        { error: 'Chat upstream unavailable', detail: err?.message || String(err) },
        503,
      );
    }
  });
}

import type { Hono } from 'hono';

interface NanoclawProxyOptions {
  adminAuth: (c: any, next: any) => Promise<unknown>;
  nanoclawInternalUrl: string;
}

export function registerNanoclawProxyRoutes(
  app: Hono,
  options: NanoclawProxyOptions,
): void {
  function forwardedRequestId(c: any): string {
    return c.get('requestId') || c.req.header('x-request-id') || '';
  }

  // Proxy NanoClaw health
  app.get('/api/nanoclaw/health', options.adminAuth, async (c) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const requestId = forwardedRequestId(c);
      const resp = await fetch(`${options.nanoclawInternalUrl}/health`, {
        signal: controller.signal,
        headers: requestId ? { 'x-request-id': requestId } : undefined,
      });
      clearTimeout(timeout);
      const data = await resp.json();
      return c.json(data);
    } catch (err: any) {
      return c.json({ status: 'unreachable', error: err.message }, 503);
    }
  });

  // Proxy NanoClaw status
  app.get('/api/nanoclaw/status', options.adminAuth, async (c) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const requestId = forwardedRequestId(c);
      const resp = await fetch(`${options.nanoclawInternalUrl}/status`, {
        signal: controller.signal,
        headers: requestId ? { 'x-request-id': requestId } : undefined,
      });
      clearTimeout(timeout);
      const data = await resp.json();
      return c.json(data);
    } catch (err: any) {
      return c.json({ status: 'unreachable', error: err.message }, 503);
    }
  });
}

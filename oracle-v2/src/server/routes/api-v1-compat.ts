import type { Hono } from 'hono';

/**
 * Compatibility layer: mirror /api/v1/* to existing /api/* handlers.
 * This preserves legacy /api routes while allowing versioned clients.
 */
export function registerApiV1Compatibility(app: Hono): void {
  const forward = async (c: any) => {
    const targetUrl = new URL(c.req.url);
    targetUrl.pathname = targetUrl.pathname.replace(/^\/api\/v1\b/, '/api');
    const location = `${targetUrl.pathname}${targetUrl.search}`;
    return c.redirect(location, 307);
  };

  app.all('/api/v1', forward);
  app.all('/api/v1/*', forward);
}

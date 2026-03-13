/**
 * Oracle MCP Routes - Streamable HTTP Transport
 *
 * Implements MCP Streamable HTTP transport (2025-03-26 spec) using
 * @modelcontextprotocol/sdk v1.x WebStandardStreamableHTTPServerTransport.
 *
 * Compatible with: Claude Code, Claude Desktop, VS Code MCP, Cursor.
 *
 * Endpoints:
 *   POST   /mcp       - Initialize new session or send messages to existing session
 *   GET    /mcp       - Server-initiated notification stream (optional)
 *   DELETE /mcp       - Session close
 *   OPTIONS /mcp      - CORS preflight
 *   POST   /mcp/sync  - Stateless sync (curl / simple HTTP clients, no SSE)
 */

import type { Context, Hono } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { randomUUID } from 'crypto';

import {
  type McpSession,
  mcpSessions,
  getMcpSession,
  deleteMcpSession,
  cleanupInactiveSessions,
  MCP_SSE_CONFIG,
} from '../../mcp-sse.js';
import { createMcpServerWithHandlers, getToolHandlers, getToolDefinitions } from './mcp-server-factory.js';

type MiddlewareHandler = (c: Context, next: () => Promise<void>) => Promise<unknown>;

interface McpSseRoutesOptions {
  authMiddleware?: MiddlewareHandler;
  path?: string;
  enabled?: boolean;
  sessionTimeoutMs?: number;
}

async function checkAuth(c: Context, authMiddleware: MiddlewareHandler | undefined): Promise<boolean> {
  if (!authMiddleware) return true;
  let passed = false;
  await authMiddleware(c, async () => { passed = true; });
  return passed;
}

export function registerMcpSseRoutes(app: Hono, options: McpSseRoutesOptions = {}): void {
  const {
    authMiddleware,
    path = MCP_SSE_CONFIG.path,
    enabled = MCP_SSE_CONFIG.enabled,
    sessionTimeoutMs = MCP_SSE_CONFIG.sessionTimeoutMs,
  } = options;

  if (!enabled) {
    console.log('[MCP] Disabled via configuration');
    return;
  }

  console.log(`[MCP] Streamable HTTP registered at ${path}`);

  // Periodic cleanup of inactive sessions
  const cleanupInterval = setInterval(() => {
    const n = cleanupInactiveSessions(sessionTimeoutMs);
    if (n > 0) console.log(`[MCP] Cleaned ${n} inactive sessions`);
  }, 30 * 60 * 1000);
  process.on('SIGTERM', () => clearInterval(cleanupInterval));

  /**
   * OPTIONS /mcp - CORS preflight
   */
  app.options(path, (c) => {
    c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, Last-Event-ID');
    c.header('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    c.header('Access-Control-Max-Age', '600');
    return c.body(null, 204);
  });

  /**
   * Primary MCP endpoint - Streamable HTTP transport
   *
   * POST without Mcp-Session-Id → create new session (must be initialize request)
   *   OR handle stateless requests (tools/list, tools/call) without session
   * POST/GET/DELETE with Mcp-Session-Id → route to existing session transport
   */
  app.on(['GET', 'POST', 'DELETE'], path, async (c) => {
    if (!await checkAuth(c, authMiddleware)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const sessionId = c.req.header('mcp-session-id');

    // Route to existing session
    if (sessionId) {
      const session = getMcpSession(sessionId);
      if (!session) {
        // Session expired or not found — client must re-initialize
        return c.json({ error: 'Session not found. Re-initialize via POST /mcp' }, 404);
      }
      return session.transport.handleRequest(c.req.raw);
    }

    // No session ID — only POST can create a new session or handle stateless
    if (c.req.method !== 'POST') {
      return c.json({ error: 'New MCP sessions must be initialized via POST' }, 405);
    }

    // Check if this is a stateless request (initialize, tools/list or tools/call without session)
    try {
      const body = await c.req.json();

      // Handle initialize as stateless - return server info without creating session
      if (body.method === 'initialize') {
        return c.json({
          jsonrpc: '2.0',
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'oracle-nightly-sse', version: '0.7.0' }
          },
          id: body.id ?? null,
        });
      }

      if (body.method === 'tools/list' || body.method === 'tools/call') {
        // Handle as stateless request (same logic as /mcp/sync)
        let result: unknown;
        if (body.method === 'tools/list') {
          result = { tools: getToolDefinitions() };
        } else {
          const { name, arguments: args } = body.params || {};
          if (!name) {
            return c.json({
              jsonrpc: '2.0',
              error: { code: -32602, message: 'Invalid params: missing tool name' },
              id: body.id ?? null,
            }, 400);
          }
          const handlers = getToolHandlers();
          const handler = handlers.get(name);
          if (!handler) {
            return c.json({
              jsonrpc: '2.0',
              error: { code: -32601, message: `Tool not found: ${name}` },
              id: body.id ?? null,
            }, 404);
          }
          result = await handler(args || {});
        }
        return c.json({ jsonrpc: '2.0', result, id: body.id ?? null });
      }

      // Handle notifications/initialized - just acknowledge without error
      if (body.method === 'notifications/initialized') {
        return c.json({ jsonrpc: '2.0', result: {}, id: body.id ?? null });
      }
    } catch {
      // Not JSON or parse error — fall through to normal session handling
    }

    // Create new stateful transport + MCP server for this session
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (sid) => {
        mcpSessions.set(sid, {
          sessionId: sid,
          transport,
          createdAt: new Date(),
          lastActivityAt: new Date(),
        } satisfies McpSession);
        console.log(`[MCP] Session initialized: ${sid} (active: ${mcpSessions.size})`);
      },
      onsessionclosed: (sid) => {
        deleteMcpSession(sid);
        console.log(`[MCP] Session closed: ${sid} (active: ${mcpSessions.size})`);
      },
    });

    const server = createMcpServerWithHandlers();
    await server.connect(transport);

    return transport.handleRequest(c.req.raw);
  });

  /**
   * OPTIONS /mcp/sync - CORS preflight
   */
  app.options(`${path}/sync`, (c) => {
    c.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    c.header('Access-Control-Max-Age', '600');
    return c.body(null, 204);
  });

  /**
   * POST /mcp/sync - Stateless synchronous endpoint
   *
   * For curl / simple HTTP clients that don't support SSE.
   * Supports: tools/list, tools/call
   * Returns JSON directly (no streaming).
   */
  app.post(`${path}/sync`, async (c) => {
    if (!await checkAuth(c, authMiddleware)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    try {
      const body = await c.req.json();
      if (!body.jsonrpc || !body.method) {
        return c.json({
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Invalid Request: missing jsonrpc or method' },
          id: body.id ?? null,
        }, 400);
      }

      let result: unknown;

      if (body.method === 'tools/list') {
        result = { tools: getToolDefinitions() };
      } else if (body.method === 'tools/call') {
        const { name, arguments: args } = body.params || {};
        if (!name) {
          return c.json({
            jsonrpc: '2.0',
            error: { code: -32602, message: 'Invalid params: missing tool name' },
            id: body.id ?? null,
          }, 400);
        }
        const handlers = getToolHandlers();
        const handler = handlers.get(name);
        if (!handler) {
          return c.json({
            jsonrpc: '2.0',
            error: { code: -32601, message: `Tool not found: ${name}` },
            id: body.id ?? null,
          }, 404);
        }
        result = await handler(args || {});
      } else {
        return c.json({
          jsonrpc: '2.0',
          error: { code: -32601, message: `Method not supported in /sync: ${body.method}` },
          id: body.id ?? null,
        }, 405);
      }

      return c.json({ jsonrpc: '2.0', result, id: body.id ?? null });
    } catch (error) {
      console.error('[MCP sync] Error:', error);
      return c.json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error',
          data: error instanceof Error ? error.message : String(error),
        },
        id: null,
      }, 500);
    }
  });
}


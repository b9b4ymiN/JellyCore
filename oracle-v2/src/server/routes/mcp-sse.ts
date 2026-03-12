/**
 * Oracle MCP SSE Routes for Hono.js
 *
 * Provides HTTP endpoints for MCP over SSE:
 * - GET /mcp: SSE stream for server-to-client notifications
 * - POST /mcp: Client-to-server messages (JSON-RPC)
 * - DELETE /mcp: Session termination
 */

import type { Hono, Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import type { SSEStreamingApi } from 'hono/streaming';

import {
  HonoSSETransport,
  McpSession,
  mcpSessions,
  createSession,
  deleteSession,
  getOrCreateSession,
  cleanupInactiveSessions,
  getSessionCount,
  MCP_SSE_CONFIG,
} from '../../mcp-sse.js';
import { createMcpServerWithHandlers } from './mcp-server-factory.js';

type MiddlewareHandler = (c: Context, next: () => Promise<void>) => Promise<Response | void>;

interface McpSseRoutesOptions {
  /**
   * Authentication middleware (e.g., adminAuth from http-middleware)
   */
  authMiddleware?: MiddlewareHandler;

  /**
   * MCP endpoint path (default: /mcp)
   */
  path?: string;

  /**
   * Enable MCP SSE (default: true from env)
   */
  enabled?: boolean;

  /**
   * Session timeout in milliseconds
   */
  sessionTimeoutMs?: number;
}

/**
 * Register MCP SSE routes on Hono app
 */
export function registerMcpSseRoutes(
  app: Hono,
  options: McpSseRoutesOptions = {}
): void {
  const {
    authMiddleware,
    path = MCP_SSE_CONFIG.path,
    enabled = MCP_SSE_CONFIG.enabled,
    sessionTimeoutMs = MCP_SSE_CONFIG.sessionTimeoutMs,
  } = options;

  // Skip if disabled
  if (!enabled) {
    console.log('[MCP SSE] Disabled via configuration');
    return;
  }

  console.log(`[MCP SSE] Registering routes at ${path}`);

  // Session cleanup interval (every 30 minutes)
  const cleanupInterval = setInterval(() => {
    const cleaned = cleanupInactiveSessions(sessionTimeoutMs);
    if (cleaned > 0) {
      console.log(`[MCP SSE] Cleaned up ${cleaned} inactive sessions`);
    }
  }, 30 * 60 * 1000);

  // Graceful shutdown
  process.on('SIGTERM', () => {
    clearInterval(cleanupInterval);
  });

  /**
   * GET /mcp - SSE stream for server-to-client notifications
   */
  app.get(path, async (c) => {
    // Apply auth if middleware provided
    if (authMiddleware) {
      let authPassed = false;
      await authMiddleware(c, async () => {
        authPassed = true;
      });
      if (!authPassed) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
    }

    const sessionId = c.req.query('sessionId');

    return streamSSE(c, async (stream) => {
      try {
        // Check for existing session
        let session: McpSession | undefined;
        if (sessionId) {
          session = getOrCreateSession(sessionId);
        }

        // Create new session if not exists
        if (!session) {
          const transport = new HonoSSETransport({
            sessionTimeoutMs,
            onsessioninitialized: (id) => {
              console.log(`[MCP SSE] Session initialized: ${id}`);
            },
            onsessionclosed: (id) => {
              console.log(`[MCP SSE] Session closed: ${id}`);
            },
          });

          // Create MCP server instance for this session
          const server = createMcpServerWithHandlers();

          // Connect transport to server
          await server.connect(transport);

          // Create session
          session = createSession(transport, server);
        }

        // Set SSE stream for transport with base path for POST endpoint
        session.transport.setSSEStream(stream, path);

        // Keep connection alive with periodic heartbeats
        let heartbeatCount = 0;
        const heartbeatInterval = setInterval(() => {
          try {
            stream.writeSSE({
              event: 'heartbeat',
              data: JSON.stringify({ count: heartbeatCount++ }),
            });
          } catch {
            clearInterval(heartbeatInterval);
          }
        }, 30000); // 30 second heartbeat

        // Wait indefinitely (connection will be closed by client or timeout)
        await new Promise<void>((resolve) => {
          // Resolve on a long timeout (session timeout)
          const timeout = setTimeout(() => {
            clearInterval(heartbeatInterval);
            resolve();
          }, sessionTimeoutMs);

          // Also handle process termination
          const onSigterm = () => {
            clearTimeout(timeout);
            clearInterval(heartbeatInterval);
            resolve();
          };
          process.once('SIGTERM', onSigterm);
        });

      } catch (error) {
        console.error('[MCP SSE] GET error:', error);
        try {
          await stream.writeSSE({
            event: 'error',
            data: JSON.stringify({
              error: error instanceof Error ? error.message : 'Unknown error'
            }),
          });
        } catch {
          // Stream may already be closed
        }
      }
    });
  });

  /**
   * POST /mcp - Client-to-server messages
   */
  app.post(path, async (c) => {
    // Apply auth if middleware provided
    if (authMiddleware) {
      let authPassed = false;
      await authMiddleware(c, async () => {
        authPassed = true;
      });
      if (!authPassed) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
    }

    try {
      // Get session ID from query or header
      const sessionId = c.req.query('sessionId') ||
        c.req.header('mcp-session-id');

      if (!sessionId) {
        return c.json({
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: 'Missing sessionId. Include sessionId in query or mcp-session-id header.',
          },
          id: null,
        }, 400);
      }

      // Get session
      const session = getOrCreateSession(sessionId);
      if (!session) {
        return c.json({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: 'Session not found. Establish SSE connection first via GET /mcp',
          },
          id: null,
        }, 404);
      }

      // Update last activity
      session.lastActivityAt = new Date();

      // Parse request body
      const body = await c.req.json();

      // Validate JSON-RPC message
      const parseResult = JSONRPCMessageSchema.safeParse(body);
      if (!parseResult.success) {
        return c.json({
          jsonrpc: '2.0',
          error: {
            code: -32700,
            message: 'Parse error',
            data: parseResult.error.errors,
          },
          id: null,
        }, 400);
      }

      const message = parseResult.data;

      // Handle message via transport
      await session.transport.handlePostMessage(message);

      // Return session ID in response header
      c.header('mcp-session-id', sessionId);

      // Official MCP SDK returns plain text "Accepted" with 202 status
      return c.text("Accepted", 202);

    } catch (error) {
      console.error('[MCP SSE] POST error:', error);
      return c.json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error',
          data: error instanceof Error ? error.message : 'Unknown error',
        },
        id: null,
      }, 500);
    }
  });

  /**
   * DELETE /mcp - Session termination
   */
  app.delete(path, async (c) => {
    // Apply auth if middleware provided
    if (authMiddleware) {
      let authPassed = false;
      await authMiddleware(c, async () => {
        authPassed = true;
      });
      if (!authPassed) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
    }

    const sessionId = c.req.query('sessionId') ||
      c.req.header('mcp-session-id');

    if (!sessionId) {
      return c.json({ error: 'Missing sessionId' }, 400);
    }

    const deleted = deleteSession(sessionId);

    if (deleted) {
      return c.json({ status: 'ok', message: 'Session terminated' });
    } else {
      return c.json({ error: 'Session not found' }, 404);
    }
  });

  /**
   * OPTIONS /mcp - CORS preflight
   */
  app.options(path, (c) => {
    c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-session-id');
    c.header('Access-Control-Expose-Headers', 'mcp-session-id');
    c.header('Access-Control-Max-Age', '600');
    return c.body(null, 204);
  });

  /**
   * GET /mcp/status - Session status (for debugging/metrics)
   */
  app.get(`${path}/status`, async (c) => {
    // Apply auth if middleware provided
    if (authMiddleware) {
      let authPassed = false;
      await authMiddleware(c, async () => {
        authPassed = true;
      });
      if (!authPassed) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
    }

    return c.json({
      enabled: true,
      sessionCount: getSessionCount(),
      config: {
        path,
        sessionTimeoutMs,
      },
    });
  });
}

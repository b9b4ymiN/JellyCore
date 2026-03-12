/**
 * Oracle MCP Streamable HTTP Session Management
 *
 * Uses MCP SDK v1.x WebStandardStreamableHTTPServerTransport implementing the
 * MCP Streamable HTTP transport spec (2025-03-26).
 *
 * Compatible with: Claude Code, Claude Desktop, VS Code MCP extension, Cursor.
 *
 * Transport flow:
 *   1. Client POST /mcp (no Mcp-Session-Id) → initialize → server returns Mcp-Session-Id header
 *   2. Client POST /mcp (with Mcp-Session-Id) → tool calls → routed to session transport
 *   3. Client GET  /mcp (with Mcp-Session-Id) → server-initiated notification stream (optional)
 *   4. Client DELETE /mcp (with Mcp-Session-Id) → session close
 */

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

export type { WebStandardStreamableHTTPServerTransport };

/**
 * Active MCP session
 */
export interface McpSession {
  sessionId: string;
  transport: WebStandardStreamableHTTPServerTransport;
  createdAt: Date;
  lastActivityAt: Date;
}

/**
 * Global session store
 */
export const mcpSessions = new Map<string, McpSession>();

export function getMcpSession(sessionId: string): McpSession | undefined {
  const session = mcpSessions.get(sessionId);
  if (session) {
    session.lastActivityAt = new Date();
  }
  return session;
}

export function deleteMcpSession(sessionId: string): boolean {
  return mcpSessions.delete(sessionId);
}

/**
 * Cleanup sessions inactive longer than timeoutMs
 */
export function cleanupInactiveSessions(timeoutMs = 60 * 60 * 1000): number {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, session] of mcpSessions) {
    if (now - session.lastActivityAt.getTime() > timeoutMs) {
      mcpSessions.delete(id);
      cleaned++;
    }
  }
  return cleaned;
}

export function getSessionCount(): number {
  return mcpSessions.size;
}

/**
 * Environment configuration
 */
export const MCP_SSE_CONFIG = {
  enabled: process.env.ORACLE_MCP_ENABLED !== 'false',
  path: process.env.ORACLE_MCP_PATH || '/mcp',
  sessionTimeoutMs: Number.parseInt(process.env.ORACLE_MCP_SESSION_TIMEOUT_MS || '3600000', 10),
};


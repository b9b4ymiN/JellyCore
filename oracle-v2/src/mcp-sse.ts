/**
 * Oracle MCP SSE Transport for Hono.js
 *
 * Provides SSE (Server-Sent Events) transport for MCP protocol,
 * compatible with Hono.js Web Standard API.
 *
 * Architecture:
 * - GET /mcp: SSE stream for server-to-client notifications
 * - POST /mcp: Client-to-server messages (JSON-RPC)
 * - DELETE /mcp: Session termination
 */

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import type { SSEStreamingApi } from 'hono/streaming';

/**
 * Session info for tracking active MCP sessions
 */
export interface McpSession {
  sessionId: string;
  transport: HonoSSETransport;
  server: unknown; // MCP Server instance
  createdAt: Date;
  lastActivityAt: Date;
}

/**
 * Global session store
 */
export const mcpSessions = new Map<string, McpSession>();

/**
 * Configuration options for HonoSSETransport
 */
export interface HonoSSETransportOptions {
  /**
   * Callback when session is initialized
   */
  onsessioninitialized?: (sessionId: string) => void;

  /**
   * Callback when session is closed
   */
  onsessionclosed?: (sessionId: string) => void;

  /**
   * Session timeout in milliseconds (default: 1 hour)
   */
  sessionTimeoutMs?: number;
}

/**
 * Hono-compatible SSE Transport for MCP
 *
 * Implements the Transport interface from MCP SDK using Hono's SSE streaming API.
 */
export class HonoSSETransport implements Transport {
  private _sessionId: string;
  private _sseStream?: SSEStreamingApi;
  private _messageQueue: JSONRPCMessage[] = [];
  private _isStarted = false;
  private _options: HonoSSETransportOptions;

  // Transport interface callbacks
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(options: HonoSSETransportOptions = {}) {
    this._sessionId = randomUUID();
    this._options = {
      sessionTimeoutMs: 60 * 60 * 1000, // 1 hour default
      ...options,
    };
  }

  /**
   * Get the session ID for this transport
   */
  get sessionId(): string {
    return this._sessionId;
  }

  /**
   * Set the SSE stream for this transport
   * Called when GET request establishes SSE connection
   */
  setSSEStream(stream: SSEStreamingApi, basePath: string = '/mcp'): void {
    this._sseStream = stream;
    this._isStarted = true;

    // Send endpoint event to client with URL path for POST requests
    // MCP SDK expects: data = relative URL path (e.g., "/mcp?sessionId=xxx")
    // Use encodeURI to match official MCP SDK behavior
    const postEndpoint = encodeURI(`${basePath}?sessionId=${this._sessionId}`);
    stream.writeSSE({
      event: 'endpoint',
      data: postEndpoint,
    });

    // Flush queued messages
    this._flushMessageQueue();

    // Notify session initialized
    this._options.onsessioninitialized?.(this._sessionId);
  }

  /**
   * Start the transport
   * For SSE, this is a no-op as the transport starts when SSE stream is set
   */
  async start(): Promise<void> {
    // SSE transport starts when setSSEStream is called
    // This is a no-op for compatibility with MCP SDK
  }

  /**
   * Send a message to the client via SSE
   */
  async send(message: JSONRPCMessage): Promise<void> {
    if (!this._sseStream || !this._isStarted) {
      // Queue message if SSE stream not ready
      this._messageQueue.push(message);
      return;
    }

    try {
      await this._sseStream.writeSSE({
        event: 'message',
        data: JSON.stringify(message),
      });
    } catch (error) {
      this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Handle incoming message from POST request
   */
  async handlePostMessage(message: JSONRPCMessage): Promise<void> {
    if (!this._sseStream || !this._isStarted) {
      throw new Error('SSE connection not established');
    }

    this.onmessage?.(message);
  }

  /**
   * Close the transport
   */
  async close(): Promise<void> {
    if (this._sseStream) {
      try {
        await this._sseStream.writeSSE({
          event: 'close',
          data: JSON.stringify({ reason: 'Session closed' }),
        });
        this._sseStream.close();
      } catch {
        // Ignore errors on close
      }
    }

    this._sseStream = undefined;
    this._isStarted = false;
    this._messageQueue = [];

    this._options.onsessionclosed?.(this._sessionId);
    this.onclose?.();
  }

  /**
   * Flush queued messages to SSE stream
   */
  private async _flushMessageQueue(): Promise<void> {
    if (!this._sseStream) return;

    while (this._messageQueue.length > 0) {
      const message = this._messageQueue.shift();
      if (message) {
        await this.send(message);
      }
    }
  }
}

/**
 * Get or create MCP session
 */
export function getOrCreateSession(sessionId?: string): McpSession | undefined {
  if (sessionId && mcpSessions.has(sessionId)) {
    const session = mcpSessions.get(sessionId)!;
    session.lastActivityAt = new Date();
    return session;
  }
  return undefined;
}

/**
 * Create new MCP session
 */
export function createSession(transport: HonoSSETransport, server: unknown): McpSession {
  const session: McpSession = {
    sessionId: transport.sessionId,
    transport,
    server,
    createdAt: new Date(),
    lastActivityAt: new Date(),
  };

  mcpSessions.set(session.sessionId, session);
  return session;
}

/**
 * Delete MCP session
 */
export function deleteSession(sessionId: string): boolean {
  const session = mcpSessions.get(sessionId);
  if (session) {
    session.transport.close();
    mcpSessions.delete(sessionId);
    return true;
  }
  return false;
}

/**
 * Cleanup inactive sessions
 * Should be called periodically
 */
export function cleanupInactiveSessions(timeoutMs: number = 60 * 60 * 1000): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [sessionId, session] of mcpSessions.entries()) {
    const inactiveTime = now - session.lastActivityAt.getTime();
    if (inactiveTime > timeoutMs) {
      deleteSession(sessionId);
      cleaned++;
    }
  }

  return cleaned;
}

/**
 * Get session count (for metrics)
 */
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

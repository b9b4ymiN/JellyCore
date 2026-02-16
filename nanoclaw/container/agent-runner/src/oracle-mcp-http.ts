/**
 * MCP-HTTP Bridge for Oracle V2
 *
 * Translates MCP tool calls from Agent SDK into HTTP requests to Oracle service.
 * Runs inside agent container, communicates with Oracle via Docker network.
 *
 * Environment Variables:
 *   - ORACLE_API_URL: Oracle service URL (default: http://oracle:47778)
 *   - ORACLE_AUTH_TOKEN: Optional Bearer token for authentication
 *   - ORACLE_READ_ONLY: If "true", hide write tools (learn, thread, decisions, etc.)
 *   - ORACLE_TIMEOUT: Request timeout in ms (default: 10000)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

// Configuration from environment
const ORACLE_API_URL = process.env.ORACLE_API_URL || 'http://oracle:47778';
const ORACLE_AUTH_TOKEN = process.env.ORACLE_AUTH_TOKEN;
const ORACLE_READ_ONLY = process.env.ORACLE_READ_ONLY === 'true';
const ORACLE_TIMEOUT = parseInt(process.env.ORACLE_TIMEOUT || '10000', 10);

// Tool definitions matching Oracle HTTP API endpoints
const ORACLE_TOOLS: Tool[] = [
  // Search tools (always available)
  {
    name: 'oracle_search',
    description: 'Search Oracle knowledge base with hybrid search (keyword + semantic). Use layer param to search specific memory layers.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Search query' },
        type: { type: 'string', description: 'Document type filter (all|decision|pattern|principle)', default: 'all' },
        limit: { type: 'number', description: 'Max results (default: 10)', default: 10 },
        offset: { type: 'number', description: 'Offset for pagination (default: 0)', default: 0 },
        mode: { type: 'string', description: 'Search mode: hybrid, fts, or vector (default: hybrid)', default: 'hybrid' },
        project: { type: 'string', description: 'Filter by project path' },
        layer: { type: 'string', description: 'Filter by memory layer(s), comma-separated: semantic,procedural,episodic,user_model' },
      },
      required: ['q'],
    },
  },
  {
    name: 'oracle_consult',
    description: 'Get guidance from Oracle on a decision using principles and patterns',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Decision or question to consult about' },
        context: { type: 'string', description: 'Additional context for the decision' },
      },
      required: ['q'],
    },
  },
  {
    name: 'oracle_reflect',
    description: 'Get random wisdom/reflection from Oracle knowledge',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'oracle_list',
    description: 'List documents in Oracle knowledge base',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Document type filter (default: all)', default: 'all' },
        limit: { type: 'number', description: 'Max results (default: 10)', default: 10 },
        offset: { type: 'number', description: 'Offset for pagination (default: 0)', default: 0 },
        group: { type: 'boolean', description: 'Group by type (default: true)', default: true },
      },
    },
  },
  {
    name: 'oracle_stats',
    description: 'Get Oracle database statistics',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'oracle_doc',
    description: 'Get a specific document by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Document ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'oracle_context',
    description: 'Get project context information',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Current working directory' },
      },
    },
  },
  // --- Five-Layer Memory read tools (always available) ---
  {
    name: 'oracle_user_model',
    description: 'Get user model (preferences, expertise, interaction patterns). Returns current user profile.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User identifier (default: "default")', default: 'default' },
      },
    },
  },
  {
    name: 'oracle_procedural_search',
    description: 'Search procedural memory for learned procedures/workflows matching a task context.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Task context to match procedures against' },
        limit: { type: 'number', description: 'Max results (default: 3)', default: 3 },
      },
      required: ['q'],
    },
  },
  {
    name: 'oracle_episodic_search',
    description: 'Search episodic memory for past conversation summaries and outcomes.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Topic to search past episodes for' },
        userId: { type: 'string', description: 'Filter by user' },
        limit: { type: 'number', description: 'Max results (default: 5)', default: 5 },
      },
      required: ['q'],
    },
  },
  // Write tools (hidden in read-only mode)
  ...(ORACLE_READ_ONLY ? [] : [
    {
      name: 'oracle_learn',
      description: 'Add new pattern/learning to Oracle knowledge base. Use layer to target specific memory layer.',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Pattern or learning content' },
          source: { type: 'string', description: 'Source file or origin' },
          concepts: { type: 'array', items: { type: 'string' }, description: 'Key concepts' },
          origin: { type: 'string', description: 'Origin: mother, arthur, volt, human, or null' },
          project: { type: 'string', description: 'Project path (ghq format)' },
          cwd: { type: 'string', description: 'Auto-detect project from cwd' },
          layer: { type: 'string', description: 'Memory layer: semantic (default), procedural, episodic, user_model' },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'oracle_thread_create',
      description: 'Create a new forum thread or send message',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Message content' },
          thread_id: { type: 'number', description: 'Thread ID (for reply)' },
          title: { type: 'string', description: 'Thread title (for new thread)' },
          role: { type: 'string', description: 'Role: human, oracle, or system (default: human)', default: 'human' },
        },
        required: ['message'],
      },
    },
    {
      name: 'oracle_thread',
      description: 'Get thread with messages',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Thread ID' },
        },
        required: ['id'],
      },
    },
    {
      name: 'oracle_thread_update',
      description: 'Update thread status',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Thread ID' },
          status: { type: 'string', description: 'New status: active, resolved, closed' },
        },
        required: ['id', 'status'],
      },
    },
    {
      name: 'oracle_threads',
      description: 'List forum threads',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status' },
          limit: { type: 'number', description: 'Max results (default: 20)', default: 20 },
          offset: { type: 'number', description: 'Offset for pagination (default: 0)', default: 0 },
        },
      },
    },
    {
      name: 'oracle_decisions',
      description: 'List decisions',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status' },
          project: { type: 'string', description: 'Filter by project' },
          tags: { type: 'string', description: 'Comma-separated tag filter' },
          limit: { type: 'number', description: 'Max results (default: 20)', default: 20 },
          offset: { type: 'number', description: 'Offset for pagination (default: 0)', default: 0 },
        },
      },
    },
    {
      name: 'oracle_decision',
      description: 'Get decision by ID',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Decision ID' },
        },
        required: ['id'],
      },
    },
    {
      name: 'oracle_decision_create',
      description: 'Create new decision',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Decision title' },
          context: { type: 'string', description: 'Decision context' },
          options: { type: 'array', items: { type: 'string' }, description: 'Options being considered' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags' },
          project: { type: 'string', description: 'Project path' },
        },
        required: ['title'],
      },
    },
    {
      name: 'oracle_decision_update',
      description: 'Update decision',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Decision ID' },
          title: { type: 'string', description: 'Decision title' },
          context: { type: 'string', description: 'Decision context' },
          options: { type: 'array', items: { type: 'string' }, description: 'Options being considered' },
          decision: { type: 'string', description: 'Final decision' },
          rationale: { type: 'string', description: 'Rationale for decision' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags' },
          status: { type: 'string', description: 'Status: pending, decided, deferred' },
          decided_by: { type: 'string', description: 'Who made the decision' },
        },
        required: ['id'],
      },
    },
    {
      name: 'oracle_traces',
      description: 'List discovery traces',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Filter by query' },
          status: { type: 'string', description: 'Filter by status: raw, reviewed, distilled' },
          project: { type: 'string', description: 'Filter by project' },
          limit: { type: 'number', description: 'Max results (default: 50)', default: 50 },
          offset: { type: 'number', description: 'Offset for pagination (default: 0)', default: 0 },
        },
      },
    },
    {
      name: 'oracle_trace',
      description: 'Get trace by ID',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Trace ID' },
        },
        required: ['id'],
      },
    },
    {
      name: 'oracle_supersede',
      description: 'Log document supersession',
      inputSchema: {
        type: 'object',
        properties: {
          old_path: { type: 'string', description: 'Old document path' },
          old_id: { type: 'string', description: 'Old document ID' },
          old_title: { type: 'string', description: 'Old document title' },
          old_type: { type: 'string', description: 'Old document type' },
          new_path: { type: 'string', description: 'New document path' },
          new_id: { type: 'string', description: 'New document ID' },
          new_title: { type: 'string', description: 'New document title' },
          reason: { type: 'string', description: 'Reason for supersession' },
          superseded_by: { type: 'string', description: 'Who made the change' },
          project: { type: 'string', description: 'Project path' },
        },
        required: ['old_path'],
      },
    },
    // --- Five-Layer Memory write tools ---
    {
      name: 'oracle_user_model_update',
      description: 'Update user model (deep-merges into existing). Can update expertise, preferences, topics, notes.',
      inputSchema: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User identifier (default: "default")', default: 'default' },
          expertise: {
            type: 'object',
            description: 'Expertise levels: { "topic": "novice"|"intermediate"|"advanced"|"expert" }',
          },
          preferences: {
            type: 'object',
            description: 'Preferences: { language, responseLength, responseStyle, codeStyle }',
          },
          commonTopics: {
            type: 'array',
            items: { type: 'string' },
            description: 'Common topics the user discusses',
          },
          timezone: { type: 'string', description: 'User timezone (e.g., Asia/Bangkok)' },
          notes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Free-form notes about the user',
          },
        },
      },
    },
    {
      name: 'oracle_procedural_learn',
      description: 'Save a learned procedure/workflow to procedural memory. If same trigger exists, merges steps.',
      inputSchema: {
        type: 'object',
        properties: {
          trigger: { type: 'string', description: 'When/condition this procedure applies' },
          procedure: {
            type: 'array',
            items: { type: 'string' },
            description: 'Step-by-step procedure',
          },
          source: { type: 'string', description: 'How learned: correction, repeated_pattern, or explicit', default: 'explicit' },
        },
        required: ['trigger', 'procedure'],
      },
    },
    {
      name: 'oracle_procedural_usage',
      description: 'Record that a procedure was used successfully (increments success count, boosts confidence).',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Procedure ID (e.g., procedural_abc123)' },
        },
        required: ['id'],
      },
    },
    {
      name: 'oracle_episodic_record',
      description: 'Record a conversation episode summary to episodic memory (90-day TTL, auto-extends on access).',
      inputSchema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Episode summary' },
          userId: { type: 'string', description: 'User identifier (default: "default")', default: 'default' },
          groupId: { type: 'string', description: 'Group identifier (default: "default")', default: 'default' },
          topics: {
            type: 'array',
            items: { type: 'string' },
            description: 'Topics discussed',
          },
          outcome: { type: 'string', description: 'Outcome: success, partial, failed, unknown', default: 'unknown' },
          durationMs: { type: 'number', description: 'Conversation duration in milliseconds', default: 0 },
        },
        required: ['summary'],
      },
    },
  ] as Tool[]),
];

// HTTP client with retry logic
class OracleHttpClient {
  private readonly baseUrl: string;
  private readonly authToken?: string;
  private readonly timeout: number;

  constructor(baseUrl: string, authToken?: string, timeout: number = 10000) {
    this.baseUrl = baseUrl;
    this.authToken = authToken;
    this.timeout = timeout;
  }

  private async request(
    method: string,
    path: string,
    body?: any,
    retries: number = 3
  ): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          return await response.json();
        }

        // 4xx errors - don't retry
        if (response.status >= 400 && response.status < 500) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(`Oracle error (${response.status}): ${errorData.error || response.statusText}`);
        }

        // 5xx errors - retry
        if (response.status >= 500 && attempt < retries - 1) {
          const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
          console.error(`[Oracle Bridge] Server error ${response.status}, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        throw new Error(`Oracle error (${response.status}): ${response.statusText}`);
      } catch (error: any) {
        if (error.name === 'AbortError') {
          throw new Error(`Oracle request timeout after ${this.timeout}ms`);
        }

        if (attempt === retries - 1) {
          throw error;
        }

        const delay = Math.pow(2, attempt) * 1000;
        console.error(`[Oracle Bridge] Request failed: ${error.message}, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error('Oracle service unavailable after retries');
  }

  async get(path: string, params?: Record<string, any>): Promise<any> {
    const query = params ? '?' + new URLSearchParams(
      Object.entries(params).flatMap(([k, v]) =>
        v === undefined ? [] : [[k, String(v)]] as [string, string][]
      )
    ).toString() : '';
    return this.request('GET', path + query);
  }

  async post(path: string, body: any): Promise<any> {
    return this.request('POST', path, body);
  }

  async patch(path: string, body: any): Promise<any> {
    return this.request('PATCH', path, body);
  }
}

// Initialize MCP server and HTTP client
const server = new Server(
  {
    name: 'oracle-mcp-http',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const client = new OracleHttpClient(ORACLE_API_URL, ORACLE_AUTH_TOKEN, ORACLE_TIMEOUT);

console.error(`[Oracle Bridge] Initialized`);
console.error(`[Oracle Bridge] URL: ${ORACLE_API_URL}`);
console.error(`[Oracle Bridge] Auth: ${ORACLE_AUTH_TOKEN ? 'enabled' : 'disabled'}`);
console.error(`[Oracle Bridge] Read-only: ${ORACLE_READ_ONLY ? 'yes' : 'no'}`);
console.error(`[Oracle Bridge] Timeout: ${ORACLE_TIMEOUT}ms`);

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: ORACLE_TOOLS,
  };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    let result: any;

    switch (name) {
      // Search tools
      case 'oracle_search':
        result = await client.get('/api/search', {
          q: args.q,
          type: args.type,
          limit: args.limit,
          offset: args.offset,
          mode: args.mode,
          project: args.project,
          layer: args.layer,
        });
        break;

      case 'oracle_consult':
        result = await client.get('/api/consult', {
          q: args.q,
          context: args.context,
        });
        break;

      case 'oracle_reflect':
        result = await client.get('/api/reflect');
        break;

      case 'oracle_list':
        result = await client.get('/api/list', {
          type: args.type,
          limit: args.limit,
          offset: args.offset,
          group: args.group,
        });
        break;

      case 'oracle_stats':
        result = await client.get('/api/stats');
        break;

      case 'oracle_doc':
        result = await client.get(`/api/doc/${args.id}`);
        break;

      case 'oracle_context':
        result = await client.get('/api/context', {
          cwd: args.cwd,
        });
        break;

      // Write tools (only if not read-only)
      case 'oracle_learn':
        if (ORACLE_READ_ONLY) {
          throw new Error('Write operations are disabled in read-only mode');
        }
        result = await client.post('/api/learn', {
          pattern: args.pattern,
          source: args.source,
          concepts: args.concepts,
          origin: args.origin,
          project: args.project,
          cwd: args.cwd,
          layer: args.layer,
        });
        break;

      case 'oracle_thread_create':
        if (ORACLE_READ_ONLY) {
          throw new Error('Write operations are disabled in read-only mode');
        }
        result = await client.post('/api/thread', {
          message: args.message,
          thread_id: args.thread_id,
          title: args.title,
          role: args.role,
        });
        break;

      case 'oracle_thread':
        result = await client.get(`/api/thread/${args.id}`);
        break;

      case 'oracle_thread_update':
        if (ORACLE_READ_ONLY) {
          throw new Error('Write operations are disabled in read-only mode');
        }
        result = await client.patch(`/api/thread/${args.id}/status`, {
          status: args.status,
        });
        break;

      case 'oracle_threads':
        result = await client.get('/api/threads', {
          status: args.status,
          limit: args.limit,
          offset: args.offset,
        });
        break;

      case 'oracle_decisions':
        result = await client.get('/api/decisions', {
          status: args.status,
          project: args.project,
          tags: args.tags,
          limit: args.limit,
          offset: args.offset,
        });
        break;

      case 'oracle_decision':
        result = await client.get(`/api/decisions/${args.id}`);
        break;

      case 'oracle_decision_create':
        if (ORACLE_READ_ONLY) {
          throw new Error('Write operations are disabled in read-only mode');
        }
        result = await client.post('/api/decisions', {
          title: args.title,
          context: args.context,
          options: args.options,
          tags: args.tags,
          project: args.project,
        });
        break;

      case 'oracle_decision_update':
        if (ORACLE_READ_ONLY) {
          throw new Error('Write operations are disabled in read-only mode');
        }
        result = await client.patch(`/api/decisions/${args.id}`, {
          title: args.title,
          context: args.context,
          options: args.options,
          decision: args.decision,
          rationale: args.rationale,
          tags: args.tags,
          status: args.status,
          decided_by: args.decided_by,
        });
        break;

      case 'oracle_traces':
        result = await client.get('/api/traces', {
          query: args.query,
          status: args.status,
          project: args.project,
          limit: args.limit,
          offset: args.offset,
        });
        break;

      case 'oracle_trace':
        result = await client.get(`/api/traces/${args.id}`);
        break;

      case 'oracle_supersede':
        if (ORACLE_READ_ONLY) {
          throw new Error('Write operations are disabled in read-only mode');
        }
        result = await client.post('/api/supersede', {
          old_path: args.old_path,
          old_id: args.old_id,
          old_title: args.old_title,
          old_type: args.old_type,
          new_path: args.new_path,
          new_id: args.new_id,
          new_title: args.new_title,
          reason: args.reason,
          superseded_by: args.superseded_by,
          project: args.project,
        });
        break;

      // --- Five-Layer Memory tools ---

      // User Model (Layer 1) - read
      case 'oracle_user_model':
        result = await client.get('/api/user-model', {
          userId: args.userId,
        });
        break;

      // User Model (Layer 1) - write
      case 'oracle_user_model_update':
        if (ORACLE_READ_ONLY) {
          throw new Error('Write operations are disabled in read-only mode');
        }
        {
          const { userId, ...updates } = args as any;
          result = await client.post('/api/user-model', {
            userId: userId || 'default',
            updates,
          });
        }
        break;

      // Procedural Memory (Layer 2) - read
      case 'oracle_procedural_search':
        result = await client.get('/api/procedural', {
          q: args.q,
          limit: args.limit,
        });
        break;

      // Procedural Memory (Layer 2) - write
      case 'oracle_procedural_learn':
        if (ORACLE_READ_ONLY) {
          throw new Error('Write operations are disabled in read-only mode');
        }
        result = await client.post('/api/procedural', {
          trigger: args.trigger,
          procedure: args.procedure,
          source: args.source,
        });
        break;

      // Procedural Memory (Layer 2) - usage tracking
      case 'oracle_procedural_usage':
        if (ORACLE_READ_ONLY) {
          throw new Error('Write operations are disabled in read-only mode');
        }
        result = await client.post('/api/procedural/usage', {
          id: args.id,
        });
        break;

      // Episodic Memory (Layer 4) - read
      case 'oracle_episodic_search':
        result = await client.get('/api/episodic', {
          q: args.q,
          userId: args.userId,
          limit: args.limit,
        });
        break;

      // Episodic Memory (Layer 4) - write
      case 'oracle_episodic_record':
        if (ORACLE_READ_ONLY) {
          throw new Error('Write operations are disabled in read-only mode');
        }
        result = await client.post('/api/episodic', {
          summary: args.summary,
          userId: args.userId,
          groupId: args.groupId,
          topics: args.topics,
          outcome: args.outcome,
          durationMs: args.durationMs,
        });
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error: any) {
    console.error(`[Oracle Bridge] Tool ${name} failed: ${error.message}`);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[Oracle Bridge] MCP server running on stdio');
}

main().catch((error) => {
  console.error('[Oracle Bridge] Fatal error:', error);
  process.exit(1);
});

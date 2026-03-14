/**
 * Oracle MCP Server Factory
 *
 * Creates MCP server instances for SSE transport.
 * Reuses shared database connections and ChromaDB client.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Database } from 'bun:sqlite';
import { drizzle, BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { eq, sql, and, or, like, desc, gt } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { applySqlitePragmaPolicy } from '../../db/sqlite-policy.js';
import { oracleDocuments, consultLog, learnLog, searchLog, supersedeLog, traceLog } from '../../db/schema.js';
import { ChromaHttpClient } from '../../chroma-http.js';
import path from 'path';
import { homedir } from 'os';
import fs from 'fs';

import {
  handleThreadMessage,
  listThreads,
  getFullThread,
  updateThreadStatus,
} from '../../forum/handler.js';

import {
  createDecision,
  getDecision,
  updateDecision,
  listDecisions,
} from '../../decisions/handler.js';

import type { DecisionStatus } from '../../decisions/types.js';

import {
  createTrace,
  getTrace,
  listTraces,
  getTraceChain,
  linkTraces,
} from '../../trace/handler.js';
import { parseStoredConcepts, serializeStoredConcepts } from '../concepts-codec.js';

import { logSearch } from '../logging.js';
import { detectProject } from '../project-detect.js';

// Singleton database connections
let sqliteInstance: Database | null = null;
let dbInstance: BunSQLiteDatabase<typeof schema> | null = null;
let chromaClientInstance: ChromaHttpClient | null = null;
let chromaStatus: 'unknown' | 'connected' | 'unavailable' = 'unknown';

/**
 * Get or create singleton database connections
 */
function getSharedResources() {
  if (!sqliteInstance) {
    const userHome = process.env.HOME || process.env.USERPROFILE || homedir();
    const oracleDataDir = process.env.ORACLE_DATA_DIR || path.join(userHome, '.oracle-v2');
    const dbPath = process.env.ORACLE_DB_PATH || path.join(oracleDataDir, 'oracle.db');

    sqliteInstance = new Database(dbPath);
    applySqlitePragmaPolicy(sqliteInstance, 'mcp-sse-factory');
    dbInstance = drizzle(sqliteInstance, { schema });
  }

  if (!chromaClientInstance) {
    chromaClientInstance = new ChromaHttpClient(
      'oracle_knowledge',
      process.env.CHROMA_URL || 'http://localhost:8000',
      process.env.CHROMA_AUTH_TOKEN,
    );
  }

  return {
    sqlite: sqliteInstance,
    db: dbInstance!,
    chromaClient: chromaClientInstance,
  };
}

/**
 * Verify ChromaDB connection health
 */
async function verifyChromaHealth(): Promise<void> {
  const { chromaClient } = getSharedResources();
  try {
    const stats = await chromaClient.getStats();
    chromaStatus = stats.count > 0 ? 'connected' : 'connected';
  } catch {
    chromaStatus = 'unavailable';
  }
}

// Verify on module load
verifyChromaHealth();

// Write tools that should be disabled in read-only mode
const WRITE_TOOLS = [
  'oracle_learn',
  'oracle_thread',
  'oracle_thread_update',
  'oracle_decisions_create',
  'oracle_decisions_update',
  'oracle_trace',
  'oracle_supersede',
];

// Tool definitions (copied from OracleMCPServer for now)
const TOOL_DEFINITIONS = [
  {
    name: '____IMPORTANT',
    description: `ORACLE WORKFLOW GUIDE:

1. SEARCH & DISCOVER
   oracle_search(query) → Find knowledge by keywords/vectors
   oracle_list() → Browse all documents
   oracle_concepts() → See topic coverage

2. CONSULT & REFLECT
   oracle_consult(decision) → Get guidance for decisions
   oracle_reflect() → Random wisdom for alignment

3. LEARN & REMEMBER
   oracle_learn(pattern) → Add new patterns/learnings
   oracle_thread(message) → Multi-turn discussions
   ⚠️ BEFORE adding: search for similar topics first!
   If updating old info → use oracle_supersede(oldId, newId)

4. TRACE & DISTILL
   oracle_trace(query) → Log discovery sessions with dig points
   oracle_trace_list() → Find past traces
   oracle_trace_get(id) → Explore dig points (files, commits, issues)
   oracle_trace_link(prevId, nextId) → Chain related traces together
   oracle_trace_chain(id) → View the full linked chain

5. DECIDE & TRACK
   oracle_decisions_create() → Track important decisions
   oracle_decisions_list() → Review pending decisions

6. SUPERSEDE (when info changes)
   oracle_supersede(oldId, newId, reason) → Mark old doc as outdated
   "Nothing is Deleted" — old preserved, just marked superseded

Philosophy: "Nothing is Deleted" — All interactions logged.`,
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'oracle_search',
    description: 'Search Oracle knowledge base using hybrid search (FTS5 keywords + ChromaDB vectors). Finds relevant principles, patterns, learnings, or retrospectives.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        type: { type: 'string', enum: ['principle', 'pattern', 'learning', 'retro', 'all'], default: 'all' },
        limit: { type: 'number', default: 5 },
        offset: { type: 'number', default: 0 },
        mode: { type: 'string', enum: ['hybrid', 'fts', 'vector'], default: 'hybrid' }
      },
      required: ['query']
    }
  },
  {
    name: 'oracle_consult',
    description: 'Get guidance on a decision based on Oracle philosophy.',
    inputSchema: {
      type: 'object',
      properties: {
        decision: { type: 'string', description: 'The decision you need to make' },
        context: { type: 'string', description: 'Additional context' }
      },
      required: ['decision']
    }
  },
  {
    name: 'oracle_reflect',
    description: 'Get a random principle or learning for reflection.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'oracle_learn',
    description: 'Add a new pattern or learning to the Oracle knowledge base.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'The pattern or learning to add' },
        source: { type: 'string', description: 'Optional source attribution' },
        concepts: { type: 'array', items: { type: 'string' }, description: 'Optional concept tags' },
        project: { type: 'string', description: 'Source project' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'oracle_list',
    description: 'List all documents in Oracle knowledge base.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['principle', 'pattern', 'learning', 'retro', 'all'], default: 'all' },
        limit: { type: 'number', default: 10 },
        offset: { type: 'number', default: 0 }
      }
    }
  },
  {
    name: 'oracle_stats',
    description: 'Get Oracle knowledge base statistics.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'oracle_concepts',
    description: 'List all concept tags in the Oracle knowledge base.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 50 },
        type: { type: 'string', enum: ['principle', 'pattern', 'learning', 'retro', 'all'], default: 'all' }
      }
    }
  },
  {
    name: 'oracle_thread',
    description: 'Send a message to an Oracle discussion thread.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Your question or message' },
        threadId: { type: 'number', description: 'Thread ID to continue' },
        title: { type: 'string', description: 'Title for new thread' },
        role: { type: 'string', enum: ['human', 'claude'], default: 'human' },
        model: { type: 'string', description: 'Model name for Claude calls' }
      },
      required: ['message']
    }
  },
  {
    name: 'oracle_threads',
    description: 'List Oracle discussion threads.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'answered', 'pending', 'closed'] },
        limit: { type: 'number', default: 20 },
        offset: { type: 'number', default: 0 }
      }
    }
  },
  {
    name: 'oracle_thread_read',
    description: 'Read full message history from a thread.',
    inputSchema: {
      type: 'object',
      properties: {
        threadId: { type: 'number', description: 'Thread ID to read' },
        limit: { type: 'number' }
      },
      required: ['threadId']
    }
  },
  {
    name: 'oracle_thread_update',
    description: 'Update thread status.',
    inputSchema: {
      type: 'object',
      properties: {
        threadId: { type: 'number' },
        status: { type: 'string', enum: ['active', 'closed', 'answered', 'pending'] }
      },
      required: ['threadId', 'status']
    }
  },
  {
    name: 'oracle_decisions_list',
    description: 'List decisions with optional filters.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'parked', 'researching', 'decided', 'implemented', 'closed'] },
        project: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        limit: { type: 'number', default: 20 },
        offset: { type: 'number', default: 0 }
      }
    }
  },
  {
    name: 'oracle_decisions_create',
    description: 'Create a new decision to track.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        context: { type: 'string' },
        options: { type: 'array', items: { type: 'object' } },
        tags: { type: 'array', items: { type: 'string' } },
        project: { type: 'string' }
      },
      required: ['title']
    }
  },
  {
    name: 'oracle_decisions_get',
    description: 'Get a single decision with full details.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id']
    }
  },
  {
    name: 'oracle_decisions_update',
    description: 'Update a decision.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        title: { type: 'string' },
        context: { type: 'string' },
        options: { type: 'array', items: { type: 'object' } },
        decision: { type: 'string' },
        rationale: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        status: { type: 'string' },
        decidedBy: { type: 'string' }
      },
      required: ['id']
    }
  },
  {
    name: 'oracle_trace',
    description: 'Log a trace session with dig points.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        queryType: { type: 'string', enum: ['general', 'project', 'pattern', 'evolution'] },
        project: { type: 'string' },
        foundFiles: { type: 'array' },
        foundCommits: { type: 'array' },
        foundIssues: { type: 'array' },
        foundRetrospectives: { type: 'array' },
        foundLearnings: { type: 'array' },
        parentTraceId: { type: 'string' },
        agentCount: { type: 'number' },
        durationMs: { type: 'number' }
      },
      required: ['query']
    }
  },
  {
    name: 'oracle_trace_list',
    description: 'List recent traces.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        project: { type: 'string' },
        status: { type: 'string', enum: ['raw', 'reviewed', 'distilling', 'distilled'] },
        depth: { type: 'number' },
        limit: { type: 'number', default: 20 },
        offset: { type: 'number', default: 0 }
      }
    }
  },
  {
    name: 'oracle_trace_get',
    description: 'Get full details of a specific trace.',
    inputSchema: {
      type: 'object',
      properties: {
        traceId: { type: 'string' },
        includeChain: { type: 'boolean' }
      },
      required: ['traceId']
    }
  },
  {
    name: 'oracle_trace_link',
    description: 'Link two traces as a chain.',
    inputSchema: {
      type: 'object',
      properties: {
        prevTraceId: { type: 'string' },
        nextTraceId: { type: 'string' }
      },
      required: ['prevTraceId', 'nextTraceId']
    }
  },
  {
    name: 'oracle_trace_chain',
    description: 'Get the full linked chain for a trace.',
    inputSchema: {
      type: 'object',
      properties: { traceId: { type: 'string' } },
      required: ['traceId']
    }
  },
  {
    name: 'oracle_supersede',
    description: 'Mark an old learning/document as superseded.',
    inputSchema: {
      type: 'object',
      properties: {
        oldId: { type: 'string' },
        newId: { type: 'string' },
        reason: { type: 'string' }
      },
      required: ['oldId', 'newId']
    }
  },
];

/**
 * Tool handler function type
 */
export type ToolHandler = (args: Record<string, any>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

/**
 * Get tool handlers map (for direct invocation without MCP Server)
 */
export function getToolHandlers(): Map<string, ToolHandler> {
  const { sqlite, db, chromaClient } = getSharedResources();
  const readOnly = process.env.ORACLE_READ_ONLY === 'true';
  const repoRoot = process.env.ORACLE_REPO_ROOT || process.cwd();

  const handlers = new Map<string, ToolHandler>();

  // oracle_search
  handlers.set('oracle_search', async (args) => {
    const { query, type = 'all', limit = 5, offset = 0, mode = 'hybrid' } = args;
    const startTime = Date.now();
    const result = handleOracleSearch(sqlite, chromaClient, query, type, limit, offset, mode, chromaStatus);
    logSearch(query, type, mode, result.results.length, Date.now() - startTime);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  // oracle_consult
  handlers.set('oracle_consult', async (args) => {
    const { decision, context } = args;
    const result = handleOracleConsult(sqlite, decision, context);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  // oracle_reflect
  handlers.set('oracle_reflect', async () => {
    const result = handleOracleReflect(sqlite);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  // oracle_learn
  handlers.set('oracle_learn', async (args) => {
    if (readOnly) {
      return { content: [{ type: 'text', text: 'Tool "oracle_learn" is disabled in read-only mode.' }], isError: true };
    }
    const { pattern, source, concepts, project } = args;
    const result = handleOracleLearn(sqlite, db, repoRoot, pattern, source, concepts, project);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  // oracle_list
  handlers.set('oracle_list', async (args) => {
    const { type = 'all', limit = 10, offset = 0 } = args;
    const result = handleOracleList(sqlite, type, limit, offset);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  // oracle_stats
  handlers.set('oracle_stats', async () => {
    const result = handleOracleStats(sqlite, chromaStatus);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  // oracle_concepts
  handlers.set('oracle_concepts', async (args) => {
    const { limit = 50, type = 'all' } = args;
    const result = handleOracleConcepts(sqlite, limit, type);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  // oracle_thread
  handlers.set('oracle_thread', async (args) => {
    if (readOnly) {
      return { content: [{ type: 'text', text: 'Tool "oracle_thread" is disabled in read-only mode.' }], isError: true };
    }
    const { message, threadId, title, role = 'human', model } = args;
    const result = await handleThreadMessage({ message, threadId, title, role, model });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  // oracle_threads
  handlers.set('oracle_threads', async (args) => {
    const { status, limit = 20, offset = 0 } = args;
    const result = listThreads({ status, limit, offset });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  // oracle_thread_read
  handlers.set('oracle_thread_read', async (args) => {
    const { threadId, limit } = args;
    const threadData = getFullThread(threadId);
    if (!threadData) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Thread not found' }) }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify(threadData, null, 2) }] };
  });

  // oracle_thread_update
  handlers.set('oracle_thread_update', async (args) => {
    if (readOnly) {
      return { content: [{ type: 'text', text: 'Tool "oracle_thread_update" is disabled in read-only mode.' }], isError: true };
    }
    const { threadId, status } = args;
    updateThreadStatus(threadId, status);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, threadId, status }) }] };
  });

  // oracle_decisions_list
  handlers.set('oracle_decisions_list', async (args) => {
    const { status, project, tags, limit = 20, offset = 0 } = args;
    const result = listDecisions({ status: status as DecisionStatus, project, tags, limit, offset });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  // oracle_decisions_create
  handlers.set('oracle_decisions_create', async (args) => {
    if (readOnly) {
      return { content: [{ type: 'text', text: 'Tool "oracle_decisions_create" is disabled in read-only mode.' }], isError: true };
    }
    const { title, context, options, tags, project } = args;
    const result = createDecision({ title, context, options, tags, project });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  // oracle_decisions_get
  handlers.set('oracle_decisions_get', async (args) => {
    const { id } = args;
    const result = getDecision(id);
    if (!result) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Decision not found' }) }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  // oracle_decisions_update
  handlers.set('oracle_decisions_update', async (args) => {
    if (readOnly) {
      return { content: [{ type: 'text', text: 'Tool "oracle_decisions_update" is disabled in read-only mode.' }], isError: true };
    }
    const { id, ...updateData } = args;
    const result = updateDecision({ id, ...updateData });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  // oracle_trace
  handlers.set('oracle_trace', async (args) => {
    if (readOnly) {
      return { content: [{ type: 'text', text: 'Tool "oracle_trace" is disabled in read-only mode.' }], isError: true };
    }
    const result = createTrace({
      query: args.query,
      queryType: args.queryType,
      project: args.project,
      foundFiles: args.foundFiles,
      foundCommits: args.foundCommits,
      foundIssues: args.foundIssues,
      foundRetrospectives: args.foundRetrospectives,
      foundLearnings: args.foundLearnings,
      parentTraceId: args.parentTraceId,
      agentCount: args.agentCount,
      durationMs: args.durationMs,
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  // oracle_trace_list
  handlers.set('oracle_trace_list', async (args) => {
    const { query, project, status, depth, limit = 20, offset = 0 } = args;
    const result = listTraces({ query, project, status, depth, limit, offset });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  // oracle_trace_get
  handlers.set('oracle_trace_get', async (args) => {
    const { traceId, includeChain } = args;
    const result = getTrace(traceId);
    if (!result) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Trace not found' }) }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  // oracle_trace_link
  handlers.set('oracle_trace_link', async (args) => {
    const { prevTraceId, nextTraceId } = args;
    const result = linkTraces(prevTraceId, nextTraceId);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  // oracle_trace_chain
  handlers.set('oracle_trace_chain', async (args) => {
    const { traceId } = args;
    const result = getTraceChain(traceId);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  // oracle_supersede
  handlers.set('oracle_supersede', async (args) => {
    if (readOnly) {
      return { content: [{ type: 'text', text: 'Tool "oracle_supersede" is disabled in read-only mode.' }], isError: true };
    }
    const { oldId, newId, reason } = args;
    const oldDoc = sqlite.prepare('SELECT source_file FROM oracle_documents WHERE id = ?').get(oldId) as any;
    const newDoc = sqlite.prepare('SELECT source_file FROM oracle_documents WHERE id = ?').get(newId) as any;

    if (!oldDoc || !newDoc) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Document not found' }) }], isError: true };
    }

    db.insert(supersedeLog).values({
      oldPath: oldDoc.source_file,
      oldId,
      newPath: newDoc.source_file,
      newId,
      reason: reason || null,
      supersededAt: Date.now(),
      supersededBy: 'mcp-sync',
    }).run();

    sqlite.prepare('UPDATE oracle_documents SET superseded_by = ?, superseded_at = ?, superseded_reason = ? WHERE id = ?')
      .run(newId, Date.now(), reason || null, oldId);

    return { content: [{ type: 'text', text: JSON.stringify({ success: true, oldId, newId }) }] };
  });

  return handlers;
}

/**
 * Get tool definitions (for listing tools)
 */
export function getToolDefinitions() {
  const readOnly = process.env.ORACLE_READ_ONLY === 'true';
  return readOnly
    ? TOOL_DEFINITIONS.filter(t => !WRITE_TOOLS.includes(t.name))
    : TOOL_DEFINITIONS;
}

/**
 * Create MCP server instance with handlers
 */
export function createMcpServerWithHandlers(): Server {
  const { sqlite, db, chromaClient } = getSharedResources();
  const readOnly = process.env.ORACLE_READ_ONLY === 'true';

  const server = new Server(
    {
      name: 'oracle-nightly-sse',
      version: '0.7.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Setup error handling
  server.onerror = (error) => {
    console.error('[MCP SSE Error]', error);
  };

  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = readOnly
      ? TOOL_DEFINITIONS.filter(t => !WRITE_TOOLS.includes(t.name))
      : TOOL_DEFINITIONS;
    return { tools };
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const repoRoot = process.env.ORACLE_REPO_ROOT || process.cwd();

    // Check read-only mode
    if (readOnly && WRITE_TOOLS.includes(name)) {
      return {
        content: [{
          type: 'text',
          text: `Tool "${name}" is disabled in read-only mode.`,
        }],
        isError: true,
      };
    }

    try {
      switch (name) {
        case 'oracle_search': {
          const { query, type = 'all', limit = 5, offset = 0, mode = 'hybrid' } = args as any;
          const startTime = Date.now();
          const result = handleOracleSearch(sqlite, chromaClient, query, type, limit, offset, mode, chromaStatus);
          logSearch(query, type, mode, result.results.length, Date.now() - startTime);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'oracle_consult': {
          const { decision, context } = args as any;
          const result = handleOracleConsult(sqlite, decision, context);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'oracle_reflect': {
          const result = handleOracleReflect(sqlite);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'oracle_learn': {
          const { pattern, source, concepts, project } = args as any;
          const result = handleOracleLearn(sqlite, db, repoRoot, pattern, source, concepts, project);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'oracle_list': {
          const { type = 'all', limit = 10, offset = 0 } = args as any;
          const result = handleOracleList(sqlite, type, limit, offset);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'oracle_stats': {
          const result = handleOracleStats(sqlite, chromaStatus);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'oracle_concepts': {
          const { limit = 50, type = 'all' } = args as any;
          const result = handleOracleConcepts(sqlite, limit, type);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'oracle_thread': {
          const { message, threadId, title, role = 'human', model } = args as any;
          const result = await handleThreadMessage({ message, threadId, title, role, model });
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'oracle_threads': {
          const { status, limit = 20, offset = 0 } = args as any;
          const result = listThreads({ status, limit, offset });
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'oracle_thread_read': {
          const { threadId, limit } = args as any;
          const threadData = getFullThread(threadId);
          if (!threadData) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'Thread not found' }) }], isError: true };
          }
          return { content: [{ type: 'text', text: JSON.stringify(threadData, null, 2) }] };
        }

        case 'oracle_thread_update': {
          const { threadId, status } = args as any;
          updateThreadStatus(threadId, status);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, threadId, status }) }] };
        }

        case 'oracle_decisions_list': {
          const { status, project, tags, limit = 20, offset = 0 } = args as any;
          const result = listDecisions({ status: status as DecisionStatus, project, tags, limit, offset });
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'oracle_decisions_create': {
          const { title, context, options, tags, project } = args as any;
          const result = createDecision({ title, context, options, tags, project });
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'oracle_decisions_get': {
          const { id } = args as any;
          const result = getDecision(id);
          if (!result) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'Decision not found' }) }], isError: true };
          }
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'oracle_decisions_update': {
          const { id, ...updateData } = args as any;
          const result = updateDecision({ id, ...updateData });
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'oracle_trace': {
          const input = args as any;
          const result = createTrace({
            query: input.query,
            queryType: input.queryType,
            project: input.project,
            foundFiles: input.foundFiles,
            foundCommits: input.foundCommits,
            foundIssues: input.foundIssues,
            foundRetrospectives: input.foundRetrospectives,
            foundLearnings: input.foundLearnings,
            parentTraceId: input.parentTraceId,
            agentCount: input.agentCount,
            durationMs: input.durationMs,
          });
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'oracle_trace_list': {
          const { query, project, status, depth, limit = 20, offset = 0 } = args as any;
          const result = listTraces({ query, project, status, depth, limit, offset });
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'oracle_trace_get': {
          const { traceId, includeChain } = args as any;
          const result = getTrace(traceId);
          if (!result) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'Trace not found' }) }], isError: true };
          }
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'oracle_trace_link': {
          const { prevTraceId, nextTraceId } = args as any;
          const result = linkTraces(prevTraceId, nextTraceId);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'oracle_trace_chain': {
          const { traceId } = args as any;
          const result = getTraceChain(traceId);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'oracle_supersede': {
          const { oldId, newId, reason } = args as any;
          // Get document paths
          const oldDoc = sqlite.prepare('SELECT source_file FROM oracle_documents WHERE id = ?').get(oldId) as any;
          const newDoc = sqlite.prepare('SELECT source_file FROM oracle_documents WHERE id = ?').get(newId) as any;

          if (!oldDoc || !newDoc) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'Document not found' }) }], isError: true };
          }

          // Log supersession
          db.insert(supersedeLog).values({
            oldPath: oldDoc.source_file,
            oldId,
            newPath: newDoc.source_file,
            newId,
            reason: reason || null,
            supersededAt: Date.now(),
            supersededBy: 'mcp-sse',
          }).run();

          // Update document
          sqlite.prepare('UPDATE oracle_documents SET superseded_by = ?, superseded_at = ?, superseded_reason = ? WHERE id = ?')
            .run(newId, Date.now(), reason || null, oldId);

          return { content: [{ type: 'text', text: JSON.stringify({ success: true, oldId, newId }) }] };
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
        }],
        isError: true,
      };
    }
  });

  return server;
}

// Helper functions using raw SQLite for FTS operations

function handleOracleSearch(
  sqlite: Database,
  chromaClient: ChromaHttpClient,
  query: string,
  type: string,
  limit: number,
  offset: number,
  mode: string,
  chromaStatus: string
) {
  // Sanitize FTS5 special chars
  const safeQuery = query.replace(/[?*+\-()^~"':.\/ ]/g, ' ').replace(/\s+/g, ' ').trim() || query;

  // FTS5 search — JOIN with oracle_documents to get type/source_file
  const typeFilter = type !== 'all' ? `AND d.type = '${type}'` : '';
  const ftsQuery = sqlite.prepare(`
    SELECT f.id, d.type, f.content, d.source_file, d.concepts, rank as score
    FROM oracle_fts f
    JOIN oracle_documents d ON f.id = d.id
    WHERE oracle_fts MATCH ? ${typeFilter}
    ORDER BY rank
    LIMIT ? OFFSET ?
  `);

  let ftsResults: any[] = [];
  try {
    ftsResults = ftsQuery.all(safeQuery, limit, offset);
  } catch {
    // FTS query error, return empty
  }

  const results = ftsResults.map((r: any) => ({
    id: r.id,
    type: r.type,
    content: r.content?.substring(0, 500) ?? '',
    source_file: r.source_file,
    concepts: parseStoredConcepts(r.concepts),
    score: r.score,
    source: 'fts',
  }));

  return {
    results,
    mode: 'fts',
    chromaStatus,
    query,
  };
}

function handleOracleConsult(
  sqlite: Database,
  decision: string,
  context?: string
) {
  const query = context ? `${decision} ${context}` : decision;
  const safeQuery = query.replace(/[?*+\-()^~"':.\/ ]/g, ' ').replace(/\s+/g, ' ').trim() || query;

  // JOIN oracle_fts with oracle_documents to filter by type
  const ftsQuery = sqlite.prepare(`
    SELECT f.id, d.type, f.content, d.source_file
    FROM oracle_fts f
    JOIN oracle_documents d ON f.id = d.id
    WHERE oracle_fts MATCH ?
    AND d.type IN ('principle', 'pattern')
    ORDER BY rank
    LIMIT 5
  `);

  let relevant: any[] = [];
  try {
    relevant = ftsQuery.all(safeQuery);
  } catch {
    // FTS error
  }

  return {
    decision,
    context,
    relevant_docs: relevant.map((r: any) => ({
      id: r.id,
      type: r.type,
      content: r.content?.substring(0, 300) ?? '',
      source: r.source_file,
    })),
    guidance: relevant.length > 0
      ? `Based on ${relevant.length} relevant documents, consider the principles and patterns above.`
      : 'No specific guidance found. Consider adding relevant principles to the knowledge base.',
  };
}

function handleOracleReflect(sqlite: Database) {
  const countQuery = sqlite.prepare(`SELECT COUNT(*) as count FROM oracle_documents`);
  const { count } = countQuery.get() as any;

  if (count === 0) {
    return { message: 'No documents in knowledge base yet.' };
  }

  // oracle_documents has no title/content — fetch meta then get content from oracle_fts
  const randomQuery = sqlite.prepare(`
    SELECT id, type, source_file, concepts
    FROM oracle_documents
    WHERE type IN ('principle', 'learning')
    ORDER BY RANDOM()
    LIMIT 1
  `);

  const doc = randomQuery.get() as any;
  if (!doc) return { message: 'No documents in knowledge base yet.' };

  const ftsRow = sqlite.prepare(`SELECT content FROM oracle_fts WHERE id = ?`).get(doc.id) as any;

  return {
    reflection: {
      id: doc.id,
      type: doc.type,
      source_file: doc.source_file,
      concepts: parseStoredConcepts(doc.concepts),
      content: ftsRow?.content ?? '',
    },
    message: 'Here is a random piece of wisdom for reflection.',
  };
}

function handleOracleLearn(
  sqlite: Database,
  db: BunSQLiteDatabase<typeof schema>,
  repoRoot: string,
  pattern: string,
  source?: string,
  concepts?: string[],
  project?: string
) {
  const normalizedProject = detectProject(project || repoRoot);
  const conceptsList = parseStoredConcepts(concepts);
  const conceptsFrontmatter = conceptsList.join(', ');
  const storedConcepts = serializeStoredConcepts(conceptsList);
  const ftsConcepts = conceptsList.join(' ');

  // Generate ID and filename
  const id = `learning-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Create markdown file
  const learningsDir = path.join(repoRoot, 'ψ', 'memory', 'learnings');
  if (!fs.existsSync(learningsDir)) {
    fs.mkdirSync(learningsDir, { recursive: true });
  }

  const filename = `${id}.md`;
  const filepath = path.join(learningsDir, filename);
  const content = `---
id: ${id}
type: learning
concepts: [${conceptsFrontmatter}]
source: ${source || 'Oracle Learn'}
project: ${normalizedProject}
created: ${new Date().toISOString()}
---

# Learning

${pattern}
`;

  fs.writeFileSync(filepath, content);

  // Insert into database using Drizzle with correct schema
  db.insert(oracleDocuments).values({
    id,
    type: 'learning',
    sourceFile: filepath,
    concepts: storedConcepts,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    indexedAt: Date.now(),
  }).run();

  // Insert into FTS5 so search and oracle_list can find it
  sqlite.prepare(
    `INSERT OR REPLACE INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)`
  ).run(id, content, ftsConcepts);

  // Log learning with correct schema
  db.insert(learnLog).values({
    documentId: id,
    patternPreview: pattern.slice(0, 200),
    source: source || 'Oracle Learn',
    concepts: storedConcepts,
    createdAt: Date.now(),
  }).run();

  return {
    id,
    message: 'Learning added successfully',
    file: filepath,
  };
}

function handleOracleList(
  sqlite: Database,
  type: string,
  limit: number,
  offset: number
) {
  const typeFilter = type !== 'all' ? `WHERE d.type = '${type}'` : '';

  const countQuery = sqlite.prepare(
    type !== 'all'
      ? `SELECT COUNT(*) as count FROM oracle_documents WHERE type = '${type}'`
      : `SELECT COUNT(*) as count FROM oracle_documents`
  );
  const { count } = countQuery.get() as any;

  // JOIN with oracle_fts to get content (oracle_documents has no content/title columns)
  const dTypeFilter = type !== 'all' ? `WHERE d.type = '${type}'` : '';
  const listQuery = sqlite.prepare(`
    SELECT d.id, d.type, d.source_file, d.concepts, d.indexed_at, f.content
    FROM oracle_documents d
    JOIN oracle_fts f ON d.id = f.id
    ${dTypeFilter}
    ORDER BY d.indexed_at DESC
    LIMIT ? OFFSET ?
  `);

  const documents = listQuery.all(limit, offset) as any[];

  return {
    documents: documents.map((d: any) => ({
      id: d.id,
      type: d.type,
      title: d.content ? d.content.split('\n')[0].substring(0, 80) : d.id,
      content: d.content ? d.content.substring(0, 500) : '',
      concepts: parseStoredConcepts(d.concepts),
      source_file: d.source_file,
      indexed_at: d.indexed_at,
    })),
    total: count,
    limit,
    offset,
    type,
  };
}

function handleOracleStats(
  sqlite: Database,
  chromaStatus: string
) {
  const statsQuery = sqlite.prepare(`
    SELECT type, COUNT(*) as count
    FROM oracle_documents
    GROUP BY type
  `);

  const byType = statsQuery.all() as any[];

  const totalQuery = sqlite.prepare(`SELECT COUNT(*) as count FROM oracle_documents`);
  const { count: total } = totalQuery.get() as any;

  return {
    total_documents: total,
    by_type: byType.reduce((acc, r) => ({ ...acc, [r.type]: r.count }), {}),
    chroma_status: chromaStatus,
  };
}

function handleOracleConcepts(
  sqlite: Database,
  limit: number,
  type: string
) {
  const typeFilter = type !== 'all' ? `WHERE type = '${type}'` : '';

  const query = sqlite.prepare(`
    SELECT concepts FROM oracle_documents ${typeFilter}
  `);

  const rows = query.all() as any[];

  const conceptCounts: Record<string, number> = {};
  for (const row of rows) {
    const concepts = parseStoredConcepts(row.concepts);
    for (const concept of concepts) {
      conceptCounts[concept] = (conceptCounts[concept] || 0) + 1;
    }
  }

  const sorted = Object.entries(conceptCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([concept, count]) => ({ concept, count }));

  return {
    concepts: sorted,
    total_unique: Object.keys(conceptCounts).length,
  };
}

import type { Hono } from 'hono';
import { desc, eq, gt, sql } from 'drizzle-orm';

import {
  db,
  consultLog,
  learnLog,
  searchLog,
  supersedeLog,
} from '../../db/index.js';
import {
  handleDashboardActivity,
  handleDashboardGrowth,
  handleDashboardSummary,
} from '../dashboard.js';
import {
  getFullThread,
  getMessages,
  handleThreadMessage,
  listThreads,
  updateThreadStatus,
} from '../../forum/handler.js';
import {
  createDecision,
  getDecision,
  getDecisionCounts,
  listDecisions,
  transitionStatus,
  updateDecision,
} from '../../decisions/handler.js';
import {
  getTrace,
  getTraceChain,
  listTraces,
} from '../../trace/handler.js';
import { searchCache } from '../../cache.js';

export function registerAdminRoutes(app: Hono): void {
  app.get('/api/dashboard', (c) => c.json(handleDashboardSummary()));
  app.get('/api/dashboard/summary', (c) => c.json(handleDashboardSummary()));

  app.get('/api/dashboard/activity', (c) => {
    const days = Number.parseInt(c.req.query('days') || '7', 10);
    return c.json(handleDashboardActivity(days));
  });

  app.get('/api/dashboard/growth', (c) => {
    const period = c.req.query('period') || 'week';
    return c.json(handleDashboardGrowth(period));
  });

  app.get('/api/session/stats', (c) => {
    const since = c.req.query('since');
    const sinceTime = since
      ? Number.parseInt(since, 10)
      : Date.now() - 24 * 60 * 60 * 1000;

    const searches = db.select({ count: sql<number>`count(*)` })
      .from(searchLog)
      .where(gt(searchLog.createdAt, sinceTime))
      .get();

    const consultations = db.select({ count: sql<number>`count(*)` })
      .from(consultLog)
      .where(gt(consultLog.createdAt, sinceTime))
      .get();

    const learnings = db.select({ count: sql<number>`count(*)` })
      .from(learnLog)
      .where(gt(learnLog.createdAt, sinceTime))
      .get();

    return c.json({
      searches: searches?.count || 0,
      consultations: consultations?.count || 0,
      learnings: learnings?.count || 0,
      since: sinceTime,
    });
  });

  app.get('/api/threads', (c) => {
    const status = c.req.query('status') as any;
    const limit = Number.parseInt(c.req.query('limit') || '20', 10);
    const offset = Number.parseInt(c.req.query('offset') || '0', 10);

    const threadList = listThreads({ status, limit, offset });
    return c.json({
      threads: threadList.threads.map((thread) => ({
        id: thread.id,
        title: thread.title,
        status: thread.status,
        message_count: getMessages(thread.id).length,
        created_at: new Date(thread.createdAt).toISOString(),
        issue_url: thread.issueUrl,
      })),
      total: threadList.total,
    });
  });

  app.post('/api/thread', async (c) => {
    try {
      const data = await c.req.json();
      if (!data.message) {
        return c.json({ error: 'Missing required field: message' }, 400);
      }

      const result = await handleThreadMessage({
        message: data.message,
        threadId: data.thread_id,
        title: data.title,
        role: data.role || 'human',
      });

      return c.json({
        thread_id: result.threadId,
        message_id: result.messageId,
        status: result.status,
        oracle_response: result.oracleResponse,
        issue_url: result.issueUrl,
      });
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  });

  app.get('/api/thread/:id', (c) => {
    const threadId = Number.parseInt(c.req.param('id'), 10);
    if (Number.isNaN(threadId)) {
      return c.json({ error: 'Invalid thread ID' }, 400);
    }

    const threadData = getFullThread(threadId);
    if (!threadData) {
      return c.json({ error: 'Thread not found' }, 404);
    }

    return c.json({
      thread: {
        id: threadData.thread.id,
        title: threadData.thread.title,
        status: threadData.thread.status,
        created_at: new Date(threadData.thread.createdAt).toISOString(),
        issue_url: threadData.thread.issueUrl,
      },
      messages: threadData.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        author: message.author,
        principles_found: message.principlesFound,
        patterns_found: message.patternsFound,
        created_at: new Date(message.createdAt).toISOString(),
      })),
    });
  });

  app.patch('/api/thread/:id/status', async (c) => {
    const threadId = Number.parseInt(c.req.param('id'), 10);
    try {
      const data = await c.req.json();
      if (!data.status) {
        return c.json({ error: 'Missing required field: status' }, 400);
      }
      updateThreadStatus(threadId, data.status);
      return c.json({ success: true, thread_id: threadId, status: data.status });
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }
  });

  app.get('/api/decisions', (c) => {
    const status = c.req.query('status') as any;
    const project = c.req.query('project');
    const tagsRaw = c.req.query('tags');
    const tags = tagsRaw ? tagsRaw.split(',') : undefined;
    const limit = Number.parseInt(c.req.query('limit') || '20', 10);
    const offset = Number.parseInt(c.req.query('offset') || '0', 10);

    const result = listDecisions({ status, project, tags, limit, offset });
    return c.json({
      decisions: result.decisions.map((decision) => ({
        id: decision.id,
        title: decision.title,
        status: decision.status,
        context: decision.context,
        decision: decision.decision,
        project: decision.project,
        tags: decision.tags,
        created_at: new Date(decision.createdAt).toISOString(),
        updated_at: new Date(decision.updatedAt).toISOString(),
        decided_at: decision.decidedAt ? new Date(decision.decidedAt).toISOString() : null,
        decided_by: decision.decidedBy,
      })),
      total: result.total,
      counts: getDecisionCounts(),
    });
  });

  app.get('/api/decisions/:id', (c) => {
    const decisionId = Number.parseInt(c.req.param('id'), 10);
    const decision = getDecision(decisionId);

    if (!decision) {
      return c.json({ error: 'Decision not found' }, 404);
    }

    return c.json({
      id: decision.id,
      title: decision.title,
      status: decision.status,
      context: decision.context,
      options: decision.options,
      decision: decision.decision,
      rationale: decision.rationale,
      project: decision.project,
      tags: decision.tags,
      created_at: new Date(decision.createdAt).toISOString(),
      updated_at: new Date(decision.updatedAt).toISOString(),
      decided_at: decision.decidedAt ? new Date(decision.decidedAt).toISOString() : null,
      decided_by: decision.decidedBy,
    });
  });

  app.post('/api/decisions', async (c) => {
    try {
      const data = await c.req.json();
      if (!data.title) {
        return c.json({ error: 'Missing required field: title' }, 400);
      }

      const decision = createDecision({
        title: data.title,
        context: data.context,
        options: data.options,
        tags: data.tags,
        project: data.project,
      });

      return c.json({
        id: decision.id,
        title: decision.title,
        status: decision.status,
        created_at: new Date(decision.createdAt).toISOString(),
      }, 201);
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  });

  app.patch('/api/decisions/:id', async (c) => {
    const decisionId = Number.parseInt(c.req.param('id'), 10);
    try {
      const data = await c.req.json();
      const decision = updateDecision({
        id: decisionId,
        title: data.title,
        context: data.context,
        options: data.options,
        decision: data.decision,
        rationale: data.rationale,
        tags: data.tags,
        status: data.status,
        decidedBy: data.decided_by,
      });

      if (!decision) {
        return c.json({ error: 'Decision not found' }, 404);
      }

      return c.json({
        id: decision.id,
        title: decision.title,
        status: decision.status,
        updated_at: new Date(decision.updatedAt).toISOString(),
      });
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'Invalid request',
      }, 400);
    }
  });

  app.post('/api/decisions/:id/transition', async (c) => {
    const decisionId = Number.parseInt(c.req.param('id'), 10);
    try {
      const data = await c.req.json();
      if (!data.status) {
        return c.json({ error: 'Missing required field: status' }, 400);
      }
      const decision = transitionStatus(decisionId, data.status, data.decided_by);

      if (!decision) {
        return c.json({ error: 'Decision not found' }, 404);
      }

      return c.json({
        id: decision.id,
        title: decision.title,
        status: decision.status,
        decided_at: decision.decidedAt ? new Date(decision.decidedAt).toISOString() : null,
        decided_by: decision.decidedBy,
      });
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'Invalid request',
      }, 400);
    }
  });

  app.get('/api/supersede', (c) => {
    const project = c.req.query('project');
    const limit = Number.parseInt(c.req.query('limit') || '50', 10);
    const offset = Number.parseInt(c.req.query('offset') || '0', 10);

    const whereClause = project ? eq(supersedeLog.project, project) : undefined;
    const countResult = db.select({ total: sql<number>`count(*)` })
      .from(supersedeLog)
      .where(whereClause)
      .get();
    const total = countResult?.total || 0;

    const logs = db.select()
      .from(supersedeLog)
      .where(whereClause)
      .orderBy(desc(supersedeLog.supersededAt))
      .limit(limit)
      .offset(offset)
      .all();

    return c.json({
      supersessions: logs.map((log) => ({
        id: log.id,
        old_path: log.oldPath,
        old_id: log.oldId,
        old_title: log.oldTitle,
        old_type: log.oldType,
        new_path: log.newPath,
        new_id: log.newId,
        new_title: log.newTitle,
        reason: log.reason,
        superseded_at: new Date(log.supersededAt).toISOString(),
        superseded_by: log.supersededBy,
        project: log.project,
      })),
      total,
      limit,
      offset,
    });
  });

  app.get('/api/supersede/chain/:path', (c) => {
    const docPath = decodeURIComponent(c.req.param('path'));

    const asOld = db.select()
      .from(supersedeLog)
      .where(eq(supersedeLog.oldPath, docPath))
      .orderBy(supersedeLog.supersededAt)
      .all();

    const asNew = db.select()
      .from(supersedeLog)
      .where(eq(supersedeLog.newPath, docPath))
      .orderBy(supersedeLog.supersededAt)
      .all();

    return c.json({
      superseded_by: asOld.map((log) => ({
        new_path: log.newPath,
        reason: log.reason,
        superseded_at: new Date(log.supersededAt).toISOString(),
      })),
      supersedes: asNew.map((log) => ({
        old_path: log.oldPath,
        reason: log.reason,
        superseded_at: new Date(log.supersededAt).toISOString(),
      })),
    });
  });

  app.post('/api/supersede', async (c) => {
    try {
      const data = await c.req.json();
      if (!data.old_path) {
        return c.json({ error: 'Missing required field: old_path' }, 400);
      }

      const result = db.insert(supersedeLog).values({
        oldPath: data.old_path,
        oldId: data.old_id || null,
        oldTitle: data.old_title || null,
        oldType: data.old_type || null,
        newPath: data.new_path || null,
        newId: data.new_id || null,
        newTitle: data.new_title || null,
        reason: data.reason || null,
        supersededAt: Date.now(),
        supersededBy: data.superseded_by || 'user',
        project: data.project || null,
      }).returning({ id: supersedeLog.id }).get();

      searchCache.invalidate();

      return c.json({
        id: result.id,
        message: 'Supersession logged',
      }, 201);
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  });

  app.get('/api/traces', (c) => {
    const query = c.req.query('query');
    const status = c.req.query('status');
    const project = c.req.query('project');
    const limit = Number.parseInt(c.req.query('limit') || '50', 10);
    const offset = Number.parseInt(c.req.query('offset') || '0', 10);

    const result = listTraces({
      query: query || undefined,
      status: status as 'raw' | 'reviewed' | 'distilled' | undefined,
      project: project || undefined,
      limit,
      offset,
    });

    return c.json(result);
  });

  app.get('/api/traces/:id', (c) => {
    const traceId = c.req.param('id');
    const trace = getTrace(traceId);

    if (!trace) {
      return c.json({ error: 'Trace not found' }, 404);
    }

    return c.json(trace);
  });

  app.get('/api/traces/:id/chain', (c) => {
    const traceId = c.req.param('id');
    const direction = c.req.query('direction') as 'up' | 'down' | 'both' || 'both';

    const chain = getTraceChain(traceId, direction);
    return c.json(chain);
  });

  app.post('/api/traces/:prevId/link', async (c) => {
    try {
      const prevId = c.req.param('prevId');
      const { nextId } = await c.req.json();

      if (!nextId) {
        return c.json({ error: 'Missing nextId in request body' }, 400);
      }

      const { linkTraces } = await import('../../trace/handler.js');
      const result = linkTraces(prevId, nextId);

      if (!result.success) {
        return c.json({ error: result.message }, 400);
      }

      return c.json(result);
    } catch (err) {
      console.error('Link traces error:', err);
      return c.json({ error: 'Failed to link traces' }, 500);
    }
  });

  app.delete('/api/traces/:id/link', async (c) => {
    try {
      const traceId = c.req.param('id');
      const direction = c.req.query('direction') as 'prev' | 'next';

      if (!direction || !['prev', 'next'].includes(direction)) {
        return c.json({ error: 'Missing or invalid direction (prev|next)' }, 400);
      }

      const { unlinkTraces } = await import('../../trace/handler.js');
      const result = unlinkTraces(traceId, direction);

      if (!result.success) {
        return c.json({ error: result.message }, 400);
      }

      return c.json(result);
    } catch (err) {
      console.error('Unlink traces error:', err);
      return c.json({ error: 'Failed to unlink traces' }, 500);
    }
  });

  app.get('/api/traces/:id/linked-chain', async (c) => {
    try {
      const traceId = c.req.param('id');
      const { getTraceLinkedChain } = await import('../../trace/handler.js');
      const result = getTraceLinkedChain(traceId);
      return c.json(result);
    } catch (err) {
      console.error('Get linked chain error:', err);
      return c.json({ error: 'Failed to get linked chain' }, 500);
    }
  });
}

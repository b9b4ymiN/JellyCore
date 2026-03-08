import fs from 'fs';
import path from 'path';

import type { Hono } from 'hono';
import { desc } from 'drizzle-orm';

import { handleContext } from '../context.js';
import {
  handleConsult,
  handleGraph,
  handleLearn,
  handleList,
  handleReflect,
  handleSearch,
  handleStats,
} from '../handlers.js';
import { searchCache } from '../../cache.js';
import { db, searchLog, sqlite } from '../../db/index.js';

interface SearchRoutesOptions {
  dbPath: string;
  repoRoot: string;
}

export function registerSearchRoutes(app: Hono, options: SearchRoutesOptions): void {
  app.get('/api/search', async (c) => {
    const q = c.req.query('q');
    if (!q) {
      return c.json({ error: 'Missing query parameter: q' }, 400);
    }
    const type = c.req.query('type') || 'all';
    const limit = Number.parseInt(c.req.query('limit') || '10', 10);
    const offset = Number.parseInt(c.req.query('offset') || '0', 10);
    const mode = (c.req.query('mode') || 'hybrid') as 'hybrid' | 'fts' | 'vector';
    const project = c.req.query('project');
    const cwd = c.req.query('cwd');
    const layerParam = c.req.query('layer');
    const layerFilter = layerParam
      ? layerParam.split(',').map((layer) => layer.trim()).filter(Boolean)
      : undefined;

    const result = await handleSearch(q, type, limit, offset, mode, project, cwd, layerFilter);
    return c.json({ ...result, query: q });
  });

  app.get('/api/consult', async (c) => {
    const q = c.req.query('q');
    if (!q) {
      return c.json({ error: 'Missing query parameter: q (decision)' }, 400);
    }
    const context = c.req.query('context') || '';
    const result = await handleConsult(q, context);
    return c.json(result);
  });

  app.get('/api/reflect', (c) => c.json(handleReflect()));
  app.get('/api/stats', (c) => c.json(handleStats(options.dbPath)));
  app.get('/api/cache/stats', (c) => c.json(searchCache.stats));

  app.get('/api/logs', (c) => {
    try {
      const limit = Number.parseInt(c.req.query('limit') || '20', 10);
      const logs = db.select({
        query: searchLog.query,
        type: searchLog.type,
        mode: searchLog.mode,
        results_count: searchLog.resultsCount,
        search_time_ms: searchLog.searchTimeMs,
        created_at: searchLog.createdAt,
        project: searchLog.project,
      })
        .from(searchLog)
        .orderBy(desc(searchLog.createdAt))
        .limit(limit)
        .all();
      return c.json({ logs, total: logs.length });
    } catch {
      return c.json({ logs: [], error: 'Log table not found' });
    }
  });

  app.get('/api/doc/:id', (c) => {
    const docId = c.req.param('id');
    try {
      const row = sqlite.prepare(`
      SELECT d.id, d.type, d.source_file, d.concepts, d.project, f.content
      FROM oracle_documents d
      JOIN oracle_fts f ON d.id = f.id
      WHERE d.id = ?
    `).get(docId) as {
        id: string;
        type: string;
        source_file: string;
        concepts: string;
        project: string | null;
        content: string;
      } | undefined;

      if (!row) {
        return c.json({ error: 'Document not found' }, 404);
      }

      return c.json({
        id: row.id,
        type: row.type,
        content: row.content,
        source_file: row.source_file,
        concepts: JSON.parse(row.concepts || '[]'),
        project: row.project,
      });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  app.get('/api/list', (c) => {
    const type = c.req.query('type') || 'all';
    const limit = Number.parseInt(c.req.query('limit') || '10', 10);
    const offset = Number.parseInt(c.req.query('offset') || '0', 10);
    const group = c.req.query('group') !== 'false';
    return c.json(handleList(type, limit, offset, group));
  });

  app.get('/api/graph', (c) => c.json(handleGraph()));

  app.get('/api/context', (c) => {
    const cwd = c.req.query('cwd');
    return c.json(handleContext(cwd));
  });

  app.get('/api/file', async (c) => {
    const filePath = c.req.query('path');
    const project = c.req.query('project');

    if (!filePath) {
      return c.json({ error: 'Missing path parameter' }, 400);
    }

    try {
      let ghqRoot = process.env.GHQ_ROOT;
      if (!ghqRoot) {
        try {
          const proc = Bun.spawnSync(['ghq', 'root']);
          ghqRoot = proc.stdout.toString().trim();
        } catch {
          const match = options.repoRoot.match(/^(.+?)\/github\.com\//);
          ghqRoot = match
            ? match[1]
            : path.dirname(path.dirname(path.dirname(options.repoRoot)));
        }
      }

      const basePath = project
        ? path.join(ghqRoot, project)
        : options.repoRoot;
      const fullPath = path.join(basePath, filePath);

      let realPath: string;
      try {
        realPath = fs.realpathSync(fullPath);
      } catch {
        realPath = path.resolve(fullPath);
      }

      const realGhqRoot = fs.realpathSync(ghqRoot);
      const realRepoRoot = fs.realpathSync(options.repoRoot);
      if (!realPath.startsWith(realGhqRoot) && !realPath.startsWith(realRepoRoot)) {
        return c.json({ error: 'Invalid path: outside allowed bounds' }, 400);
      }

      if (!fs.existsSync(fullPath)) {
        return c.text('File not found', 404);
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      return c.text(content);
    } catch (e: any) {
      return c.text(e.message, 500);
    }
  });

  app.post('/api/learn', async (c) => {
    try {
      const data = await c.req.json();
      if (!data.pattern) {
        return c.json({ error: 'Missing required field: pattern' }, 400);
      }

      const result = await handleLearn(
        data.pattern,
        data.source,
        data.concepts,
        data.origin,
        data.project,
        data.cwd,
        data.layer,
      );
      return c.json(result);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        500,
      );
    }
  });

  app.post('/api/ask', async (c) => {
    try {
      const data = await c.req.json();
      if (!data.question) {
        return c.json({ error: 'Missing required field: question' }, 400);
      }
      const consultResult = await handleConsult(data.question, data.context || '');
      return c.json({
        response:
          consultResult.guidance
          || "I found some relevant information but couldn't formulate a specific response.",
        principles: consultResult.principles?.length || 0,
        patterns: consultResult.patterns?.length || 0,
      });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        500,
      );
    }
  });
}


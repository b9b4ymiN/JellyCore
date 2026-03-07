import type { Hono } from 'hono';

import { getEpisodicStore } from '../../memory/episodic.js';
import { getProceduralStore } from '../../memory/procedural.js';
import { getUserModelStore } from '../../memory/user-model.js';
import { searchCache } from '../../cache.js';

export function registerMemoryRoutes(app: Hono): void {
  // User Model (Layer 1)
  app.get('/api/user-model', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default';
      const store = getUserModelStore();
      const model = await store.get(userId);
      return c.json(model);
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 500);
    }
  });

  app.post('/api/user-model', async (c) => {
    try {
      const data = await c.req.json();
      const userId = data.userId || 'default';
      const updates = data.updates || data;
      delete updates.userId;
      delete updates.updates;
      const store = getUserModelStore();
      const model = await store.update(userId, updates);
      searchCache.invalidate();
      return c.json({ success: true, model });
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 500);
    }
  });

  app.delete('/api/user-model', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default';
      const store = getUserModelStore();
      await store.reset(userId);
      return c.json({ success: true });
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 500);
    }
  });

  // Procedural Memory (Layer 2)
  app.get('/api/procedural', async (c) => {
    try {
      const q = c.req.query('q') || '';
      const limit = parseInt(c.req.query('limit') || '3');

      if (!q) {
        return c.json({ error: 'Missing required query parameter: q' }, 400);
      }

      const store = getProceduralStore();
      const results = await store.find(q, limit);
      return c.json({ results, total: results.length });
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 500);
    }
  });

  app.post('/api/procedural', async (c) => {
    try {
      const data = await c.req.json();
      if (!data.trigger || !data.procedure) {
        return c.json({ error: 'Missing required fields: trigger, procedure' }, 400);
      }
      if (!Array.isArray(data.procedure)) {
        return c.json({ error: 'procedure must be an array of strings' }, 400);
      }

      const store = getProceduralStore();
      const id = await store.learn({
        trigger: data.trigger,
        procedure: data.procedure,
        source: data.source || 'explicit',
      });

      return c.json({ success: true, id });
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 500);
    }
  });

  app.post('/api/procedural/usage', async (c) => {
    try {
      const data = await c.req.json();
      if (!data.id) {
        return c.json({ error: 'Missing required field: id' }, 400);
      }

      const store = getProceduralStore();
      await store.recordUsage(data.id);
      return c.json({ success: true });
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 500);
    }
  });

  // Episodic Memory (Layer 4)
  app.post('/api/episodic', async (c) => {
    try {
      const data = await c.req.json();
      if (!data.summary) {
        return c.json({ error: 'Missing required field: summary' }, 400);
      }

      const store = getEpisodicStore();
      const id = await store.record({
        userId: data.userId || 'default',
        groupId: data.groupId || 'default',
        summary: data.summary,
        topics: data.topics || [],
        outcome: data.outcome || 'unknown',
        durationMs: data.durationMs || 0,
      });

      return c.json({ success: true, id });
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 500);
    }
  });

  app.get('/api/episodic', async (c) => {
    try {
      const q = c.req.query('q') || '';
      const userId = c.req.query('userId');
      const limit = parseInt(c.req.query('limit') || '5');

      if (!q) {
        return c.json({ error: 'Missing required query parameter: q' }, 400);
      }

      const store = getEpisodicStore();
      const results = await store.findRelated(q, userId || undefined, limit);
      return c.json({ results, total: results.length });
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 500);
    }
  });
}

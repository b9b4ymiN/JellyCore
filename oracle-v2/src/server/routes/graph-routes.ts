/**
 * Knowledge Graph API Routes (P4)
 * 
 * REST endpoints for graph queries and relationship management
 */

import { Hono } from 'hono';
import { GraphDiscoveryError, getKnowledgeGraphService } from '../../knowledge-graph-service.js';

const app = new Hono();
const graphService = getKnowledgeGraphService();

/**
 * POST /api/graph/discover
 * Discover relationships from documents
 */
app.post('/discover', async (c) => {
  try {
    const result = await graphService.discoverRelationships();
    return c.json({
      message: 'Relationship discovery complete',
      ...result,
    });
  } catch (error) {
    console.error('[API] Graph discovery error:', error);
    if (error instanceof GraphDiscoveryError) {
      return c.json({
        error: 'Relationship discovery failed',
        ...error.result,
      }, 500);
    }

    return c.json({
      error: 'Relationship discovery failed',
      mode: 'rebuild',
      processed: 0,
      attemptedPairs: 0,
      relationships: 0,
      skippedInvalidDocuments: 0,
      skippedInsufficientConcepts: 0,
      durationMs: 0,
    }, 500);
  }
});

/**
 * GET /api/graph/concepts/:concept/related
 * Get related concepts
 */
app.get('/concepts/:concept/related', async (c) => {
  try {
    const concept = decodeURIComponent(c.req.param('concept'));
    const limit = parseInt(c.req.query('limit') || '20');
    const minStrength = parseInt(c.req.query('minStrength') || '1');
    const types = c.req.query('types')?.split(',');

    const related = await graphService.getRelatedConcepts(concept, {
      limit,
      minStrength,
      types: types as any,
    });

    return c.json({
      concept,
      related,
      count: related.length,
    });
  } catch (error) {
    console.error('[API] Get related concepts error:', error);
    return c.json({ error: 'Failed to get related concepts' }, 500);
  }
});

/**
 * GET /api/graph/path
 * Find path between two concepts
 */
app.get('/path', async (c) => {
  try {
    const from = c.req.query('from');
    const to = c.req.query('to');
    const maxDepth = parseInt(c.req.query('maxDepth') || '3');

    if (!from || !to) {
      return c.json({ error: 'Missing from or to parameter' }, 400);
    }

    const path = await graphService.findPath(from, to, maxDepth);

    if (path) {
      return c.json({
        from,
        to,
        path,
        length: path.length - 1,
      });
    } else {
      return c.json({
        from,
        to,
        path: null,
        message: 'No path found',
      }, 404);
    }
  } catch (error) {
    console.error('[API] Find path error:', error);
    return c.json({ error: 'Failed to find path' }, 500);
  }
});

/**
 * GET /api/graph/top-concepts
 * Get most connected concepts
 */
app.get('/top-concepts', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '20');
    const top = await graphService.getTopConcepts(limit);

    return c.json({
      concepts: top,
      count: top.length,
    });
  } catch (error) {
    console.error('[API] Get top concepts error:', error);
    return c.json({ error: 'Failed to get top concepts' }, 500);
  }
});

/**
 * GET /api/graph/stats
 * Get graph statistics
 */
app.get('/stats', async (c) => {
  try {
    const stats = await graphService.getStats();
    return c.json({ stats });
  } catch (error) {
    console.error('[API] Get graph stats error:', error);
    return c.json({ error: 'Failed to get stats' }, 500);
  }
});

export function registerGraphRoutes(parentApp: Hono) {
  parentApp.route('/api/graph', app);
  console.log('[API] Knowledge Graph routes registered');
}

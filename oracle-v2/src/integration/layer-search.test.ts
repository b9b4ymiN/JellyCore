/**
 * Part G — Layer-Aware Search Tests
 *
 * Tests for: getLayerBoost(), layer filter SQL construction,
 *            layer-aware cache key, and layer propagation through results
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { homedir } from 'os';

// ============================================================
// Re-implementation of getLayerBoost for unit testing
// (private function in handlers.ts)
// ============================================================
function getLayerBoost(layer: string | null, queryType?: string): number {
  if (!layer || layer === 'semantic') return 1.0;
  if (layer === 'procedural' && queryType === 'semantic') return 1.2;
  if (layer === 'episodic' && queryType === 'semantic') return 1.1;
  if (layer === 'procedural') return 1.1; // still slight boost for exact queries
  if (layer === 'episodic') return 1.0;
  if (layer === 'user_model') return 0.5;
  return 1.0;
}

// ============================================================
// Re-implementation of layer filter SQL construction for testing
// ============================================================
function buildLayerFilterSql(layerFilter?: string[]): { sql: string; params: string[] } {
  if (!layerFilter || layerFilter.length === 0) {
    return { sql: '', params: [] };
  }
  const placeholders = layerFilter.map(() => '?').join(',');
  if (layerFilter.includes('semantic')) {
    return {
      sql: ` AND (d.memory_layer IN (${placeholders}) OR d.memory_layer IS NULL)`,
      params: [...layerFilter],
    };
  }
  return {
    sql: ` AND d.memory_layer IN (${placeholders})`,
    params: [...layerFilter],
  };
}

// ============================================================
// Cache key generation (mirrors handlers.ts logic)
// ============================================================
function makeCacheKey(query: string, mode: string, limit: number, type: string, project?: string, layerFilter?: string[]): string {
  const base = `${query}:${mode}:${limit}:${type}:${project ?? ''}`;
  const layerKey = layerFilter?.join(',') || '';
  return base + (layerKey ? `:layer=${layerKey}` : '');
}

describe('Part G — Layer-Aware Search', () => {
  // ============================================================
  // getLayerBoost()
  // ============================================================
  describe('getLayerBoost()', () => {
    it('null layer → 1.0 (no boost)', () => {
      expect(getLayerBoost(null)).toBe(1.0);
    });

    it('semantic layer → 1.0', () => {
      expect(getLayerBoost('semantic')).toBe(1.0);
      expect(getLayerBoost('semantic', 'all')).toBe(1.0);
      expect(getLayerBoost('semantic', 'semantic')).toBe(1.0);
    });

    it('procedural + semantic query → 1.2 boost', () => {
      expect(getLayerBoost('procedural', 'semantic')).toBe(1.2);
    });

    it('procedural + non-semantic query → 1.1 boost', () => {
      expect(getLayerBoost('procedural', 'all')).toBe(1.1);
      expect(getLayerBoost('procedural')).toBe(1.1);
    });

    it('episodic + semantic query → 1.1 boost', () => {
      expect(getLayerBoost('episodic', 'semantic')).toBe(1.1);
    });

    it('episodic + non-semantic query → 1.0', () => {
      expect(getLayerBoost('episodic', 'all')).toBe(1.0);
      expect(getLayerBoost('episodic')).toBe(1.0);
    });

    it('user_model → 0.5 always', () => {
      expect(getLayerBoost('user_model')).toBe(0.5);
      expect(getLayerBoost('user_model', 'semantic')).toBe(0.5);
      expect(getLayerBoost('user_model', 'all')).toBe(0.5);
    });

    it('unknown layer → 1.0 fallback', () => {
      expect(getLayerBoost('unknown')).toBe(1.0);
      expect(getLayerBoost('custom_layer')).toBe(1.0);
    });

    it('boost values maintain correct ordering', () => {
      // procedural should be boosted most for semantic queries
      const procBoost = getLayerBoost('procedural', 'semantic');
      const epiBoost = getLayerBoost('episodic', 'semantic');
      const semBoost = getLayerBoost('semantic', 'semantic');
      const umBoost = getLayerBoost('user_model', 'semantic');

      expect(procBoost).toBeGreaterThan(epiBoost);
      expect(epiBoost).toBeGreaterThanOrEqual(semBoost);
      expect(semBoost).toBeGreaterThan(umBoost);
    });
  });

  // ============================================================
  // Layer Filter SQL Construction
  // ============================================================
  describe('buildLayerFilterSql()', () => {
    it('no filter → empty SQL', () => {
      const { sql, params } = buildLayerFilterSql(undefined);
      expect(sql).toBe('');
      expect(params).toHaveLength(0);
    });

    it('empty array → empty SQL', () => {
      const { sql, params } = buildLayerFilterSql([]);
      expect(sql).toBe('');
      expect(params).toHaveLength(0);
    });

    it('single non-semantic layer → IN clause without NULL fallback', () => {
      const { sql, params } = buildLayerFilterSql(['procedural']);
      expect(sql).toContain('d.memory_layer IN (?)');
      expect(sql).not.toContain('IS NULL');
      expect(params).toEqual(['procedural']);
    });

    it('semantic layer → includes IS NULL fallback for legacy docs', () => {
      const { sql, params } = buildLayerFilterSql(['semantic']);
      expect(sql).toContain('d.memory_layer IN (?)');
      expect(sql).toContain('IS NULL');
      expect(params).toEqual(['semantic']);
    });

    it('multiple layers including semantic → includes IS NULL fallback', () => {
      const { sql, params } = buildLayerFilterSql(['semantic', 'procedural']);
      expect(sql).toContain('d.memory_layer IN (?,?)');
      expect(sql).toContain('IS NULL');
      expect(params).toEqual(['semantic', 'procedural']);
    });

    it('multiple layers without semantic → no IS NULL fallback', () => {
      const { sql, params } = buildLayerFilterSql(['procedural', 'episodic']);
      expect(sql).toContain('d.memory_layer IN (?,?)');
      expect(sql).not.toContain('IS NULL');
      expect(params).toEqual(['procedural', 'episodic']);
    });
  });

  // ============================================================
  // Cache Key with Layer
  // ============================================================
  describe('layer-aware cache key', () => {
    it('no layer filter → no layer suffix', () => {
      const key = makeCacheKey('test', 'hybrid', 10, 'all');
      expect(key).not.toContain(':layer=');
    });

    it('single layer → includes layer suffix', () => {
      const key = makeCacheKey('test', 'hybrid', 10, 'all', undefined, ['semantic']);
      expect(key).toContain(':layer=semantic');
    });

    it('multiple layers → comma-joined suffix', () => {
      const key = makeCacheKey('test', 'hybrid', 10, 'all', undefined, ['semantic', 'procedural']);
      expect(key).toContain(':layer=semantic,procedural');
    });

    it('same query, different layers → different cache keys', () => {
      const key1 = makeCacheKey('test', 'hybrid', 10, 'all', undefined, ['semantic']);
      const key2 = makeCacheKey('test', 'hybrid', 10, 'all', undefined, ['procedural']);
      expect(key1).not.toBe(key2);
    });

    it('same query, same layers → same cache keys', () => {
      const key1 = makeCacheKey('test', 'hybrid', 10, 'all', undefined, ['semantic']);
      const key2 = makeCacheKey('test', 'hybrid', 10, 'all', undefined, ['semantic']);
      expect(key1).toBe(key2);
    });
  });

  // ============================================================
  // Layer Filter with SQLite (actual DB)
  // ============================================================
  describe('SQLite layer filter integration', () => {
    let db: InstanceType<typeof Database>;
    const dbPath = join(homedir(), '.oracle-v2', `test-layer-search-${randomUUID().slice(0, 8)}.db`);

    beforeAll(() => {
      db = new Database(dbPath);
      // Create a simple test table mimicking documents
      db.exec(`
        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'fact',
          memory_layer TEXT,
          decay_score INTEGER DEFAULT 100
        )
      `);

      // Insert test data across layers
      const insert = db.prepare('INSERT INTO documents (id, content, type, memory_layer, decay_score) VALUES (?, ?, ?, ?, ?)');
      insert.run('doc1', 'Docker compose deployment guide', 'fact', 'semantic', 100);
      insert.run('doc2', 'When build fails, run clean install', 'fact', 'procedural', 90);
      insert.run('doc3', 'User deployed v0.6.0 on March 15', 'retro', 'episodic', 80);
      insert.run('doc4', 'User prefers Thai language', 'fact', 'user_model', 70);
      insert.run('doc5', 'Legacy doc without layer', 'fact', null, 60);
      insert.run('doc6', 'Another semantic doc', 'fact', 'semantic', 95);
    });

    afterAll(() => {
      db.close();
      try { require('fs').unlinkSync(dbPath); } catch (e) {}
    });

    it('no filter → returns all docs', () => {
      const rows = db.prepare('SELECT * FROM documents').all();
      expect(rows).toHaveLength(6);
    });

    it('filter by semantic → includes NULL legacy docs', () => {
      const { sql, params } = buildLayerFilterSql(['semantic']);
      const query = `SELECT * FROM documents d WHERE 1=1${sql}`;
      const rows = db.prepare(query).all(...params);
      // doc1 (semantic), doc5 (NULL→semantic), doc6 (semantic) = 3 docs
      expect(rows).toHaveLength(3);
    });

    it('filter by procedural → excludes NULL legacy docs', () => {
      const { sql, params } = buildLayerFilterSql(['procedural']);
      const query = `SELECT * FROM documents d WHERE 1=1${sql}`;
      const rows = db.prepare(query).all(...params);
      expect(rows).toHaveLength(1);
      expect((rows[0] as any).id).toBe('doc2');
    });

    it('filter by episodic → only episodic docs', () => {
      const { sql, params } = buildLayerFilterSql(['episodic']);
      const query = `SELECT * FROM documents d WHERE 1=1${sql}`;
      const rows = db.prepare(query).all(...params);
      expect(rows).toHaveLength(1);
      expect((rows[0] as any).id).toBe('doc3');
    });

    it('filter by user_model → only user_model docs', () => {
      const { sql, params } = buildLayerFilterSql(['user_model']);
      const query = `SELECT * FROM documents d WHERE 1=1${sql}`;
      const rows = db.prepare(query).all(...params);
      expect(rows).toHaveLength(1);
      expect((rows[0] as any).id).toBe('doc4');
    });

    it('filter by semantic + procedural → includes NULL + matching layers', () => {
      const { sql, params } = buildLayerFilterSql(['semantic', 'procedural']);
      const query = `SELECT * FROM documents d WHERE 1=1${sql}`;
      const rows = db.prepare(query).all(...params);
      // doc1, doc2, doc5 (NULL→semantic), doc6 = 4 docs
      expect(rows).toHaveLength(4);
    });

    it('filter by procedural + episodic → no NULL docs', () => {
      const { sql, params } = buildLayerFilterSql(['procedural', 'episodic']);
      const query = `SELECT * FROM documents d WHERE 1=1${sql}`;
      const rows = db.prepare(query).all(...params);
      expect(rows).toHaveLength(2);
    });

    it('decay_score retrieved alongside memory_layer for RRF adjustment', () => {
      const rows = db.prepare('SELECT id, memory_layer, decay_score FROM documents d WHERE memory_layer IS NOT NULL').all() as any[];
      expect(rows).toHaveLength(5); // all except doc5
      for (const row of rows) {
        expect(row.memory_layer).toBeDefined();
        expect(row.decay_score).toBeGreaterThanOrEqual(0);
        expect(row.decay_score).toBeLessThanOrEqual(100);
      }
    });
  });

  // ============================================================
  // Layer Boost Effect on Rankings
  // ============================================================
  describe('layer boost effect on rankings', () => {
    // Simulate RRF + layer boost to verify ordering
    interface MockResult {
      id: string;
      rrfScore: number;
      layer: string | null;
    }

    function applyLayerBoost(results: MockResult[], queryType?: string): MockResult[] {
      return results
        .map(r => ({
          ...r,
          rrfScore: r.rrfScore * getLayerBoost(r.layer, queryType),
        }))
        .sort((a, b) => b.rrfScore - a.rrfScore);
    }

    it('procedural docs ranked higher for semantic queries', () => {
      const results: MockResult[] = [
        { id: 'a', rrfScore: 0.5, layer: 'semantic' },
        { id: 'b', rrfScore: 0.5, layer: 'procedural' },
      ];
      const ranked = applyLayerBoost(results, 'semantic');
      expect(ranked[0].id).toBe('b'); // procedural gets 1.2× boost
      expect(ranked[1].id).toBe('a'); // semantic stays 1.0×
    });

    it('user_model docs ranked lower', () => {
      const results: MockResult[] = [
        { id: 'a', rrfScore: 0.5, layer: 'user_model' },
        { id: 'b', rrfScore: 0.3, layer: 'semantic' },
      ];
      const ranked = applyLayerBoost(results, 'semantic');
      // user_model: 0.5 × 0.5 = 0.25
      // semantic: 0.3 × 1.0 = 0.30
      expect(ranked[0].id).toBe('b');
      expect(ranked[1].id).toBe('a');
    });

    it('null layer treated as semantic (no penalty)', () => {
      const results: MockResult[] = [
        { id: 'a', rrfScore: 0.5, layer: null },
        { id: 'b', rrfScore: 0.5, layer: 'semantic' },
      ];
      const ranked = applyLayerBoost(results, 'semantic');
      // Both get 1.0× → scores equal, stable sort
      expect(ranked[0].rrfScore).toBe(ranked[1].rrfScore);
    });

    it('episodic gets moderate boost for semantic queries', () => {
      const results: MockResult[] = [
        { id: 'a', rrfScore: 0.5, layer: 'episodic' },
        { id: 'b', rrfScore: 0.5, layer: 'semantic' },
      ];
      const ranked = applyLayerBoost(results, 'semantic');
      expect(ranked[0].id).toBe('a'); // episodic gets 1.1× boost
    });
  });

  // ============================================================
  // Edge Cases
  // ============================================================
  describe('edge cases', () => {
    it('getLayerBoost is stable across repeated calls', () => {
      for (let i = 0; i < 100; i++) {
        expect(getLayerBoost('procedural', 'semantic')).toBe(1.2);
      }
    });

    it('layer filter with all layers → returns everything', () => {
      const allLayers = ['semantic', 'procedural', 'episodic', 'user_model'];
      const { sql, params } = buildLayerFilterSql(allLayers);
      // semantic is in the list, so NULL is also included
      expect(sql).toContain('IS NULL');
      expect(params).toHaveLength(4);
    });

    it('layer boost values are all positive', () => {
      const layers = [null, 'semantic', 'procedural', 'episodic', 'user_model', 'unknown'];
      const queryTypes = [undefined, 'all', 'semantic', 'fact', 'retro'];
      for (const layer of layers) {
        for (const qt of queryTypes) {
          const boost = getLayerBoost(layer, qt);
          expect(boost).toBeGreaterThan(0);
          expect(boost).toBeLessThanOrEqual(2.0); // reasonable upper bound
        }
      }
    });
  });
});

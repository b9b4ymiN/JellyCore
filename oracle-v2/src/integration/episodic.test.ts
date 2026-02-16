/**
 * Part E — Episodic Memory Tests
 *
 * Tests for EpisodicStore: record, findRelated, purgeExpired, getById
 * Uses isolated test DB (no ChromaDB dependency)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { eq, sql, lte, and } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { type EpisodicMemory, floatToInt } from '../types.js';
import path from 'path';
import fs from 'fs';

const TEST_DB_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || '.',
  '.oracle-v2',
  'test-episodic.db'
);

let sqliteDb: Database;
let db: ReturnType<typeof drizzle>;

// Test-local EpisodicStore that uses our test DB (no ChromaDB)
class TestEpisodicStore {
  async record(episode: {
    userId: string;
    groupId: string;
    summary: string;
    topics: string[];
    outcome: 'success' | 'partial' | 'failed' | 'unknown';
    durationMs: number;
  }): Promise<string> {
    const now = Date.now();
    const docId = `episodic_${episode.groupId}_${now}`;
    const expiresAt = now + 90 * 24 * 60 * 60 * 1000;

    const episodicData: EpisodicMemory = {
      userId: episode.userId,
      groupId: episode.groupId,
      summary: episode.summary,
      topics: episode.topics,
      outcome: episode.outcome,
      durationMs: episode.durationMs,
      recordedAt: now,
    };

    const conceptsArray = [
      'memory:episodic',
      `user:${episode.userId}`,
      `group:${episode.groupId}`,
      ...episode.topics.map(t => `topic:${t}`),
      JSON.stringify(episodicData),
    ];

    await db.insert(schema.oracleDocuments).values({
      id: docId,
      type: 'retro',
      sourceFile: `memory://episodic/${episode.groupId}`,
      concepts: JSON.stringify(conceptsArray),
      createdAt: now,
      updatedAt: now,
      indexedAt: now,
      memoryLayer: 'episodic',
      confidence: floatToInt(0.80),
      accessCount: 0,
      decayScore: 100,
      expiresAt,
      createdBy: 'memory_system',
    });

    // Index into FTS5
    sqliteDb.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)').run(
      docId,
      `${episode.summary}\n${episode.topics.join(' ')}\n${episode.outcome}`,
      conceptsArray.filter(c => !c.startsWith('{')).join(' '),
    );

    return docId;
  }

  async findRelated(topic: string, userId?: string, limit: number = 5): Promise<EpisodicMemory[]> {
    const results: EpisodicMemory[] = [];
    const sanitized = topic.replace(/['"]/g, '').substring(0, 200);

    let ftsQuery = 'SELECT f.id FROM oracle_fts f JOIN oracle_documents d ON f.id = d.id WHERE oracle_fts MATCH ? AND d.memory_layer = ?';
    const params: any[] = [sanitized, 'episodic'];

    if (userId) {
      ftsQuery += ' AND d.concepts LIKE ?';
      params.push(`%user:${userId}%`);
    }

    ftsQuery += ' AND (d.expires_at IS NULL OR d.expires_at > ?) ORDER BY d.created_at DESC LIMIT ?';
    params.push(Date.now(), limit * 2);

    const ftsRows = sqliteDb.prepare(ftsQuery).all(...params) as { id: string }[];

    for (const ftsRow of ftsRows) {
      const row = await db.select().from(schema.oracleDocuments).where(eq(schema.oracleDocuments.id, ftsRow.id));
      if (row.length > 0 && row[0].memoryLayer === 'episodic') {
        const episode = this.parseFromRow(row[0]);
        if (episode) results.push(episode);
      }
    }

    return results.sort((a, b) => b.recordedAt - a.recordedAt).slice(0, limit);
  }

  async purgeExpired(): Promise<{ removed: number; archived: number }> {
    const now = Date.now();
    let removed = 0;
    let archived = 0;

    const expired = db
      .select()
      .from(schema.oracleDocuments)
      .where(
        and(
          eq(schema.oracleDocuments.memoryLayer, 'episodic'),
          lte(schema.oracleDocuments.expiresAt, now),
        ),
      )
      .all();

    for (const row of expired) {
      const episode = this.parseFromRow(row);
      if (episode) {
        db.update(schema.oracleDocuments)
          .set({
            memoryLayer: null,
            expiresAt: null,
            decayScore: 50,
            updatedAt: now,
            concepts: JSON.stringify([
              'archived:episodic',
              `user:${episode.userId}`,
              ...episode.topics.map(t => `topic:${t}`),
            ]),
          })
          .where(eq(schema.oracleDocuments.id, row.id))
          .run();
        archived++;
      } else {
        db.delete(schema.oracleDocuments).where(eq(schema.oracleDocuments.id, row.id)).run();
        try { sqliteDb.prepare('DELETE FROM oracle_fts WHERE id = ?').run(row.id); } catch {}
        removed++;
      }
    }

    return { removed, archived };
  }

  async getById(id: string): Promise<EpisodicMemory | null> {
    const rows = await db.select().from(schema.oracleDocuments).where(eq(schema.oracleDocuments.id, id));
    if (rows.length === 0 || rows[0].memoryLayer !== 'episodic') return null;
    if (rows[0].expiresAt && rows[0].expiresAt < Date.now()) return null;
    return this.parseFromRow(rows[0]);
  }

  private parseFromRow(row: any): EpisodicMemory | null {
    try {
      const concepts = JSON.parse(row.concepts) as string[];
      const jsonStr = concepts.find(c => c.startsWith('{'));
      if (jsonStr) return JSON.parse(jsonStr) as EpisodicMemory;
    } catch {}
    return null;
  }
}

beforeAll(() => {
  // Clean up test DB
  try { fs.rmSync(TEST_DB_PATH, { force: true }); } catch {}

  sqliteDb = new Database(TEST_DB_PATH);
  db = drizzle(sqliteDb, { schema });

  // Apply migrations
  const migrationsDir = path.join(import.meta.dirname || __dirname, '..', 'db', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    const statements = sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      try { sqliteDb.exec(stmt); } catch {}
    }
  }

  // Add all ensureSchema columns (v0.5.0 + v0.6.0 + v0.7.0)
  const columns = [
    "ALTER TABLE oracle_documents ADD COLUMN is_private INTEGER DEFAULT 0",
    "ALTER TABLE oracle_documents ADD COLUMN embedding_model TEXT DEFAULT 'all-MiniLM-L6-v2'",
    "ALTER TABLE oracle_documents ADD COLUMN embedding_version INTEGER DEFAULT 1",
    "ALTER TABLE oracle_documents ADD COLUMN embedding_hash TEXT",
    "ALTER TABLE oracle_documents ADD COLUMN chunk_index INTEGER",
    "ALTER TABLE oracle_documents ADD COLUMN total_chunks INTEGER",
    "ALTER TABLE oracle_documents ADD COLUMN parent_id TEXT",
    "ALTER TABLE oracle_documents ADD COLUMN memory_layer TEXT",
    "ALTER TABLE oracle_documents ADD COLUMN confidence INTEGER",
    "ALTER TABLE oracle_documents ADD COLUMN access_count INTEGER DEFAULT 0",
    "ALTER TABLE oracle_documents ADD COLUMN last_accessed_at INTEGER",
    "ALTER TABLE oracle_documents ADD COLUMN decay_score INTEGER DEFAULT 100",
    "ALTER TABLE oracle_documents ADD COLUMN expires_at INTEGER",
  ];
  for (const col of columns) {
    try { sqliteDb.exec(col); } catch {}
  }

  // Create FTS5 table if not exists
  try {
    sqliteDb.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS oracle_fts USING fts5(id, content, concepts, tokenize='porter')`);
  } catch {}
});

afterAll(() => {
  try { sqliteDb.close(); } catch {}
  try { fs.rmSync(TEST_DB_PATH, { force: true }); } catch {}
});

describe('Part E — Episodic Memory', () => {
  let store: TestEpisodicStore;

  beforeAll(() => {
    store = new TestEpisodicStore();
  });

  // ============================================================
  // record()
  // ============================================================
  describe('record()', () => {
    it('records an episode and returns ID', async () => {
      const id = await store.record({
        userId: 'owner',
        groupId: 'main-chat',
        summary: 'Implemented Thai NLP sidecar for Oracle search',
        topics: ['thai-nlp', 'search', 'oracle'],
        outcome: 'success',
        durationMs: 3600000,
      });

      expect(id).toMatch(/^episodic_main-chat_\d+$/);
    });

    it('stores episode data correctly in DB', async () => {
      const id = await store.record({
        userId: 'owner',
        groupId: 'test-group',
        summary: 'Debugged Docker network issue',
        topics: ['docker', 'networking'],
        outcome: 'success',
        durationMs: 1800000,
      });

      const row = db.select().from(schema.oracleDocuments).where(eq(schema.oracleDocuments.id, id)).get();
      expect(row).toBeDefined();
      expect(row!.memoryLayer).toBe('episodic');
      expect(row!.type).toBe('retro');
      expect(row!.expiresAt).toBeGreaterThan(Date.now());
      expect(row!.decayScore).toBe(100);
    });

    it('sets TTL to ~90 days', async () => {
      const beforeRecord = Date.now();
      const id = await store.record({
        userId: 'owner',
        groupId: 'ttl-test',
        summary: 'Testing TTL',
        topics: ['test'],
        outcome: 'unknown',
        durationMs: 0,
      });

      const row = db.select().from(schema.oracleDocuments).where(eq(schema.oracleDocuments.id, id)).get();
      const ttlDays = (row!.expiresAt! - beforeRecord) / (24 * 60 * 60 * 1000);
      expect(ttlDays).toBeGreaterThanOrEqual(89);
      expect(ttlDays).toBeLessThanOrEqual(91);
    });

    it('indexes in FTS5', async () => {
      const id = await store.record({
        userId: 'owner',
        groupId: 'fts-test',
        summary: 'Kubernetes deployment configuration updated',
        topics: ['kubernetes', 'deployment'],
        outcome: 'success',
        durationMs: 600000,
      });

      const ftsRow = sqliteDb.prepare('SELECT content FROM oracle_fts WHERE id = ?').get(id) as { content: string };
      expect(ftsRow).toBeDefined();
      expect(ftsRow.content).toContain('Kubernetes');
    });

    it('stores correct concepts array', async () => {
      const id = await store.record({
        userId: 'alice',
        groupId: 'concept-test',
        summary: 'Testing concepts',
        topics: ['api', 'testing'],
        outcome: 'partial',
        durationMs: 300000,
      });

      const row = db.select().from(schema.oracleDocuments).where(eq(schema.oracleDocuments.id, id)).get();
      const concepts = JSON.parse(row!.concepts!) as string[];
      expect(concepts).toContain('memory:episodic');
      expect(concepts).toContain('user:alice');
      expect(concepts).toContain('group:concept-test');
      expect(concepts).toContain('topic:api');
      expect(concepts).toContain('topic:testing');
      // Last element is JSON
      const jsonStr = concepts.find(c => c.startsWith('{'));
      expect(jsonStr).toBeDefined();
      const parsed = JSON.parse(jsonStr!);
      expect(parsed.outcome).toBe('partial');
    });
  });

  // ============================================================
  // getById()
  // ============================================================
  describe('getById()', () => {
    it('retrieves existing episode', async () => {
      const id = await store.record({
        userId: 'owner',
        groupId: 'get-test',
        summary: 'Episode for getById test',
        topics: ['test'],
        outcome: 'success',
        durationMs: 100,
      });

      const episode = await store.getById(id);
      expect(episode).not.toBeNull();
      expect(episode!.summary).toBe('Episode for getById test');
      expect(episode!.userId).toBe('owner');
      expect(episode!.outcome).toBe('success');
    });

    it('returns null for non-existent ID', async () => {
      const episode = await store.getById('episodic_nonexistent_0');
      expect(episode).toBeNull();
    });

    it('returns null for expired episode', async () => {
      // Insert directly with past expires_at
      const docId = 'episodic_expired_test';
      const episodicData: EpisodicMemory = {
        userId: 'owner', groupId: 'expired', summary: 'Old episode',
        topics: [], outcome: 'success', durationMs: 0, recordedAt: 1000,
      };
      await db.insert(schema.oracleDocuments).values({
        id: docId, type: 'retro', sourceFile: 'memory://episodic/expired',
        concepts: JSON.stringify(['memory:episodic', JSON.stringify(episodicData)]),
        createdAt: 1000, updatedAt: 1000, indexedAt: 1000,
        memoryLayer: 'episodic', expiresAt: Date.now() - 1000,
      });

      const episode = await store.getById(docId);
      expect(episode).toBeNull();
    });
  });

  // ============================================================
  // findRelated()
  // ============================================================
  describe('findRelated()', () => {
    it('finds episodes by topic via FTS5', async () => {
      await store.record({
        userId: 'owner',
        groupId: 'search-test-1',
        summary: 'Implemented ChromaDB vector search integration',
        topics: ['chromadb', 'vector', 'search'],
        outcome: 'success',
        durationMs: 7200000,
      });

      const results = await store.findRelated('ChromaDB vector');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].summary).toContain('ChromaDB');
    });

    it('filters by userId', async () => {
      await store.record({
        userId: 'alice-unique',
        groupId: 'alice-search',
        summary: 'Alice unique Redis caching implementation',
        topics: ['redis', 'caching'],
        outcome: 'success',
        durationMs: 1000,
      });

      await store.record({
        userId: 'bob-unique',
        groupId: 'bob-search',
        summary: 'Bob unique Redis monitoring setup',
        topics: ['redis', 'monitoring'],
        outcome: 'partial',
        durationMs: 2000,
      });

      const aliceResults = await store.findRelated('Redis', 'alice-unique');
      // All results should belong to alice
      for (const r of aliceResults) {
        expect(r.userId).toBe('alice-unique');
      }
    });

    it('respects limit', async () => {
      const results = await store.findRelated('test', undefined, 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('returns empty for no match', async () => {
      const results = await store.findRelated('quantumEntanglementXyz');
      expect(results.length).toBe(0);
    });
  });

  // ============================================================
  // purgeExpired()
  // ============================================================
  describe('purgeExpired()', () => {
    it('archives expired episodes (converts to semantic)', async () => {
      const docId = 'episodic_purge_archive';
      const episodicData: EpisodicMemory = {
        userId: 'owner', groupId: 'purge-archive',
        summary: 'Episode to be archived',
        topics: ['archive-test'],
        outcome: 'success', durationMs: 5000, recordedAt: 1000,
      };

      await db.insert(schema.oracleDocuments).values({
        id: docId, type: 'retro', sourceFile: 'memory://episodic/purge-archive',
        concepts: JSON.stringify(['memory:episodic', JSON.stringify(episodicData)]),
        createdAt: 1000, updatedAt: 1000, indexedAt: 1000,
        memoryLayer: 'episodic', expiresAt: Date.now() - 1, // expired
        decayScore: 100,
      });

      const result = await store.purgeExpired();
      expect(result.archived).toBeGreaterThanOrEqual(1);

      // Check that doc was converted (memoryLayer set to null, expiresAt cleared)
      const row = db.select().from(schema.oracleDocuments).where(eq(schema.oracleDocuments.id, docId)).get();
      expect(row).toBeDefined();
      expect(row!.memoryLayer).toBeNull();
      expect(row!.expiresAt).toBeNull();
      expect(row!.decayScore).toBe(50);
    });

    it('does not purge non-expired episodes', async () => {
      const docId = 'episodic_purge_keep';
      const episodicData: EpisodicMemory = {
        userId: 'owner', groupId: 'purge-keep',
        summary: 'Episode to keep',
        topics: ['keep-test'],
        outcome: 'success', durationMs: 1000, recordedAt: Date.now(),
      };

      await db.insert(schema.oracleDocuments).values({
        id: docId, type: 'retro', sourceFile: 'memory://episodic/purge-keep',
        concepts: JSON.stringify(['memory:episodic', JSON.stringify(episodicData)]),
        createdAt: Date.now(), updatedAt: Date.now(), indexedAt: Date.now(),
        memoryLayer: 'episodic',
        expiresAt: Date.now() + 86400000, // expires tomorrow
        decayScore: 100,
      });

      await store.purgeExpired();

      const row = db.select().from(schema.oracleDocuments).where(eq(schema.oracleDocuments.id, docId)).get();
      expect(row).toBeDefined();
      expect(row!.memoryLayer).toBe('episodic');
    });

    it('removes unparseable expired episodes', async () => {
      const docId = 'episodic_purge_remove';

      await db.insert(schema.oracleDocuments).values({
        id: docId, type: 'retro', sourceFile: 'memory://episodic/bad',
        concepts: JSON.stringify(['memory:episodic', 'no-json-here']),
        createdAt: 1000, updatedAt: 1000, indexedAt: 1000,
        memoryLayer: 'episodic', expiresAt: Date.now() - 1, // expired
      });

      const result = await store.purgeExpired();
      expect(result.removed).toBeGreaterThanOrEqual(1);

      const row = db.select().from(schema.oracleDocuments).where(eq(schema.oracleDocuments.id, docId)).get();
      expect(row).toBeUndefined();
    });
  });

  // ============================================================
  // EpisodicMemory structure
  // ============================================================
  describe('EpisodicMemory structure', () => {
    it('contains all required fields', async () => {
      const id = await store.record({
        userId: 'owner',
        groupId: 'structure-test',
        summary: 'Testing structure',
        topics: ['test', 'structure'],
        outcome: 'success',
        durationMs: 42000,
      });

      const episode = await store.getById(id);
      expect(episode).not.toBeNull();
      expect(episode!.userId).toBe('owner');
      expect(episode!.groupId).toBe('structure-test');
      expect(episode!.summary).toBe('Testing structure');
      expect(episode!.topics).toEqual(['test', 'structure']);
      expect(episode!.outcome).toBe('success');
      expect(episode!.durationMs).toBe(42000);
      expect(episode!.recordedAt).toBeGreaterThan(0);
    });
  });
});

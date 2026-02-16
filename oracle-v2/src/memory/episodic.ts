/**
 * Episodic Memory Store (Layer 4 — Five-Layer Memory v0.7.0)
 *
 * เก็บ summarized conversation episodes: ใครทำอะไร เมื่อไหร่ ผลเป็นยังไง
 *
 * Storage strategy:
 *   - memory_layer = 'episodic'
 *   - type = 'retro' (reuse existing type)
 *   - id = 'episodic_{groupId}_{timestamp}'
 *   - concepts = ['memory:episodic', 'user:{userId}', 'group:{groupId}', ...topics]
 *   - expires_at = created_at + 90 days (TTL)
 *
 * TTL strategy:
 *   - Default: 90 วัน
 *   - Access ต่ออายุ: ถ้าถูก search hit → extend TTL +30 วัน
 *   - ก่อนลบ: archive เป็น compact summary (1 บรรทัด) เก็บถาวรใน type='retro'
 */

import { eq, sql, lte, and } from 'drizzle-orm';
import { db, sqlite, oracleDocuments } from '../db/index.js';
import { ChromaHttpClient } from '../chroma-http.js';
import { type EpisodicMemory, floatToInt } from '../types.js';
import { searchCache } from '../cache.js';

/** Default TTL: 90 days in ms */
const TTL_DEFAULT_MS = 90 * 24 * 60 * 60 * 1000;
/** Access extension: +30 days in ms */
const TTL_EXTEND_MS = 30 * 24 * 60 * 60 * 1000;

// Singleton ChromaDB client
let chromaClient: ChromaHttpClient | null = null;

function getChromaClient(): ChromaHttpClient {
  if (!chromaClient) {
    chromaClient = new ChromaHttpClient(
      'oracle_knowledge',
      process.env.CHROMA_URL || 'http://localhost:8000',
      process.env.CHROMA_AUTH_TOKEN,
    );
  }
  return chromaClient;
}

export class EpisodicStore {
  /**
   * บันทึก episode สรุปจากงาน
   */
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
    const expiresAt = now + TTL_DEFAULT_MS;

    const episodicData: EpisodicMemory = {
      userId: episode.userId,
      groupId: episode.groupId,
      summary: episode.summary,
      topics: episode.topics,
      outcome: episode.outcome,
      durationMs: episode.durationMs,
      recordedAt: now,
    };

    // Build concepts array
    const conceptsArray = [
      'memory:episodic',
      `user:${episode.userId}`,
      `group:${episode.groupId}`,
      ...episode.topics.map(t => `topic:${t}`),
      JSON.stringify(episodicData),
    ];

    // Insert into oracle_documents
    await db.insert(oracleDocuments).values({
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
    const ftsContent = `${episode.summary}\n${episode.topics.join(' ')}\n${episode.outcome}`;
    try {
      sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)').run(
        docId,
        ftsContent,
        conceptsArray.filter(c => !c.startsWith('{')).join(' '),
      );
    } catch { /* FTS5 failure non-critical */ }

    // Index into ChromaDB
    try {
      const client = getChromaClient();
      await client.addDocuments([{
        id: docId,
        document: `${episode.summary}\nTopics: ${episode.topics.join(', ')}\nOutcome: ${episode.outcome}`,
        metadata: {
          type: 'retro',
          memory_layer: 'episodic',
          user_id: episode.userId,
          group_id: episode.groupId,
          outcome: episode.outcome,
        },
      }]);
    } catch { /* ChromaDB failure non-critical */ }

    searchCache.invalidate();
    return docId;
  }

  /**
   * ค้นหา episodes ที่เกี่ยวข้องกับ topic
   * ค้นจาก FTS5 (ChromaDB too slow for simple lookups)
   */
  async findRelated(
    topic: string,
    userId?: string,
    limit: number = 5,
  ): Promise<EpisodicMemory[]> {
    const results: EpisodicMemory[] = [];

    // Strategy 1: ChromaDB vector search
    try {
      const client = getChromaClient();
      const chromaResults = await client.query(
        topic,
        limit * 2,
        { memory_layer: 'episodic' },
      );

      for (let i = 0; i < chromaResults.ids.length; i++) {
        const docId = chromaResults.ids[i];
        const row = await db
          .select()
          .from(oracleDocuments)
          .where(eq(oracleDocuments.id, docId));

        if (row.length > 0 && row[0].memoryLayer === 'episodic') {
          // Check TTL
          if (row[0].expiresAt && row[0].expiresAt < Date.now()) continue;
          // Filter by userId if specified
          const episode = this.parseEpisodicFromRow(row[0]);
          if (episode && (!userId || episode.userId === userId)) {
            // Extend TTL on access
            this.extendTtl(docId);
            results.push(episode);
          }
        }
      }
    } catch {
      // ChromaDB unavailable — fallback to FTS5
    }

    // Strategy 2: FTS5 fallback
    if (results.length === 0) {
      try {
        const sanitized = topic.replace(/['"]/g, '').substring(0, 200);

        // Build query with optional user filter
        let ftsQuery = 'SELECT f.id FROM oracle_fts f JOIN oracle_documents d ON f.id = d.id WHERE oracle_fts MATCH ? AND d.memory_layer = ?';
        const params: any[] = [sanitized, 'episodic'];

        if (userId) {
          // Filter concepts for user
          ftsQuery += ' AND d.concepts LIKE ?';
          params.push(`%user:${userId}%`);
        }

        // Only non-expired
        ftsQuery += ' AND (d.expires_at IS NULL OR d.expires_at > ?) ORDER BY d.created_at DESC LIMIT ?';
        params.push(Date.now(), limit * 2);

        const ftsRows = sqlite.prepare(ftsQuery).all(...params) as { id: string }[];

        for (const ftsRow of ftsRows) {
          const row = await db
            .select()
            .from(oracleDocuments)
            .where(eq(oracleDocuments.id, ftsRow.id));

          if (row.length > 0 && row[0].memoryLayer === 'episodic') {
            const episode = this.parseEpisodicFromRow(row[0]);
            if (episode) {
              this.extendTtl(ftsRow.id);
              results.push(episode);
            }
          }
        }
      } catch {
        // FTS5 query failed — return empty
      }
    }

    // Sort by recordedAt DESC and limit
    return results
      .sort((a, b) => b.recordedAt - a.recordedAt)
      .slice(0, limit);
  }

  /**
   * ลบ episodes ที่หมดอายุ (TTL expired)
   *
   * ก่อนลบ: archive เป็น compact summary → เก็บถาวรโดยเปลี่ยน memory_layer=null (semantic)
   */
  async purgeExpired(): Promise<{ removed: number; archived: number }> {
    const now = Date.now();
    let removed = 0;
    let archived = 0;

    // Find expired episodic docs
    const expired = db
      .select()
      .from(oracleDocuments)
      .where(
        and(
          eq(oracleDocuments.memoryLayer, 'episodic'),
          lte(oracleDocuments.expiresAt, now),
        ),
      )
      .all();

    for (const row of expired) {
      const episode = this.parseEpisodicFromRow(row);

      if (episode) {
        // Archive: convert to compact semantic retro (1-line summary, no TTL)
        db.update(oracleDocuments)
          .set({
            memoryLayer: null, // becomes semantic (legacy)
            expiresAt: null,
            decayScore: 50, // archived docs start at half-life
            updatedAt: now,
            concepts: JSON.stringify([
              'archived:episodic',
              `user:${episode.userId}`,
              ...episode.topics.map(t => `topic:${t}`),
            ]),
          })
          .where(eq(oracleDocuments.id, row.id))
          .run();
        archived++;
      } else {
        // Can't parse — just delete
        db.delete(oracleDocuments)
          .where(eq(oracleDocuments.id, row.id))
          .run();

        try {
          sqlite.prepare('DELETE FROM oracle_fts WHERE id = ?').run(row.id);
        } catch { /* non-critical */ }

        removed++;
      }
    }

    return { removed, archived };
  }

  /**
   * Get a specific episode by ID
   */
  async getById(id: string): Promise<EpisodicMemory | null> {
    const rows = await db
      .select()
      .from(oracleDocuments)
      .where(eq(oracleDocuments.id, id));

    if (rows.length === 0 || rows[0].memoryLayer !== 'episodic') return null;
    if (rows[0].expiresAt && rows[0].expiresAt < Date.now()) return null;

    return this.parseEpisodicFromRow(rows[0]);
  }

  /**
   * Extend TTL by 30 days on access
   */
  private extendTtl(docId: string): void {
    try {
      db.update(oracleDocuments)
        .set({
          expiresAt: sql`${oracleDocuments.expiresAt} + ${TTL_EXTEND_MS}`,
          accessCount: sql`COALESCE(${oracleDocuments.accessCount}, 0) + 1`,
          lastAccessedAt: Date.now(),
        })
        .where(eq(oracleDocuments.id, docId))
        .run();
    } catch { /* non-critical */ }
  }

  /**
   * Parse EpisodicMemory from oracle_documents row
   */
  private parseEpisodicFromRow(row: any): EpisodicMemory | null {
    try {
      const concepts = JSON.parse(row.concepts) as string[];
      const jsonStr = concepts.find(c => c.startsWith('{'));
      if (jsonStr) {
        return JSON.parse(jsonStr) as EpisodicMemory;
      }
    } catch {
      // Parse failed
    }
    return null;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let storeInstance: EpisodicStore | null = null;

export function getEpisodicStore(): EpisodicStore {
  if (!storeInstance) {
    storeInstance = new EpisodicStore();
  }
  return storeInstance;
}

export function resetEpisodicStore(): void {
  storeInstance = null;
}

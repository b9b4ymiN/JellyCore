/**
 * Procedural Memory Store (Layer 2 — Five-Layer Memory)
 *
 * เก็บ "วิธีทำงาน" ที่ AI เรียนรู้ ใน oracle_documents
 *   - memory_layer = 'procedural'
 *   - type = 'pattern' (reuse existing type)
 *   - concepts = ['memory:procedural', ...topic concepts]
 *
 * เรียนรู้จาก:
 *   - corrections: user แก้ AI → จำไว้
 *   - repeated_pattern: ทำซ้ำหลายครั้ง → สรุปเป็น procedure
 *   - explicit: user สอนตรงๆ "เวลาทำ X ให้ทำ Y"
 *
 * Merge logic: ถ้า trigger ซ้ำ (same docId hash) → merge procedure steps, increment successCount
 */

import { eq, sql, desc } from 'drizzle-orm';
import { db, sqlite, oracleDocuments } from '../db/index.js';
import { ChromaHttpClient } from '../chroma-http.js';
import { type ProceduralMemory, floatToInt, intToFloat } from '../types.js';
import { searchCache } from '../cache.js';
import crypto from 'crypto';

/** Hash trigger to create deterministic doc ID */
function hashTrigger(trigger: string): string {
  return crypto.createHash('sha256').update(trigger.toLowerCase().trim()).digest('hex').substring(0, 16);
}

/** Generate doc ID from trigger */
function makeDocId(trigger: string): string {
  return `procedural_${hashTrigger(trigger)}`;
}

// Singleton ChromaDB client for procedural memory vector search
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

export class ProceduralStore {
  /**
   * ค้นหา procedural memories ที่ match กับ task context
   * ใช้ semantic search (ChromaDB) → หา trigger ที่คล้ายกับ current task
   * Fallback to FTS5 if ChromaDB unavailable
   */
  async find(taskContext: string, limit: number = 3): Promise<ProceduralMemory[]> {
    const results: ProceduralMemory[] = [];

    // Strategy 1: Vector search via ChromaDB
    try {
      const client = getChromaClient();
      const chromaResults = await client.query(
        taskContext,
        limit * 2, // over-fetch then filter
        { memory_layer: 'procedural' },
      );

      for (let i = 0; i < chromaResults.ids.length; i++) {
        const docId = chromaResults.ids[i];
        const row = await db
          .select()
          .from(oracleDocuments)
          .where(eq(oracleDocuments.id, docId));

        if (row.length > 0 && row[0].memoryLayer === 'procedural') {
          const proc = this.parseProceduralFromRow(row[0]);
          if (proc) results.push(proc);
        }
      }
    } catch {
      // ChromaDB unavailable — fallback to FTS5
    }

    // Strategy 2: FTS5 fallback (if ChromaDB returned nothing)
    if (results.length === 0) {
      try {
        // Sanitize query for FTS5
        const sanitized = taskContext.replace(/['"]/g, '').substring(0, 200);
        const ftsRows = sqlite.prepare(`
          SELECT f.id FROM oracle_fts f
          WHERE oracle_fts MATCH ?
          LIMIT ?
        `).all(sanitized, limit * 2) as { id: string }[];

        for (const ftsRow of ftsRows) {
          const row = await db
            .select()
            .from(oracleDocuments)
            .where(eq(oracleDocuments.id, ftsRow.id));

          if (row.length > 0 && row[0].memoryLayer === 'procedural') {
            const proc = this.parseProceduralFromRow(row[0]);
            if (proc) results.push(proc);
          }
        }
      } catch {
        // FTS5 query failed — return empty
      }
    }

    // Sort by successCount DESC and limit
    return results
      .sort((a, b) => b.successCount - a.successCount)
      .slice(0, limit);
  }

  /**
   * บันทึก procedural pattern ใหม่
   * ถ้ามี trigger ซ้ำ (same hash) → merge แทน create
   */
  async learn(memory: Omit<ProceduralMemory, 'successCount' | 'lastUsed'>): Promise<string> {
    const docId = makeDocId(memory.trigger);
    const now = Date.now();

    // Check if exists
    const existing = await db
      .select()
      .from(oracleDocuments)
      .where(eq(oracleDocuments.id, docId));

    if (existing.length > 0) {
      // Merge: combine procedure steps, increment count
      const existingProc = this.parseProceduralFromRow(existing[0]);
      if (existingProc) {
        // Merge procedure steps (deduplicate)
        const mergedSteps = [...existingProc.procedure];
        for (const step of memory.procedure) {
          if (!mergedSteps.includes(step)) {
            mergedSteps.push(step);
          }
        }

        const merged: ProceduralMemory = {
          trigger: memory.trigger,
          procedure: mergedSteps,
          source: memory.source,
          successCount: existingProc.successCount + 1,
          lastUsed: now,
        };

        const conceptsArray = this.buildConcepts(merged);

        await db
          .update(oracleDocuments)
          .set({
            concepts: JSON.stringify(conceptsArray),
            updatedAt: now,
            accessCount: sql`COALESCE(${oracleDocuments.accessCount}, 0) + 1`,
            lastAccessedAt: now,
          })
          .where(eq(oracleDocuments.id, docId));

        // Update FTS5
        try {
          sqlite.prepare('DELETE FROM oracle_fts WHERE id = ?').run(docId);
          sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)').run(
            docId,
            `${merged.trigger}\n${merged.procedure.join('\n')}`,
            conceptsArray.filter(c => !c.startsWith('{')).join(' '),
          );
        } catch { /* FTS5 failure non-critical */ }

        // Update ChromaDB
        try {
          const client = getChromaClient();
          await client.addDocuments([{
            id: docId,
            document: `${merged.trigger}\n${merged.procedure.join('\n')}`,
            metadata: {
              type: 'pattern',
              memory_layer: 'procedural',
              source: merged.source,
              success_count: String(merged.successCount),
            },
          }]);
        } catch { /* ChromaDB failure non-critical */ }

        searchCache.invalidate();
        return docId;
      }
    }

    // INSERT new procedural memory
    const proc: ProceduralMemory = {
      trigger: memory.trigger,
      procedure: memory.procedure,
      source: memory.source,
      successCount: 1,
      lastUsed: now,
    };

    const conceptsArray = this.buildConcepts(proc);

    await db.insert(oracleDocuments).values({
      id: docId,
      type: 'pattern',
      sourceFile: `memory://procedural/${hashTrigger(memory.trigger)}`,
      concepts: JSON.stringify(conceptsArray),
      createdAt: now,
      updatedAt: now,
      indexedAt: now,
      memoryLayer: 'procedural',
      confidence: floatToInt(0.7), // starts moderate, grows with success
      accessCount: 0,
      decayScore: 100,
      createdBy: 'memory_system',
    });

    // Index into FTS5
    try {
      sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)').run(
        docId,
        `${proc.trigger}\n${proc.procedure.join('\n')}`,
        conceptsArray.filter(c => !c.startsWith('{')).join(' '),
      );
    } catch { /* FTS5 failure non-critical */ }

    // Index into ChromaDB
    try {
      const client = getChromaClient();
      await client.addDocuments([{
        id: docId,
        document: `${proc.trigger}\n${proc.procedure.join('\n')}`,
        metadata: {
          type: 'pattern',
          memory_layer: 'procedural',
          source: proc.source,
          success_count: '1',
        },
      }]);
    } catch { /* ChromaDB failure non-critical */ }

    searchCache.invalidate();
    return docId;
  }

  /**
   * บันทึกว่า procedure ถูกใช้แล้ว (เพิ่ม successCount)
   */
  async recordUsage(id: string): Promise<void> {
    const now = Date.now();

    const rows = await db
      .select()
      .from(oracleDocuments)
      .where(eq(oracleDocuments.id, id));

    if (rows.length === 0) return;

    const proc = this.parseProceduralFromRow(rows[0]);
    if (!proc) return;

    proc.successCount += 1;
    proc.lastUsed = now;

    const conceptsArray = this.buildConcepts(proc);

    await db
      .update(oracleDocuments)
      .set({
        concepts: JSON.stringify(conceptsArray),
        updatedAt: now,
        accessCount: sql`COALESCE(${oracleDocuments.accessCount}, 0) + 1`,
        lastAccessedAt: now,
        // Boost confidence as success grows (max 0.95)
        confidence: floatToInt(Math.min(0.95, 0.7 + proc.successCount * 0.025)),
      })
      .where(eq(oracleDocuments.id, id));
  }

  /**
   * ดึง procedural memory by ID
   */
  async getById(id: string): Promise<ProceduralMemory | null> {
    const rows = await db
      .select()
      .from(oracleDocuments)
      .where(eq(oracleDocuments.id, id));

    if (rows.length === 0) return null;
    return this.parseProceduralFromRow(rows[0]);
  }

  // ── Internal helpers ──

  private buildConcepts(proc: ProceduralMemory): string[] {
    // Extract topic words from trigger
    const words = proc.trigger
      .toLowerCase()
      .replace(/[^\w\sก-๛]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2)
      .slice(0, 10);

    return [
      'memory:procedural',
      ...words.map(w => `topic:${w}`),
      JSON.stringify(proc), // last element is the full ProceduralMemory JSON
    ];
  }

  private parseProceduralFromRow(row: { concepts: string; memoryLayer?: string | null }): ProceduralMemory | null {
    if (row.memoryLayer !== 'procedural') return null;

    try {
      const concepts = JSON.parse(row.concepts) as string[];
      const procJson = concepts.find(c => c.startsWith('{'));
      if (procJson) {
        return JSON.parse(procJson) as ProceduralMemory;
      }
    } catch { /* parse failure */ }

    return null;
  }
}

// Singleton
let _store: ProceduralStore | null = null;
export function getProceduralStore(): ProceduralStore {
  if (!_store) {
    _store = new ProceduralStore();
  }
  return _store;
}

// For testing — reset singleton
export function resetProceduralStore(): void {
  _store = null;
}

export { makeDocId, hashTrigger };

/**
 * Part C — Procedural Memory Layer Tests
 *
 * ทดสอบ Procedural Memory Store:
 * 1. learn() → สร้าง procedural memory ใหม่
 * 2. learn() → merge เมื่อ trigger ซ้ำ
 * 3. find() → ค้นหาด้วย FTS5 fallback (ไม่มี ChromaDB ใน test)
 * 4. recordUsage() → เพิ่ม successCount
 * 5. getById()
 * 6. hashTrigger/makeDocId deterministic
 * 7. DB row metadata ถูกต้อง
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq, sql } from "drizzle-orm";
import { existsSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

import * as schema from "../db/schema";
import { type ProceduralMemory, floatToInt, intToFloat } from "../types";
import { hashTrigger, makeDocId } from "../memory/procedural";

const TEST_DB_PATH = join(homedir(), ".oracle-v2", "test-procedural.db");
const PROJECT_ROOT = join(import.meta.dir, "../..");

let sqliteDb: Database;
let db: ReturnType<typeof drizzle>;

/**
 * Minimal ProceduralStore reimplementation for testing
 * (uses test db, no ChromaDB, FTS5 only)
 */
class TestProceduralStore {
  async learn(memory: Omit<ProceduralMemory, 'successCount' | 'lastUsed'>): Promise<string> {
    const docId = makeDocId(memory.trigger);
    const now = Date.now();

    const existing = await db
      .select()
      .from(schema.oracleDocuments)
      .where(eq(schema.oracleDocuments.id, docId));

    if (existing.length > 0) {
      const existingProc = this.parseProceduralFromRow(existing[0]);
      if (existingProc) {
        const mergedSteps = [...existingProc.procedure];
        for (const step of memory.procedure) {
          if (!mergedSteps.includes(step)) mergedSteps.push(step);
        }

        const merged: ProceduralMemory = {
          trigger: memory.trigger,
          procedure: mergedSteps,
          source: memory.source,
          successCount: existingProc.successCount + 1,
          lastUsed: now,
        };

        const conceptsArray = this.buildConcepts(merged);

        await db.update(schema.oracleDocuments)
          .set({
            concepts: JSON.stringify(conceptsArray),
            updatedAt: now,
            accessCount: sql`COALESCE(${schema.oracleDocuments.accessCount}, 0) + 1`,
            lastAccessedAt: now,
          })
          .where(eq(schema.oracleDocuments.id, docId));

        // Update FTS5
        try {
          sqliteDb.prepare('DELETE FROM oracle_fts WHERE id = ?').run(docId);
          sqliteDb.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)').run(
            docId,
            `${merged.trigger}\n${merged.procedure.join('\n')}`,
            conceptsArray.filter(c => !c.startsWith('{')).join(' '),
          );
        } catch {}

        return docId;
      }
    }

    // New
    const proc: ProceduralMemory = {
      trigger: memory.trigger,
      procedure: memory.procedure,
      source: memory.source,
      successCount: 1,
      lastUsed: now,
    };
    const conceptsArray = this.buildConcepts(proc);

    await db.insert(schema.oracleDocuments).values({
      id: docId,
      type: 'pattern',
      sourceFile: `memory://procedural/${hashTrigger(memory.trigger)}`,
      concepts: JSON.stringify(conceptsArray),
      createdAt: now,
      updatedAt: now,
      indexedAt: now,
      memoryLayer: 'procedural',
      confidence: floatToInt(0.7),
      accessCount: 0,
      decayScore: 100,
      createdBy: 'memory_system',
    });

    // FTS5
    try {
      sqliteDb.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)').run(
        docId,
        `${proc.trigger}\n${proc.procedure.join('\n')}`,
        conceptsArray.filter(c => !c.startsWith('{')).join(' '),
      );
    } catch {}

    return docId;
  }

  async recordUsage(id: string): Promise<void> {
    const now = Date.now();
    const rows = await db
      .select()
      .from(schema.oracleDocuments)
      .where(eq(schema.oracleDocuments.id, id));

    if (rows.length === 0) return;
    const proc = this.parseProceduralFromRow(rows[0]);
    if (!proc) return;

    proc.successCount += 1;
    proc.lastUsed = now;
    const conceptsArray = this.buildConcepts(proc);

    await db.update(schema.oracleDocuments)
      .set({
        concepts: JSON.stringify(conceptsArray),
        updatedAt: now,
        accessCount: sql`COALESCE(${schema.oracleDocuments.accessCount}, 0) + 1`,
        lastAccessedAt: now,
        confidence: floatToInt(Math.min(0.95, 0.7 + proc.successCount * 0.025)),
      })
      .where(eq(schema.oracleDocuments.id, id));
  }

  async getById(id: string): Promise<ProceduralMemory | null> {
    const rows = await db
      .select()
      .from(schema.oracleDocuments)
      .where(eq(schema.oracleDocuments.id, id));
    if (rows.length === 0) return null;
    return this.parseProceduralFromRow(rows[0]);
  }

  async findByFts(query: string, limit: number = 3): Promise<ProceduralMemory[]> {
    const results: ProceduralMemory[] = [];
    try {
      const sanitized = query.replace(/['"]/g, '').substring(0, 200);
      const ftsRows = sqliteDb.prepare(`
        SELECT f.id FROM oracle_fts f
        WHERE oracle_fts MATCH ?
        LIMIT ?
      `).all(sanitized, limit * 2) as { id: string }[];

      for (const ftsRow of ftsRows) {
        const row = await db
          .select()
          .from(schema.oracleDocuments)
          .where(eq(schema.oracleDocuments.id, ftsRow.id));

        if (row.length > 0 && row[0].memoryLayer === 'procedural') {
          const proc = this.parseProceduralFromRow(row[0]);
          if (proc) results.push(proc);
        }
      }
    } catch {}
    return results.sort((a, b) => b.successCount - a.successCount).slice(0, limit);
  }

  private buildConcepts(proc: ProceduralMemory): string[] {
    const words = proc.trigger
      .toLowerCase()
      .replace(/[^\w\sก-๛]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2)
      .slice(0, 10);
    return [
      'memory:procedural',
      ...words.map(w => `topic:${w}`),
      JSON.stringify(proc),
    ];
  }

  private parseProceduralFromRow(row: { concepts: string; memoryLayer?: string | null }): ProceduralMemory | null {
    if (row.memoryLayer !== 'procedural') return null;
    try {
      const concepts = JSON.parse(row.concepts) as string[];
      const procJson = concepts.find(c => c.startsWith('{'));
      if (procJson) return JSON.parse(procJson) as ProceduralMemory;
    } catch {}
    return null;
  }
}

describe("Part C — Procedural Memory Layer", () => {
  let store: TestProceduralStore;

  beforeAll(async () => {
    const dir = join(homedir(), ".oracle-v2");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);

    sqliteDb = new Database(TEST_DB_PATH);
    db = drizzle(sqliteDb, { schema });

    // Apply migrations
    const migrationsDir = join(PROJECT_ROOT, "src/db/migrations");
    for (const file of ["0000_unknown_viper.sql", "0001_chunky_dark_phoenix.sql", "0002_mixed_rhodey.sql", "0003_rapid_strong_guy.sql"]) {
      const sqlPath = join(migrationsDir, file);
      if (existsSync(sqlPath)) {
        const sqlContent = readFileSync(sqlPath, "utf-8");
        for (const stmt of sqlContent.split("--> statement-breakpoint").filter(s => s.trim())) {
          try { if (stmt.trim()) sqliteDb.exec(stmt); } catch {}
        }
      }
    }

    // ensureSchema columns
    const cols = sqliteDb.prepare("PRAGMA table_info('oracle_documents')").all() as { name: string }[];
    const existing = new Set(cols.map(c => c.name));
    for (const [col, ddl] of [
      ['is_private', 'ALTER TABLE oracle_documents ADD COLUMN is_private INTEGER DEFAULT 0'],
      ['embedding_model', "ALTER TABLE oracle_documents ADD COLUMN embedding_model TEXT DEFAULT 'all-MiniLM-L6-v2'"],
      ['embedding_version', 'ALTER TABLE oracle_documents ADD COLUMN embedding_version INTEGER DEFAULT 1'],
      ['embedding_hash', 'ALTER TABLE oracle_documents ADD COLUMN embedding_hash TEXT'],
      ['chunk_index', 'ALTER TABLE oracle_documents ADD COLUMN chunk_index INTEGER'],
      ['total_chunks', 'ALTER TABLE oracle_documents ADD COLUMN total_chunks INTEGER'],
      ['parent_id', 'ALTER TABLE oracle_documents ADD COLUMN parent_id TEXT'],
      ['memory_layer', 'ALTER TABLE oracle_documents ADD COLUMN memory_layer TEXT'],
      ['confidence', 'ALTER TABLE oracle_documents ADD COLUMN confidence INTEGER'],
      ['access_count', 'ALTER TABLE oracle_documents ADD COLUMN access_count INTEGER DEFAULT 0'],
      ['last_accessed_at', 'ALTER TABLE oracle_documents ADD COLUMN last_accessed_at INTEGER'],
      ['decay_score', 'ALTER TABLE oracle_documents ADD COLUMN decay_score INTEGER DEFAULT 100'],
      ['expires_at', 'ALTER TABLE oracle_documents ADD COLUMN expires_at INTEGER'],
    ] as [string, string][]) {
      if (!existing.has(col)) sqliteDb.exec(ddl);
    }
    sqliteDb.exec('CREATE INDEX IF NOT EXISTS idx_memory_layer ON oracle_documents(memory_layer)');

    // Create FTS5
    sqliteDb.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS oracle_fts USING fts5(
        id UNINDEXED, content, concepts,
        tokenize='porter unicode61'
      );
    `);

    store = new TestProceduralStore();
  });

  afterAll(() => {
    sqliteDb.close();
    try { if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH); } catch {}
  });

  // ─── hashTrigger / makeDocId ──────────────────────
  describe("hashTrigger / makeDocId", () => {
    test("deterministic hash", () => {
      const h1 = hashTrigger("deploy Docker");
      const h2 = hashTrigger("deploy Docker");
      expect(h1).toBe(h2);
      expect(h1.length).toBe(16);
    });

    test("case-insensitive hash", () => {
      const h1 = hashTrigger("Deploy Docker");
      const h2 = hashTrigger("deploy docker");
      expect(h1).toBe(h2);
    });

    test("trims whitespace", () => {
      const h1 = hashTrigger("  deploy Docker  ");
      const h2 = hashTrigger("deploy Docker");
      expect(h1).toBe(h2);
    });

    test("different triggers → different hashes", () => {
      const h1 = hashTrigger("deploy Docker");
      const h2 = hashTrigger("debug TypeScript");
      expect(h1).not.toBe(h2);
    });

    test("makeDocId format", () => {
      const id = makeDocId("deploy Docker");
      expect(id).toMatch(/^procedural_[a-f0-9]{16}$/);
    });
  });

  // ─── learn() ──────────────────────────────────────
  describe("learn()", () => {
    test("creates new procedural memory", async () => {
      const id = await store.learn({
        trigger: "deploy Docker container",
        procedure: ["check config", "build image", "run container"],
        source: "explicit",
      });

      expect(id).toMatch(/^procedural_/);

      const proc = await store.getById(id);
      expect(proc).not.toBeNull();
      expect(proc!.trigger).toBe("deploy Docker container");
      expect(proc!.procedure).toEqual(["check config", "build image", "run container"]);
      expect(proc!.source).toBe("explicit");
      expect(proc!.successCount).toBe(1);
    });

    test("DB row has correct metadata", async () => {
      const id = makeDocId("deploy Docker container");
      const rows = await db
        .select()
        .from(schema.oracleDocuments)
        .where(eq(schema.oracleDocuments.id, id));

      expect(rows.length).toBe(1);
      expect(rows[0].memoryLayer).toBe("procedural");
      expect(rows[0].type).toBe("pattern");
      expect(rows[0].confidence).toBe(floatToInt(0.7));
      expect(rows[0].decayScore).toBe(100);
      expect(rows[0].createdBy).toBe("memory_system");
      expect(rows[0].sourceFile).toContain("memory://procedural/");
    });

    test("merge on duplicate trigger", async () => {
      const id1 = await store.learn({
        trigger: "deploy Docker container",
        procedure: ["push to registry"],
        source: "repeated_pattern",
      });

      const proc = await store.getById(id1);
      expect(proc).not.toBeNull();
      // Should have merged steps
      expect(proc!.procedure).toContain("check config");
      expect(proc!.procedure).toContain("build image");
      expect(proc!.procedure).toContain("run container");
      expect(proc!.procedure).toContain("push to registry");
      expect(proc!.successCount).toBe(2); // incremented
    });

    test("duplicate steps not added twice", async () => {
      await store.learn({
        trigger: "deploy Docker container",
        procedure: ["check config", "new step"],
        source: "correction",
      });

      const proc = await store.getById(makeDocId("deploy Docker container"));
      // "check config" should appear only once
      const checkConfigCount = proc!.procedure.filter(s => s === "check config").length;
      expect(checkConfigCount).toBe(1);
      expect(proc!.procedure).toContain("new step");
      expect(proc!.successCount).toBe(3);
    });

    test("different trigger creates separate doc", async () => {
      const id = await store.learn({
        trigger: "debug TypeScript error",
        procedure: ["read error message", "check imports", "run tsc"],
        source: "correction",
      });

      expect(id).not.toBe(makeDocId("deploy Docker container"));
      const proc = await store.getById(id);
      expect(proc!.trigger).toBe("debug TypeScript error");
      expect(proc!.successCount).toBe(1);
    });

    test("Thai trigger works", async () => {
      const id = await store.learn({
        trigger: "เมื่อ user ถามเรื่อง จัดการ database",
        procedure: ["ถามว่าใช้ DB อะไร", "ตรวจ schema", "แนะนำ migration"],
        source: "explicit",
      });

      const proc = await store.getById(id);
      expect(proc).not.toBeNull();
      expect(proc!.trigger).toContain("database");
    });
  });

  // ─── recordUsage() ────────────────────────────────
  describe("recordUsage()", () => {
    test("increments successCount", async () => {
      const id = makeDocId("deploy Docker container");
      const before = await store.getById(id);
      const beforeCount = before!.successCount;

      await store.recordUsage(id);

      const after = await store.getById(id);
      expect(after!.successCount).toBe(beforeCount + 1);
    });

    test("updates lastUsed", async () => {
      const id = makeDocId("deploy Docker container");
      const before = await store.getById(id);
      const beforeUsed = before!.lastUsed;

      await new Promise(r => setTimeout(r, 10));
      await store.recordUsage(id);

      const after = await store.getById(id);
      expect(after!.lastUsed).toBeGreaterThan(beforeUsed);
    });

    test("increases access_count in DB", async () => {
      const id = makeDocId("deploy Docker container");

      const rowsBefore = await db.select().from(schema.oracleDocuments)
        .where(eq(schema.oracleDocuments.id, id));
      const accessBefore = rowsBefore[0].accessCount || 0;

      await store.recordUsage(id);

      const rowsAfter = await db.select().from(schema.oracleDocuments)
        .where(eq(schema.oracleDocuments.id, id));
      expect(rowsAfter[0].accessCount).toBe(accessBefore + 1);
    });

    test("boosts confidence with usage", async () => {
      const id = makeDocId("deploy Docker container");

      // Record usage many times to see confidence increase
      for (let i = 0; i < 5; i++) {
        await store.recordUsage(id);
      }

      const rows = await db.select().from(schema.oracleDocuments)
        .where(eq(schema.oracleDocuments.id, id));
      const conf = intToFloat(rows[0].confidence!);
      expect(conf).toBeGreaterThan(0.7); // started at 0.7, should be higher now
      expect(conf).toBeLessThanOrEqual(0.95); // capped at 0.95
    });

    test("non-existent ID is no-op", async () => {
      // Should not throw
      await store.recordUsage("nonexistent_procedural_id");
    });
  });

  // ─── getById() ────────────────────────────────────
  describe("getById()", () => {
    test("returns null for non-existent", async () => {
      const proc = await store.getById("nonexistent");
      expect(proc).toBeNull();
    });

    test("returns correct ProceduralMemory", async () => {
      const id = makeDocId("debug TypeScript error");
      const proc = await store.getById(id);
      expect(proc).not.toBeNull();
      expect(proc!.trigger).toBe("debug TypeScript error");
      expect(proc!.procedure.length).toBe(3);
    });
  });

  // ─── FTS5 search ──────────────────────────────────
  describe("FTS5 search", () => {
    test("find by keyword in trigger", async () => {
      const results = await store.findByFts("docker deploy");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].trigger).toContain("Docker");
    });

    test("find by keyword in procedure steps", async () => {
      const results = await store.findByFts("check config");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    test("results sorted by successCount", async () => {
      const results = await store.findByFts("docker");
      if (results.length >= 2) {
        expect(results[0].successCount).toBeGreaterThanOrEqual(results[1].successCount);
      }
    });

    test("respects limit", async () => {
      const results = await store.findByFts("docker", 1);
      expect(results.length).toBeLessThanOrEqual(1);
    });

    test("no results for unrelated query", async () => {
      const results = await store.findByFts("quantum_physics_unrelated_xyz");
      expect(results.length).toBe(0);
    });
  });

  // ─── concepts structure ───────────────────────────
  describe("concepts structure", () => {
    test("concepts contain memory:procedural marker", async () => {
      const id = makeDocId("debug TypeScript error");
      const rows = await db.select().from(schema.oracleDocuments)
        .where(eq(schema.oracleDocuments.id, id));

      const concepts = JSON.parse(rows[0].concepts) as string[];
      expect(concepts[0]).toBe("memory:procedural");
    });

    test("concepts contain topic: keywords", async () => {
      const id = makeDocId("debug TypeScript error");
      const rows = await db.select().from(schema.oracleDocuments)
        .where(eq(schema.oracleDocuments.id, id));

      const concepts = JSON.parse(rows[0].concepts) as string[];
      const topics = concepts.filter(c => c.startsWith("topic:"));
      expect(topics.length).toBeGreaterThan(0);
    });

    test("last concept element is JSON", async () => {
      const id = makeDocId("debug TypeScript error");
      const rows = await db.select().from(schema.oracleDocuments)
        .where(eq(schema.oracleDocuments.id, id));

      const concepts = JSON.parse(rows[0].concepts) as string[];
      const jsonElement = concepts[concepts.length - 1];
      const parsed = JSON.parse(jsonElement);
      expect(parsed.trigger).toBe("debug TypeScript error");
      expect(parsed.procedure).toBeDefined();
    });
  });
});

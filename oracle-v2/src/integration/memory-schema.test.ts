/**
 * Part A — Schema & Type Extensions (Memory Layer System) Tests
 *
 * ทดสอบ foundation ของ Five-Layer Memory System:
 * 1. Schema migration — columns ใหม่ถูกเพิ่มได้
 * 2. CRUD operations กับ memory layer columns
 * 3. Type helpers — intToFloat, floatToInt, getEffectiveLayer
 * 4. Index performance — idx_memory_layer, idx_decay_score, idx_expires_at
 * 5. Backward compatibility — legacy docs (null layer) ยังทำงานได้
 * 6. Default values — access_count=0, decay_score=100
 * 7. UserModel / ProceduralMemory / EpisodicMemory type validation
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq, isNull, isNotNull, sql, and, inArray } from "drizzle-orm";
import { existsSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// Import schema
import * as schema from "../db/schema";

// Import types
import {
  type MemoryLayer,
  type UserModel,
  type ProceduralMemory,
  type EpisodicMemory,
  type OracleDocument,
  DEFAULT_USER_MODEL,
  getEffectiveLayer,
  intToFloat,
  floatToInt,
} from "../types";

// Test database (separate from production & other tests)
const TEST_DB_PATH = join(homedir(), ".oracle-v2", "test-memory-schema.db");
const PROJECT_ROOT = join(import.meta.dir, "../..");

let sqlite: Database;
let db: ReturnType<typeof drizzle>;

describe("Part A — Memory Layer Schema & Types", () => {
  beforeAll(async () => {
    // Ensure directory exists
    const dir = join(homedir(), ".oracle-v2");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Create fresh test database
    if (existsSync(TEST_DB_PATH)) {
      rmSync(TEST_DB_PATH);
    }

    sqlite = new Database(TEST_DB_PATH);
    db = drizzle(sqlite, { schema });

    // Apply migrations from migration files
    const migrationsDir = join(PROJECT_ROOT, "src/db/migrations");
    const migrationFiles = [
      "0000_unknown_viper.sql",
      "0001_chunky_dark_phoenix.sql",
      "0002_mixed_rhodey.sql",
      "0003_rapid_strong_guy.sql",
    ];

    for (const file of migrationFiles) {
      const sqlPath = join(migrationsDir, file);
      if (existsSync(sqlPath)) {
        const sqlContent = readFileSync(sqlPath, "utf-8");
        const statements = sqlContent.split("--> statement-breakpoint").filter(s => s.trim());
        for (const stmt of statements) {
          if (stmt.trim()) {
            try {
              sqlite.exec(stmt);
            } catch {
              // Ignore errors for already existing objects
            }
          }
        }
      }
    }

    // Apply ensureSchema() migrations (columns added after initial migration files)
    const columns = sqlite.prepare("PRAGMA table_info('oracle_documents')").all() as { name: string }[];
    const existing = new Set(columns.map(c => c.name));

    const allMigrations: [string, string][] = [
      // Pre-v0.7.0 ensureSchema columns
      ['is_private', 'ALTER TABLE oracle_documents ADD COLUMN is_private INTEGER DEFAULT 0'],
      ['embedding_model', "ALTER TABLE oracle_documents ADD COLUMN embedding_model TEXT DEFAULT 'all-MiniLM-L6-v2'"],
      ['embedding_version', 'ALTER TABLE oracle_documents ADD COLUMN embedding_version INTEGER DEFAULT 1'],
      ['embedding_hash', 'ALTER TABLE oracle_documents ADD COLUMN embedding_hash TEXT'],
      ['chunk_index', 'ALTER TABLE oracle_documents ADD COLUMN chunk_index INTEGER'],
      ['total_chunks', 'ALTER TABLE oracle_documents ADD COLUMN total_chunks INTEGER'],
      ['parent_id', 'ALTER TABLE oracle_documents ADD COLUMN parent_id TEXT'],
      // v0.7.0: Memory layer system (Phase 4)
      ['memory_layer', 'ALTER TABLE oracle_documents ADD COLUMN memory_layer TEXT'],
      ['confidence', 'ALTER TABLE oracle_documents ADD COLUMN confidence INTEGER'],
      ['access_count', 'ALTER TABLE oracle_documents ADD COLUMN access_count INTEGER DEFAULT 0'],
      ['last_accessed_at', 'ALTER TABLE oracle_documents ADD COLUMN last_accessed_at INTEGER'],
      ['decay_score', 'ALTER TABLE oracle_documents ADD COLUMN decay_score INTEGER DEFAULT 100'],
      ['expires_at', 'ALTER TABLE oracle_documents ADD COLUMN expires_at INTEGER'],
    ];

    for (const [col, ddl] of allMigrations) {
      if (!existing.has(col)) {
        sqlite.exec(ddl);
      }
    }

    // Create indexes
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_embedding_model ON oracle_documents(embedding_model)');
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_parent_id ON oracle_documents(parent_id)');
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_memory_layer ON oracle_documents(memory_layer)');
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_decay_score ON oracle_documents(decay_score)');
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_expires_at ON oracle_documents(expires_at)');

    // Ensure search_log has results column
    try {
      sqlite.exec('ALTER TABLE search_log ADD COLUMN results TEXT');
    } catch { /* may already exist */ }

    // Create FTS5 table
    sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS oracle_fts USING fts5(
        id UNINDEXED,
        content,
        concepts,
        tokenize='porter unicode61'
      );
    `);
  });

  afterAll(() => {
    sqlite.close();
    // Clean up test database (ignore EBUSY on Windows)
    try {
      if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
      if (existsSync(TEST_DB_PATH + "-wal")) rmSync(TEST_DB_PATH + "-wal");
      if (existsSync(TEST_DB_PATH + "-shm")) rmSync(TEST_DB_PATH + "-shm");
    } catch {
      // Windows may hold file locks briefly after close — acceptable
    }
  });

  // =========================================================================
  // 1. Schema Migration — columns exist and have correct types
  // =========================================================================
  describe("Schema Migration", () => {
    test("memory_layer column exists", () => {
      const columns = sqlite.prepare("PRAGMA table_info('oracle_documents')").all() as {
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
      }[];
      const col = columns.find(c => c.name === "memory_layer");
      expect(col).toBeDefined();
      expect(col!.type).toBe("TEXT");
      expect(col!.notnull).toBe(0); // nullable
    });

    test("confidence column exists (INTEGER)", () => {
      const columns = sqlite.prepare("PRAGMA table_info('oracle_documents')").all() as {
        name: string;
        type: string;
      }[];
      const col = columns.find(c => c.name === "confidence");
      expect(col).toBeDefined();
      expect(col!.type).toBe("INTEGER");
    });

    test("access_count column exists with DEFAULT 0", () => {
      const columns = sqlite.prepare("PRAGMA table_info('oracle_documents')").all() as {
        name: string;
        type: string;
        dflt_value: string | null;
      }[];
      const col = columns.find(c => c.name === "access_count");
      expect(col).toBeDefined();
      expect(col!.dflt_value).toBe("0");
    });

    test("last_accessed_at column exists", () => {
      const columns = sqlite.prepare("PRAGMA table_info('oracle_documents')").all() as {
        name: string;
        type: string;
      }[];
      const col = columns.find(c => c.name === "last_accessed_at");
      expect(col).toBeDefined();
      expect(col!.type).toBe("INTEGER");
    });

    test("decay_score column exists with DEFAULT 100", () => {
      const columns = sqlite.prepare("PRAGMA table_info('oracle_documents')").all() as {
        name: string;
        dflt_value: string | null;
      }[];
      const col = columns.find(c => c.name === "decay_score");
      expect(col).toBeDefined();
      expect(col!.dflt_value).toBe("100");
    });

    test("expires_at column exists", () => {
      const columns = sqlite.prepare("PRAGMA table_info('oracle_documents')").all() as {
        name: string;
        type: string;
      }[];
      const col = columns.find(c => c.name === "expires_at");
      expect(col).toBeDefined();
      expect(col!.type).toBe("INTEGER");
    });

    test("all 6 new columns present", () => {
      const columns = sqlite.prepare("PRAGMA table_info('oracle_documents')").all() as {
        name: string;
      }[];
      const colNames = new Set(columns.map(c => c.name));
      const expected = ['memory_layer', 'confidence', 'access_count', 'last_accessed_at', 'decay_score', 'expires_at'];
      for (const name of expected) {
        expect(colNames.has(name)).toBe(true);
      }
    });

    test("indexes exist for new columns", () => {
      const indexes = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as {
        name: string;
      }[];
      const indexNames = new Set(indexes.map(i => i.name));
      expect(indexNames.has("idx_memory_layer")).toBe(true);
      expect(indexNames.has("idx_decay_score")).toBe(true);
      expect(indexNames.has("idx_expires_at")).toBe(true);
    });
  });

  // =========================================================================
  // 2. Backward Compatibility — legacy documents (null memory_layer)
  // =========================================================================
  describe("Backward Compatibility", () => {
    const now = Date.now();

    test("INSERT legacy document (no memory layer fields) works", async () => {
      await db.insert(schema.oracleDocuments).values({
        id: "legacy_doc_1",
        type: "learning",
        sourceFile: "/test/legacy.md",
        concepts: JSON.stringify(["legacy", "test"]),
        createdAt: now,
        updatedAt: now,
        indexedAt: now,
      });

      const docs = await db
        .select()
        .from(schema.oracleDocuments)
        .where(eq(schema.oracleDocuments.id, "legacy_doc_1"));

      expect(docs.length).toBe(1);
      expect(docs[0].memoryLayer).toBeNull();
      expect(docs[0].accessCount).toBe(0);  // DEFAULT 0
      expect(docs[0].decayScore).toBe(100); // DEFAULT 100
      expect(docs[0].confidence).toBeNull();
      expect(docs[0].lastAccessedAt).toBeNull();
      expect(docs[0].expiresAt).toBeNull();
    });

    test("legacy doc type and source_file unchanged", async () => {
      const docs = await db
        .select()
        .from(schema.oracleDocuments)
        .where(eq(schema.oracleDocuments.id, "legacy_doc_1"));

      expect(docs[0].type).toBe("learning");
      expect(docs[0].sourceFile).toBe("/test/legacy.md");
    });

    test("SELECT with isNull(memoryLayer) finds legacy docs", async () => {
      const legacyDocs = await db
        .select()
        .from(schema.oracleDocuments)
        .where(isNull(schema.oracleDocuments.memoryLayer));

      expect(legacyDocs.length).toBeGreaterThanOrEqual(1);
      expect(legacyDocs.every(d => d.memoryLayer === null)).toBe(true);
    });
  });

  // =========================================================================
  // 3. CRUD with Memory Layer Columns
  // =========================================================================
  describe("CRUD with Memory Layer Columns", () => {
    const now = Date.now();

    test("INSERT user_model document", async () => {
      const userModel: UserModel = {
        userId: "test_user",
        expertise: { docker: "expert", typescript: "advanced" },
        preferences: { language: "th", responseLength: "concise", responseStyle: "casual" },
        commonTopics: ["docker", "oracle-v2"],
        timezone: "Asia/Bangkok",
        notes: ["ชอบให้ตอบสั้นๆ"],
        updatedAt: now,
      };

      await db.insert(schema.oracleDocuments).values({
        id: "user_model_test_user",
        type: "learning",
        sourceFile: "memory://user_model/test_user",
        concepts: JSON.stringify(["memory:user_model", "user:test_user"]),
        createdAt: now,
        updatedAt: now,
        indexedAt: now,
        memoryLayer: "user_model",
        confidence: floatToInt(0.95),
        isPrivate: 1,
        decayScore: 100, // user_model doesn't decay
      });

      const docs = await db
        .select()
        .from(schema.oracleDocuments)
        .where(eq(schema.oracleDocuments.id, "user_model_test_user"));

      expect(docs.length).toBe(1);
      expect(docs[0].memoryLayer).toBe("user_model");
      expect(docs[0].confidence).toBe(95); // floatToInt(0.95) = 95
      expect(docs[0].isPrivate).toBe(1);
      expect(docs[0].decayScore).toBe(100);
    });

    test("INSERT procedural document", async () => {
      const procedure: ProceduralMemory = {
        trigger: "เมื่อ user ถามเรื่อง deploy Docker",
        procedure: ["ถาม environment ก่อน", "ตรวจ docker-compose.yml", "รัน docker compose up -d --build"],
        source: "repeated_pattern",
        successCount: 5,
        lastUsed: now,
      };

      await db.insert(schema.oracleDocuments).values({
        id: "procedural_deploy_docker",
        type: "pattern",
        sourceFile: "memory://procedural/deploy_docker",
        concepts: JSON.stringify(["memory:procedural", "deploy", "docker"]),
        createdAt: now,
        updatedAt: now,
        indexedAt: now,
        memoryLayer: "procedural",
        confidence: floatToInt(0.9),
        accessCount: 5,
        lastAccessedAt: now,
      });

      const docs = await db
        .select()
        .from(schema.oracleDocuments)
        .where(eq(schema.oracleDocuments.id, "procedural_deploy_docker"));

      expect(docs.length).toBe(1);
      expect(docs[0].memoryLayer).toBe("procedural");
      expect(docs[0].type).toBe("pattern");
      expect(docs[0].accessCount).toBe(5);
      expect(docs[0].lastAccessedAt).toBe(now);
    });

    test("INSERT semantic document (explicit layer)", async () => {
      await db.insert(schema.oracleDocuments).values({
        id: "semantic_doc_1",
        type: "learning",
        sourceFile: "/learnings/test.md",
        concepts: JSON.stringify(["test", "semantic"]),
        createdAt: now,
        updatedAt: now,
        indexedAt: now,
        memoryLayer: "semantic",
        confidence: floatToInt(0.8),
      });

      const docs = await db
        .select()
        .from(schema.oracleDocuments)
        .where(eq(schema.oracleDocuments.id, "semantic_doc_1"));

      expect(docs[0].memoryLayer).toBe("semantic");
      expect(docs[0].confidence).toBe(80);
    });

    test("INSERT episodic document with TTL", async () => {
      const ttl90days = 90 * 24 * 60 * 60 * 1000;

      await db.insert(schema.oracleDocuments).values({
        id: "episodic_session_20260216",
        type: "retro",
        sourceFile: "memory://episodic/2026-02-16",
        concepts: JSON.stringify(["memory:episodic", "session:2026-02-16", "deploy"]),
        createdAt: now,
        updatedAt: now,
        indexedAt: now,
        memoryLayer: "episodic",
        confidence: floatToInt(0.7),
        expiresAt: now + ttl90days,
      });

      const docs = await db
        .select()
        .from(schema.oracleDocuments)
        .where(eq(schema.oracleDocuments.id, "episodic_session_20260216"));

      expect(docs[0].memoryLayer).toBe("episodic");
      expect(docs[0].type).toBe("retro");
      expect(docs[0].expiresAt).toBe(now + ttl90days);
      expect(docs[0].expiresAt! > now).toBe(true);
    });

    test("UPDATE access_count and last_accessed_at", async () => {
      const accessTime = Date.now();

      await db
        .update(schema.oracleDocuments)
        .set({
          accessCount: sql`COALESCE(${schema.oracleDocuments.accessCount}, 0) + 1`,
          lastAccessedAt: accessTime,
        })
        .where(eq(schema.oracleDocuments.id, "semantic_doc_1"));

      const docs = await db
        .select()
        .from(schema.oracleDocuments)
        .where(eq(schema.oracleDocuments.id, "semantic_doc_1"));

      expect(docs[0].accessCount).toBe(1);
      expect(docs[0].lastAccessedAt).toBe(accessTime);
    });

    test("UPDATE decay_score", async () => {
      await db
        .update(schema.oracleDocuments)
        .set({ decayScore: floatToInt(0.75) })
        .where(eq(schema.oracleDocuments.id, "semantic_doc_1"));

      const docs = await db
        .select()
        .from(schema.oracleDocuments)
        .where(eq(schema.oracleDocuments.id, "semantic_doc_1"));

      expect(docs[0].decayScore).toBe(75);
      expect(intToFloat(docs[0].decayScore!)).toBeCloseTo(0.75, 2);
    });

    test("INCREMENT access_count multiple times", async () => {
      // Access 3 more times
      for (let i = 0; i < 3; i++) {
        await db
          .update(schema.oracleDocuments)
          .set({
            accessCount: sql`COALESCE(${schema.oracleDocuments.accessCount}, 0) + 1`,
            lastAccessedAt: Date.now(),
          })
          .where(eq(schema.oracleDocuments.id, "semantic_doc_1"));
      }

      const docs = await db
        .select()
        .from(schema.oracleDocuments)
        .where(eq(schema.oracleDocuments.id, "semantic_doc_1"));

      expect(docs[0].accessCount).toBe(4); // 1 + 3
    });
  });

  // =========================================================================
  // 4. Layer-based Queries
  // =========================================================================
  describe("Layer-based Queries", () => {
    test("SELECT by memory_layer = 'user_model'", async () => {
      const docs = await db
        .select()
        .from(schema.oracleDocuments)
        .where(eq(schema.oracleDocuments.memoryLayer, "user_model"));

      expect(docs.length).toBeGreaterThanOrEqual(1);
      expect(docs.every(d => d.memoryLayer === "user_model")).toBe(true);
    });

    test("SELECT by memory_layer = 'procedural'", async () => {
      const docs = await db
        .select()
        .from(schema.oracleDocuments)
        .where(eq(schema.oracleDocuments.memoryLayer, "procedural"));

      expect(docs.length).toBeGreaterThanOrEqual(1);
      expect(docs.every(d => d.memoryLayer === "procedural")).toBe(true);
    });

    test("SELECT by memory_layer = 'episodic'", async () => {
      const docs = await db
        .select()
        .from(schema.oracleDocuments)
        .where(eq(schema.oracleDocuments.memoryLayer, "episodic"));

      expect(docs.length).toBeGreaterThanOrEqual(1);
    });

    test("SELECT semantic = explicit semantic + legacy (null)", async () => {
      // Semantic layer includes both explicit 'semantic' AND null (legacy docs)
      const semanticDocs = await db
        .select()
        .from(schema.oracleDocuments)
        .where(
          sql`${schema.oracleDocuments.memoryLayer} = 'semantic' OR ${schema.oracleDocuments.memoryLayer} IS NULL`
        );

      // Should include legacy_doc_1 (null) and semantic_doc_1 ('semantic')
      expect(semanticDocs.length).toBeGreaterThanOrEqual(2);

      const hasLegacy = semanticDocs.some(d => d.memoryLayer === null);
      const hasExplicit = semanticDocs.some(d => d.memoryLayer === "semantic");
      expect(hasLegacy).toBe(true);
      expect(hasExplicit).toBe(true);
    });

    test("SELECT multiple layers with IN clause", async () => {
      // For search: query multiple layers at once
      const docs = await db
        .select()
        .from(schema.oracleDocuments)
        .where(
          sql`${schema.oracleDocuments.memoryLayer} IN ('semantic', 'procedural') OR ${schema.oracleDocuments.memoryLayer} IS NULL`
        );

      expect(docs.length).toBeGreaterThanOrEqual(2);
    });

    test("GROUP BY memory_layer for stats", async () => {
      const stats = await db
        .select({
          layer: schema.oracleDocuments.memoryLayer,
          count: sql<number>`COUNT(*)`,
          avgDecay: sql<number>`AVG(${schema.oracleDocuments.decayScore})`,
        })
        .from(schema.oracleDocuments)
        .groupBy(schema.oracleDocuments.memoryLayer);

      expect(stats.length).toBeGreaterThanOrEqual(2); // at least null + user_model
      const userModelStats = stats.find(s => s.layer === "user_model");
      expect(userModelStats).toBeDefined();
      expect(userModelStats!.count).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // 5. TTL / Expiration Queries
  // =========================================================================
  describe("TTL Expiration", () => {
    test("find expired documents", async () => {
      const now = Date.now();

      // Insert already-expired episodic doc
      await db.insert(schema.oracleDocuments).values({
        id: "episodic_expired",
        type: "retro",
        sourceFile: "memory://episodic/expired",
        concepts: JSON.stringify(["memory:episodic"]),
        createdAt: now - 100 * 24 * 60 * 60 * 1000, // 100 days ago
        updatedAt: now - 100 * 24 * 60 * 60 * 1000,
        indexedAt: now - 100 * 24 * 60 * 60 * 1000,
        memoryLayer: "episodic",
        expiresAt: now - 10 * 24 * 60 * 60 * 1000, // expired 10 days ago
      });

      // Query expired docs
      const expired = await db
        .select()
        .from(schema.oracleDocuments)
        .where(
          and(
            isNotNull(schema.oracleDocuments.expiresAt),
            sql`${schema.oracleDocuments.expiresAt} < ${now}`
          )
        );

      expect(expired.length).toBeGreaterThanOrEqual(1);
      expect(expired.some(d => d.id === "episodic_expired")).toBe(true);
    });

    test("non-expired docs are not in expired query", async () => {
      const now = Date.now();

      const expired = await db
        .select()
        .from(schema.oracleDocuments)
        .where(
          and(
            isNotNull(schema.oracleDocuments.expiresAt),
            sql`${schema.oracleDocuments.expiresAt} < ${now}`
          )
        );

      // episodic_session_20260216 has TTL 90 days from now → should NOT be expired
      const notExpired = expired.find(d => d.id === "episodic_session_20260216");
      expect(notExpired).toBeUndefined();
    });

    test("documents without expiresAt never expire", async () => {
      const now = Date.now();

      const neverExpire = await db
        .select()
        .from(schema.oracleDocuments)
        .where(isNull(schema.oracleDocuments.expiresAt));

      // Legacy docs, user_model, procedural, semantic → no expiration
      const hasLegacy = neverExpire.some(d => d.id === "legacy_doc_1");
      const hasUserModel = neverExpire.some(d => d.id === "user_model_test_user");
      expect(hasLegacy).toBe(true);
      expect(hasUserModel).toBe(true);
    });
  });

  // =========================================================================
  // 6. Decay Score Ordering
  // =========================================================================
  describe("Decay Score Ordering", () => {
    const now = Date.now();

    test("ORDER BY decay_score DESC returns fresh docs first", async () => {
      // Insert docs with different decay scores
      await db.insert(schema.oracleDocuments).values({
        id: "decay_fresh",
        type: "learning",
        sourceFile: "/test/fresh.md",
        concepts: JSON.stringify(["decay-test"]),
        createdAt: now,
        updatedAt: now,
        indexedAt: now,
        memoryLayer: "semantic",
        decayScore: 100, // 1.0 = very fresh
      });

      await db.insert(schema.oracleDocuments).values({
        id: "decay_medium",
        type: "learning",
        sourceFile: "/test/medium.md",
        concepts: JSON.stringify(["decay-test"]),
        createdAt: now,
        updatedAt: now,
        indexedAt: now,
        memoryLayer: "semantic",
        decayScore: 50, // 0.5 = half-life
      });

      await db.insert(schema.oracleDocuments).values({
        id: "decay_stale",
        type: "learning",
        sourceFile: "/test/stale.md",
        concepts: JSON.stringify(["decay-test"]),
        createdAt: now,
        updatedAt: now,
        indexedAt: now,
        memoryLayer: "semantic",
        decayScore: 10, // 0.1 = very stale
      });

      const docs = await db
        .select({
          id: schema.oracleDocuments.id,
          decayScore: schema.oracleDocuments.decayScore,
        })
        .from(schema.oracleDocuments)
        .where(
          sql`${schema.oracleDocuments.id} IN ('decay_fresh', 'decay_medium', 'decay_stale')`
        )
        .orderBy(sql`${schema.oracleDocuments.decayScore} DESC`);

      expect(docs.length).toBe(3);
      expect(docs[0].id).toBe("decay_fresh");
      expect(docs[1].id).toBe("decay_medium");
      expect(docs[2].id).toBe("decay_stale");
    });

    test("decay_score combined with search score (simulated RRF)", async () => {
      // Simulate RRF: final_score = search_score * (decay_score / 100)
      const results = await db
        .select({
          id: schema.oracleDocuments.id,
          decayScore: schema.oracleDocuments.decayScore,
        })
        .from(schema.oracleDocuments)
        .where(
          sql`${schema.oracleDocuments.id} IN ('decay_fresh', 'decay_medium', 'decay_stale')`
        );

      // Simulate: all have same search_score = 0.8
      const searchScore = 0.8;
      const ranked = results.map(r => ({
        id: r.id,
        finalScore: searchScore * intToFloat(r.decayScore!),
      })).sort((a, b) => b.finalScore - a.finalScore);

      expect(ranked[0].id).toBe("decay_fresh");
      expect(ranked[0].finalScore).toBeCloseTo(0.8, 2);   // 0.8 * 1.0
      expect(ranked[1].id).toBe("decay_medium");
      expect(ranked[1].finalScore).toBeCloseTo(0.4, 2);   // 0.8 * 0.5
      expect(ranked[2].id).toBe("decay_stale");
      expect(ranked[2].finalScore).toBeCloseTo(0.08, 2);  // 0.8 * 0.1
    });
  });

  // =========================================================================
  // 7. Type Helpers — intToFloat, floatToInt, getEffectiveLayer
  // =========================================================================
  describe("Type Helpers", () => {
    describe("intToFloat()", () => {
      test("100 → 1.0", () => expect(intToFloat(100)).toBe(1.0));
      test("0 → 0.0", () => expect(intToFloat(0)).toBe(0.0));
      test("50 → 0.5", () => expect(intToFloat(50)).toBe(0.5));
      test("95 → 0.95", () => expect(intToFloat(95)).toBeCloseTo(0.95, 2));
      test("null → 1.0 (default)", () => expect(intToFloat(null)).toBe(1.0));
      test("undefined → 1.0 (default)", () => expect(intToFloat(undefined)).toBe(1.0));
      test("75 → 0.75", () => expect(intToFloat(75)).toBe(0.75));
    });

    describe("floatToInt()", () => {
      test("1.0 → 100", () => expect(floatToInt(1.0)).toBe(100));
      test("0.0 → 0", () => expect(floatToInt(0.0)).toBe(0));
      test("0.5 → 50", () => expect(floatToInt(0.5)).toBe(50));
      test("0.95 → 95", () => expect(floatToInt(0.95)).toBe(95));
      test("0.75 → 75", () => expect(floatToInt(0.75)).toBe(75));
      test("clamp > 1.0 → 100", () => expect(floatToInt(1.5)).toBe(100));
      test("clamp < 0.0 → 0", () => expect(floatToInt(-0.3)).toBe(0));
      test("0.333 → 33 (rounds)", () => expect(floatToInt(0.333)).toBe(33));
      test("0.666 → 67 (rounds)", () => expect(floatToInt(0.666)).toBe(67));
    });

    describe("roundtrip intToFloat(floatToInt(x))", () => {
      test("0.95 roundtrip", () => expect(intToFloat(floatToInt(0.95))).toBeCloseTo(0.95, 2));
      test("0.5 roundtrip", () => expect(intToFloat(floatToInt(0.5))).toBeCloseTo(0.5, 2));
      test("1.0 roundtrip", () => expect(intToFloat(floatToInt(1.0))).toBe(1.0));
      test("0.0 roundtrip", () => expect(intToFloat(floatToInt(0.0))).toBe(0.0));
    });

    describe("getEffectiveLayer()", () => {
      test("null → 'semantic'", () => expect(getEffectiveLayer(null)).toBe("semantic"));
      test("undefined → 'semantic'", () => expect(getEffectiveLayer(undefined)).toBe("semantic"));
      test("'user_model' → 'user_model'", () => expect(getEffectiveLayer("user_model")).toBe("user_model"));
      test("'procedural' → 'procedural'", () => expect(getEffectiveLayer("procedural")).toBe("procedural"));
      test("'semantic' → 'semantic'", () => expect(getEffectiveLayer("semantic")).toBe("semantic"));
      test("'episodic' → 'episodic'", () => expect(getEffectiveLayer("episodic")).toBe("episodic"));
    });
  });

  // =========================================================================
  // 8. Type Structures — UserModel, ProceduralMemory, EpisodicMemory
  // =========================================================================
  describe("Type Structures", () => {
    test("DEFAULT_USER_MODEL has correct shape", () => {
      expect(DEFAULT_USER_MODEL.preferences.language).toBe("th");
      expect(DEFAULT_USER_MODEL.preferences.responseLength).toBe("auto");
      expect(DEFAULT_USER_MODEL.preferences.responseStyle).toBe("casual");
      expect(DEFAULT_USER_MODEL.timezone).toBe("Asia/Bangkok");
      expect(DEFAULT_USER_MODEL.expertise).toEqual({});
      expect(DEFAULT_USER_MODEL.commonTopics).toEqual([]);
      expect(DEFAULT_USER_MODEL.notes).toEqual([]);
      expect(DEFAULT_USER_MODEL.updatedAt).toBe(0);
    });

    test("UserModel can be created with defaults", () => {
      const model: UserModel = {
        userId: "test",
        ...DEFAULT_USER_MODEL,
        updatedAt: Date.now(),
      };
      expect(model.userId).toBe("test");
      expect(model.preferences.language).toBe("th");
    });

    test("UserModel expertise levels are type-safe", () => {
      const model: UserModel = {
        userId: "test",
        ...DEFAULT_USER_MODEL,
        expertise: {
          docker: "expert",
          typescript: "advanced",
          kubernetes: "novice",
          python: "intermediate",
        },
        updatedAt: Date.now(),
      };
      expect(Object.keys(model.expertise).length).toBe(4);
    });

    test("ProceduralMemory has correct shape", () => {
      const proc: ProceduralMemory = {
        trigger: "เมื่อ user ถามเรื่อง deploy Docker",
        procedure: ["ถาม environment", "ตรวจ config", "deploy"],
        source: "repeated_pattern",
        successCount: 5,
        lastUsed: Date.now(),
      };
      expect(proc.procedure.length).toBe(3);
      expect(proc.source).toBe("repeated_pattern");
    });

    test("ProceduralMemory source types", () => {
      const sources: ProceduralMemory["source"][] = ["correction", "repeated_pattern", "explicit"];
      sources.forEach(s => {
        const proc: ProceduralMemory = {
          trigger: "test",
          procedure: ["step1"],
          source: s,
          successCount: 0,
          lastUsed: 0,
        };
        expect(proc.source).toBe(s);
      });
    });

    test("EpisodicMemory has correct shape", () => {
      const episode: EpisodicMemory = {
        userId: "default",
        groupId: "main",
        summary: "Implement Smart Chunker สำหรับ bilingual text",
        topics: ["chunker", "thai-nlp", "indexer"],
        outcome: "success",
        durationMs: 3600000,
        recordedAt: Date.now(),
      };
      expect(episode.topics.length).toBe(3);
      expect(episode.outcome).toBe("success");
    });

    test("EpisodicMemory outcome types", () => {
      const outcomes: EpisodicMemory["outcome"][] = ["success", "partial", "failed", "unknown"];
      outcomes.forEach(o => {
        const ep: EpisodicMemory = {
          userId: "test",
          groupId: "test",
          summary: "test",
          topics: [],
          outcome: o,
          durationMs: 0,
          recordedAt: 0,
        };
        expect(ep.outcome).toBe(o);
      });
    });

    test("MemoryLayer type covers all layers", () => {
      const layers: MemoryLayer[] = ["user_model", "procedural", "semantic", "episodic"];
      expect(layers.length).toBe(4);
      // Verify each is a valid memory layer
      layers.forEach(l => {
        expect(getEffectiveLayer(l)).toBe(l);
      });
    });
  });

  // =========================================================================
  // 9. OracleDocument extended fields type check
  // =========================================================================
  describe("OracleDocument with Memory Layer Fields", () => {
    test("OracleDocument accepts all new fields", () => {
      const doc: OracleDocument = {
        id: "test_full_doc",
        type: "learning",
        source_file: "/test/full.md",
        content: "Test content",
        concepts: ["test"],
        created_at: Date.now(),
        updated_at: Date.now(),
        // v0.7.0 fields
        memory_layer: "semantic",
        confidence: 0.85,
        access_count: 10,
        last_accessed_at: Date.now(),
        decay_score: 0.75,
        expires_at: null as any,
      };
      expect(doc.memory_layer).toBe("semantic");
      expect(doc.confidence).toBe(0.85);
      expect(doc.access_count).toBe(10);
    });

    test("OracleDocument works without new fields (backward compat)", () => {
      const doc: OracleDocument = {
        id: "test_minimal_doc",
        type: "principle",
        source_file: "/test/minimal.md",
        content: "Minimal content",
        concepts: ["minimal"],
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      expect(doc.memory_layer).toBeUndefined();
      expect(doc.confidence).toBeUndefined();
      expect(doc.access_count).toBeUndefined();
    });
  });

  // =========================================================================
  // 10. ensureSchema() idempotency simulation
  // =========================================================================
  describe("ensureSchema() Idempotency", () => {
    test("applying migration twice does not error", () => {
      // Simulate running ensureSchema() again
      const columns = sqlite.prepare("PRAGMA table_info('oracle_documents')").all() as { name: string }[];
      const existing = new Set(columns.map(c => c.name));

      const migrations: [string, string][] = [
        ['memory_layer', 'ALTER TABLE oracle_documents ADD COLUMN memory_layer TEXT'],
        ['confidence', 'ALTER TABLE oracle_documents ADD COLUMN confidence INTEGER'],
        ['access_count', 'ALTER TABLE oracle_documents ADD COLUMN access_count INTEGER DEFAULT 0'],
        ['last_accessed_at', 'ALTER TABLE oracle_documents ADD COLUMN last_accessed_at INTEGER'],
        ['decay_score', 'ALTER TABLE oracle_documents ADD COLUMN decay_score INTEGER DEFAULT 100'],
        ['expires_at', 'ALTER TABLE oracle_documents ADD COLUMN expires_at INTEGER'],
      ];

      // All should already exist, so no ALTER TABLE should run
      let alterCount = 0;
      for (const [col, ddl] of migrations) {
        if (!existing.has(col)) {
          alterCount++;
          sqlite.exec(ddl);
        }
      }

      expect(alterCount).toBe(0); // all columns already exist

      // Indexes should also be idempotent
      expect(() => {
        sqlite.exec('CREATE INDEX IF NOT EXISTS idx_memory_layer ON oracle_documents(memory_layer)');
        sqlite.exec('CREATE INDEX IF NOT EXISTS idx_decay_score ON oracle_documents(decay_score)');
        sqlite.exec('CREATE INDEX IF NOT EXISTS idx_expires_at ON oracle_documents(expires_at)');
      }).not.toThrow();
    });
  });
});

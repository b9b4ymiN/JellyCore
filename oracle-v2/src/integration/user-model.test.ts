/**
 * Part B — User Model Layer Tests
 *
 * ทดสอบ User Model Store:
 * 1. get() → default model เมื่อไม่มี
 * 2. update() → create + deep merge
 * 3. reset() → delete
 * 4. deep merge ทำงานถูกต้อง (nested objects, arrays)
 * 5. private flag (is_private = 1)
 * 6. decay_score = 100 เสมอ
 * 7. idempotent updates
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { existsSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

import * as schema from "../db/schema";
import {
  type UserModel,
  DEFAULT_USER_MODEL,
  floatToInt,
  intToFloat,
} from "../types";
import { deepMerge } from "../memory/user-model";

// We can't import UserModelStore directly because it uses the singleton db.
// Instead we test the deepMerge utility + DB operations via Drizzle directly.

const TEST_DB_PATH = join(homedir(), ".oracle-v2", "test-user-model.db");
const PROJECT_ROOT = join(import.meta.dir, "../..");

let sqlite: Database;
let db: ReturnType<typeof drizzle>;

/**
 * Minimal UserModelStore reimplementation for testing
 * (uses test db instead of production singleton)
 */
class TestUserModelStore {
  async get(userId: string): Promise<UserModel> {
    const docId = `user_model_${userId}`;
    const rows = await db
      .select()
      .from(schema.oracleDocuments)
      .where(eq(schema.oracleDocuments.id, docId));

    if (rows.length === 0) {
      return { userId, ...DEFAULT_USER_MODEL, updatedAt: Date.now() };
    }

    try {
      const concepts = JSON.parse(rows[0].concepts) as string[];
      const modelJson = concepts.find(c => c.startsWith('{'));
      if (modelJson) return JSON.parse(modelJson) as UserModel;
    } catch {}

    return { userId, ...DEFAULT_USER_MODEL, updatedAt: Date.now() };
  }

  async update(userId: string, partial: Partial<UserModel>): Promise<UserModel> {
    const existing = await this.get(userId);
    const merged: UserModel = deepMerge(existing, {
      ...partial,
      userId,
      updatedAt: Date.now(),
    });

    const docId = `user_model_${userId}`;
    const now = Date.now();
    const conceptsArray = [
      'memory:user_model',
      `user:${userId}`,
      JSON.stringify(merged),
    ];

    const existingRows = await db
      .select({ id: schema.oracleDocuments.id })
      .from(schema.oracleDocuments)
      .where(eq(schema.oracleDocuments.id, docId));

    if (existingRows.length > 0) {
      await db.update(schema.oracleDocuments)
        .set({
          concepts: JSON.stringify(conceptsArray),
          updatedAt: now,
          confidence: floatToInt(0.95),
        })
        .where(eq(schema.oracleDocuments.id, docId));
    } else {
      await db.insert(schema.oracleDocuments).values({
        id: docId,
        type: 'learning',
        sourceFile: `memory://user_model/${userId}`,
        concepts: JSON.stringify(conceptsArray),
        createdAt: now,
        updatedAt: now,
        indexedAt: now,
        memoryLayer: 'user_model',
        confidence: floatToInt(0.95),
        isPrivate: 1,
        decayScore: 100,
        createdBy: 'memory_system',
      });
    }

    return merged;
  }

  async reset(userId: string): Promise<void> {
    const docId = `user_model_${userId}`;
    await db.delete(schema.oracleDocuments)
      .where(eq(schema.oracleDocuments.id, docId));
  }
}

describe("Part B — User Model Layer", () => {
  let store: TestUserModelStore;

  beforeAll(async () => {
    const dir = join(homedir(), ".oracle-v2");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);

    sqlite = new Database(TEST_DB_PATH);
    db = drizzle(sqlite, { schema });

    // Apply migrations
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
          try { if (stmt.trim()) sqlite.exec(stmt); } catch {}
        }
      }
    }

    // Apply ensureSchema columns
    const cols = sqlite.prepare("PRAGMA table_info('oracle_documents')").all() as { name: string }[];
    const existing = new Set(cols.map(c => c.name));
    const migrations: [string, string][] = [
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
    ];
    for (const [col, ddl] of migrations) {
      if (!existing.has(col)) sqlite.exec(ddl);
    }
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_memory_layer ON oracle_documents(memory_layer)');

    store = new TestUserModelStore();
  });

  afterAll(() => {
    sqlite.close();
    try {
      if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
    } catch {}
  });

  // ─── deepMerge utility ────────────────────────────────────────────────
  describe("deepMerge()", () => {
    test("shallow merge", () => {
      const target = { a: 1, b: 2 };
      const result = deepMerge(target, { b: 3 });
      expect(result).toEqual({ a: 1, b: 3 });
    });

    test("deep merge nested objects", () => {
      const target = { a: { b: 1, c: 2 }, d: 3 };
      const result = deepMerge(target, { a: { c: 99 } } as any);
      expect(result.a.b).toBe(1);
      expect(result.a.c).toBe(99);
      expect(result.d).toBe(3);
    });

    test("arrays are replaced, not merged", () => {
      const target = { items: [1, 2, 3] };
      const result = deepMerge(target, { items: [4, 5] } as any);
      expect(result.items).toEqual([4, 5]);
    });

    test("undefined values are skipped", () => {
      const target = { a: 1, b: 2 };
      const result = deepMerge(target, { a: undefined } as any);
      expect(result.a).toBe(1);
    });

    test("null values are set", () => {
      const target = { a: 1, b: 2 };
      const result = deepMerge(target, { a: null } as any);
      expect(result.a).toBeNull();
    });

    test("deeply nested 3 levels", () => {
      const target = { l1: { l2: { l3: "old", keep: true } } };
      const result = deepMerge(target, { l1: { l2: { l3: "new" } } } as any);
      expect(result.l1.l2.l3).toBe("new");
      expect(result.l1.l2.keep).toBe(true);
    });

    test("UserModel preferences deep merge", () => {
      const model: UserModel = {
        userId: "test",
        ...DEFAULT_USER_MODEL,
        preferences: { language: "th", responseLength: "auto", responseStyle: "casual" },
        updatedAt: 0,
      };
      const result = deepMerge(model, {
        preferences: { responseLength: "concise" },
      } as Partial<UserModel>);
      expect(result.preferences.language).toBe("th");
      expect(result.preferences.responseLength).toBe("concise");
      expect(result.preferences.responseStyle).toBe("casual");
    });

    test("UserModel expertise deep merge", () => {
      const model: UserModel = {
        userId: "test",
        ...DEFAULT_USER_MODEL,
        expertise: { docker: "expert" },
        updatedAt: 0,
      };
      const result = deepMerge(model, {
        expertise: { typescript: "advanced" },
      } as Partial<UserModel>);
      expect(result.expertise.docker).toBe("expert");
      expect(result.expertise.typescript).toBe("advanced");
    });
  });

  // ─── get() ─────────────────────────────────────────────────────────
  describe("get()", () => {
    test("returns default model for new user", async () => {
      const model = await store.get("new_user_123");
      expect(model.userId).toBe("new_user_123");
      expect(model.preferences.language).toBe("th");
      expect(model.preferences.responseLength).toBe("auto");
      expect(model.preferences.responseStyle).toBe("casual");
      expect(model.timezone).toBe("Asia/Bangkok");
      expect(model.expertise).toEqual({});
      expect(model.commonTopics).toEqual([]);
      expect(model.notes).toEqual([]);
    });

    test("returns saved model after update", async () => {
      await store.update("saved_user", {
        expertise: { docker: "expert" },
      });
      const model = await store.get("saved_user");
      expect(model.userId).toBe("saved_user");
      expect(model.expertise.docker).toBe("expert");
    });
  });

  // ─── update() ──────────────────────────────────────────────────────
  describe("update()", () => {
    test("creates new user model on first update", async () => {
      const model = await store.update("fresh_user", {
        preferences: { language: "en" },
      });
      expect(model.userId).toBe("fresh_user");
      expect(model.preferences.language).toBe("en");
      expect(model.preferences.responseLength).toBe("auto"); // default preserved
    });

    test("deep merges on subsequent updates", async () => {
      await store.update("merge_user", {
        expertise: { docker: "expert" },
      });
      const m2 = await store.update("merge_user", {
        expertise: { typescript: "advanced" },
      });
      expect(m2.expertise.docker).toBe("expert");
      expect(m2.expertise.typescript).toBe("advanced");
    });

    test("preferences merge correctly", async () => {
      await store.update("pref_user", {
        preferences: { language: "th", responseLength: "detailed", responseStyle: "casual" },
      });
      const m2 = await store.update("pref_user", {
        preferences: { responseLength: "concise" },
      });
      expect(m2.preferences.language).toBe("th");
      expect(m2.preferences.responseLength).toBe("concise");
      expect(m2.preferences.responseStyle).toBe("casual");
    });

    test("notes and commonTopics are replaced (arrays)", async () => {
      await store.update("arr_user", {
        notes: ["note1", "note2"],
        commonTopics: ["topic1"],
      });
      const m2 = await store.update("arr_user", {
        notes: ["note3"],
      });
      expect(m2.notes).toEqual(["note3"]);
      expect(m2.commonTopics).toEqual(["topic1"]);
    });

    test("DB row has correct memory_layer and is_private", async () => {
      await store.update("db_check_user", {
        expertise: { python: "intermediate" },
      });

      const rows = await db
        .select()
        .from(schema.oracleDocuments)
        .where(eq(schema.oracleDocuments.id, "user_model_db_check_user"));

      expect(rows.length).toBe(1);
      expect(rows[0].memoryLayer).toBe("user_model");
      expect(rows[0].isPrivate).toBe(1);
      expect(rows[0].type).toBe("learning");
      expect(rows[0].decayScore).toBe(100);
      expect(rows[0].confidence).toBe(95); // floatToInt(0.95)
      expect(rows[0].createdBy).toBe("memory_system");
      expect(rows[0].sourceFile).toBe("memory://user_model/db_check_user");
    });

    test("updatedAt is refreshed on each update", async () => {
      const m1 = await store.update("time_user", { notes: ["first"] });
      const t1 = m1.updatedAt;

      // Small delay to ensure different timestamp
      await new Promise(r => setTimeout(r, 10));

      const m2 = await store.update("time_user", { notes: ["second"] });
      expect(m2.updatedAt).toBeGreaterThan(t1);
    });
  });

  // ─── reset() ───────────────────────────────────────────────────────
  describe("reset()", () => {
    test("deletes user model from DB", async () => {
      await store.update("reset_user", {
        expertise: { docker: "expert" },
      });
      await store.reset("reset_user");

      const rows = await db
        .select()
        .from(schema.oracleDocuments)
        .where(eq(schema.oracleDocuments.id, "user_model_reset_user"));

      expect(rows.length).toBe(0);
    });

    test("get() returns default after reset", async () => {
      await store.update("reset_user2", {
        preferences: { language: "en" },
      });
      await store.reset("reset_user2");
      const model = await store.get("reset_user2");
      expect(model.preferences.language).toBe("th"); // back to default
    });

    test("reset non-existent user is no-op", async () => {
      // Should not throw
      await store.reset("nonexistent_user_xyz");
    });
  });
});

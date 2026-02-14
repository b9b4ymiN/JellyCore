# 2.7 — Database Migration System

> แก้จุดอ่อน: A7 (Schema Migration via Try/Catch ALTER TABLE)

**Status:** ⬜ Not Started  
**Effort:** Small  
**Priority:** 🟡 Medium — ทำเร็ว เพราะ items อื่นอาจต้อง add tables

---

## 📋 ปัญหาเดิม

Schema evolution ใช้ `try/catch ALTER TABLE` → silent failure → ไม่มี versioning → schema drift undetectable

**ที่มา:** NanoClaw `src/db.ts`, Oracle V2 `src/server/db.ts`

---

## ✅ Checklist

### NanoClaw Migration System

- [ ] สร้าง `src/migrations/` directory
- [ ] สร้าง `src/migration-runner.ts`:
  ```typescript
  function runMigrations(db: Database): void {
    // Create migrations table
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT DEFAULT (datetime('now'))
      )
    `);
    
    // Get current version
    const current = db.prepare('SELECT MAX(version) as v FROM schema_migrations').get();
    
    // Run pending migrations
    for (const migration of migrations) {
      if (migration.version > (current?.v || 0)) {
        db.exec(migration.sql);
        db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name);
        log.info(`Applied migration ${migration.version}: ${migration.name}`);
      }
    }
  }
  ```

- [ ] สร้าง migration files:
  ```
  src/migrations/
  ├── 001_initial_schema.ts    ← existing tables (chats, messages, etc.)
  ├── 002_queue_state.ts       ← from Item 2.2
  ├── 003_container_registry.ts ← from Item 2.3
  ├── 004_rate_limit_events.ts  ← from Item 2.6
  └── index.ts                 ← export migrations array
  ```

- [ ] Migration format:
  ```typescript
  export const migration_002 = {
    version: 2,
    name: 'add_queue_state',
    sql: `
      CREATE TABLE IF NOT EXISTS queue_state (
        group_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        container_id TEXT,
        ...
      );
    `
  };
  ```

### ปรับ NanoClaw Startup

- [ ] แก้ `src/db.ts` → `initDatabase()`:
  - ลบ `try/catch ALTER TABLE` blocks ทั้งหมด
  - เรียก `runMigrations(db)` แทน
  - ลบ `createSchema()` function (replaced by migration 001)

### Oracle V2 Migrations

- [ ] Oracle V2 ใช้ **Drizzle Kit** อยู่แล้ว → ใช้ให้จริงจัง:
  - `bun run drizzle-kit generate` → สร้าง migration files
  - `bun run drizzle-kit migrate` → apply migrations
  - เรียกตอน service startup
- [ ] ลบ `try/catch ALTER TABLE` ใน `src/server/db.ts` → `bootstrapCoreTables()`

### ทดสอบ

- [ ] Fresh database → all migrations applied → schema complete
- [ ] Existing database → only new migrations applied
- [ ] `schema_migrations` table → shows all applied versions
- [ ] Re-run → no duplicate migrations
- [ ] Migration failure (simulate) → error thrown (not swallowed)

---

## 🧪 Definition of Done

1. All schema changes tracked via numbered migrations
2. `schema_migrations` table shows history
3. No more `try/catch ALTER TABLE`
4. New tables from Phase 2 created via migrations

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `src/migration-runner.ts` | NanoClaw | **Create** |
| `src/migrations/` | NanoClaw | **Create** — migration files |
| `src/db.ts` | NanoClaw | Use migration runner |
| `src/server/db.ts` | Oracle V2 | Use Drizzle Kit properly |

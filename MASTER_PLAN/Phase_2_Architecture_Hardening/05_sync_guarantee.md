# 2.5 — SQLite ↔ ChromaDB Sync Guarantee

> แก้จุดอ่อน: A5 (SQLite and ChromaDB Can Desync)

**Status:** ⬜ Not Started  
**Effort:** Medium  
**Priority:** 🟡 Medium

---

## 📋 ปัญหาเดิม

Documents insert ลง SQLite FTS5 แล้ว ChromaDB แยกกัน — ไม่มี transactional guarantee  
Partial failure → documents อยู่ใน store หนึ่งแต่ไม่อยู่อีก store

**ที่มา:** Oracle V2 `src/indexer.ts`

---

## ✅ Checklist

### เพิ่ม Sync Status Column

- [ ] แก้ `src/db/schema.ts`:
  ```typescript
  syncStatus: text('sync_status').default('pending'),  // 'pending' | 'synced' | 'failed'
  lastSyncAttempt: integer('last_sync_attempt'),
  syncError: text('sync_error'),
  ```

### ปรับ Indexing Pipeline

- [ ] แก้ `src/indexer.ts`:
  ```
  1. Insert to SQLite → sync_status = 'pending'
  2. Upsert to ChromaDB
  3. If ChromaDB success → update sync_status = 'synced'
  4. If ChromaDB fail → update sync_status = 'failed', set sync_error
  5. Retry failed documents (up to 3 times)
  ```

### Background Sync Job

- [ ] สร้าง `src/sync-worker.ts`:
  - Run ทุก 5 นาที
  - Query: `SELECT * FROM oracle_documents WHERE sync_status IN ('pending', 'failed') AND last_sync_attempt < ?`
  - For each: attempt ChromaDB upsert → update status
  - Max batch: 50 documents per run
  - Log: success/failure counts

### Re-Index Improvements

- [ ] แก้ re-index flow:
  - **ก่อน:** Delete ChromaDB collection → recreate → re-index all
  - **หลัง:** Use `upsert` (create or replace) → no delete needed → no zero-result window
  - Keep existing collection during re-index

### Sync Status API

- [ ] เพิ่มใน `oracle_stats` response:
  ```json
  {
    "sync": {
      "synced": 1234,
      "pending": 5,
      "failed": 2,
      "lastSyncRun": "2026-02-14T10:30:00Z"
    }
  }
  ```

### ทดสอบ

- [ ] Index document → SQLite ✓ + ChromaDB ✓ → sync_status = 'synced'
- [ ] Index document → SQLite ✓ + ChromaDB fail → sync_status = 'failed'
- [ ] Background job → retry failed → eventually 'synced'
- [ ] Re-index → ไม่มี search downtime (no collection delete)
- [ ] Stats API → shows sync status counts

---

## 🧪 Definition of Done

1. Every document has `sync_status` tracking
2. Failed ChromaDB inserts are retried automatically
3. Re-index doesn't cause search downtime
4. Sync status visible via API

---

## 📎 Files to Modify

| File | Repo | Action |
|------|------|--------|
| `src/db/schema.ts` | Oracle V2 | Add sync_status column |
| `src/indexer.ts` | Oracle V2 | Update pipeline + use upsert |
| `src/sync-worker.ts` | Oracle V2 | **Create** — background sync job |
| `src/server.ts` | Oracle V2 | Start sync worker |
| `src/server/handlers.ts` | Oracle V2 | Add sync stats to oracle_stats |

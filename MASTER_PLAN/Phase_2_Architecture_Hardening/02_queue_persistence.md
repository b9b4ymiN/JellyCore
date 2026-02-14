# 2.2 — Queue State Persistence

> แก้จุดอ่อน: A2 (GroupQueue In-Memory Only), A3 (Orphan Containers)

**Status:** ⬜ Not Started  
**Effort:** Medium  
**Priority:** 🟠 High

---

## 📋 ปัญหาเดิม

Queue state อยู่ใน `Map<string, GroupState>` (memory) → crash = สูญทั้ง queue + orphan containers

**ที่มา:** NanoClaw `src/group-queue.ts`

---

## 🎯 เป้าหมาย

Persist queue state ลง SQLite → restart แล้วกู้คืน queue + reclaim orphan containers

---

## ✅ Checklist

### สร้าง Queue State Table

- [ ] เพิ่ม table ใน `src/db.ts`:
  ```sql
  CREATE TABLE IF NOT EXISTS queue_state (
    group_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,           -- 'active' | 'waiting' | 'completed' | 'failed'
    container_id TEXT,              -- Docker container ID
    message_text TEXT,              -- Original message (for retry)
    chat_jid TEXT,                  -- Reply destination
    enqueued_at INTEGER NOT NULL,   -- timestamp
    started_at INTEGER,             -- timestamp
    priority TEXT DEFAULT 'normal', -- 'high' | 'normal' | 'low'
    retry_count INTEGER DEFAULT 0,
    last_error TEXT
  );
  ```

### ปรับ GroupQueue

- [ ] แก้ `src/group-queue.ts`:
  - `enqueue()` → insert/update row ใน `queue_state`
  - `startProcessing()` → update status = 'active', set container_id
  - `completeProcessing()` → update status = 'completed' (หรือ delete row)
  - `failProcessing()` → update status = 'failed', set last_error

### Startup Recovery

- [ ] เพิ่ม `recoverQueue()` ใน `src/group-queue.ts`:
  ```typescript
  function recoverQueue(): void {
    // 1. Load 'waiting' entries → re-enqueue
    const waiting = db.prepare('SELECT * FROM queue_state WHERE status = ?').all('waiting');
    for (const entry of waiting) {
      enqueue(entry.group_id, entry.message_text, entry.chat_jid, entry.priority);
    }
    
    // 2. Check 'active' entries → verify container still running
    const active = db.prepare('SELECT * FROM queue_state WHERE status = ?').all('active');
    for (const entry of active) {
      if (isContainerRunning(entry.container_id)) {
        // Reclaim: track this container
        trackContainer(entry.group_id, entry.container_id);
      } else {
        // Container died: re-enqueue message
        updateStatus(entry.group_id, 'waiting');
        enqueue(entry.group_id, entry.message_text, entry.chat_jid, entry.priority);
      }
    }
  }
  ```
- [ ] เรียก `recoverQueue()` ใน `main()` ก่อน start message loop

### Container Running Check

- [ ] สร้าง utility `isContainerRunning(containerId: string): boolean`:
  ```typescript
  function isContainerRunning(containerId: string): boolean {
    try {
      const result = execSync(`docker inspect --format='{{.State.Running}}' ${containerId}`);
      return result.toString().trim() === 'true';
    } catch {
      return false;  // Container doesn't exist
    }
  }
  ```

### Cleanup Stale Entries

- [ ] เพิ่ม periodic cleanup (ทุก 1 ชั่วโมง):
  - Delete `completed` entries older than 24 hours
  - Delete `failed` entries older than 7 days

### ทดสอบ

- [ ] Enqueue 3 messages → kill process → restart → 3 messages ยังอยู่ในคิว
- [ ] Active container → kill NanoClaw → restart → container ถูก reclaim
- [ ] Active container died → NanoClaw restart → message re-enqueued
- [ ] `queue_state` table → data correct after operations
- [ ] Cleanup: old completed entries ถูกลบ

---

## 🧪 Definition of Done

1. Queued messages survive process restart
2. Active containers reclaimed after restart
3. Dead containers detected → messages re-enqueued
4. Stale entries cleaned periodically

---

## 📎 Files to Modify

| File | Repo | Action |
|------|------|--------|
| `src/db.ts` | NanoClaw | Add queue_state table |
| `src/group-queue.ts` | NanoClaw | Persist state + recovery |
| `src/index.ts` | NanoClaw | Call recoverQueue() on startup |

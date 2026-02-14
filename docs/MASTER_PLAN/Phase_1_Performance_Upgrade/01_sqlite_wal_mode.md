# 1.1 — SQLite WAL Mode + Busy Timeout

> แก้จุดอ่อน: P1 (No WAL Mode), P2 (No Busy Timeout)

**Status:** ✅ Complete  
**Effort:** Small  
**Priority:** 🟠 High — ป้องกัน SQLITE_BUSY errors

---

## 📋 ปัญหาเดิม

ทั้ง NanoClaw และ Oracle V2 ใช้ SQLite default settings:
- **DELETE journal mode** → block readers ขณะ write
- **busy_timeout = 0** → lock contention = `SQLITE_BUSY` error ทันที

**ที่มา:** NanoClaw `src/db.ts`, Oracle V2 `src/server/db.ts`

---

## 🎯 เป้าหมาย

เปิด **WAL mode** (readers ไม่ถูก block) + **busy timeout 30s** (writers retry แทน error)

---

## ✅ Checklist

### NanoClaw Database

- [ ] แก้ `src/db.ts` → หลัง `new Database(dbPath)`:
  ```typescript
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 30000');
  db.pragma('synchronous = NORMAL');  // Safe with WAL, faster than FULL
  db.pragma('cache_size = -20000');   // 20MB cache (negative = KB)
  db.pragma('foreign_keys = ON');
  ```
- [ ] Verify: ลอง concurrent read + write → ไม่มี SQLITE_BUSY

### Oracle V2 Database

- [ ] แก้ `src/server/db.ts` → เพิ่ม pragmas เดียวกัน:
  ```typescript
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 30000');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -20000');
  ```
- [ ] ตรวจสอบ Drizzle ORM compatibility กับ WAL mode (ควร OK)

### ทดสอบ

- [ ] NanoClaw: message loop poll + container write IPC → ไม่มี error
- [ ] Oracle: concurrent search + learn → ไม่มี SQLITE_BUSY
- [ ] Verify WAL mode active: `PRAGMA journal_mode;` → `wal`
- [ ] Check WAL files created: `database.db-wal`, `database.db-shm`
- [ ] Restart service → WAL mode persists

---

## 🧪 Definition of Done

1. `PRAGMA journal_mode;` → `wal` ทั้ง 2 databases
2. No SQLITE_BUSY errors under concurrent load
3. WAL files exist alongside database files

---

## 📎 Files to Modify

| File | Repo | Action |
|------|------|--------|
| `src/db.ts` | NanoClaw | Add WAL + busy_timeout pragmas |
| `src/server/db.ts` | Oracle V2 | Add WAL + busy_timeout pragmas |

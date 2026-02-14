# 0.7 — Knowledge Base Public/Private Split

> แก้จุดอ่อน: S8 (ψ/memory/ Contains Operational Details in Git)

**Status:** ✅ Done  
**Effort:** Small  
**Priority:** 🟢 Low

---

## 📋 ปัญหาเดิม

`ψ/memory/` ทั้ง directory อยู่ใน Git — รวมถึง session retrospectives ที่มี:
- Commit hashes, file paths, command history
- Personal development patterns
- Timestamps, session durations
- Specific technical decisions

ถ้า repo ถูก share หรือ push ไป public → leak operational details

**ที่มา:** Oracle V2 `ψ/memory/retrospectives/`, `ψ/memory/learnings/`

---

## 🎯 เป้าหมาย

แยก knowledge base เป็น 2 layers:
- **Public** → Git-safe (principles, generic patterns)
- **Private** → Encrypted volume only (personal notes, conversations, operational data)

---

## ✅ Checklist

### ปรับ Directory Structure

- [ ] สร้าง structure ใหม่:
  ```
  ψ/memory/
  ├── public/                    ← อยู่ใน Git
  │   ├── resonance/             # หลักการ, ค่านิยม, personality
  │   │   └── core-principles.md
  │   └── learnings/             # Generic technical patterns
  │       └── coding-patterns.md
  │
  └── private/                   ← ❌ ไม่อยู่ใน Git
      ├── notes/                 # บันทึกส่วนตัว, journal
      ├── conversations/         # Conversation summaries
      ├── retrospectives/        # Session histories
      ├── decisions/             # Personal decisions
      ├── projects/              # Project-specific docs
      └── web-captures/          # Scraped web content
  ```

### Git Configuration

- [ ] เพิ่มใน `.gitignore`:
  ```
  # Private knowledge base (encrypted volume only)
  ψ/memory/private/
  ```
- [ ] ถ้ามี existing files ใน `ψ/memory/retrospectives/` หรือ `ψ/memory/learnings/` ที่มี personal data:
  - ย้ายไปที่ `ψ/memory/private/`
  - `git rm --cached` เพื่อลบจาก Git history
  - พิจารณา `git filter-branch` หรือ `BFG Repo-Cleaner` ถ้าต้องลบจาก history จริงๆ

### ปรับ Oracle V2 Indexer

- [ ] แก้ `src/indexer.ts`:
  - Scan ทั้ง `ψ/memory/public/` และ `ψ/memory/private/`
  - เพิ่ม field `is_private: boolean` ใน document metadata
  - Documents จาก `private/` → `is_private = true`
  - Documents จาก `public/` → `is_private = false`

### ปรับ Oracle V2 Schema

- [ ] แก้ `src/db/schema.ts`:
  - เพิ่ม column `is_private` (boolean, default false) ใน `oracle_documents` table
  - Run Drizzle migration

### ปรับ Search (Optional)

- [ ] Search results สามารถ filter ด้วย `is_private`:
  - MCP read-only mode → exclude private documents (safety)
  - Main group → include ทุกอย่าง
  - Non-main groups → public only

### Volume Mount

- [ ] Docker Compose: mount `ψ/memory/private/` เป็น encrypted volume
  ```yaml
  volumes:
    - oracle-knowledge-public:/data/knowledge/public     # from repo
    - oracle-knowledge-private:/data/knowledge/private   # encrypted volume
  ```

### ทดสอบ

- [ ] `git status` → ไม่เห็น files ใน `ψ/memory/private/`
- [ ] Oracle indexer → index ทั้ง public + private
- [ ] Search → return documents จากทั้ง 2 layers (ใน main group)
- [ ] Non-main group (read-only) → ไม่เห็น private documents

---

## 🧪 Definition of Done

1. `ψ/memory/private/` ไม่อยู่ใน Git (.gitignore)
2. Existing personal data ย้ายไป private layer แล้ว
3. Oracle indexer index ทั้ง 2 layers ด้วย `is_private` flag
4. Private docs อยู่บน encrypted volume เท่านั้น

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `.gitignore` | Oracle V2 | Add `ψ/memory/private/` |
| `src/indexer.ts` | Oracle V2 | Add private layer scanning + flag |
| `src/db/schema.ts` | Oracle V2 | Add `is_private` column |
| `docker-compose.yml` | JellyCore | Mount private as encrypted volume |

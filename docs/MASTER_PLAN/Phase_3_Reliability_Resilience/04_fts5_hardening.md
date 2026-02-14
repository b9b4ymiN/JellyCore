# 3.4 — FTS5 Query Hardening

> แก้จุดอ่อน: S6 (FTS5 Sanitization Falls Back to Original Query)

**Status:** ⬜ Not Started  
**Effort:** Small  
**Priority:** 🟡 Medium

---

## 📋 ปัญหาเดิม

FTS5 sanitizer strip special characters → ถ้า sanitized เป็นว่าง → **fallback ใช้ original unsanitized query** → อาจ crash FTS5

**ที่มา:** Oracle V2 `src/index.ts` `sanitizeFtsQuery()`, `src/server/handlers.ts`

---

## ✅ Checklist

### Fix Sanitizer Fallback

- [ ] แก้ `sanitizeFtsQuery()`:
  ```typescript
  // BEFORE: fallback to original if sanitized is empty
  // AFTER: return empty → caller returns empty results
  function sanitizeFtsQuery(query: string): string | null {
    const sanitized = query.replace(/[?*+\-()^~"':./\\]/g, ' ').trim();
    if (!sanitized || sanitized.length === 0) {
      return null;  // Signal: query has no searchable terms
    }
    return sanitized;
  }
  ```

### Add Query Length Limit

- [ ] Max query length: 500 characters
  ```typescript
  if (query.length > 500) {
    query = query.slice(0, 500);
  }
  ```

### Wrap FTS5 MATCH in Try/Catch

- [ ] แก้ search handler:
  ```typescript
  try {
    results = db.prepare('SELECT * FROM oracle_fts WHERE oracle_fts MATCH ?').all(sanitized);
  } catch (err) {
    log.warn(`FTS5 query error: ${err.message}, falling back to LIKE`);
    // Safe fallback: LIKE search (slower but won't crash)
    results = db.prepare('SELECT * FROM oracle_documents WHERE content LIKE ?')
      .all(`%${sanitized}%`);
  }
  ```

### Input Validation at MCP/HTTP Layer

- [ ] MCP tool `oracle_search` → validate before processing:
  - Empty query → return `{ results: [], message: "Query is empty" }`
  - Query = only special characters → return empty results
  - Query > 500 chars → truncate

### ทดสอบ

- [ ] Search `"((("` → empty results (ไม่ crash)
- [ ] Search `"***"` → empty results
- [ ] Search `""` (empty) → empty results + message
- [ ] Search `"normal query"` → results as expected
- [ ] Search very long string (1000 chars) → truncated to 500 + results
- [ ] FTS5 parse error → LIKE fallback triggers + warning logged

---

## 🧪 Definition of Done

1. No FTS5 crash from any input
2. Empty/special-char queries → empty results (no fallback to raw)
3. LIKE fallback for FTS5 errors
4. Query length limited

---

## 📎 Files to Modify

| File | Repo | Action |
|------|------|--------|
| `src/index.ts` | Oracle V2 | Fix sanitizeFtsQuery fallback |
| `src/server/handlers.ts` | Oracle V2 | Try/catch FTS5 + LIKE fallback |

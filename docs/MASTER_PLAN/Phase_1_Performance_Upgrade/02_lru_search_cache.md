# 1.2 — Oracle V2 LRU Search Cache

> แก้จุดอ่อน: P3 (No Search Caching in Oracle V2)

**Status:** ✅ Complete  
**Effort:** Medium  
**Priority:** 🟡 Medium

---

## 📋 ปัญหาเดิม

ทุก search request hit SQLite FTS5 + ChromaDB ใหม่ทุกครั้ง ไม่มี cache  
Repeated queries (เช่น agent consult loop) เสีย compute ซ้ำ

**ที่มา:** Oracle V2 `src/server/handlers.ts` → `handleSearch()`

---

## 🎯 เป้าหมาย

LRU cache ใน memory: repeated query → <5ms, cache invalidation เมื่อ write operations

---

## ✅ Checklist

### Install Dependencies

- [ ] เพิ่ม `lru-cache` package: `bun add lru-cache`

### สร้าง Cache Module

- [ ] สร้าง `src/cache.ts`:
  ```typescript
  import { LRUCache } from 'lru-cache';
  
  interface CacheEntry {
    results: SearchResult[];
    timestamp: number;
  }
  
  const searchCache = new LRUCache<string, CacheEntry>({
    max: 1000,           // Max 1000 entries
    ttl: 5 * 60 * 1000,  // TTL: 5 minutes
  });
  
  export function getCachedSearch(key: string): SearchResult[] | null;
  export function setCachedSearch(key: string, results: SearchResult[]): void;
  export function invalidateCache(): void;  // Flush all
  export function getCacheStats(): { hits: number, misses: number, size: number };
  ```

- [ ] Cache key generation:
  ```typescript
  function makeCacheKey(query: string, mode: string, limit: number): string {
    return `${mode}:${limit}:${query.toLowerCase().trim()}`;
  }
  ```

### Integrate with Search Handler

- [ ] แก้ `src/server/handlers.ts` → `handleSearch()`:
  ```typescript
  // Check cache first
  const cached = getCachedSearch(cacheKey);
  if (cached) {
    logCacheHit(query);
    return cached;
  }
  
  // Execute search
  const results = await hybridSearch(query, mode, limit);
  
  // Store in cache
  setCachedSearch(cacheKey, results);
  return results;
  ```

### Cache Invalidation

- [ ] เรียก `invalidateCache()` เมื่อ:
  - `oracle_learn` ถูกเรียก (new document added)
  - `oracle_supersede` ถูกเรียก (document superseded)
  - Indexer re-run (new documents indexed)
  - `POST /api/learn` endpoint

### Cache Stats API

- [ ] เพิ่ม endpoint `GET /api/cache/stats`:
  ```json
  { "hits": 1234, "misses": 56, "size": 789, "maxSize": 1000, "ttlMs": 300000 }
  ```
- [ ] เพิ่มใน `oracle_stats` MCP tool response

### ทดสอบ

- [ ] Search "test" ครั้งแรก → ~200ms (cache miss)
- [ ] Search "test" ครั้งที่ 2 → <5ms (cache hit)
- [ ] `oracle_learn` something → search cache cleared
- [ ] Search "test" ครั้งที่ 3 → ~200ms (cache miss after invalidation)
- [ ] Wait 5 minutes → search "test" → ~200ms (TTL expired)
- [ ] Cache stats endpoint → shows correct hit/miss ratio

---

## 🧪 Definition of Done

1. Repeated identical queries → <5ms response
2. Cache invalidated on write operations
3. TTL 5 minutes enforced
4. Cache stats available via API

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `src/cache.ts` | Oracle V2 | **Create** — LRU cache module |
| `src/server/handlers.ts` | Oracle V2 | Wrap search with cache |
| `src/index.ts` | Oracle V2 | Invalidate cache on learns/supersedes |
| `src/server.ts` | Oracle V2 | Add /api/cache/stats endpoint |
| `package.json` | Oracle V2 | Add lru-cache dependency |

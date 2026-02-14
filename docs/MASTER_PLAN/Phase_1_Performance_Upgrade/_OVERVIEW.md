# Phase 1: Performance Upgrade

> สัปดาห์ที่ 2 — เพิ่มประสิทธิภาพทั้ง database, search, messaging และ container

**Status:** ✅ Complete  
**แก้ไขจุดอ่อน:** P1, P2, P3, P4, P5, P6, P7, P8 (8 จุด)  
**Prerequisites:** Phase 0 completed

---

## 🎯 เป้าหมาย

ลด latency ทุกจุด — database (WAL mode), search (LRU cache), messaging (event-driven), container (pre-compiled) — ให้ user experience เร็วและ smooth

---

## 📁 Items ใน Phase นี้

| # | Item | แก้จุดอ่อน | ไฟล์ |
|---|------|-----------|------|
| 1.1 | SQLite WAL Mode + Busy Timeout | P1, P2 | [01_sqlite_wal_mode.md](01_sqlite_wal_mode.md) |
| 1.2 | Oracle V2 LRU Search Cache | P3 | [02_lru_search_cache.md](02_lru_search_cache.md) |
| 1.3 | Event-Driven Message Handling | P4 | [03_event_driven_messages.md](03_event_driven_messages.md) |
| 1.4 | ChromaDB Dedicated Service | P5 | [04_chromadb_dedicated_service.md](04_chromadb_dedicated_service.md) |
| 1.5 | Pre-Built Agent Container | P6 | [05_prebuilt_container.md](05_prebuilt_container.md) |
| 1.6 | Dynamic Concurrency + Backpressure | P7 | [06_dynamic_concurrency.md](06_dynamic_concurrency.md) |
| 1.7 | IPC Upgrade (fs.watch) | P8 | [07_ipc_upgrade.md](07_ipc_upgrade.md) |
| 1.8 | Smart Query Router | W9 (cost) | [08_smart_query_router.md](08_smart_query_router.md) |
| 1.9 | Container Warm Pool | W6 (cold start) | [09_container_warm_pool.md](09_container_warm_pool.md) |

---

## 🔗 Dependency Graph

```
1.1 SQLite WAL       ──► (independent)
1.2 LRU Cache        ──► (independent)
1.3 Event-Driven     ──► (independent)
1.4 ChromaDB Svc     ──► (done in Phase 0.8)
1.5 Pre-Built Img    ──► 1.9 Warm Pool (needs pre-built image)
1.6 Backpressure     ──► (independent)
1.7 IPC Upgrade      ──► (independent)
1.8 Smart Query Router ──► (independent, ใช้กับ 1.9)
1.9 Container Warm Pool ──► depends on 1.5
```

**ส่วนใหญ่ทำ parallel ได้** — ยกเว้น 1.9 ที่ต้องรอ 1.5

---

## 📊 Expected Performance Gains

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Oracle search (cached) | ~200ms | <5ms | 40x faster |
| Oracle search (uncached) | ~200ms | <200ms | same (first call) |
| Message latency | 0-2s (polling) | <50ms (event) | 40x faster |
| Container cold start | ~10s | <3s | 3x faster |
| SQLite concurrent R/W | SQLITE_BUSY | seamless | no errors |

---

## 📊 Expected Performance Gains (Updated)

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Oracle search (cached) | ~200ms | <5ms | 40x faster |
| Simple query routing | N/A (all to container) | Inline/Oracle-only | 70% skip container |
| Container acquisition | ~10s (cold) | <300ms (warm pool) | 33x faster |
| Message latency | 0-2s (polling) | <50ms (event) | 40x faster |
| SQLite concurrent R/W | SQLITE_BUSY | seamless | no errors |
| API cost per query | ~$0.05 avg | ~$0.02 avg | 2.5x cheaper |

---

## ✅ Phase Completion Criteria

- [x] SQLite WAL mode enabled ทั้ง 2 repo + busy timeout 30s
- [x] Oracle search cached → <5ms response
- [x] Message event-driven → polls ≤ 1 ครั้ง/30s (fallback only)
- [x] Container image pre-compiled → cold start <5s
- [x] User ได้ backpressure notification เมื่อ queue เต็ม
- [x] Smart Query Router classifies queries into 4 tiers
- [x] Container Warm Pool maintains ≥1 ready container, acquisition <300ms

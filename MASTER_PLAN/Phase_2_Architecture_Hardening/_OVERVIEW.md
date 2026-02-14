# Phase 2: Architecture Hardening

> สัปดาห์ที่ 3 — แก้ไขจุดอ่อนทางสถาปัตยกรรม: SPOF, queue persistence, health monitoring

**Status:** ⬜ Not Started  
**แก้ไขจุดอ่อน:** A1, A2, A3, A4, A5, A6, A7 (7 จุด)  
**Prerequisites:** Phase 0, Phase 1 completed

---

## 🎯 เป้าหมาย

ทำให้ระบบ **resilient** — crash แล้วฟื้นได้, queue ไม่หาย, container ไม่กลายเป็น orphan, มี monitoring และ rate limiting

---

## 📁 Items ใน Phase นี้

| # | Item | แก้จุดอ่อน | ไฟล์ |
|---|------|-----------|------|
| 2.1 | Process Supervisor (PM2) | A1 | [01_process_supervisor.md](01_process_supervisor.md) |
| 2.2 | Queue State Persistence | A2, A3 | [02_queue_persistence.md](02_queue_persistence.md) |
| 2.3 | Container Lifecycle Manager | A3 | [03_container_lifecycle.md](03_container_lifecycle.md) |
| 2.4 | Health Monitor + Alerts | A4 | [04_health_monitor.md](04_health_monitor.md) |
| 2.5 | SQLite ↔ ChromaDB Sync | A5 | [05_sync_guarantee.md](05_sync_guarantee.md) |
| 2.6 | Rate Limiter | A6 | [06_rate_limiter.md](06_rate_limiter.md) |
| 2.7 | Database Migration System | A7 | [07_migration_system.md](07_migration_system.md) |

---

## 🔗 Dependency Graph

```
2.1 PM2 Supervisor     ──► (independent, do first)
2.2 Queue Persistence  ──► 2.3 Container Lifecycle (uses persisted state)
2.4 Health Monitor     ──► 2.1 PM2 (uses PM2 API for restart)
2.5 Sync Guarantee     ──► (independent)
2.6 Rate Limiter       ──► (independent)
2.7 Migration System   ──► (do early, other items may need new tables)
```

**แนะนำลำดับ:** 2.7 → 2.1 → 2.2 → 2.3 → 2.4 → 2.5/2.6 (parallel)

---

## ✅ Phase Completion Criteria

- [ ] PM2 auto-restart NanoClaw + Oracle ภายใน 5s หลัง crash
- [ ] Queue state persist → restart ไม่สูญเสีย queued messages
- [ ] Orphan containers ถูก cleanup เมื่อ NanoClaw restart
- [ ] Health monitor ตรวจทุก subsystem ทุก 30s + alert ผ่าน Telegram
- [ ] SQLite ↔ ChromaDB sync status tracking
- [ ] Rate limiting: 10 msg/min per user enforced
- [ ] Schema migrations versioned + tracked

# Phase 3: Reliability & Resilience

> สัปดาห์ที่ 4 — ทำให้ระบบ recover จาก failures ได้อัตโนมัติ + backup data อย่างสม่ำเสมอ

**Status:** ⬜ Not Started  
**แก้ไขจุดอ่อน:** R1, R2, R3, R4, R5, S6 (6 จุด)  
**Prerequisites:** Phase 0, 1, 2 completed

---

## 🎯 เป้าหมาย

ทำให้ระบบ "self-recovering" — WhatsApp disconnect → reconnect อัตโนมัติ, partial failure → retry, stuck tasks → circuit breaker, ทุกอย่างมี backup

---

## 📁 Items ใน Phase นี้

| # | Item | แก้จุดอ่อน | ไฟล์ |
|---|------|-----------|------|
| 3.1 | WhatsApp Connection Resilience | R1 | [01_whatsapp_resilience.md](01_whatsapp_resilience.md) |
| 3.2 | Partial Output Recovery | R2 | [02_partial_output_recovery.md](02_partial_output_recovery.md) |
| 3.3 | Task Scheduler Circuit Breaker | R5 | [03_circuit_breaker.md](03_circuit_breaker.md) |
| 3.4 | FTS5 Query Hardening | S6 | [04_fts5_hardening.md](04_fts5_hardening.md) |
| 3.5 | Automated Backup System | R4 | [05_automated_backup.md](05_automated_backup.md) |

---

## ✅ Phase Completion Criteria

- [ ] WhatsApp disconnect → auto-reconnect ภายใน 30s (max 5 retries)
- [ ] WhatsApp logged out → enter degraded mode + alert (ไม่ exit)
- [ ] Container crash mid-response → user notified + auto-retry
- [ ] Task fail 3 ครั้งติด → disabled + alert
- [ ] FTS5 malformed query → safe error (ไม่ crash)
- [ ] Backup ทุก 6 ชั่วโมง + daily off-site sync + restore tested

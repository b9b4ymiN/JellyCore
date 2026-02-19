# 🧠 JellyCore — Full Power Master Plan

> NanoClaw (Body) + Oracle V2 (Brain) = JellyCore (Personal AI Assistant)

**Version:** 2.1 — Full Power Edition (Improved)  
**Created:** 2026-02-14  
**Updated:** 2025-07-14  
**Status:** Planning  
**Total Phases:** 7 (Phase 0–6)  
**Total Items:** 47 (เดิม 40 + Phase 6 ใหม่ 7)  
**Estimated Timeline:** 12 สัปดาห์  

---

## 🎯 Vision

ระบบ AI ผู้ช่วยส่วนตัวที่:
- มี **long-term memory** จดจำบริบท บทสนทนา และ preferences ของเจ้าของ
- มี **hybrid search** (keyword + semantic) สำหรับ knowledge retrieval ที่แม่นยำ
- มี **4-layer memory** (Working/Episodic/Semantic/Procedural) เพื่อความจำขั้นสูง
- ทำงานผ่าน **multi-channel** (WhatsApp + Telegram) ได้อย่างต่อเนื่อง
- มี **container isolation** สำหรับ code execution ที่ปลอดภัย
- **self-reflecting** ประเมินคำตอบตัวเอง ปรับปรุงอัตโนมัติ
- **self-healing** และ **auto-recovery** เมื่อเกิดปัญหา
- **response streaming** แสดงผลแบบ real-time ไม่ต้องรอ
- **production-ready** ด้วย encryption, backup, monitoring, dashboard ครบวงจร

---

## 🏗️ Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                    LINUX VPS (Docker Compose)                    │
│                                                                  │
│  ┌──────────────────┐    ┌───────────────────────────────────┐  │
│  │  NANOCLAW HOST   │    │  ORACLE V2 SERVICE (independent)  │  │
│  │  (Node.js 22)    │    │  (Bun runtime)                    │  │
│  │                  │    │                                   │  │
│  │  • WhatsApp      │◄──►│  • MCP Server + HTTP API          │  │
│  │  • Telegram      │    │  • Hybrid Search (FTS5+ChromaDB)  │  │
│  │  • Router        │    │  • Knowledge Store                │  │
│  │  • Queue         │    │  • LRU Cache                      │  │
│  │  • Scheduler     │    │  • Dashboard (React)              │  │
│  │  • Health Monitor│    │                                   │  │
│  └────────┬─────────┘    └───────────────────────────────────┘  │
│           │ spawn                                                │
│  ┌────────▼──────────────────────────────────────────────────┐  │
│  │  DOCKER CONTAINER (per query)                             │  │
│  │  Claude Agent SDK + MCP-HTTP Bridge → Oracle API          │  │
│  │  Restricted mounts (group folder + IPC only)              │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌────────┐ ┌───────────────────┐    │
│  │ ChromaDB │ │ Caddy TLS│ │ Backup │ │ PM2 Supervisor    │    │
│  └──────────┘ └──────────┘ └────────┘ └───────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

## 📊 Weakness Analysis Summary

แผนนี้แก้ไขจุดอ่อน **29 จุดเดิม** + **21 จุดที่ค้นพบจากการ review เพิ่มเติม**:

| Severity | จำนวนเดิม | จุดอ่อนเพิ่มที่แก้ | ตัวอย่าง |
|----------|-----------|-------------------|---------|
| 🔴 Critical | 2 | +3 | Container permission bypass, SPOF, Knowledge decay, Cost explosion |
| 🟠 High | 8 | +5 | Unencrypted auth, No streaming, No query routing, No memory layers |
| 🟡 Medium | 13 | +8 | No cache, No dashboard, No contradiction detection, No UX indicators |
| 🟢 Low | 6 | +5 | IPC polling, No rich UI, No self-reflection |

---

## 📁 Phase Structure

| Phase | สัปดาห์ | Focus | Items | จุดอ่อนที่แก้ |
|-------|---------|-------|-------|-------------|
| [Phase 0](Phase_0_Security_Foundation/) | 1 | Security Foundation | 8 | S1–S8 |
| [Phase 1](Phase_1_Performance_Upgrade/) | 2–3 | Performance Upgrade | 9 (+2 ใหม่) | P1–P8, W6, W9 |
| [Phase 2](Phase_2_Architecture_Hardening/) | 3–4 | Architecture Hardening | 7 | A1–A7 |
| [Phase 3](Phase_3_Reliability_Resilience/) | 4–5 | Reliability & Resilience | 5 | R1–R5, S6 |
| [Phase 4](Phase_4_Integration_Channels/) | 5–8 | Integration & Intelligence | 13 (+8 ใหม่) | W4, W8, W9, W11, W15 |
| [Phase 5](Phase_5_Production_Polish/) | 8–10 | Production Polish | 6 (+1 ใหม่) | W11 |
| [Phase 6](Phase_6_Scheduler_Heartbeat/) | 10–12 | Scheduler Hardening + Heartbeat | 7 | B1–B6 + HB |

### 🆕 New Items Added (v2.1)

| Category | Items | Description |
|----------|-------|-------------|
| 🧠 ฉลาดขึ้น | 1.8 Smart Query Router, 4.6 Enhanced RAG, 4.10 Self-Reflection | Query classification, hybrid search re-ranking, quality self-eval |
| 💾 จำดีขึ้น | 4.7 4-Layer Memory, 4.8 Knowledge Decay, 4.11 Memory Consolidation | Working/Episodic/Semantic/Procedural memory, temporal decay, dedup |
| ⚡ เร็วขึ้น | 1.9 Container Warm Pool, 4.9 Response Streaming | Pre-warmed containers, IPC streaming, progressive UI update |
| 🎨 UX ดีขึ้น | 4.12 Rich Telegram UI, 4.13 Status Indicators, 5.6 Interactive Dashboard | Inline keyboards, real-time progress, web dashboard |

---

## 🔑 Key Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Oracle deployment | Independent service (HTTP) | ลด coupling, upgrade อิสระ, ChromaDB start ครั้งเดียว |
| Container↔Oracle | MCP-HTTP Bridge | Agent ใช้ `mcp__oracle__*` ได้เหมือนเดิม |
| Process supervisor | PM2 | Cross-platform, Node.js native, built-in log rotation |
| Telegram mode | Webhook (ไม่ใช่ polling) | Reliable กว่า, ไม่ต้อง maintain connection |
| Storage encryption | LUKS / Docker encrypted volumes | Encrypt at rest ทุก data volume |
| Knowledge versioning | Public/Private split | Public → Git, Private → encrypted volume only |
| Reverse proxy | Caddy | Auto TLS, config ง่าย, performance ดี |
| Backup schedule | 6-hourly + daily off-site | Balance data loss window vs storage cost |

---

## 📋 How to Use This Plan

1. **เปิด Phase folder** ตามลำดับ (Phase 0 → 1 → 2 → ...)
2. **อ่าน `_OVERVIEW.md`** ในแต่ละ Phase เพื่อเข้าใจ scope
3. **เปิดแต่ละ Item file** แล้วทำตาม checklist ทีละข้อ
4. **Tick ☑️ checklist** เมื่อทำเสร็จแต่ละข้อ (`[ ]` → `[x]`)
5. **อย่าข้าม Phase** — แต่ละ Phase build on top of previous
6. **Items ภายใน Phase เดียวกัน** สามารถทำ parallel ได้ถ้าไม่มี dependency

---

## 🔗 Source Repositories

| Repo | Role | URL |
|------|------|-----|
| NanoClaw | Execution Engine (Body) | https://github.com/qwibitai/nanoclaw |
| Oracle V2 | Knowledge Engine (Brain) | https://github.com/Soul-Brews-Studio/oracle-v2 |

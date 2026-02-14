# Phase 4: Integration & Channels + Intelligence Layer

> สัปดาห์ที่ 5–7 — เชื่อมระบบเข้าด้วยกัน, เพิ่ม Telegram, สร้าง AI intelligence layer, พัฒนา memory & UX

**Status:** ⬜ Not Started  
**แก้ไขจุดอ่อน:** W4 (streaming), W8 (knowledge decay), W9 (cost), W11 (dashboard), W15 (UI)  
**Prerequisites:** Phase 0, 1, 2, 3 completed

---

## 🎯 เป้าหมาย

ทำให้ AI assistant **ฉลาด จำดี เร็ว UX ดี** — Enhanced RAG, 4-Layer Memory, Knowledge Decay, Self-Reflection, Response Streaming, Rich Telegram UI, Status Indicators

---

## 📁 Items ใน Phase นี้

| # | Item | Category | ไฟล์ |
|---|------|----------|------|
| 4.1 | Context-Aware Prompt Builder | Intelligence | [01_prompt_builder.md](01_prompt_builder.md) |
| 4.2 | Telegram Channel | Channel | [02_telegram_channel.md](02_telegram_channel.md) |
| 4.3 | Auto-Learning System | Intelligence | [03_auto_learning.md](03_auto_learning.md) |
| 4.4 | Conversation Memory Pipeline | Memory | [04_conversation_memory.md](04_conversation_memory.md) |
| 4.5 | End-to-End Integration Test | Testing | [05_e2e_test.md](05_e2e_test.md) |
| 4.6 | Enhanced RAG Pipeline | 🧠 ฉลาดขึ้น | [06_enhanced_rag.md](06_enhanced_rag.md) |
| 4.7 | 4-Layer Memory System | 💾 จำดีขึ้น | [07_memory_system.md](07_memory_system.md) |
| 4.8 | Knowledge Decay & Contradiction Detection | 💾 จำดีขึ้น | [08_knowledge_decay.md](08_knowledge_decay.md) |
| 4.9 | Response Streaming | ⚡ เร็วขึ้น | [09_response_streaming.md](09_response_streaming.md) |
| 4.10 | Self-Reflection Loop | 🧠 ฉลาดขึ้น | [10_self_reflection.md](10_self_reflection.md) |
| 4.11 | Memory Consolidation Service | 💾 จำดีขึ้น | [11_memory_consolidation.md](11_memory_consolidation.md) |
| 4.12 | Rich Telegram UI | 🎨 UX ดีขึ้น | [12_rich_telegram_ui.md](12_rich_telegram_ui.md) |
| 4.13 | Status Indicators | 🎨 UX ดีขึ้น | [13_status_indicators.md](13_status_indicators.md) |

---

## 🔗 Dependency Graph

```
4.1 Prompt Builder   ──► 4.6 Enhanced RAG ──► 4.10 Self-Reflection
4.2 Telegram Channel ──► 4.12 Rich UI ──► 4.13 Status Indicators
4.3 Auto-Learning    ──► 4.4 Conversation Memory
4.4 Conv Memory      ──► 4.7 Memory System ──► 4.8 Knowledge Decay
                                             ──► 4.11 Memory Consolidation
4.5 E2E Test         ──► (ทำหลังสุด)
4.9 Response Streaming ──► (needs IPC Upgrade 2.7)
```

**ทำ parallel ได้ (Wave 1):** 4.1, 4.2, 4.3, 4.9  
**Wave 2:** 4.4, 4.6, 4.12  
**Wave 3:** 4.7, 4.10, 4.13  
**Wave 4:** 4.8, 4.11  
**สุดท้าย:** 4.5 E2E Test

---

## ✅ Phase Completion Criteria

### Core (เดิม)
- [ ] Agent response มี Oracle context injected
- [ ] Telegram channel ส่ง/รับ messages ได้
- [ ] Agent auto-learn จาก conversations
- [ ] Conversation summaries stored ใน Oracle
- [ ] E2E: WhatsApp → Agent → Oracle → Response (ถูกต้อง)
- [ ] E2E: Telegram → Agent → Oracle → Response (ถูกต้อง)

### ฉลาดขึ้น (ใหม่)
- [ ] Enhanced RAG: hybrid search re-ranking, source attribution
- [ ] Self-Reflection: quality < 0.5 triggers retry
- [ ] Query expansion: Thai↔English cross-language

### จำดีขึ้น (ใหม่)
- [ ] 4-Layer Memory System functional (Working/Episodic/Semantic/Procedural)
- [ ] Knowledge Decay: temporal decay scoring active
- [ ] Contradiction Detection: conflicts flagged on learn
- [ ] Memory Consolidation: daily job merges duplicates

### เร็วขึ้น (ใหม่)
- [ ] Response Streaming: Telegram progressive update
- [ ] Status indicators: processing stages visible

### UX ดีขึ้น (ใหม่)
- [ ] Rich Telegram UI: inline keyboards, feedback buttons
- [ ] Status Indicators: real-time processing progress

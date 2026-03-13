# Synapse Decision Log

**Created:** 2026-03-13
**Status:** Approved

---

## Decision: Fork Graphiti + Inject Oracle-v2 (Option E)

### Context

ต้องการสร้างระบบสมองหลักใหม่สำหรับ JellyCore ที่:
1. มี Knowledge Graph (Oracle-v2 ไม่มี)
2. รองรับ Temporal Facts (รู้ว่าอะไร true เมื่อไหร่)
3. มี Thai NLP (Graphiti ไม่มี)
4. มี Five-Layer Memory Model (Graphiti ไม่มี)
5. Real-time Indexing (Oracle-v2 ไม่มี)

### Options Considered

| Option | Description | Time | Risk |
|--------|-------------|------|------|
| A | เก็บ Oracle-v2 + เพิ่ม Supermemory | Medium | Low |
| B | Upgrade Oracle-v2 ด้วย Graphiti concepts | High | Medium |
| C | Replace ด้วย Graphiti | Low | Medium |
| D | Build ใหม่จากศูนย์ | Very High | High |
| **E** | **Fork Graphiti + Inject Oracle-v2** | **Low** | **Low** |

### Decision

**เลือก Option E** - Fork Graphiti + Inject Oracle-v2 features

### Rationale

1. **เร็วที่สุด** - 3-5 วัน vs 2-3 สัปดาห์
2. **Risk ต่ำ** - ใช้ code ที่พิสูจน์แล้ว (24K stars)
3. **Maintenance ง่าย** - สามารถ merge upstream updates ได้
4. **ได้ของที่ยากที่สุดฟรี** - Graph engine, Temporal, Contradiction handling

### What We Get Free (from Graphiti)

- ✅ Temporal Knowledge Graph
- ✅ Entity extraction with LLM
- ✅ Auto contradiction handling
- ✅ Hybrid retrieval (semantic + BM25 + graph)
- ✅ MCP Server built-in
- ✅ Provenance (Episodes)

### What We Add (from Oracle-v2)

- ✅ Five-Layer Memory Model
- ✅ Thai NLP Sidecar
- ✅ Decay Scoring System
- ✅ User Model (preferences, expertise)
- ✅ Procedural Memory (how-to patterns)
- ✅ Supersede Pattern

### Consequences

**Positive:**
- เวลาพัฒนาสั้นลงมาก
- Code quality สูง (มี paper, มี production use)
- สามารถรับ upstream updates ได้

**Negative:**
- เป็น Python (ต่างจาก Oracle-v2 ที่เป็น TypeScript)
- ต้อง setup FalkorDB (แต่ง่ายกว่า Neo4j)
- ต้อง migrate data จาก Oracle-v2

### Stakeholders

- Boat (User) - Approved
- Fon (AI) - Recommended

### Review Date

After Phase 1 completion (Day 2)

---

## Related Decisions

| Date | Decision | Status |
|------|----------|--------|
| 2026-03-13 | Choose Option E over Option D | Approved |

---

## Appendix: Original Options

### Option A: Oracle-v2 + Supermemory

```
JellyCore
├── Oracle-v2 (Five-Layer Memory + Thai NLP)
├── Supermemory MCP (RAG + Connectors)
└── Nanoclaw (orchestrator)
```

Pros:
- เก็บ Oracle-v2 ไว้
- ได้ connectors จาก Supermemory

Cons:
- สองระบบแยกกัน
- ไม่มี Knowledge Graph
- Complex integration

### Option B: Upgrade Oracle-v2

เพิ่ม features เหล่านี้เข้า Oracle-v2:
- Knowledge Graph layer
- Bi-temporal tracking
- Auto contradiction handling

Pros:
- ไม่ต้อง setup DB ใหม่
- Stack เดิม (TypeScript)

Cons:
- เวลานาน
- ต้องเขียน graph engine เอง

### Option C: Replace with Graphiti

Replace Oracle-v2 ทั้งหมดด้วย Graphiti

Pros:
- ง่ายที่สุด

Cons:
- เสีย Thai NLP
- เสีย Five-Layer Model
- เสีย User Model

### Option D: Build New

สร้างใหม่ทั้งหมดจากศูนย์

Pros:
- สะอาดที่สุด
- Design ตามต้องการ

Cons:
- นานมาก (2-3 สัปดาห์)
- Risk สูง
- ต้องเขียนทุกอย่างเอง

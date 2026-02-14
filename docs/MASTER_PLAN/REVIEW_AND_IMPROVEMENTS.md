# 🔍 JellyCore Master Plan — Review & Improvements

> รีวิวฉบับเต็ม: จุดอ่อนที่ยังซ่อนอยู่ + แผนปรับปรุง + Claude Code Skills ที่แนะนำ  
> **Reviewed:** 2026-02-14  
> **Updated:** 2025-07-14 (v2.1 — แก้ไข Agent section เป็น Claude Code Skills)  
> **Reviewer:** AI Architect Review

---

## สารบัญ

1. [สรุปภาพรวมแผน](#1-สรุปภาพรวมแผน)
2. [จุดอ่อนที่ยังซ่อนอยู่ (21 จุด)](#2-จุดอ่อนที่ยังซ่อนอยู่)
3. [แผนปรับปรุง: ฉลาดขึ้น จำได้ดีขึ้น เร็วขึ้น](#3-แผนปรับปรุง)
4. [Claude Code Skills สำหรับการพัฒนา](#4-claude-code-skills-สำหรับการพัฒนา)
5. [สรุป Action Items](#5-สรุป-action-items)

---

## 1. สรุปภาพรวมแผน

แผนปัจจุบันครอบคลุมดี ครบ 6 Phases / 37 Items / 29 จุดอ่อน ใน 8 สัปดาห์ — ถือว่า **solid foundation** แต่ยังมีจุดอ่อนที่ซ่อนอยู่อีก **21 จุด** ที่แผนยังไม่ครอบคลุม

### สิ่งที่แผนทำได้ดี ✅

| ด้าน | สิ่งที่ดี |
|------|----------|
| Security | ครอบคลุมดี: LUKS, AES-256-GCM auth, HMAC IPC, container mount restriction |
| Architecture | แยก Oracle เป็น independent service เป็น decision ที่ดีมาก |
| Reliability | Circuit breaker, self-healing, backup ครบวงจร |
| Testing | E2E test plan ละเอียด ครอบคลุม 6 flows |
| Documentation | 5 เอกสาร ARCHITECTURE/SECURITY/RECOVERY/RUNBOOK/API ครบถ้วน |

### สิ่งที่ต้องปรับปรุง ⚠️

| ด้าน | ปัญหา |
|------|-------|
| Intelligence | ไม่มี strategy สำหรับ embedding model, LLM routing, RAG pipeline |
| Memory | ไม่มี memory decay, knowledge graph, contradiction detection |
| Performance | Container cold start ทุก query, ไม่มี streaming, ไม่มี container pool |
| Cost | ไม่มี token tracking, budget alerts, cost optimization |
| UX | ไม่มี streaming response, feedback loop, rich formatting |
| Data | ไม่มี retention policy, data deletion, privacy safeguards |

---

## 2. จุดอ่อนที่ยังซ่อนอยู่

### 🔴 Critical (5 จุด)

#### W1: ไม่มี Embedding Model Strategy
**ปัญหา:** แผนใช้ ChromaDB สำหรับ vector search แต่ไม่ได้ระบุ:
- ใช้ embedding model อะไร (OpenAI? local model? Bun-native?)
- Embedding dimension เท่าไร
- จะ upgrade embedding model อย่างไร (re-embed ทั้งหมด?)
- ภาษาไทย embedding quality ดีพอหรือไม่

**แก้ไข:** เพิ่ม Item ใน Phase 0 หรือ 1:
```
- เลือก embedding model: แนะนำ Cohere embed-v4 หรือ 
  OpenAI text-embedding-3-small (รองรับภาษาไทย)
- สร้าง embedding versioning system 
  (เก็บ model_version ใน metadata)
- เตรียม re-embedding script สำหรับ model upgrade
- ทดสอบ Thai language recall accuracy > 80%
```

#### W2: ไม่มี LLM Model Routing & Cost Control
**ปัญหา:** ทุก query spawn container + เรียก Claude เท่าเทียมกัน ไม่ว่าจะเป็นคำถามง่ายหรือซับซ้อน → สิ้นเปลือง API credits

**แก้ไข:**
```
Tier 1 (Simple): "สวัสดี", "ขอบคุณ"
  → ตอบ inline ไม่ต้อง spawn container

Tier 2 (Medium): คำถามทั่วไป, search
  → Claude Haiku/fast model, shorter context

Tier 3 (Complex): coding, analysis, multi-step
  → Claude Sonnet/Opus, full container + Oracle context

ควรเพิ่ม:
- Token usage tracker per user/day/month
- Budget alert เมื่อใช้ > 80% ของ monthly budget  
- Cost dashboard ใน Oracle Dashboard
```

#### W3: Container Cold Start ทุก Query
**ปัญหา:** แม้ prebuilt image จะลดเหลือ <3s แต่ทุก message ยังต้อง spawn → run → destroy container ซึ่งยังช้าสำหรับ conversational UX

**แก้ไข:**
```
Container Warm Pool:
- เตรียม 1-2 containers ไว้ล่วงหน้า (pre-warmed)
- เมื่อ container ถูกใช้ → spawn ตัวใหม่เข้า pool ทันที
- Idle container timeout: 5 นาที
- ลด latency จาก 3s → <500ms

Alternative: Session-Persistent Container
- Container ไม่ตายทันที หลังตอบ → รอ 10 นาที
- Follow-up messages ใช้ container เดิม (resume session)
- ลด spawn overhead สำหรับ conversation flow
```

#### W4: ไม่มี Streaming Response
**ปัญหา:** User ต้องรอจนกว่า container จะทำงานเสร็จ 100% จึงได้ response → UX ไม่ดีสำหรับ response ยาว

**แก้ไข:**
```
Streaming Pipeline:
1. Container → เขียน partial output ลง IPC file ทุก chunk
2. NanoClaw → fs.watch detect partial output  
3. NanoClaw → ส่ง partial message ทาง WhatsApp/Telegram
4. เมื่อจบ → ส่ง message สุดท้าย (หรือ edit message เดิม)

Telegram: ใช้ editMessageText() สำหรับ streaming
WhatsApp: ส่ง typing indicator → ส่ง full response เมื่อจบ
  (WhatsApp ไม่รองรับ edit message ได้ดี)
```

#### W5: ไม่มี Data Retention & Privacy Policy
**ปัญหา:** เก็บ conversations, preferences, learnings ตลอดไป ไม่มี:
- สิทธิ์ลบข้อมูลของ user
- Data retention period
- Export ข้อมูลส่วนตัว
- Anonymization สำหรับ analytics

**แก้ไข:**
```
- เพิ่ม IPC command: delete_my_data → ลบ learnings ของ user
- Auto-archive conversations > 90 วัน
- Don't store: passwords, financial data, medical data
- เก็บ conversation summaries แทน raw messages
- เพิ่มใน SECURITY.md: Data Privacy section
```

---

### 🟠 High (8 จุด)

#### W6: RAG Pipeline ไม่สมบูรณ์
**ปัญหา:** Prompt Builder (4.1) query Oracle 3 ครั้งแบบง่ายๆ แต่ไม่มี:
- Document chunking strategy (เอกสารยาว → ผลลัพธ์ไม่แม่นยำ)
- Re-ranking (ผลลัพธ์ top-5 อาจไม่ relevant ที่สุด)
- Dynamic context window management (inject มากไปจน token เกิน)

**แก้ไข:** เพิ่มใน Phase 4 Item 4.1:
```
RAG Enhancement:
1. Chunking: แบ่งเอกสารเป็น chunks 500-1000 tokens
   พร้อม overlap 100 tokens
2. Re-ranking: ใช้ cross-encoder หรือ LLM re-rank 
   บน top-20 → เลือก top-5
3. Context Budget: คำนวณ token ก่อน inject
   - Max context: 4000 tokens
   - ถ้าเกิน → ตัด lowest relevance ออก
4. Source Attribution: แสดง source ของ knowledge ใน response
```

#### W7: Memory System ตื้นเกินไป
**ปัญหา:** Conversation Memory (4.4) เก็บแค่ summary → ไม่มี structured memory types

**แก้ไข:** ปรับ Memory Architecture เป็น 4 ชั้น:
```
┌──────────────────────────────────────┐
│  Episodic Memory (บทสนทนา)           │ ← 4.4 มีแล้ว
│  "เมื่อวาน discuss เรื่อง Docker"      │
├──────────────────────────────────────┤
│  Semantic Memory (ความรู้)             │ ← Oracle มีแล้ว
│  "Docker คือ container platform"      │
├──────────────────────────────────────┤
│  Procedural Memory (วิธีทำ) ★ NEW    │
│  "User ชอบให้ deploy ด้วย script"     │
│  "เวลา debug → ดู log ก่อนเสมอ"      │
├──────────────────────────────────────┤
│  User Model (โมเดลผู้ใช้) ★ NEW      │
│  "ระดับ expertise: senior dev"        │
│  "ภาษา: ไทย casual, อังกฤษ technical" │
│  "เวลาตอบ: ชอบสั้น กระชับ"           │
└──────────────────────────────────────┘

เพิ่ม concepts ใน Oracle:
- memory:episodic, memory:semantic, memory:procedural, memory:user_model
- ให้ Prompt Builder ดึงจากแต่ละชั้นแยกกัน
```

#### W8: ไม่มี Knowledge Decay & Contradiction Detection
**ปัญหา:** Knowledge ถูกเก็บตลอดไปด้วย weight เท่ากัน → ข้อมูลเก่าที่ผิดอาจ override ข้อมูลใหม่ที่ถูก

**แก้ไข:**
```
Knowledge Lifecycle:
1. Temporal Decay: relevance_score *= 0.95^(days_since_access)
   - เข้าถึงบ่อย → score สูง
   - ไม่เคยเข้าถึง → ค่อยๆ จางลง

2. Contradiction Detection:
   - เมื่อ learn ใหม่ → search existing ที่ขัดแย้ง
   - ถ้า similarity > 0.8 แต่ content ขัดแย้ง → flag
   - ถาม user: "ข้อมูลเดิมบอกว่า X แต่ข้อมูลใหม่บอกว่า Y — ใช้อันไหน?"
   - ถ้า auto → ใช้ข้อมูลใหม่กว่า (supersede เก่า)

3. Knowledge Consolidation (weekly):
   - รวม fragments ที่เกี่ยวข้องเป็น document เดียว
   - ลบ duplicates
   - Update decay scores
```

#### W9: IPC ยังเป็น File-Based
**ปัญหา:** แม้จะ upgrade เป็น fs.watch แล้ว แต่ file-based IPC ยังมีข้อจำกัด:
- Race conditions ตอนเขียน/อ่านพร้อมกัน
- Disk I/O bottleneck
- ไม่รองรับ bidirectional streaming

**แก้ไข:** อัปเกรดเป็น Unix Domain Socket หรือ named pipe (Phase ถัดไป):
```
ทางเลือก:
A) Unix Domain Socket (แนะนำ)
   - Bidirectional, zero-copy
   - Container mount: /tmp/jellycore.sock
   - ใช้ได้กับ Docker --volume

B) Redis Pub/Sub 
   - ถ้าจะ scale หลาย VPS ในอนาคต
   - เพิ่ม dependency แต่ได้ scalability

C) เก็บ file-based IPC ไว้ (ปัจจุบัน)
   - ง่ายที่สุด, debug ง่าย
   - ใช้ได้ถ้า throughput ไม่สูงมาก (<100 msg/min)
   
แนะนำ: ใช้ file-based ไปก่อน (Phase 0-3), 
upgrade เป็น Unix Socket ใน Phase 4+
```

#### W10: ไม่มี Observability & Request Tracing
**ปัญหา:** มี health checks แต่ไม่มี end-to-end tracing → debug ยากเมื่อ response ช้าหรือผิด

**แก้ไข:**
```
เพิ่มใน Phase 5 (Monitoring):
1. Request ID: generate UUID ต่อ message
   → propagate ผ่านทุก service (HTTP header, IPC metadata)

2. Trace Log:
   [req-abc123] 00ms → Received WhatsApp message
   [req-abc123] 05ms → Queued (position: 2)
   [req-abc123] 50ms → Oracle context query (3 results)
   [req-abc123] 120ms → Container spawned
   [req-abc123] 3500ms → Container completed
   [req-abc123] 3550ms → Response sent

3. Slow Request Alert: 
   ถ้า total time > 10s → log warning + tag for analysis

4. เก็บ trace data ใน SQLite table:
   traces(request_id, step, timestamp_ms, metadata)
```

#### W11: Dashboard ขาด Feature สำคัญ
**ปัญหา:** Dashboard (Oracle React) มีอยู่แล้วแต่แผนไม่ได้กำหนด features ที่ต้องเพิ่ม

**แก้ไข:**
```
Dashboard Features ที่ควรมี:
1. Knowledge Browser: ดู/แก้/ลบ knowledge entries
2. Conversation History: ดู conversation summaries
3. Learning Feed: ดู auto-learnings ล่าสุด (approve/reject)
4. System Status: health checks + metrics แบบ real-time
5. Cost Tracker: API usage per day/week/month
6. User Model View: ดู/แก้ user preferences ที่ระบบเรียนรู้
7. Knowledge Graph Viz: แสดง concept relationships
8. Search Playground: ทดสอบ search queries + ดู results
```

#### W12: ไม่มี Fallback LLM Provider
**ปัญหา:** ใช้ Anthropic Claude อย่างเดียว → ถ้า API down = ระบบใช้ไม่ได้เลย

**แก้ไข:**
```
LLM Failover Chain:
1. Claude Sonnet 4 (primary)
2. Claude Haiku (fallback for simple queries)
3. Local LLM via Ollama (emergency fallback)
   → ติดตั้ง Ollama + llama3.2 บน VPS
   → ตอบได้แม้ Anthropic API down
   → Quality ต่ำกว่า แต่ available 100%

Config:
LLM_PRIMARY=claude-sonnet-4-20250514
LLM_FALLBACK=claude-haiku
LLM_EMERGENCY=ollama:llama3.2
```

#### W13: ไม่มี Human-in-the-Loop สำหรับ Auto-Learning
**ปัญหา:** Auto-Learning (4.3) เรียนรู้อัตโนมัติ 100% → อาจเรียนผิด

**แก้ไข:**
```
Learning Confidence Tiers:
- High (>0.8): store ทันที (facts, explicit preferences)
- Medium (0.5-0.8): store + flag for review
- Low (<0.5): don't store, log only

Review Queue:
- Dashboard แสดง pending learnings ที่ต้อง review
- Admin approve/reject ผ่าน Dashboard หรือ Telegram
- Telegram: ส่ง learning summary ทุก 24h → admin confirm
```

---

### 🟡 Medium (6 จุด)

#### W14: ไม่มี Knowledge Graph
**ปัญหา:** ใช้ FTS5 + Vector Search = flat search → ไม่เข้าใจ relationships ระหว่าง concepts

**แก้ไข:**
```
เพิ่ม Knowledge Graph Layer (Phase 4+):
- Oracle มี concepts[] อยู่แล้ว → สร้าง graph จาก concepts
- Node: concept (e.g., "Docker", "TypeScript", "deployment")
- Edge: co-occurrence ใน document เดียวกัน
- ใช้ประโยชน์:
  1. ถาม "Docker" → suggest "deployment", "container", "compose"
  2. ถาม "related topics to X" → traverse graph
  3. Prompt Builder → inject related concepts ด้วย

Implementation:
- SQLite table: concept_graph(from_concept, to_concept, weight)
- Update เมื่อ learn/index
- Query: 1-2 hop neighbors
```

#### W15: Telegram UI ไม่ใช้ศักยภาพเต็ม
**ปัญหา:** Telegram รองรับ inline buttons, callback queries, markdown formatting แต่แผนใช้แค่ text messages

**แก้ไข:**
```
Rich Telegram UI:
1. Inline Keyboards:
   - หลังตอบ → ปุ่ม [👍 Helpful] [👎 Not helpful] [📝 Learn this]
   - Feedback → feed เข้า auto-learning quality

2. Quick Actions:
   - /search <query> → ผลลัพธ์พร้อมปุ่ม [More] [Related]
   - /learn → wizard: Title → Content → Concepts

3. Status Messages:
   - ⏳ Searching knowledge base...
   - 🤔 Thinking...
   - ✅ Done (2.3s)

4. Formatted Responses:
   - Code blocks with syntax highlighting
   - Collapsible sections via spoiler
   - Links + previews
```

#### W16: ไม่มี Conversation Context Window Management
**ปัญหา:** Container session อาจมี context window เต็ม → compact → สูญเสีย context สำคัญ

**แก้ไข:**
```
Context Window Strategy:
1. ก่อน compact → extract key info →  store ใน Oracle
2. หลัง compact → inject summary กลับเข้า context
3. Priority system:
   - High: user instructions, current task
   - Medium: conversation history, preferences
   - Low: generic knowledge
4. Monitor token usage: 
   เตือนเมื่อใกล้ limit → auto-compact + save state
```

#### W17: ไม่มี Multi-User Isolation
**ปัญหา:** ถ้ามีหลาย user ใน group → learnings/preferences ปนกัน

**แก้ไข:**
```
User-Scoped Data:
- Oracle learn: เพิ่ม user_id ใน metadata
- Search: filter by user_id สำหรับ preferences
- Shared knowledge: flag is_shared = true
- Per-user rate limits (มีแล้วใน 2.6)
```

#### W18: Test Coverage ไม่ครอบคลุม Unit Tests
**ปัญหา:** E2E test ดี แต่ไม่มี unit test plan สำหรับ modules แต่ละตัว

**แก้ไข:**
```
เพิ่ม Unit Test Plan:
- MCP-HTTP Bridge: mock HTTP → verify MCP translation
- Prompt Builder: mock Oracle → verify context format
- Auto-Learner: mock conversation → verify extraction
- Rate Limiter: verify sliding window correctness  
- Health Monitor: mock service states → verify alerts
- Queue Persistence: verify state save/restore

Target: >80% coverage สำหรับ core modules
Framework: Vitest (NanoClaw), bun:test (Oracle)
```

#### W19: ไม่มี Graceful Shutdown Coordination
**ปัญหา:** PM2 restart → active containers อาจค้าง, queue items อาจหาย

**แก้ไข:**
```
Shutdown Sequence:
1. Stop accepting new messages (drain mode)
2. Wait for active containers to finish (max 60s)
3. Save queue state to SQLite
4. Send "going offline" notification via Telegram
5. Shutdown services: NanoClaw → Oracle → ChromaDB
6. On restart → restore queue state → resume
```

---

### 🟢 Low (2 จุด)

#### W20: ไม่มี Changelog / Version Tracking ของ Knowledge
**ปัญหา:** Knowledge ถูก supersede แต่ไม่เก็บ history ว่าเปลี่ยนอะไร

**แก้ไข:**
```
Knowledge Audit Log:
- knowledge_history(doc_id, action, old_content, new_content, timestamp)
- ทุก learn/supersede/delete → log entry
- Dashboard: ดู history ของแต่ละ document
```

#### W21: ไม่มี Notification Preferences
**ปัญหา:** System alerts ส่งทุกอย่างไป Telegram → อาจ spam

**แก้ไข:**
```
Alert Levels:
- 🔴 Critical: WhatsApp down, Oracle down → always notify
- 🟡 Warning: disk 85%, high latency → notify 1x/hour
- 🟢 Info: backup complete, learning stored → silent (log only)
- User configurable via Telegram: /alerts set warning
```

---

## 3. แผนปรับปรุง

### 3A. ฉลาดขึ้น (Intelligence Upgrades)

#### เพิ่ม Item: Smart Query Router
```
Phase: 1 (Performance) — เพิ่มเป็น Item 1.8

วัตถุประสงค์: จัดประเภท message ก่อน process

Classification:
├── GREETING → ตอบ inline (ไม่ spawn container)
├── SIMPLE_QUERY → Oracle search → ตอบ inline  
├── KNOWLEDGE_QUERY → Oracle consult → inject context → container
├── COMPLEX_TASK → full container + Oracle context
├── ADMIN_COMMAND → execute directly (no container)
└── MEDIA → handle based on type

Implement:
- Rule-based classifier (regex + keyword matching)
- ไม่ต้องใช้ LLM สำหรับ classification 
  (save tokens)
- Configurable thresholds
```

#### เพิ่ม Item: Enhanced RAG Pipeline
```
Phase: 4 — ปรับ Item 4.1

เพิ่มใน Prompt Builder:

1. Query Expansion:
   user: "Docker คืออะไร"
   → expanded: ["Docker", "container", "containerization", 
                 "Docker คืออะไร", "what is Docker"]

2. Hybrid Search + Re-rank:
   FTS5 top-10 + ChromaDB top-10 → merge → 
   cross-encoder re-rank → top-5

3. Context Compression:
   ก่อน inject → summarize long documents
   ให้พอดี context budget (4000 tokens)

4. Source Citation:
   Response → "[จาก: Oracle doc #123]"
```

#### เพิ่ม Item: Self-Reflection Loop
```
Phase: 4 — เพิ่มเป็น Item 4.6

หลัง agent ตอบ → evaluate ตัวเอง:
1. "คำตอบนี้ครบถ้วนหรือไม่?"
2. "มีข้อมูลที่ขัดแย้งกันหรือไม่?"
3. "User น่าจะต้องการข้อมูลเพิ่มหรือไม่?"

ถ้า confidence ต่ำ → 
  "ผมไม่แน่ใจ 100% — ต้องการให้หาข้อมูลเพิ่มไหม?"
```

---

### 3B. จำได้ดีขึ้น (Memory Upgrades)

#### เพิ่ม Item: Structured Memory System
```
Phase: 4 — ปรับ Item 4.4

Memory Types:
1. Working Memory (ระยะสั้น)
   - Current conversation context
   - Active task state
   - TTL: ตลอด session

2. Episodic Memory (เหตุการณ์)
   - Conversation summaries ← มีแล้ว
   - เพิ่ม: emotional context, satisfaction level
   - TTL: 90 วัน → archive

3. Semantic Memory (ความรู้)
   - Oracle knowledge base ← มีแล้ว
   - เพิ่ม: temporal decay, access frequency tracking
   - TTL: ไม่หมดอายุ แต่ decay

4. Procedural Memory (วิธีการ) ★ NEW
   - "เวลา user ถาม X → ทำ Y"  
   - "User ชอบ format แบบ bullet points"
   - เรียนรู้จาก corrections + repeated patterns
   - TTL: ไม่หมดอายุ

5. User Model ★ NEW
   - Expertise level per topic
   - Communication preferences
   - Timezone, active hours
   - Common tasks/projects
```

#### เพิ่ม Item: Memory Consolidation Service
```
Phase: 4 — เพิ่มเป็น Item 4.7

Background job ทุก 24 ชั่วโมง:
1. รวม similar learnings เข้าด้วยกัน
2. ลบ duplicates (similarity > 0.9)
3. Update decay scores
4. Detect contradictions → flag for review
5. Extract patterns จาก episodic memories
   → สร้าง procedural memories
6. Update user model จาก recent interactions
```

---

### 3C. เร็วขึ้น (Performance Upgrades)

#### เพิ่ม Item: Container Warm Pool
```
Phase: 1 — เพิ่มเป็น Item 1.8 (หรือปรับ 1.5)

Container Pool Manager:
- Maintain pool ขนาด 1-3 warm containers
- เมื่อ container ถูกใช้ → spawn ตัวใหม่เข้า pool
- Warm container มี MCP bridge พร้อมแล้ว
- Latency: 3s → <300ms

Pool Config:
POOL_MIN_SIZE=1
POOL_MAX_SIZE=3  
POOL_IDLE_TIMEOUT=300000  # 5 min
```

#### เพิ่ม Item: Response Streaming
```
Phase: 4 — เพิ่มเป็น Item 4.8

Streaming Protocol:
1. Container เขียน partial output → IPC stream file
2. NanoClaw watch → detect new chunks
3. Telegram: editMessageText() ทุก 1 วินาที
4. WhatsApp: typing indicator + send เมื่อจบ

UX Flow:
[Typing...] → [Searching Oracle...] → [Thinking...] 
→ [Partial response...] → [Complete response ✅]
```

#### เพิ่ม Optimization: Oracle Connection Pool
```
Phase: 1 — เพิ่มใน Item 1.2

HTTP Client Pool:
- Keep-alive connections to Oracle
- Max 10 concurrent connections
- Connection reuse → ลด TCP handshake overhead
- Health check ก่อน reuse
```

---

### 3D. Interface ที่เข้าใจง่ายขึ้น (UX Upgrades)

#### เพิ่ม Item: Smart Response Formatting
```
Phase: 4 — เพิ่มเป็น Item 4.9

Auto-Detect Response Format:
- Code → code block with language tag
- List → bullet points
- Step-by-step → numbered list
- Comparison → table
- Short answer → plain text

Channel-Specific:
- Telegram: full Markdown + inline buttons
- WhatsApp: simplified Markdown (bold, italic, monospace)

Feedback Buttons (Telegram):
[👍] [👎] [📝 จำไว้] [🔄 ลองใหม่]
```

#### เพิ่ม Item: Status Indicators
```
Phase: 4 — เพิ่มเป็น Item 4.10

Message Status Flow:
📥 Received → 🔍 Searching... → 🤔 Thinking... → ✅ Done

Implementation:
- WhatsApp: typing indicator (PresenceUpdate)
- Telegram: sendChatAction('typing')
- ถ้า process > 5s → ส่ง status message:
  "🔍 กำลังค้นหาข้อมูล..." (แล้ว edit เป็น response)
```

#### เพิ่ม Item: Interactive Dashboard
```
Phase: 5 — ปรับ Item 5.1

Dashboard Sections:
1. 🏠 Home: system status, recent activity, quick stats
2. 📚 Knowledge: browse, search, add, edit, delete entries
3. 🧠 Memory: view learned preferences, approve/reject
4. 💬 Conversations: history, summaries, search
5. 📊 Analytics: message volume, response times, costs
6. ⚙️ Settings: alert preferences, model config, limits
7. 🔍 Playground: test search queries, preview prompts
```

---

## 4. Claude Code Skills สำหรับการพัฒนา

> **หมายเหตุ:** Skills ที่แนะนำคือ Claude Code development skills จาก [skillsmp.com](https://skillsmp.com/) ที่จะช่วย Claude Code เขียนโค้ดโปรเจคนี้ได้ดีขึ้น

ดูรายละเอียดทั้งหมดใน **[CLAUDE_CODE_SKILLS.md](CLAUDE_CODE_SKILLS.md)**

### สรุปย่อ — Top 5 Skills ที่ควรติดตั้งก่อน

| # | Skill | ที่มา | ใช้ทำอะไร |
|---|-------|-------|----------|
| 1 | **coding-standards** | affaan-m/everything-claude-code | TypeScript/Node.js/React best practices — ทุก Phase |
| 2 | **docker-patterns** | affaan-m/everything-claude-code | Docker Compose patterns, container security — Phase 0, 1, 5 |
| 3 | **mcp-builder** | ComposioHQ/awesome-claude-skills | สร้าง MCP server — Oracle V2 เป็น MCP server |
| 4 | **bun-development** | davila7/claude-code-templates | Bun runtime — Oracle V2 ใช้ Bun |
| 5 | **telegram-bot-builder** | davila7/claude-code-templates | Telegram Bot API expert — Phase 4 |

### วิธีติดตั้ง

```bash
mkdir -p .claude/skills
# Download จาก skillsmp.com → export → save ใน .claude/skills/
```

### Agent Router (ใน Application)

แนะนำให้สร้าง **Smart Query Router** (Item 1.8) เพื่อจัด tier ของ query:

| Tier | ตัวอย่าง | Container? | Model |
|------|---------|------------|-------|
| `inline` | "สวัสดี", "ขอบคุณ" | ไม่ | Template |
| `oracle-only` | "Docker port เท่าไหร่?" | ไม่ | Haiku |
| `container-light` | "เขียน function sort" | ใช่ (light) | Sonnet |
| `container-full` | "debug project ทั้งหมด" | ใช่ (full) | Sonnet |

> การ route query ที่ถูกต้อง = ลด cost 60%+ และเพิ่ม speed 3-5x

---

## 5. สรุป Action Items

### แผนปรับปรุงที่แนะนำ เรียงตาม Priority

#### 🔴 ต้องเพิ่มก่อนเริ่ม Phase (Critical)

| # | Action | เพิ่มใน Phase | Effort |
|---|--------|--------------|--------|
| A1 | Embedding Model Strategy + Thai testing | Phase 0 | Small |
| A2 | Smart Query Router (ไม่ spawn container ทุก msg) | Phase 1 | Medium |
| A3 | LLM Model Routing + Cost Tracking | Phase 1 | Medium |
| A4 | Container Warm Pool หรือ Session Persistence | Phase 1 | Large |
| A5 | Data Retention Policy + delete API | Phase 2 | Small |

#### 🟠 เพิ่มระหว่างทำ (High)

| # | Action | เพิ่มใน Phase | Effort |
|---|--------|--------------|--------|
| A6 | Enhanced RAG Pipeline (chunking + re-rank) | Phase 4 | Medium |
| A7 | 4-Layer Memory System | Phase 4 | Large |
| A8 | Knowledge Decay + Contradiction Detection | Phase 4 | Medium |
| A9 | Agent Router + Specialized Agents | Phase 4 | Large |
| A10 | Response Streaming | Phase 4 | Medium |
| A11 | Human-in-the-Loop Learning Review | Phase 4 | Small |
| A12 | Fallback LLM (Ollama) | Phase 5 | Medium |

#### 🟡 Nice-to-have (Medium)

| # | Action | เพิ่มใน Phase | Effort |
|---|--------|--------------|--------|
| A13 | Rich Telegram UI (buttons, feedback) | Phase 4 | Small |
| A14 | Dashboard Feature Enhancement | Phase 5 | Large |
| A15 | Request Tracing (trace_id across services) | Phase 5 | Medium |
| A16 | Knowledge Graph (concept relationships) | Phase 5+ | Large |
| A17 | Memory Consolidation Background Job | Phase 5 | Medium |
| A18 | Unit Test Coverage Plan | Phase 2 | Medium |

---

### ปรับ Timeline ใหม่ที่แนะนำ

```
สัปดาห์ 1:   Phase 0 (Security) + A1 (Embedding Strategy)
สัปดาห์ 2:   Phase 1 (Performance) + A2 (Query Router) + A3 (LLM Routing)
สัปดาห์ 3:   Phase 1 ต่อ + A4 (Container Pool)
สัปดาห์ 4:   Phase 2 (Architecture) + A5 (Data Policy) + A18 (Unit Tests)
สัปดาห์ 5:   Phase 3 (Reliability)
สัปดาห์ 6-7: Phase 4 (Integration) + A6-A11 (Intelligence Upgrades)
สัปดาห์ 8:   Phase 4 ต่อ + A9 (Agent System)
สัปดาห์ 9-10: Phase 5 (Production) + A12-A17 (Polish)
```

> **เวลาเพิ่ม: ~2 สัปดาห์** (8 → 10 สัปดาห์) เพื่อได้ระบบที่ฉลาดขึ้น เร็วขึ้น และ UX ดีขึ้นอย่างมีนัยสำคัญ

---

### Skill MCP Tools ที่ต้องเพิ่มใน Oracle

```
# Existing (19 tools) — ไม่ต้องแก้

# New Tools ที่แนะนำ:

oracle_user_model_get     → ดึง user model (preferences, expertise)
oracle_user_model_update  → อัปเดต user model
oracle_memory_search      → search specific memory type
oracle_memory_consolidate → trigger manual consolidation
oracle_knowledge_graph    → query concept relationships
oracle_knowledge_decay    → get/update decay scores
oracle_contradiction_check → check if new info contradicts existing
oracle_cost_stats         → API usage statistics
```

---

> **สรุป:** แผนเดิมเป็นรากฐานที่ดีมาก (29 จุดอ่อนครอบคลุมด้าน security, performance, architecture) แต่ยังขาด **Intelligence Layer** (RAG pipeline, memory system, agent routing), **Cost Management**, และ **UX Streaming** ซึ่งเป็นสิ่งที่จะทำให้ JellyCore เป็น personal AI assistant ที่ **ฉลาดจริง** ไม่ใช่แค่ chatbot ที่ search database ได้

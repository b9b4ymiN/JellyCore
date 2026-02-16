# 🧠 JellyCore — Beyond OpenClaw: แผนยกระดับ AI Intelligence

> จุดมุ่งหมาย: ทำให้ JellyCore ฉลาดกว่า OpenClaw ในด้านที่สำคัญที่สุด — ความจำ, บริบท, และการเรียนรู้
>
> **Version:** 1.0  
> **Created:** 2026-02-15  
> **Status:** Planning  
> **Baseline:** OpenClaw v2026.2.14 (195k stars, 606 contributors)  
> **Architecture:** JellyCore = NanoClaw (Body) + Oracle V2 (Brain)

---

## 🎯 ปรัชญาในการ "เอาชนะ" OpenClaw

OpenClaw เกิดมาเป็น **"wide platform"** — รองรับ 15+ channels, macOS/iOS/Android apps, browser control,
Canvas UI, Voice Wake — แต่ core AI intelligence ของมันยังพื้นฐาน:
Markdown memory files + vector search + compaction cycle

JellyCore จะไม่แข่งเรื่องจำนวน channel หรือ platform
**เราจะแข่งที่ "ความฉลาด" ของ AI โดยตรง** — ทำให้ AI:

1. **จำได้ลึกกว่า** — 5-layer memory vs OpenClaw's 2-layer (daily + curated)
2. **ค้นหาแม่นกว่า** — adaptive hybrid search + re-ranking vs OpenClaw's BM25+vector
3. **จัดการบริบทดีกว่า** — proactive context management vs OpenClaw's reactive compaction
4. **เรียนรู้เองดีกว่า** — continuous learning loop vs OpenClaw's passive memory write
5. **ฟื้นตัวเร็วกว่า** — multi-provider failover ที่ไร้รอยต่อ
6. **ตอบเร็วกว่า** — intelligent streaming + container warm pool + query routing

สิ่งที่ OpenClaw ดีกว่าเราอยู่แล้ว (และเราจะ adopt):
- Block streaming + human-like pacing
- Model failover chain + auth profile rotation
- Session pruning + auto-compaction + memory flush
- Plugin hook system
- Observability (usage tracking, presence, health)

สิ่งที่เรามีแต่ OpenClaw ไม่มี (และจะต่อยอด):
- **Oracle V2** — dedicated knowledge engine with 19 MCP tools (OpenClaw ใช้ file-based memory)
- **Container isolation** per query (OpenClaw runs on host)
- **Hybrid search** แยก engine (FTS5 + ChromaDB) ไม่ใช่ built-in SQLite เดียว
- **Multi-agent swarms** (OpenClaw มี sessions_send แต่ไม่ใช่ true swarm)
- **IPC security** (HMAC signing, mount allowlist)

---

## 📊 Gap Analysis Matrix

| ด้าน | JellyCore Now | OpenClaw Now | เป้าหมาย JellyCore | ผลลัพธ์ |
|------|:---:|:---:|:---:|:---:|
| **Memory Depth** | 2 layers | 2 layers | **5 layers** | เหนือกว่า |
| **Search Quality** | 50/50 static | 70/30 configurable + BM25 fallback | **Adaptive weights + re-ranking + query expansion** | เหนือกว่า |
| **Context Management** | ไม่มี | Compaction + pruning + memory flush | **Proactive context + anticipatory prefetch** | เหนือกว่า |
| **Learning Loop** | Manual oracle_learn | Passive write to memory/ | **Active extraction + contradiction check + consolidation** | เหนือกว่า |
| **Model Resilience** | Single provider | Multi-provider + rotation + cooldown | **เทียบเท่า + local fallback** | เทียบเท่า |
| **Streaming** | Sentinel markers (batch) | Block streaming + draft (Telegram) | **เทียบเท่า + smart chunking** | เทียบเท่า |
| **Skills/Extensibility** | Claude Code skills | AgentSkills + ClawHub + plugins | **Standardized format + skill gating** | เทียบเท่า |
| **Observability** | Minimal | Full (usage, presence, health) | **เทียบเท่า + knowledge quality metrics** | เทียบเท่า |
| **Channels** | 2 (WhatsApp + Telegram) | 15+ | **ไม่แข่ง — focus AI** | ไม่เปรียบเทียบ |
| **Platform Apps** | ไม่มี | macOS + iOS + Android | **ไม่แข่ง — focus AI** | ไม่เปรียบเทียบ |

---

## 🏗️ 7 Pillars of Intelligence Upgrade

### Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                JELLYCORE INTELLIGENCE STACK                      │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Pillar 7: Observability & Self-Diagnosis                │   │
│  │  request tracing · usage tracking · health · knowledge QA│   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Pillar 6: Skills & Extensibility                        │   │
│  │  standardized format · gating · hot-reload · hooks       │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Pillar 5: Agent Loop Sophistication                     │   │
│  │  reply shaping · NO_REPLY · tool sanitization · A2A      │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Pillar 4: Streaming & Response UX                       │   │
│  │  block streaming · chunking · pacing · draft streaming   │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Pillar 3: Model Resilience & Cost Intelligence          │   │
│  │  multi-provider · rotation · cooldown · budget · local   │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Pillar 2: Context Mastery                               │   │
│  │  auto-compaction · pruning · memory flush · prefetch     │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Pillar 1: Deep Memory System ★ CORE DIFFERENTIATOR      │   │
│  │  5-layer memory · adaptive search · learning loop        │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Pillar 1: Deep Memory System ★ CORE DIFFERENTIATOR

> ถ้าต้องเลือกทำอย่างเดียว ให้ทำ Pillar นี้ — นี่คือสิ่งที่จะทำให้ JellyCore ฉลาดกว่า OpenClaw อย่างแท้จริง

### 1.1 Five-Layer Memory Architecture

OpenClaw มี 2 ชั้น: `memory/YYYY-MM-DD.md` (daily) + `MEMORY.md` (curated)  
JellyCore จะมี **5 ชั้น**:

```
┌─────────────────────────────────────────────────────────┐
│ Layer 5: Working Memory (ระยะสั้น ~session)             │
│ • conversation context ปัจจุบัน                         │
│ • active task state                                     │
│ • TTL: session lifetime                                 │
│ • Storage: in-memory (container process)                │
├─────────────────────────────────────────────────────────┤
│ Layer 4: Episodic Memory (เหตุการณ์ ~สัปดาห์/เดือน)     │
│ • conversation summaries ← มีแล้ว                       │
│ • เพิ่ม: satisfaction level, emotional markers          │
│ • เพิ่ม: interaction patterns per user                  │
│ • TTL: 90 วัน → archive, access ต่ออายุ                │
│ • Storage: Oracle threads + daily summary files         │
├─────────────────────────────────────────────────────────┤
│ Layer 3: Semantic Memory (ความรู้ ~ถาวร)                │
│ • Oracle knowledge base ← มีแล้ว (5,500+ docs)         │
│ • เพิ่ม: temporal decay scoring                         │
│ • เพิ่ม: access frequency tracking                     │
│ • เพิ่ม: source confidence rating                      │
│ • TTL: ไม่หมดอายุ แต่ decay ตาม recency/access         │
│ • Storage: Oracle SQLite + ChromaDB                     │
├─────────────────────────────────────────────────────────┤
│ Layer 2: Procedural Memory (วิธีทำ ~ถาวร) ★ NEW        │
│ • "เมื่อ user ถาม deploy → แสดง checklist ก่อน"        │
│ • "user นี้ชอบ bullet points ไม่ชอบ paragraphs"        │
│ • "เวลา debug → ดู log ก่อน → ตรวจ config → test"     │
│ • เรียนรู้จาก corrections + repeated behavioral pattern│
│ • Storage: Oracle ใน concept `memory:procedural`       │
├─────────────────────────────────────────────────────────┤
│ Layer 1: User Model (โมเดลผู้ใช้ ~ถาวร) ★ NEW         │
│ • expertise level per topic (novice→expert)             │
│ • communication preferences (สั้น/ยาว, ไทย/อังกฤษ)     │
│ • timezone, active hours, response speed preference     │
│ • common projects & domains                             │
│ • personality compatibility notes                       │
│ • Storage: Oracle ใน concept `memory:user_model`       │
└─────────────────────────────────────────────────────────┘
```

**ทำไมสำคัญกว่า OpenClaw:**
OpenClaw เก็บทุกอย่างเป็น flat Markdown โดยไม่แยกประเภท —
AI ต้อง "เดา" ว่าข้อมูลไหนเป็นเรื่องอะไร JellyCore จะแยก memory
เป็นชั้นๆ ที่มีความหมายทางปัญญา (cognitive memory model) ทำให้
Prompt Builder ดึงข้อมูลจากชั้นที่ถูกต้องตามบริบทของคำถาม

**Oracle MCP Tools เพิ่ม:**

| Tool | หน้าที่ |
|------|---------|
| `oracle_user_model_get` | ดึง user model (preferences, expertise) |
| `oracle_user_model_update` | อัปเดต user model |
| `oracle_procedural_get` | ดึง procedural memory สำหรับ task type |
| `oracle_procedural_learn` | บันทึก procedural pattern ใหม่ |
| `oracle_episodic_summarize` | สรุป session เป็น episodic memory |

### 1.2 Adaptive Hybrid Search

OpenClaw ให้ fixed weight 70:30 (vector:text) — JellyCore จะ **ปรับน้ำหนักตามลักษณะ query**:

```
Query Analysis → Dynamic Weight Selection:

├── Exact Match Query (code symbol, error ID, config key)
│   "ECONNREFUSED", "handleWebhook", "PORT=47778"
│   → text_weight: 0.8, vector_weight: 0.2
│
├── Semantic Query (concept, paraphrase, how-to)  
│   "วิธี deploy Docker", "ทำไม container ช้า"
│   → text_weight: 0.3, vector_weight: 0.7
│
├── Mixed Query (มีทั้ง keyword แม่นๆ + ความหมายกว้าง)
│   "Docker ECONNREFUSED เกิดจากอะไร"
│   → text_weight: 0.5, vector_weight: 0.5
│
└── Default (ไม่จำแนกได้)
    → text_weight: 0.4, vector_weight: 0.6
```

**Query Type Detection (ไม่ใช้ LLM):**
- มี quotes / backticks / camelCase / ALL_CAPS → exact match
- มีคำถาม (อะไร/ทำไม/อย่างไร) / ประโยคยาว → semantic
- mix → balanced

**เพิ่มจาก OpenClaw:**
- **Candidate Multiplier**: ดึง top-N × 4 จากทั้ง FTS5 + ChromaDB ก่อน merge
  (OpenClaw ใช้ `candidateMultiplier: 4` เหมือนกัน — เราจะทำเท่ากัน)
- **Re-ranking Layer**: เพิ่ม cross-encoder scoring หลัง merge
  สำหรับ top-20 candidates → เลือก top-5 ที่ relevant ที่สุด
  (OpenClaw ยังไม่มี built-in re-ranking ต้องใช้ QMD backend)
- **Query Expansion**: ขยาย query อัตโนมัติด้วย synonyms/translations
  "Docker คืออะไร" → ["Docker", "container", "containerization", "Docker คืออะไร"]
  (OpenClaw ไม่ทำ query expansion — ส่ง raw query เข้า search)

### 1.3 Continuous Learning Loop

OpenClaw: AI เขียน memory ลง Markdown → passive, ไม่มี validation  
JellyCore: **Active learning with quality gates**

```
Learning Pipeline:

   User Conversation
         │
         ▼
   ┌─────────────┐
   │  Extractor   │ ← หลัง agent ตอบ, วิเคราะห์:
   │              │   - ข้อมูลใหม่ที่ user แชร์?
   │              │   - user แก้คำตอบ AI? (correction)
   │              │   - pattern ซ้ำจากครั้งก่อน?
   └──────┬──────┘
          │
          ▼
   ┌─────────────┐
   │  Validator   │ ← ตรวจก่อน store:
   │              │   - มี knowledge เดิมที่ขัดแย้งไหม?
   │              │   - confidence score เท่าไร?
   │              │   - เป็น fact vs opinion vs preference?
   └──────┬──────┘
          │
     ┌────┴────┐
     │         │
  High (>0.8) Medium (0.4-0.8)        Low (<0.4)
     │         │                        │
     ▼         ▼                        ▼
  Auto-store  Flag for review          Log only
              (Telegram/Dashboard)     (don't store)
              ↓
         Admin approve/reject
```

**Contradiction Detection:**
เมื่อ `oracle_learn` ถูกเรียก:
1. Search existing knowledge ด้วย query = new content
2. ถ้า top result มี similarity > 0.85 แต่ content ต่างกัน → flag contradiction
3. ถ้า `supersede` mode → อัตโนมัติ แต่ log ไว้ใน knowledge_history
4. ถ้า `confirm` mode → ถามผู้ใช้ "ข้อมูลเดิมบอกว่า X ข้อมูลใหม่บอกว่า Y ใช้อันไหน?"

**Memory Consolidation (Background Job):**
ทุก 24 ชั่วโมง:
1. merge similar learnings (similarity > 0.9) → deduplicated entry
2. extract patterns จาก episodic memories → สร้าง procedural memories
3. update decay scores ตาม access frequency
4. update user model จาก recent interaction patterns
5. generate knowledge quality report (Dashboard)

### 1.4 Embedding Strategy

**ปัญหาปัจจุบัน:** all-MiniLM-L6-v2 (384-dim) ไม่ได้ optimize สำหรับภาษาไทย

**แผน:**

| ระยะ | Model | Dimension | Thai Quality | Cost |
|------|-------|-----------|:---:|:---:|
| **ปัจจุบัน** | all-MiniLM-L6-v2 | 384 | ★★☆☆☆ | Free (local) |
| **Phase 1** | `intfloat/multilingual-e5-large` | 1024 | ★★★★☆ | Free (local) |
| **Phase 2** | OpenAI `text-embedding-3-small` | 1536 | ★★★★★ | $0.02/1M tokens |
| **Fallback** | ปัจจุบัน (MiniLM) | 384 | ★★☆☆☆ | Free |

**Embedding Versioning System:**
- เก็บ `embedding_model` + `embedding_version` ใน Oracle documents metadata
- เมื่อเปลี่ยน model → auto-reindex ทั้งหมด (background job)
- เก็บ embedding cache ใน SQLite เพื่อไม่ต้อง re-embed unchanged content
- เหมือน OpenClaw: ตรวจ provider/model fingerprint → ถ้าไม่ตรงให้ reset + reindex

**Chunking Upgrade:**
- ปัจจุบัน: แบ่งตาม `###` headers + bullets (naive)
- เป้าหมาย: overlap chunking (~400 tokens, 80 token overlap)
  + sentence-boundary awareness + code block preservation
- เหมือน OpenClaw แต่เพิ่ม: Thai sentence segmentation (ภาษาไทยไม่มี space ระหว่างคำ)

---

## Pillar 2: Context Mastery

> OpenClaw จัดการ context แบบ "reactive" — compact เมื่อเต็ม  
> JellyCore จะ "proactive" — คาดการณ์และจัดการล่วงหน้า

### 2.1 Auto-Compaction System

**Adopt จาก OpenClaw (แต่ปรับให้เข้ากับ container architecture):**

```
Context Window Monitor:

  ทุก message ก่อนส่งเข้า container:
  1. คำนวณ estimated tokens (chars ÷ 4)
  2. ถ้า tokens > (context_window × 0.7) → trigger memory flush
  3. ถ้า tokens > (context_window × 0.85) → trigger compaction
  4. compact → สรุปประวัติเก่า → store ใน Oracle → ส่ง summary กลับเข้า context

  Memory Flush (ก่อน compact):
  - สั่ง Agent ผ่าน special system prompt:
    "Session ใกล้ compact — เขียนข้อมูลสำคัญลง Oracle ก่อน"
  - Agent เรียก oracle_learn / oracle_user_model_update
  - ถ้าไม่มีอะไรจะเขียน → NO_REPLY → ไม่ส่งอะไรให้ user
  - หลัง flush เสร็จ → compact → retry request เดิมอัตโนมัติ
```

**ต่างจาก OpenClaw อย่างไร:**
- OpenClaw compact ครั้งเดียว → ข้อมูลหายไป  
  JellyCore compact → store structured data ลง Oracle 5 layers ก่อน
  แล้ว resume ด้วย compact context + Oracle injection ที่ครบถ้วน
- OpenClaw เก็บ summary ใน JSONL session history  
  JellyCore เก็บ summary ใน Oracle threads → searchable + linkable

### 2.2 Session Pruning

**Adopt จาก OpenClaw:**

```
Pruning Strategy (per LLM request):

  1. ตรวจ tool results ใน context
  2. Tool results > 50,000 chars → soft-trim:
     - เก็บ head 1,500 chars + tail 1,500 chars
     - แทรก "... (truncated from 120,000 chars)"
  3. Tool results ที่เก่ามาก (> 3 assistant turns ago) → hard-clear:
     - แทนด้วย "[Old tool result cleared]"
  4. ห้ามตัด: image blocks, user messages, assistant messages

  Config:
  - keepLastAssistants: 3
  - softTrimRatio: 0.3  
  - hardClearRatio: 0.5
  - minPrunableToolChars: 50000
```

### 2.3 Anticipatory Context Prefetch ★ BEYOND OPENCLAW

สิ่งที่ OpenClaw ไม่มี — **prefetch context ก่อนที่ user จะถาม**:

```
Prefetch Engine:

  เมื่อ user ส่ง message:
  1. PromptBuilder ดึง Oracle context (ปกติ)
  2. พร้อมกัน: Prefetch Engine วิเคราะห์ "user น่าจะถามอะไรต่อ"
     - ถ้ากำลังคุยเรื่อง Docker → prefetch Docker-related knowledge
     - ถ้าเพิ่ง deploy → prefetch monitoring/debugging patterns
     - ถ้าเป็นเวลาเช้าวันจันทร์ → prefetch weekly summary + pending tasks
  3. Prefetched context เก็บใน warm cache
  4. เมื่อ user ถามจริง → cache hit → response เร็วขึ้น

  Implementation:
  - PromptBuilder เพิ่ม prefetchRelated(currentQuery, topicHistory)
  - ใช้ Oracle concepts graph: current topic → related concepts → prefetch
  - LRU cache ขยายจาก 50 → 200 entries
  - Async prefetch ไม่ block response ปัจจุบัน
```

---

## Pillar 3: Model Resilience & Cost Intelligence

### 3.1 Multi-Provider Failover Chain

**Adopt จาก OpenClaw (ปรับสำหรับ container-based architecture):**

```
Failover Chain:

  Primary:   anthropic/claude-sonnet-4
  Fallback:  anthropic/claude-haiku
  Emergency: ollama/llama3.3 (local, ติดตั้งบน VPS)

  เมื่อ provider fail:
  ┌──────────────────────────────────────────────┐
  │  Error Type      │  Action                   │
  ├──────────────────┼───────────────────────────┤
  │  Rate limit      │  cooldown + rotate key    │
  │  Auth error      │  cooldown + try next key  │
  │  Billing error   │  disable 5hr + next model │
  │  Timeout (30s)   │  retry once + next model  │
  │  Server error 5xx│  retry 3x + next model    │
  └──────────────────────────────────────────────┘

  Cooldown (exponential backoff):
  1 min → 5 min → 25 min → 1 hr (cap)
  Reset after 24hr without failure
```

**Container Architecture Adaptation:**
- NanoClaw เก็บ provider state (cooldowns) ใน memory
- เมื่อ spawn container → pass `LLM_PROVIDER` + `LLM_MODEL` เป็น env var
- Container ใช้ model ที่ถูก route มาให้ — ไม่ต้อง decide เอง
- ถ้า container fail เพราะ provider → NanoClaw retry ด้วย next model

### 3.2 Auth Profile Rotation

```
Multiple API Keys per Provider:

  profiles.json:
  {
    "anthropic": [
      { "id": "main", "type": "api_key", "key": "sk-ant-..." },
      { "id": "backup", "type": "api_key", "key": "sk-ant-..." }
    ],
    "openai": [
      { "id": "main", "type": "api_key", "key": "sk-..." }
    ]
  }

  Rotation Logic:
  - Round-robin primary keys ก่อน
  - เมื่อถูก rate-limit → switch ไป key ถัดไป
  - Session stickiness: pin key per session เพื่อ cache efficiency
  - Reset pin เมื่อ: session reset, key ถูก cooldown
```

### 3.3 Cost Tracking & Budget System ★ BEYOND OPENCLAW

OpenClaw มี usage tracking แต่ไม่มี **budget enforcement** — JellyCore จะมี:

```
Cost Intelligence:

  Per-Request Tracking:
  - token_input, token_output, model_used, cost_usd
  - เก็บใน Oracle table: cost_log

  Budget Enforcement:
  ┌─────────────────────────────────────────┐
  │  Level              │  Action           │
  ├─────────────────────┼───────────────────┤
  │  80% monthly budget │  Alert via Telegram│
  │  95% monthly budget │  Downgrade model   │
  │  100% budget        │  Haiku-only mode   │
  │  120% hard limit    │  Stop (offline msg)│
  └─────────────────────────────────────────┘

  Smart Cost Reduction:
  - Query Router ปัจจุบันลด cost ~60% (inline/oracle-only tiers)
  - เพิ่ม: auto-downgrade ถ้า conversation ง่ายลง
    (เริ่ม sonnet → ถ้า 3 messages ติดเป็นคำถามง่าย → switch to haiku)
  - เพิ่ม: cache Oracle results aggressively (5min → 15min TTL)

  Dashboard:
  - Daily/weekly/monthly cost chart
  - Cost per user, per group, per model
  - Projected monthly cost based on current usage

  Chat Command:
  /usage → "วันนี้ใช้ $1.23 (Sonnet: $1.10, Haiku: $0.13) — budget เหลือ 85%"
  /cost  → monthly summary + projection
```

---

## Pillar 4: Streaming & Response UX

### 4.1 Block Streaming

**Adopt จาก OpenClaw (ปรับสำหรับ container sentinel → block chunks):**

```
Streaming Pipeline:

  Container (Claude Code Agent)
    │ writes stdout with sentinel markers
    │ ─── NANOCLAW_OUTPUT_START ───
    │ partial text chunk 1...
    │ partial text chunk 2...
    │ ─── NANOCLAW_OUTPUT_END ───
    ▼
  NanoClaw (stdout parser)
    │ detect chunks via streaming sentinel markers
    │ ─── NANOCLAW_CHUNK ───
    │ buffer + apply chunking algorithm
    ▼
  Block Chunker
    │ minChars: 100, maxChars: 2000
    │ breakPreference: paragraph → newline → sentence → whitespace
    │ code fence protection: never split inside ```
    ▼
  Channel Send
    ├── Telegram: send separate messages (block replies)
    │   หรือ editMessageText() สำหรับ single-message streaming
    └── WhatsApp: typing indicator → send final (ไม่ edit ได้ดี)

  ปรับ Container Protocol:
  - เพิ่ม chunk sentinel: ─── NANOCLAW_CHUNK ───
  - Agent เขียน chunk ทุก ~500 chars (ตาม break point)
  - NanoClaw parse + forward ทันที
```

### 4.2 Human-like Pacing

**Adopt จาก OpenClaw:**

```
Pacing Config:

  Mode: natural
  Between block replies: 800ms - 2500ms random delay
  First block: ส่งทันที (ไม่ delay)
  Final block: ส่งทันที (ไม่ delay)

  ผลลัพธ์: ดูเหมือนคนพิมพ์ตอบ ไม่ใช่ bot dump ข้อความ
  เข้ากับ personality ของ ฝน (Fon) ที่เป็น "เหมือนเพื่อนแชท"
```

### 4.3 Telegram Draft Streaming

**Adopt จาก OpenClaw:**

```
Telegram Stream Modes:

  streamMode: "partial" (recommended)
  - ใช้ sendMessage → editMessageText() ต่อเนื่อง
  - ผู้ใช้เห็น text เพิ่มขึ้นเรื่อยๆ เหมือน ChatGPT
  - Update ทุก ~1s หรือเมื่อได้ chunk ใหม่
  - จบแล้ว → ส่ง final message ปกติ

  streamMode: "block"
  - ใช้ block streaming ตาม 4.1
  - ส่งทีละ message

  streamMode: "off"
  - รอจบก่อน ส่งทีเดียว (ปัจจุบัน)
```

### 4.4 Status Indicators ★ BEYOND OPENCLAW

OpenClaw ส่ง typing indicator พื้นฐาน — JellyCore จะบอก **ขั้นตอนที่กำลังทำ**:

```
Progressive Status:

  📥 "ได้รับข้อความแล้ว" (ทันที)
      ↓
  🔍 "กำลังค้นหาข้อมูลที่เกี่ยวข้อง..." (Oracle query)
      ↓
  🧠 "กำลังคิด..." (container/LLM processing)
      ↓
  ✍️ "กำลังเขียนคำตอบ..." (streaming response)
      ↓
  ✅ ส่งคำตอบ (done)

  Implementation:
  - Telegram: editMessageText() ของ status message
  - WhatsApp: sendPresenceUpdate('composing')
  - ถ้า process > 3s → แสดง status (สั้นกว่าไม่ต้องแสดง)
  - ลบ status message เมื่อส่งคำตอบจริง
```

---

## Pillar 5: Agent Loop Sophistication

### 5.1 Reply Shaping

```
Output Processing Pipeline:

  Raw Agent Output
    │
    ├── Strip <internal> tags (มีแล้ว)
    ├── Strip tool execution logs
    ├── Detect NO_REPLY → suppress entire response
    ├── Code block language tagging (auto-detect)
    ├── Truncate extremely long responses (> 4000 chars for WA)
    ├── Channel-specific formatting:
    │   ├── Telegram: full Markdown (bold, italic, code, links)
    │   └── WhatsApp: simplified (*bold*, _italic_, ```code```)
    └── Feedback buttons (Telegram inline keyboards):
        [👍] [👎] [📝 จำไว้] [🔄 ลองใหม่]
```

### 5.2 NO_REPLY System

**Adopt จาก OpenClaw:**

```
NO_REPLY Token:

  เมื่อ agent ตอบ "NO_REPLY" หรือ "[NO_REPLY]":
  - ไม่ส่งอะไรให้ user
  - ใช้สำหรับ: memory flush turns, background tasks, silent operations

  Use Cases:
  - Pre-compaction memory flush → agent เขียน memory → "NO_REPLY"
  - Scheduled background tasks ที่ผลลัพธ์ไม่ต้องแสดง
  - Self-reflection cycle ที่ evaluate ตัวเอง

  Implementation:
  - Router ตรวจ output.trim() === 'NO_REPLY'
  - Log the turn but don't send to channel
```

### 5.3 Tool Result Sanitization

```
Before Injecting Tool Results to Context:

  1. Size limit: ตัด output > 50,000 chars
     → เก็บ head 5,000 + tail 5,000 + "[truncated]"
  2. Image handling: แปลง base64 images เป็น "[Image: description]"
  3. Sensitive data: strip API keys, passwords จาก tool output
  4. Error normalization: แปลง stack traces เป็น summary
```

### 5.4 Agent-to-Agent Communication ★ BEYOND OPENCLAW

OpenClaw มี `sessions_send` — JellyCore จะมี **true swarm coordination**:

```
Multi-Agent Swarm Protocol:

  Orchestrator Agent (main)
    ├── spawn Researcher Agent → ค้นหา + สรุปข้อมูล
    ├── spawn Coder Agent → เขียนโค้ด
    ├── spawn Reviewer Agent → review โค้ดที่เขียน
    └── collect results → synthesize → respond to user

  Communication via IPC:
  - task assignment: JSON payload ผ่าน IPC file
  - progress report: periodic update จาก child → parent
  - result return: structured output ผ่าน IPC
  - ทั้งหมด HMAC-signed (มีแล้ว)

  ต่างจาก OpenClaw:
  - OpenClaw: sessions_send ส่ง text ข้าม sessions (flat)
  - JellyCore: hierarchical swarm — parent spawns children,
    children report back, parent synthesizes
```

---

## Pillar 6: Skills & Extensibility

### 6.1 Standardized Skill Format

**Adopt จาก OpenClaw (AgentSkills format):**

```
skills/<skill-name>/SKILL.md:

  ---
  name: web-search
  description: Search the web for current information
  metadata:
    jellycore:
      requires:
        bins: ["curl"]
        env: ["SEARCH_API_KEY"]
      primaryEnv: "SEARCH_API_KEY"
  ---

  ## Instructions
  When asked to search the web...

  ## Tools Available
  - `web_search(query)`: Search and return top results
```

**Implementation:**
- NanoClaw สร้าง skill loader ที่ scan `groups/<group>/skills/` + `skills/global/`
- Parse YAML frontmatter → check prerequisites (bins, env)
- Inject skill instructions เข้า system prompt
- Monitor `SKILL.md` changes → hot-reload (fs.watch)

### 6.2 Plugin Hook System

**Adopt จาก OpenClaw (simplified for container architecture):**

```
Lifecycle Hooks:

  before_agent_start(context):
    - inject extra context / modify system prompt
    - e.g., inject time-of-day greeting preference

  after_tool_call(toolName, result):
    - intercept tool results / trigger side effects
    - e.g., auto-learn จาก oracle_search results ที่ user ให้ feedback

  message_received(message):
    - pre-process inbound messages
    - e.g., translate language, strip formatting

  message_sending(response):
    - post-process outbound responses
    - e.g., apply formatting rules, add feedback buttons

  session_end(summary):
    - cleanup / persist
    - e.g., trigger episodic memory summarization

  Implementation:
  - EventEmitter-based (เหมือน MessageBus ที่มีแล้ว)
  - Hooks registered ใน config
  - Plugin files ใน plugins/ directory
```

---

## Pillar 7: Observability & Self-Diagnosis

### 7.1 Request Tracing

```
Trace System:

  Every message gets a unique trace_id (UUID v4):

  [trace-abc123] 0ms    → received: WhatsApp message from +66xxx
  [trace-abc123] 2ms    → classified: container-light (general question)
  [trace-abc123] 5ms    → queued: position 1, group "main"
  [trace-abc123] 8ms    → oracle_context: 4 queries started
  [trace-abc123] 120ms  → oracle_context: done (3 knowledge, 1 pref, 0 decisions)
  [trace-abc123] 135ms  → container: warm pool hit, spawning
  [trace-abc123] 280ms  → container: running, model=haiku
  [trace-abc123] 2100ms → container: completed, 340 tokens out
  [trace-abc123] 2120ms → response: sent to WhatsApp (1 message)
  [trace-abc123] 2120ms → total: 2120ms, cost: $0.001

  Storage:
  - traces stored in Oracle SQLite table
  - retained 7 days, then archived
  - Dashboard: trace viewer with timeline visualization
  - Alert: traces > 10s → flagged for investigation
```

### 7.2 Usage Tracking

```
Metrics:

  Per Response:
  - tokens_in, tokens_out, model, cost_usd
  - response_time_ms, query_tier
  - oracle_results_count, cache_hit

  Aggregated:
  - daily_cost, weekly_cost, monthly_cost
  - avg_response_time per tier
  - cache_hit_ratio
  - oracle_search_quality_score

  Chat Commands:
  /status → system health + uptime + container count + memory usage
  /usage  → today's token usage + cost + budget remaining
  /trace <id> → detailed trace for specific message
```

### 7.3 Knowledge Quality Metrics ★ BEYOND OPENCLAW

สิ่งที่ OpenClaw ไม่มี — **วัดคุณภาพฐานความรู้**:

```
Quality Dashboard:

  ┌──────────────────────────────────────┐
  │ Knowledge Health Score: 82/100       │
  ├──────────────────────────────────────┤
  │ Total Documents: 5,523               │
  │ Active (accessed < 30d): 1,200       │
  │ Stale (no access > 90d): 3,100      │
  │ Contradictions Detected: 15          │
  │ Duplicate Clusters: 42              │
  │ Avg Search Relevance: 0.73          │
  │ Memory Coverage Score: 68%          │
  │  - Semantic: 95% ✅                │
  │  - Procedural: 45% ⚠️              │
  │  - User Model: 60% ⚠️              │
  │  - Episodic: 80% ✅                │
  └──────────────────────────────────────┘

  Automated Actions:
  - Stale docs > 180d → auto-archive (ไม่ลบ)
  - Contradiction pairs → flag for review
  - Low-coverage memory layers → suggest learning targets
  - Search relevance < 0.5 → suggest re-indexing
```

### 7.4 Self-Diagnosis (Doctor)

**Adopt จาก OpenClaw (`openclaw doctor`):**

```
/doctor command:

  Checks:
  ✅ Oracle V2: reachable, 5523 documents indexed
  ✅ ChromaDB: connected, 5523 vectors
  ✅ Telegram: webhook active, bot responding
  ✅ WhatsApp: session valid, connected
  ✅ Container: Docker available, image ready
  ✅ Warm Pool: 2/3 containers ready
  ⚠️ Disk: 78% used (> 70% threshold)
  ❌ Backup: last backup 26 hours ago (> 24h threshold)
  ✅ API Keys: Anthropic valid, rate limit headroom 85%
  ✅ Memory: RSS 450MB, heap 200MB

  Score: 8/10 (1 warning, 1 error)
  Suggestion: Run backup now with /backup
```

---

## 🗓️ Implementation Roadmap

### Phase Mapping (ใส่เข้า Master Plan เดิม)

```
Phase 0 (Week 1): Security Foundation ✅ DONE (v0.5.0)
  • Thai NLP Sidecar, Embedding Versioning, Docker 4-service stack

Phase 1 (Week 2-3): Performance & Search Intelligence ✅ DONE (v0.6.0)
  • Adaptive Hybrid Search + Quality Correction (Part A)
  • Pluggable Embedder Interface (Part B)
  • Bilingual Smart Chunking with overlap (Part C)
  • Thai NLP Indexer + Embedding Cache (Part D)

Phase 2: Architecture Hardening ⏭️ SKIPPED
  • Multi-Provider Failover, Auth Rotation
  • เหตุผลที่ข้าม: ปัจจุบันใช้ Z.AI single provider ซึ่งเสถียรเพียงพอ
    ยังไม่มี pain point จริงเรื่อง provider down หรือ rate limit
    สามารถกลับมาทำได้เมื่อเริ่มใช้หลาย provider จริง

Phase 3: Reliability (Context Mastery) ⏭️ SKIPPED
  • Auto-Compaction, Session Pruning, Memory Flush
  • เหตุผลที่ข้าม:
    1. สถาปัตยกรรม Container ของ JellyCore สร้าง container ใหม่ทุก task
       → ไม่มี context สะสมจนล้นเหมือน OpenClaw ที่ session อยู่ยาว
    2. Oracle ทำหน้าที่ "ความจำถาวร" แยกจาก container อยู่แล้ว
       → ไม่จำเป็นต้อง flush memory ก่อน compact เพราะข้อมูลอยู่ใน Oracle
    3. ความเสี่ยง: Compaction สรุปข้อมูล → สูญเสีย nuance, tone, บริบทเฉพาะ
       ถ้า implement ผิด → AI จำผิด แย่กว่าไม่จำเลย
    4. เพิ่ม complexity ให้ NanoClaw โดยยังไม่มี use case จริงรองรับ

Phase 4: Five-Layer Memory System → ดำเนินการถัดไป (v0.7.0)
  • 4.1 User Model Layer (Layer 1)
  • 4.2 Procedural Memory (Layer 2)
  • 4.3 Semantic Memory Enhancement (Layer 3)
  • 4.4 Episodic Memory with Decay (Layer 4)
  • 4.5 Continuous Learning Loop (Pillar 1.3)

Phase 5 (Week 8-10): Production Polish → เพิ่ม:
  • 5.7 Cost Tracking & Budget System (Pillar 3.3)
  • 5.8 Request Tracing (Pillar 7.1)
  • 5.9 Knowledge Quality Metrics (Pillar 7.3)
  • 5.10 Self-Diagnosis /doctor (Pillar 7.4)
  • 5.11 Standardized Skills Format (Pillar 6.1)

Phase 6 (Week 10-12): ★ BEYOND OPENCLAW → ใหม่ทั้งหมด:
  • 6.1 Memory Consolidation Service
  • 6.2 Contradiction Detection
  • 6.3 Knowledge Graph (concept relationships)
  • 6.4 Agent Swarm Protocol Enhancement
  • 6.5 Self-Reflection Loop
  • 6.6 Query Expansion Engine
```

### Priority Matrix

```
                    ผลกระทบต่อ AI Intelligence
                    High                   Low
                ┌─────────────────────────────────┐
    Easy/Quick  │ • Embedding upgrade     │ • /doctor cmd        │
                │ • NO_REPLY system       │ • Standardized skills│
                │ • Session pruning       │ • Typing indicators  │
                │ • Usage tracking        │                      │
                ├─────────────────────────┼──────────────────────┤
    Hard/Slow   │ • 5-Layer Memory ★★★    │ • Knowledge graph    │
                │ • Learning Loop ★★★     │ • Agent swarm v2     │
                │ • Adaptive Search ★★    │ • Self-reflection    │
                │ • Auto-compaction ★★    │                      │
                │ • Block streaming ★★    │                      │
                │ • Model failover ★★     │                      │
                │ • Cost/budget system    │                      │
                │ • Anticipatory prefetch │                      │
                └─────────────────────────┴──────────────────────┘

★★★ = ทำก่อน (core differentiator)
★★  = ทำต่อ (significant improvement)
ที่เหลือ = ทำเมื่อพร้อม (nice-to-have)
```

---

## 📐 Design Decisions

| Decision | Choice | เหตุผล |
|----------|--------|--------|
| Memory architecture | 5-layer cognitive model | เหนือกว่า OpenClaw's 2-layer ในเชิงความฉลาด |
| Search weights | Adaptive (query-type based) | ดีกว่า fixed 70:30 — ตอบโจทย์ทั้ง exact + semantic |
| Re-ranking | Cross-encoder on top-20 | OpenClaw ไม่มี built-in re-ranking — เราได้เปรียบ |
| Query expansion | Rule-based + synonym | ไม่ต้องใช้ LLM → zero cost, ภาษาไทย+อังกฤษ |
| Compaction strategy | Store to Oracle → compact → resume | ดีกว่า OpenClaw ที่ compact เป็น flat JSONL summary |
| Prefetch | Concept-graph based prediction | OpenClaw ไม่มี — unique feature |
| Failover | 3-tier (Sonnet → Haiku → local) | เหมือน OpenClaw pattern + local emergency |
| Cost enforcement | Hard budget limits + auto-downgrade | OpenClaw มี tracking แต่ไม่ enforce budget |
| Streaming | Container sentinel → chunker → channel | ปรับ OpenClaw pattern ให้ใช้กับ container arch |
| Learning validation | Confidence tiers + contradiction check | OpenClaw เขียน memory passively ไม่มี validation |
| Skill format | AgentSkills-compatible | Interop กับ ecosystem ที่มี |
| Observability | Trace + metrics ใน Oracle SQLite | ใช้ infrastructure ที่มีอยู่ ไม่เพิ่ม dependency |

---

## 🎯 Success Criteria

เมื่อ implement ครบ Pillar 1-7 แล้ว JellyCore ต้อง:

| Test | Target | วิธีวัด |
|------|--------|---------|
| **Memory recall (same day)** | 95% accuracy | ถาม AI เรื่องที่เคยคุยวันนี้ → ต้องตอบถูก 19/20 |
| **Memory recall (1 week)** | 80% accuracy | ถาม AI เรื่องที่เคยคุยสัปดาห์ก่อน → ต้องตอบถูก 16/20 |
| **Memory recall (1 month)** | 60% accuracy | ถาม AI เรื่องที่เคยคุยเดือนก่อน → ต้องตอบถูก 12/20 |
| **User model accuracy** | 85% match | AI ทำนาย user preference ถูกต้อง 17/20 ครั้ง |
| **Search relevance** | >0.75 avg score | Oracle search returns relevant results |
| **First byte time** | <3s | ผู้ใช้เห็นข้อความแรกภายใน 3 วินาที (streaming) |
| **Total response time** | <10s (median) | 50th percentile สำหรับ container queries |
| **Provider failover** | <5s detection | เมื่อ provider down ต้อง switch ภายใน 5 วินาที |
| **Cost efficiency** | <$0.01 avg/message | across all tiers (inline ฟรี, oracle <$0.001, container <$0.02) |
| **Uptime** | 99.5% monthly | ต้อง failover ได้เมื่อ provider down |
| **Learning quality** | <5% false positives | Auto-learned facts ที่ผิดต้องน้อยกว่า 5% |
| **Contradiction detection** | 80% recall | ตรวจจับ contradictions ใน knowledge base ได้ 80% |

---

## 🔗 Related Documents

| Document | Purpose |
|----------|---------|
| [MASTER_PLAN/README.md](MASTER_PLAN/README.md) | แผนหลัก 6 Phases เดิม |
| [MASTER_PLAN/REVIEW_AND_IMPROVEMENTS.md](MASTER_PLAN/REVIEW_AND_IMPROVEMENTS.md) | Review จุดอ่อน 21 จุด + แผนแก้ไข |
| [QUICKSTART.md](QUICKSTART.md) | วิธี setup สำหรับ developer |
| [DEPLOYMENT.md](DEPLOYMENT.md) | วิธี deploy production |

---

> **สรุป:** JellyCore ไม่จำเป็นต้อง "เป็น OpenClaw" — เราไม่ต้องรองรับ 15 channels
> หรือสร้าง macOS app เราต้อง **ฉลาดกว่า** ในเรื่องที่สำคัญ: จำได้ดีกว่า ค้นหาแม่นกว่า
> เรียนรู้เร็วกว่า จัดการบริบทดีกว่า — แล้วตอบเร็วพอในราคาที่ control ได้
> 
> **5-Layer Memory + Adaptive Search + Learning Loop = Core Differentiator**  
> ที่เหลือคือ adopt best practices จาก OpenClaw แล้วปรับให้เข้ากับ container architecture ของเรา

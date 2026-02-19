# JellyCore API Reference (ภาษาไทย)

เอกสารอ้างอิง API สำหรับ JellyCore — Oracle V2 Knowledge Engine และ NanoClaw AI Orchestrator

**เวอร์ชัน:** 0.8.0  
**อัปเดตล่าสุด:** 18 กุมภาพันธ์ 2026

---

## สารบัญ

- [Oracle V2 API](#oracle-v2-api)
  - [ค้นหาและสอบถาม](#คนหาและสอบถาม)
  - [เอกสารและรายการ](#เอกสารและรายการ)
  - [Dashboard และสถิติ](#dashboard-และสถตอ)
  - [Threads (บทสนทนา)](#threads-บทสนทนา)
  - [Decisions (การตัดสินใจ)](#decisions-การตดสนใจ)
  - [Supersede Log](#supersede-log)
  - [Traces (การสำรวจ)](#traces-การสำรวจ)
  - [Memory Layers](#memory-layers)
- [NanoClaw API](#nanoclaw-api)
  - [Health และ Status](#health-และ-status)

---

## Oracle V2 API

**Base URL:** `http://oracle:47778` (ใน Docker network) หรือ `http://localhost:47778`  
**Authentication:** Bearer token ใน header `Authorization` (ตั้งค่าผ่าน `ORACLE_AUTH_TOKEN`)

### ค้นหาและสอบถาม

#### `GET /api/health`
ตรวจสอบสถานะของ Oracle server

**Response:**
```json
{
  "status": "ok",
  "server": "oracle-nightly",
  "port": 47778,
  "oracleV2": "connected"
}
```

---

#### `GET /api/search`
ค้นหาความรู้ในฐานข้อมูล Oracle ด้วย hybrid search (FTS + vector)

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `q` | string | ✅ | - | คำค้นหา / คำถาม |
| `type` | string | ❌ | `all` | ประเภทเอกสาร: `all`, `learning`, `decision`, `retrospective`, `resonance` |
| `limit` | number | ❌ | `10` | จำนวนผลลัพธ์สูงสุด |
| `offset` | number | ❌ | `0` | เริ่มต้นจากตำแหน่งที่ (pagination) |
| `mode` | string | ❌ | `hybrid` | โหมดการค้นหา: `hybrid`, `fts`, `vector` |
| `project` | string | ❌ | - | กรองตาม project (เช่น `github.com/owner/repo`) |
| `cwd` | string | ❌ | - | auto-detect project จาก current working directory |
| `layer` | string | ❌ | - | กรองตาม memory layer (คั่นด้วย comma): `userModel`, `contextModel`, `working`, `archival` |

**Response:**
```json
{
  "query": "How to use Docker",
  "results": [
    {
      "id": "doc-123",
      "type": "learning",
      "content": "Docker is a container platform...",
      "relevance": 0.95,
      "source_file": "ψ/memory/learnings/docker-basics.md",
      "project": "github.com/user/project",
      "layer": "working"
    }
  ],
  "ftsResults": 5,
  "vectorResults": 8,
  "searchTimeMs": 42
}
```

---

#### `GET /api/consult`
ปรึกษา Oracle เพื่อขอคำแนะนำในการตัดสินใจ (ค้นหา decisions ที่เกี่ยวข้อง)

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | ✅ | คำถาม / สถานการณ์ที่ต้องการปรึกษา |
| `context` | string | ❌ | บริบทเพิ่มเติม |

**Response:**
```json
{
  "answer": "คำแนะนำจาก Oracle...",
  "relatedDecisions": [
    {
      "id": 7,
      "title": "Use Docker for deployment",
      "decision": "เลือกใช้ Docker",
      "relevance": 0.88
    }
  ],
  "confidenceScore": 0.85
}
```

---

#### `GET /api/reflect`
สะท้อนความรู้ที่ Oracle มี — แสดงภาพรวม principles และ patterns

**Response:**
```json
{
  "totalDocuments": 1247,
  "principles": [
    { "principle": "Simplicity over complexity", "frequency": 42 }
  ],
  "patterns": [
    { "pattern": "Event-driven architecture", "count": 18 }
  ]
}
```

---

### เอกสารและรายการ

#### `GET /api/doc/:id`
ดึงเอกสารเดียวตาม ID

**Path Parameters:**
- `id` (string): Document ID

**Response:**
```json
{
  "id": "doc-123",
  "type": "learning",
  "content": "Full document content...",
  "source_file": "ψ/memory/learnings/example.md",
  "concepts": ["docker", "containers"],
  "project": "github.com/user/repo"
}
```

---

#### `GET /api/list`
แสดงรายการเอกสารทั้งหมด (pagination)

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | string | `all` | กรองตามประเภท |
| `limit` | number | `10` | จำนวนต่อหน้า |
| `offset` | number | `0` | เริ่มต้นจากตำแหน่ง |
| `group` | boolean | `true` | จัดกลุ่มตามประเภท |

**Response:**
```json
{
  "documents": [
    {
      "id": "doc-1",
      "type": "learning",
      "title": "Docker basics",
      "source_file": "ψ/memory/learnings/docker.md",
      "project": "github.com/user/repo"
    }
  ],
  "total": 1247,
  "limit": 10,
  "offset": 0
}
```

---

#### `GET /api/file`
อ่านไฟล์จาก repository (รองรับ cross-repo access ผ่าน ghq)

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | ✅ | path ของไฟล์ (relative) |
| `project` | string | ❌ | ghq project path (เช่น `github.com/owner/repo`) |

**Response:** Plain text (เนื้อหาไฟล์)

**ตัวอย่าง:**
```
GET /api/file?path=README.md
GET /api/file?path=src/index.ts&project=github.com/user/other-repo
```

---

#### `GET /api/graph`
สร้าง knowledge graph — แสดงความสัมพันธ์ระหว่างเอกสาร

**Response:**
```json
{
  "nodes": [
    { "id": "doc-1", "label": "Docker", "type": "learning" }
  ],
  "edges": [
    { "from": "doc-1", "to": "doc-5", "relation": "references" }
  ]
}
```

---

#### `GET /api/context`
แสดง context ของ project ปัจจุบัน (auto-detect จาก cwd)

**Query Parameters:**
- `cwd` (string, optional): Current working directory

**Response:**
```json
{
  "project": "github.com/user/repo",
  "recentDocuments": [ /* ... */ ],
  "relevantTopics": ["docker", "typescript"]
}
```

---

### Dashboard และสถิติ

#### `GET /api/stats`
สถิติภาพรวมของ Oracle

**Response:**
```json
{
  "totalDocuments": 1247,
  "byType": {
    "learning": 523,
    "decision": 89,
    "retrospective": 34
  },
  "dbSize": "45.2 MB",
  "indexedAt": "2026-02-18T10:30:00Z"
}
```

---

#### `GET /api/cache/stats`
สถิติ search cache

**Response:**
```json
{
  "hits": 1523,
  "misses": 342,
  "hitRate": 0.82,
  "size": 150,
  "maxSize": 500
}
```

---

#### `GET /api/logs`
ดูประวัติการค้นหา (search log)

**Query Parameters:**
- `limit` (number, default: 20): จำนวน logs

**Response:**
```json
{
  "logs": [
    {
      "query": "Docker deployment",
      "type": "all",
      "mode": "hybrid",
      "results_count": 8,
      "search_time_ms": 42,
      "created_at": 1708243200000,
      "project": "github.com/user/repo"
    }
  ],
  "total": 20
}
```

---

#### `GET /api/dashboard`
Dashboard summary — สรุปภาพรวมทั้งหมด

**Aliases:**
- `GET /api/dashboard/summary`

**Response:**
```json
{
  "totalDocs": 1247,
  "recentActivity": 156,
  "topTopics": ["docker", "typescript", "react"],
  "growthRate": "+12% this week"
}
```

---

#### `GET /api/dashboard/activity`
กิจกรรมย้อนหลัง (searches, learnings, consults)

**Query Parameters:**
- `days` (number, default: 7): จำนวนวันย้อนหลัง

**Response:**
```json
{
  "searches": [
    { "date": "2026-02-18", "count": 42 }
  ],
  "learnings": [ /* ... */ ],
  "consults": [ /* ... */ ]
}
```

---

#### `GET /api/dashboard/growth`
แนวโน้มการเติบโตของ knowledge base

**Query Parameters:**
- `period` (string, default: `week`): `day`, `week`, `month`

**Response:**
```json
{
  "period": "week",
  "growth": [
    { "date": "2026-02-11", "total": 1200 },
    { "date": "2026-02-18", "total": 1247 }
  ],
  "growthRate": "+3.9%"
}
```

---

#### `GET /api/session/stats`
สถิติการใช้งานใน session (24 ชม. ล่าสุด)

**Query Parameters:**
- `since` (number, optional): Unix timestamp (default: 24h ago)

**Response:**
```json
{
  "searches": 156,
  "consultations": 23,
  "learnings": 8,
  "since": 1708156800000
}
```

---

### Threads (บทสนทนา)

#### `GET /api/threads`
แสดงรายการ threads ทั้งหมด

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | - | กรองตามสถานะ: `open`, `closed`, `archived` |
| `limit` | number | `20` | จำนวนต่อหน้า |
| `offset` | number | `0` | เริ่มต้นจากตำแหน่ง |

**Response:**
```json
{
  "threads": [
    {
      "id": 42,
      "title": "How to optimize Docker build",
      "status": "open",
      "message_count": 5,
      "created_at": "2026-02-18T10:00:00Z",
      "issue_url": "https://github.com/user/repo/issues/42"
    }
  ],
  "total": 156
}
```

---

#### `POST /api/thread`
สร้าง thread ใหม่ หรือส่งข้อความใน thread ที่มีอยู่

**Request Body:**
```json
{
  "message": "How do I optimize Docker builds?",
  "thread_id": 42,  // Optional: ถ้าไม่ระบุ = สร้าง thread ใหม่
  "title": "Docker optimization",  // Required for new thread
  "role": "human"  // Optional: "human" | "assistant"
}
```

**Response:**
```json
{
  "thread_id": 42,
  "message_id": 128,
  "status": "open",
  "oracle_response": "Oracle suggests using multi-stage builds...",
  "issue_url": "https://github.com/user/repo/issues/42"
}
```

---

#### `GET /api/thread/:id`
ดึงข้อมูล thread พร้อมข้อความทั้งหมด

**Path Parameters:**
- `id` (number): Thread ID

**Response:**
```json
{
  "thread": {
    "id": 42,
    "title": "Docker optimization",
    "status": "open",
    "created_at": "2026-02-18T10:00:00Z",
    "issue_url": "https://github.com/user/repo/issues/42"
  },
  "messages": [
    {
      "id": 128,
      "role": "human",
      "content": "How do I optimize Docker builds?",
      "author": "user@example.com",
      "principles_found": 2,
      "patterns_found": 3,
      "created_at": "2026-02-18T10:01:00Z"
    }
  ]
}
```

---

#### `PATCH /api/thread/:id/status`
อัปเดตสถานะของ thread

**Path Parameters:**
- `id` (number): Thread ID

**Request Body:**
```json
{
  "status": "closed"  // "open" | "closed" | "archived"
}
```

**Response:**
```json
{
  "success": true,
  "thread_id": 42,
  "status": "closed"
}
```

---

### Decisions (การตัดสินใจ)

#### `GET /api/decisions`
แสดงรายการ decisions (ADR - Architecture Decision Records)

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | กรองตามสถานะ: `proposed`, `accepted`, `rejected`, `superseded` |
| `project` | string | กรองตาม project |
| `tags` | string | กรองตาม tags (คั่นด้วย comma) |
| `limit` | number | จำนวนต่อหน้า (default: 20) |
| `offset` | number | เริ่มต้นจากตำแหน่ง |

**Response:**
```json
{
  "decisions": [
    {
      "id": 7,
      "title": "Use Docker for deployment",
      "status": "accepted",
      "context": "Need reliable deployment process",
      "decision": "Adopt Docker containers",
      "project": "github.com/user/repo",
      "tags": ["docker", "deployment"],
      "created_at": "2026-02-15T10:00:00Z",
      "updated_at": "2026-02-16T14:30:00Z",
      "decided_at": "2026-02-16T14:30:00Z",
      "decided_by": "team-lead"
    }
  ],
  "total": 89,
  "counts": {
    "proposed": 12,
    "accepted": 56,
    "rejected": 15,
    "superseded": 6
  }
}
```

---

#### `GET /api/decisions/:id`
ดึงข้อมูล decision เดียว

**Path Parameters:**
- `id` (number): Decision ID

**Response:**
```json
{
  "id": 7,
  "title": "Use Docker for deployment",
  "status": "accepted",
  "context": "Need reliable deployment process...",
  "options": [
    "Docker containers",
    "VM-based deployment",
    "Kubernetes"
  ],
  "decision": "Adopt Docker containers",
  "rationale": "Docker provides isolation, reproducibility...",
  "project": "github.com/user/repo",
  "tags": ["docker", "deployment"],
  "created_at": "2026-02-15T10:00:00Z",
  "updated_at": "2026-02-16T14:30:00Z",
  "decided_at": "2026-02-16T14:30:00Z",
  "decided_by": "team-lead"
}
```

---

#### `POST /api/decisions`
สร้าง decision ใหม่

**Request Body:**
```json
{
  "title": "Use TypeScript for new services",
  "context": "Team struggling with JavaScript bugs",
  "options": ["TypeScript", "Flow", "JSDoc"],
  "tags": ["language", "typescript"],
  "project": "github.com/user/repo"
}
```

**Response:**
```json
{
  "id": 15,
  "title": "Use TypeScript for new services",
  "status": "proposed",
  "created_at": "2026-02-18T11:00:00Z"
}
```

---

#### `PATCH /api/decisions/:id`
อัปเดต decision

**Path Parameters:**
- `id` (number): Decision ID

**Request Body:** (ทุกฟิลด์ optional)
```json
{
  "title": "Updated title",
  "context": "Updated context",
  "options": ["option1", "option2"],
  "decision": "We decided to...",
  "rationale": "Because...",
  "tags": ["tag1", "tag2"],
  "status": "accepted",
  "decided_by": "username"
}
```

**Response:**
```json
{
  "id": 15,
  "title": "Use TypeScript for new services",
  "status": "accepted",
  "updated_at": "2026-02-18T11:30:00Z"
}
```

---

#### `POST /api/decisions/:id/transition`
เปลี่ยนสถานะของ decision (state machine)

**Path Parameters:**
- `id` (number): Decision ID

**Request Body:**
```json
{
  "status": "accepted",  // "proposed" → "accepted" | "rejected"
  "decided_by": "team-lead"
}
```

**Response:**
```json
{
  "id": 15,
  "title": "Use TypeScript for new services",
  "status": "accepted",
  "decided_at": "2026-02-18T12:00:00Z",
  "decided_by": "team-lead"
}
```

---

### Supersede Log

ระบบติดตามเอกสารที่ถูกแทนที่ (versioning, deprecation)

#### `GET /api/supersede`
แสดงรายการ supersessions

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `project` | string | - | กรองตาม project |
| `limit` | number | `50` | จำนวนต่อหน้า |
| `offset` | number | `0` | เริ่มต้นจากตำแหน่ง |

**Response:**
```json
{
  "supersessions": [
    {
      "id": 23,
      "old_path": "ψ/memory/learnings/docker-v1.md",
      "old_id": "doc-100",
      "old_title": "Docker basics",
      "old_type": "learning",
      "new_path": "ψ/memory/learnings/docker-v2.md",
      "new_id": "doc-150",
      "new_title": "Docker advanced guide",
      "reason": "Outdated — updated to latest practices",
      "superseded_at": "2026-02-18T10:00:00Z",
      "superseded_by": "admin",
      "project": "github.com/user/repo"
    }
  ],
  "total": 45,
  "limit": 50,
  "offset": 0
}
```

---

#### `GET /api/supersede/chain/:path`
แสดง chain ของเอกสาร (ว่าถูกแทนที่โดยอะไร / แทนที่อะไร)

**Path Parameters:**
- `path` (string, URL-encoded): Document path

**Response:**
```json
{
  "superseded_by": [
    {
      "new_path": "ψ/memory/learnings/docker-v2.md",
      "reason": "Updated content",
      "superseded_at": "2026-02-18T10:00:00Z"
    }
  ],
  "supersedes": [
    {
      "old_path": "ψ/memory/learnings/docker-beta.md",
      "reason": "Stable version released",
      "superseded_at": "2026-01-15T08:00:00Z"
    }
  ]
}
```

---

#### `POST /api/supersede`
บันทึก supersession ใหม่

**Request Body:**
```json
{
  "old_path": "ψ/memory/learnings/old-doc.md",
  "old_id": "doc-100",
  "old_title": "Old title",
  "old_type": "learning",
  "new_path": "ψ/memory/learnings/new-doc.md",
  "new_id": "doc-200",
  "new_title": "New title",
  "reason": "Updated with new information",
  "superseded_by": "admin",
  "project": "github.com/user/repo"
}
```

**Response:**
```json
{
  "id": 24,
  "message": "Supersession logged"
}
```

**Note:** การบันทึก supersession จะ invalidate search cache โดยอัตโนมัติ

---

### Traces (การสำรวจ)

Trace = บันทึกการเดินทางค้นพบความรู้ (discovery journey)

#### `GET /api/traces`
แสดงรายการ traces

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | กรองตามคำค้นหา |
| `status` | string | `raw`, `reviewed`, `distilled` |
| `project` | string | กรองตาม project |
| `limit` | number | จำนวนต่อหน้า (default: 50) |
| `offset` | number | เริ่มต้นจากตำแหน่ง |

**Response:**
```json
{
  "traces": [
    {
      "id": "trace-abc123",
      "query": "How to optimize React performance",
      "status": "reviewed",
      "project": "github.com/user/app",
      "created_at": "2026-02-18T10:00:00Z",
      "findings": 5
    }
  ],
  "total": 234
}
```

---

#### `GET /api/traces/:id`
ดึงข้อมูล trace เดียว

**Path Parameters:**
- `id` (string): Trace ID

**Response:**
```json
{
  "id": "trace-abc123",
  "query": "How to optimize React performance",
  "status": "reviewed",
  "findings": [
    {
      "type": "pattern",
      "content": "Use React.memo for expensive components",
      "source": "doc-456"
    }
  ],
  "linkedPrevId": null,
  "linkedNextId": "trace-def456",
  "created_at": "2026-02-18T10:00:00Z"
}
```

---

#### `GET /api/traces/:id/chain`
ดึง trace chain (ต้นน้ำ-ปลายน้ำ)

**Path Parameters:**
- `id` (string): Trace ID

**Query Parameters:**
- `direction` (string): `up` | `down` | `both` (default: `both`)

**Response:**
```json
{
  "upstream": [ /* traces ที่มาก่อน */ ],
  "current": { /* trace ปัจจุบัน */ },
  "downstream": [ /* traces ที่ตามมา */ ]
}
```

---

#### `POST /api/traces/:prevId/link`
เชื่อม trace เข้าด้วยกัน (สร้าง linked chain)

**Path Parameters:**
- `prevId` (string): Trace ID ก่อนหน้า

**Request Body:**
```json
{
  "nextId": "trace-def456"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Traces linked successfully"
}
```

---

#### `DELETE /api/traces/:id/link`
ยกเลิกการเชื่อม trace

**Path Parameters:**
- `id` (string): Trace ID

**Query Parameters:**
- `direction` (string, required): `prev` | `next`

**Response:**
```json
{
  "success": true,
  "message": "Trace unlinked"
}
```

---

#### `GET /api/traces/:id/linked-chain`
ดึง linked chain ทั้งหมดของ trace (แบบเชื่อมโยงผ่าน linkedPrevId/linkedNextId)

**Path Parameters:**
- `id` (string): Trace ID

**Response:**
```json
{
  "chain": [
    { "id": "trace-abc", "query": "Initial query", "created_at": "..." },
    { "id": "trace-def", "query": "Follow-up query", "created_at": "..." }
  ]
}
```

---

### Memory Layers

Phase 4 (v0.7.0) — เลเยอร์หน่วยความจำแบบลำดับชั้น

#### `GET /api/user-model`
ดึงข้อมูล User Model (Layer 1) — ข้อมูลเกี่ยวกับผู้ใช้

**Query Parameters:**
- `userId` (string, default: `default`): User ID

**Response:**
```json
{
  "userId": "default",
  "preferences": {
    "theme": "dark",
    "language": "th"
  },
  "skills": ["typescript", "react", "docker"],
  "recentTopics": ["performance", "deployment"]
}
```

---

## NanoClaw API

**Base URL:** `http://nanoclaw:47779` (ใน Docker network) หรือ `http://localhost:47779`  
**Note:** NanoClaw health API ไม่ต้อง authentication (internal network only)

### Health และ Status

#### `GET /health`
ตรวจสอบสถานะของ NanoClaw orchestrator

**Response:**
```json
{
  "status": "ok",
  "uptime": 3600,
  "version": "0.8.0",
  "timestamp": "2026-02-18T12:00:00Z"
}
```

**Fields:**
- `uptime`: จำนวนวินาทีที่ทำงาน
- `version`: NanoClaw version

---

#### `GET /status`
สถานะโดยละเอียด — containers, queue, resources

**Response:**
```json
{
  "activeContainers": 2,
  "queueDepth": 3,
  "registeredGroups": ["main", "tg-123456789"],
  "resources": {
    "currentMax": 5,
    "cpuUsage": "45.2%",
    "memoryFree": "62.8%"
  },
  "recentErrors": [
    {
      "timestamp": "2026-02-18T11:58:00Z",
      "message": "Container spawn timeout",
      "group": "main"
    }
  ],
  "uptime": 3600,
  "version": "0.8.0",
  "timestamp": "2026-02-18T12:00:00Z"
}
```

**Fields:**
- `activeContainers`: จำนวน agent containers ที่กำลังทำงาน
- `queueDepth`: จำนวนงานที่รอคิว
- `registeredGroups`: รายชื่อ groups ที่ลงทะเบียน (Telegram/WhatsApp)
- `resources`: สถานะ CPU และ memory
  - `currentMax`: concurrency limit ปัจจุบัน (ปรับอัตโนมัติตาม load)
  - `cpuUsage`: % การใช้ CPU (1-min load average)
  - `memoryFree`: % memory ว่าง
- `recentErrors`: ข้อผิดพลาด 20 รายการล่าสุด (circular buffer)

---

## Error Handling

### HTTP Status Codes

| Code | Meaning | ตัวอย่าง |
|------|---------|----------|
| 200 | OK | สำเร็จ |
| 201 | Created | สร้างข้อมูลสำเร็จ |
| 400 | Bad Request | ข้อมูล request ไม่ถูกต้อง |
| 401 | Unauthorized | ไม่มี auth token หรือ token ไม่ถูกต้อง |
| 404 | Not Found | ไม่พบข้อมูลที่ร้องขอ |
| 500 | Internal Server Error | เกิดข้อผิดพลาดภายใน server |

### Error Response Format

```json
{
  "error": "รายละเอียดข้อผิดพลาด"
}
```

---

## Authentication (Oracle Only)

Oracle API ต้องการ Bearer token:

```bash
curl -H "Authorization: Bearer YOUR_ORACLE_AUTH_TOKEN" \
  http://oracle:47778/api/search?q=docker
```

**Environment Variable:** `ORACLE_AUTH_TOKEN`

NanoClaw health API ไม่ต้อง authentication (internal only)

---

## ตัวอย่างการใช้งาน

### ค้นหาความรู้เกี่ยวกับ Docker
```bash
curl "http://oracle:47778/api/search?q=docker&limit=5&mode=hybrid" \
  -H "Authorization: Bearer $ORACLE_AUTH_TOKEN"
```

### สร้าง Decision ใหม่
```bash
curl -X POST "http://oracle:47778/api/decisions" \
  -H "Authorization: Bearer $ORACLE_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Migrate to Bun runtime",
    "context": "Node.js is slow for our use case",
    "options": ["Bun", "Deno", "Stay with Node"],
    "tags": ["runtime", "performance"]
  }'
```

### ส่งข้อความใน Thread
```bash
curl -X POST "http://oracle:47778/api/thread" \
  -H "Authorization: Bearer $ORACLE_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "thread_id": 42,
    "message": "Can you explain the rationale for using Docker?",
    "role": "human"
  }'
```

### ตรวจสอบสถานะ NanoClaw
```bash
curl "http://nanoclaw:47779/status"
```

---

## Changelog

### v0.8.0 (2026-02-18)
- ✅ เพิ่ม typing interval TTL (auto-expire after 5 min)
- ✅ Fix orphan container cleanup on shutdown
- ✅ เพิ่ม `stop_grace_period` ใน docker-compose

### v0.7.1 (2026-02-01)
- ✅ Memory reliability improvements
- ✅ Cache optimization

### v0.7.0 (2026-01-15)
- ✅ Memory Layers (Phase 4)
- ✅ Trace linking API
- ✅ Layer filtering in search

### v0.6.0 (2025-12-20)
- ✅ Performance optimization
- ✅ Query router

---

## Support

- **Documentation:** [docs/](../docs/)
- **GitHub Issues:** [JellyCore Issues](https://github.com/b9b4ymiN/JellyCore/issues)
- **คำถาม:** ถาม Oracle ผ่าน Telegram bot หรือ API `/api/consult`

---

**สร้างโดย:** JellyCore Team  
**License:** MIT

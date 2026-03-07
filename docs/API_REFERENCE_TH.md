# JellyCore API Reference (à¸ à¸²à¸©à¸²à¹„à¸—à¸¢)

à¹€à¸­à¸à¸ªà¸²à¸£à¸­à¹‰à¸²à¸‡à¸­à¸´à¸‡ API à¸ªà¸³à¸«à¸£à¸±à¸š JellyCore â€” Oracle V2 Knowledge Engine à¹à¸¥à¸° NanoClaw AI Orchestrator

**à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™:** 0.8.0  
**à¸­à¸±à¸›à¹€à¸”à¸•à¸¥à¹ˆà¸²à¸ªà¸¸à¸”:** 18 à¸à¸¸à¸¡à¸ à¸²à¸žà¸±à¸™à¸˜à¹Œ 2026

---

## à¸ªà¸²à¸£à¸šà¸±à¸

- [Oracle V2 API](#oracle-v2-api)
  - [à¸„à¹‰à¸™à¸«à¸²à¹à¸¥à¸°à¸ªà¸­à¸šà¸–à¸²à¸¡](#à¸„à¸™à¸«à¸²à¹à¸¥à¸°à¸ªà¸­à¸šà¸–à¸²à¸¡)
  - [à¹€à¸­à¸à¸ªà¸²à¸£à¹à¸¥à¸°à¸£à¸²à¸¢à¸à¸²à¸£](#à¹€à¸­à¸à¸ªà¸²à¸£à¹à¸¥à¸°à¸£à¸²à¸¢à¸à¸²à¸£)
  - [Dashboard à¹à¸¥à¸°à¸ªà¸–à¸´à¸•à¸´](#dashboard-à¹à¸¥à¸°à¸ªà¸–à¸•à¸­)
  - [Threads (à¸šà¸—à¸ªà¸™à¸—à¸™à¸²)](#threads-à¸šà¸—à¸ªà¸™à¸—à¸™à¸²)
  - [Decisions (à¸à¸²à¸£à¸•à¸±à¸”à¸ªà¸´à¸™à¹ƒà¸ˆ)](#decisions-à¸à¸²à¸£à¸•à¸”à¸ªà¸™à¹ƒà¸ˆ)
  - [Supersede Log](#supersede-log)
  - [Traces (à¸à¸²à¸£à¸ªà¸³à¸£à¸§à¸ˆ)](#traces-à¸à¸²à¸£à¸ªà¸³à¸£à¸§à¸ˆ)
  - [Memory Layers](#memory-layers)
- [NanoClaw API](#nanoclaw-api)
  - [Health à¹à¸¥à¸° Status](#health-à¹à¸¥à¸°-status)

---

## Oracle V2 API

**Base URL:** `http://oracle:47778` (à¹ƒà¸™ Docker network) à¸«à¸£à¸·à¸­ `http://localhost:47778`  
**Authentication:** Oracle à¸›à¹‰à¸­à¸‡à¸à¸±à¸™à¹€à¸‰à¸žà¸²à¸° sensitive routes à¸”à¹‰à¸§à¸¢ Bearer token (`Authorization: Bearer <ORACLE_AUTH_TOKEN>`) à¹‚à¸”à¸¢à¸„à¹ˆà¸²à¹€à¸£à¸´à¹ˆà¸¡à¸•à¹‰à¸™à¸„à¸£à¸­à¸šà¸„à¸¥à¸¸à¸¡ `/api/nanoclaw/*`, `/api/logs`, `/api/user-model*`, `/api/procedural*`, `/api/episodic*`
**Compatibility:** à¸£à¸­à¸‡à¸£à¸±à¸š alias `/api/v1/*` à¹‚à¸”à¸¢ response à¹€à¸—à¸µà¸¢à¸šà¹€à¸—à¹ˆà¸² `/api/*` (à¹€à¸ªà¹‰à¸™à¸—à¸²à¸‡à¹€à¸”à¸´à¸¡à¸¢à¸±à¸‡à¹ƒà¸Šà¹‰à¹„à¸”à¹‰à¸•à¹ˆà¸­à¹€à¸™à¸·à¹ˆà¸­à¸‡)
**Request Correlation:** แนบ header X-Request-Id เพื่อ trace ข้าม service (Oracle จะ echo x-request-id กลับใน response)
**Metrics:** Prometheus endpoint คือ GET /metrics
### à¸„à¹‰à¸™à¸«à¸²à¹à¸¥à¸°à¸ªà¸­à¸šà¸–à¸²à¸¡

#### `GET /api/health`
à¸•à¸£à¸§à¸ˆà¸ªà¸­à¸šà¸ªà¸–à¸²à¸™à¸°à¸‚à¸­à¸‡ Oracle server

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
à¸„à¹‰à¸™à¸«à¸²à¸„à¸§à¸²à¸¡à¸£à¸¹à¹‰à¹ƒà¸™à¸à¸²à¸™à¸‚à¹‰à¸­à¸¡à¸¹à¸¥ Oracle à¸”à¹‰à¸§à¸¢ hybrid search (FTS + vector)

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `q` | string | âœ… | - | à¸„à¸³à¸„à¹‰à¸™à¸«à¸² / à¸„à¸³à¸–à¸²à¸¡ |
| `type` | string | âŒ | `all` | à¸›à¸£à¸°à¹€à¸ à¸—à¹€à¸­à¸à¸ªà¸²à¸£: `all`, `learning`, `decision`, `retrospective`, `resonance` |
| `limit` | number | âŒ | `10` | à¸ˆà¸³à¸™à¸§à¸™à¸œà¸¥à¸¥à¸±à¸žà¸˜à¹Œà¸ªà¸¹à¸‡à¸ªà¸¸à¸” |
| `offset` | number | âŒ | `0` | à¹€à¸£à¸´à¹ˆà¸¡à¸•à¹‰à¸™à¸ˆà¸²à¸à¸•à¸³à¹à¸«à¸™à¹ˆà¸‡à¸—à¸µà¹ˆ (pagination) |
| `mode` | string | âŒ | `hybrid` | à¹‚à¸«à¸¡à¸”à¸à¸²à¸£à¸„à¹‰à¸™à¸«à¸²: `hybrid`, `fts`, `vector` |
| `project` | string | âŒ | - | à¸à¸£à¸­à¸‡à¸•à¸²à¸¡ project (à¹€à¸Šà¹ˆà¸™ `github.com/owner/repo`) |
| `cwd` | string | âŒ | - | auto-detect project à¸ˆà¸²à¸ current working directory |
| `layer` | string | âŒ | - | à¸à¸£à¸­à¸‡à¸•à¸²à¸¡ memory layer (à¸„à¸±à¹ˆà¸™à¸”à¹‰à¸§à¸¢ comma): `userModel`, `contextModel`, `working`, `archival` |

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
      "source_file": "Ïˆ/memory/learnings/docker-basics.md",
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
à¸›à¸£à¸¶à¸à¸©à¸² Oracle à¹€à¸žà¸·à¹ˆà¸­à¸‚à¸­à¸„à¸³à¹à¸™à¸°à¸™à¸³à¹ƒà¸™à¸à¸²à¸£à¸•à¸±à¸”à¸ªà¸´à¸™à¹ƒà¸ˆ (à¸„à¹‰à¸™à¸«à¸² decisions à¸—à¸µà¹ˆà¹€à¸à¸µà¹ˆà¸¢à¸§à¸‚à¹‰à¸­à¸‡)

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | âœ… | à¸„à¸³à¸–à¸²à¸¡ / à¸ªà¸–à¸²à¸™à¸à¸²à¸£à¸“à¹Œà¸—à¸µà¹ˆà¸•à¹‰à¸­à¸‡à¸à¸²à¸£à¸›à¸£à¸¶à¸à¸©à¸² |
| `context` | string | âŒ | à¸šà¸£à¸´à¸šà¸—à¹€à¸žà¸´à¹ˆà¸¡à¹€à¸•à¸´à¸¡ |

**Response:**
```json
{
  "answer": "à¸„à¸³à¹à¸™à¸°à¸™à¸³à¸ˆà¸²à¸ Oracle...",
  "relatedDecisions": [
    {
      "id": 7,
      "title": "Use Docker for deployment",
      "decision": "à¹€à¸¥à¸·à¸­à¸à¹ƒà¸Šà¹‰ Docker",
      "relevance": 0.88
    }
  ],
  "confidenceScore": 0.85
}
```

---

#### `GET /api/reflect`
à¸ªà¸°à¸—à¹‰à¸­à¸™à¸„à¸§à¸²à¸¡à¸£à¸¹à¹‰à¸—à¸µà¹ˆ Oracle à¸¡à¸µ â€” à¹à¸ªà¸”à¸‡à¸ à¸²à¸žà¸£à¸§à¸¡ principles à¹à¸¥à¸° patterns

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

### à¹€à¸­à¸à¸ªà¸²à¸£à¹à¸¥à¸°à¸£à¸²à¸¢à¸à¸²à¸£

#### `GET /api/doc/:id`
à¸”à¸¶à¸‡à¹€à¸­à¸à¸ªà¸²à¸£à¹€à¸”à¸µà¸¢à¸§à¸•à¸²à¸¡ ID

**Path Parameters:**
- `id` (string): Document ID

**Response:**
```json
{
  "id": "doc-123",
  "type": "learning",
  "content": "Full document content...",
  "source_file": "Ïˆ/memory/learnings/example.md",
  "concepts": ["docker", "containers"],
  "project": "github.com/user/repo"
}
```

---

#### `GET /api/list`
à¹à¸ªà¸”à¸‡à¸£à¸²à¸¢à¸à¸²à¸£à¹€à¸­à¸à¸ªà¸²à¸£à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸” (pagination)

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | string | `all` | à¸à¸£à¸­à¸‡à¸•à¸²à¸¡à¸›à¸£à¸°à¹€à¸ à¸— |
| `limit` | number | `10` | à¸ˆà¸³à¸™à¸§à¸™à¸•à¹ˆà¸­à¸«à¸™à¹‰à¸² |
| `offset` | number | `0` | à¹€à¸£à¸´à¹ˆà¸¡à¸•à¹‰à¸™à¸ˆà¸²à¸à¸•à¸³à¹à¸«à¸™à¹ˆà¸‡ |
| `group` | boolean | `true` | à¸ˆà¸±à¸”à¸à¸¥à¸¸à¹ˆà¸¡à¸•à¸²à¸¡à¸›à¸£à¸°à¹€à¸ à¸— |

**Response:**
```json
{
  "documents": [
    {
      "id": "doc-1",
      "type": "learning",
      "title": "Docker basics",
      "source_file": "Ïˆ/memory/learnings/docker.md",
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
à¸­à¹ˆà¸²à¸™à¹„à¸Ÿà¸¥à¹Œà¸ˆà¸²à¸ repository (à¸£à¸­à¸‡à¸£à¸±à¸š cross-repo access à¸œà¹ˆà¸²à¸™ ghq)

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | âœ… | path à¸‚à¸­à¸‡à¹„à¸Ÿà¸¥à¹Œ (relative) |
| `project` | string | âŒ | ghq project path (à¹€à¸Šà¹ˆà¸™ `github.com/owner/repo`) |

**Response:** Plain text (à¹€à¸™à¸·à¹‰à¸­à¸«à¸²à¹„à¸Ÿà¸¥à¹Œ)

**à¸•à¸±à¸§à¸­à¸¢à¹ˆà¸²à¸‡:**
```
GET /api/file?path=README.md
GET /api/file?path=src/index.ts&project=github.com/user/other-repo
```

---

#### `GET /api/graph`
à¸ªà¸£à¹‰à¸²à¸‡ knowledge graph â€” à¹à¸ªà¸”à¸‡à¸„à¸§à¸²à¸¡à¸ªà¸±à¸¡à¸žà¸±à¸™à¸˜à¹Œà¸£à¸°à¸«à¸§à¹ˆà¸²à¸‡à¹€à¸­à¸à¸ªà¸²à¸£

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
à¹à¸ªà¸”à¸‡ context à¸‚à¸­à¸‡ project à¸›à¸±à¸ˆà¸ˆà¸¸à¸šà¸±à¸™ (auto-detect à¸ˆà¸²à¸ cwd)

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

### Dashboard à¹à¸¥à¸°à¸ªà¸–à¸´à¸•à¸´

#### `GET /api/stats`
à¸ªà¸–à¸´à¸•à¸´à¸ à¸²à¸žà¸£à¸§à¸¡à¸‚à¸­à¸‡ Oracle

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
à¸ªà¸–à¸´à¸•à¸´ search cache

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
à¸”à¸¹à¸›à¸£à¸°à¸§à¸±à¸•à¸´à¸à¸²à¸£à¸„à¹‰à¸™à¸«à¸² (search log)

**Query Parameters:**
- `limit` (number, default: 20): à¸ˆà¸³à¸™à¸§à¸™ logs

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
Dashboard summary â€” à¸ªà¸£à¸¸à¸›à¸ à¸²à¸žà¸£à¸§à¸¡à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸”

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
à¸à¸´à¸ˆà¸à¸£à¸£à¸¡à¸¢à¹‰à¸­à¸™à¸«à¸¥à¸±à¸‡ (searches, learnings, consults)

**Query Parameters:**
- `days` (number, default: 7): à¸ˆà¸³à¸™à¸§à¸™à¸§à¸±à¸™à¸¢à¹‰à¸­à¸™à¸«à¸¥à¸±à¸‡

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
à¹à¸™à¸§à¹‚à¸™à¹‰à¸¡à¸à¸²à¸£à¹€à¸•à¸´à¸šà¹‚à¸•à¸‚à¸­à¸‡ knowledge base

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
à¸ªà¸–à¸´à¸•à¸´à¸à¸²à¸£à¹ƒà¸Šà¹‰à¸‡à¸²à¸™à¹ƒà¸™ session (24 à¸Šà¸¡. à¸¥à¹ˆà¸²à¸ªà¸¸à¸”)

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

### Threads (à¸šà¸—à¸ªà¸™à¸—à¸™à¸²)

#### `GET /api/threads`
à¹à¸ªà¸”à¸‡à¸£à¸²à¸¢à¸à¸²à¸£ threads à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸”

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | - | à¸à¸£à¸­à¸‡à¸•à¸²à¸¡à¸ªà¸–à¸²à¸™à¸°: `open`, `closed`, `archived` |
| `limit` | number | `20` | à¸ˆà¸³à¸™à¸§à¸™à¸•à¹ˆà¸­à¸«à¸™à¹‰à¸² |
| `offset` | number | `0` | à¹€à¸£à¸´à¹ˆà¸¡à¸•à¹‰à¸™à¸ˆà¸²à¸à¸•à¸³à¹à¸«à¸™à¹ˆà¸‡ |

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
à¸ªà¸£à¹‰à¸²à¸‡ thread à¹ƒà¸«à¸¡à¹ˆ à¸«à¸£à¸·à¸­à¸ªà¹ˆà¸‡à¸‚à¹‰à¸­à¸„à¸§à¸²à¸¡à¹ƒà¸™ thread à¸—à¸µà¹ˆà¸¡à¸µà¸­à¸¢à¸¹à¹ˆ

**Request Body:**
```json
{
  "message": "How do I optimize Docker builds?",
  "thread_id": 42,  // Optional: à¸–à¹‰à¸²à¹„à¸¡à¹ˆà¸£à¸°à¸šà¸¸ = à¸ªà¸£à¹‰à¸²à¸‡ thread à¹ƒà¸«à¸¡à¹ˆ
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
à¸”à¸¶à¸‡à¸‚à¹‰à¸­à¸¡à¸¹à¸¥ thread à¸žà¸£à¹‰à¸­à¸¡à¸‚à¹‰à¸­à¸„à¸§à¸²à¸¡à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸”

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
à¸­à¸±à¸›à¹€à¸”à¸•à¸ªà¸–à¸²à¸™à¸°à¸‚à¸­à¸‡ thread

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

### Decisions (à¸à¸²à¸£à¸•à¸±à¸”à¸ªà¸´à¸™à¹ƒà¸ˆ)

#### `GET /api/decisions`
à¹à¸ªà¸”à¸‡à¸£à¸²à¸¢à¸à¸²à¸£ decisions (ADR - Architecture Decision Records)

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | à¸à¸£à¸­à¸‡à¸•à¸²à¸¡à¸ªà¸–à¸²à¸™à¸°: `proposed`, `accepted`, `rejected`, `superseded` |
| `project` | string | à¸à¸£à¸­à¸‡à¸•à¸²à¸¡ project |
| `tags` | string | à¸à¸£à¸­à¸‡à¸•à¸²à¸¡ tags (à¸„à¸±à¹ˆà¸™à¸”à¹‰à¸§à¸¢ comma) |
| `limit` | number | à¸ˆà¸³à¸™à¸§à¸™à¸•à¹ˆà¸­à¸«à¸™à¹‰à¸² (default: 20) |
| `offset` | number | à¹€à¸£à¸´à¹ˆà¸¡à¸•à¹‰à¸™à¸ˆà¸²à¸à¸•à¸³à¹à¸«à¸™à¹ˆà¸‡ |

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
à¸”à¸¶à¸‡à¸‚à¹‰à¸­à¸¡à¸¹à¸¥ decision à¹€à¸”à¸µà¸¢à¸§

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
à¸ªà¸£à¹‰à¸²à¸‡ decision à¹ƒà¸«à¸¡à¹ˆ

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
à¸­à¸±à¸›à¹€à¸”à¸• decision

**Path Parameters:**
- `id` (number): Decision ID

**Request Body:** (à¸—à¸¸à¸à¸Ÿà¸´à¸¥à¸”à¹Œ optional)
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
à¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™à¸ªà¸–à¸²à¸™à¸°à¸‚à¸­à¸‡ decision (state machine)

**Path Parameters:**
- `id` (number): Decision ID

**Request Body:**
```json
{
  "status": "accepted",  // "proposed" â†’ "accepted" | "rejected"
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

à¸£à¸°à¸šà¸šà¸•à¸´à¸”à¸•à¸²à¸¡à¹€à¸­à¸à¸ªà¸²à¸£à¸—à¸µà¹ˆà¸–à¸¹à¸à¹à¸—à¸™à¸—à¸µà¹ˆ (versioning, deprecation)

#### `GET /api/supersede`
à¹à¸ªà¸”à¸‡à¸£à¸²à¸¢à¸à¸²à¸£ supersessions

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `project` | string | - | à¸à¸£à¸­à¸‡à¸•à¸²à¸¡ project |
| `limit` | number | `50` | à¸ˆà¸³à¸™à¸§à¸™à¸•à¹ˆà¸­à¸«à¸™à¹‰à¸² |
| `offset` | number | `0` | à¹€à¸£à¸´à¹ˆà¸¡à¸•à¹‰à¸™à¸ˆà¸²à¸à¸•à¸³à¹à¸«à¸™à¹ˆà¸‡ |

**Response:**
```json
{
  "supersessions": [
    {
      "id": 23,
      "old_path": "Ïˆ/memory/learnings/docker-v1.md",
      "old_id": "doc-100",
      "old_title": "Docker basics",
      "old_type": "learning",
      "new_path": "Ïˆ/memory/learnings/docker-v2.md",
      "new_id": "doc-150",
      "new_title": "Docker advanced guide",
      "reason": "Outdated â€” updated to latest practices",
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
à¹à¸ªà¸”à¸‡ chain à¸‚à¸­à¸‡à¹€à¸­à¸à¸ªà¸²à¸£ (à¸§à¹ˆà¸²à¸–à¸¹à¸à¹à¸—à¸™à¸—à¸µà¹ˆà¹‚à¸”à¸¢à¸­à¸°à¹„à¸£ / à¹à¸—à¸™à¸—à¸µà¹ˆà¸­à¸°à¹„à¸£)

**Path Parameters:**
- `path` (string, URL-encoded): Document path

**Response:**
```json
{
  "superseded_by": [
    {
      "new_path": "Ïˆ/memory/learnings/docker-v2.md",
      "reason": "Updated content",
      "superseded_at": "2026-02-18T10:00:00Z"
    }
  ],
  "supersedes": [
    {
      "old_path": "Ïˆ/memory/learnings/docker-beta.md",
      "reason": "Stable version released",
      "superseded_at": "2026-01-15T08:00:00Z"
    }
  ]
}
```

---

#### `POST /api/supersede`
à¸šà¸±à¸™à¸—à¸¶à¸ supersession à¹ƒà¸«à¸¡à¹ˆ

**Request Body:**
```json
{
  "old_path": "Ïˆ/memory/learnings/old-doc.md",
  "old_id": "doc-100",
  "old_title": "Old title",
  "old_type": "learning",
  "new_path": "Ïˆ/memory/learnings/new-doc.md",
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

**Note:** à¸à¸²à¸£à¸šà¸±à¸™à¸—à¸¶à¸ supersession à¸ˆà¸° invalidate search cache à¹‚à¸”à¸¢à¸­à¸±à¸•à¹‚à¸™à¸¡à¸±à¸•à¸´

---

### Traces (à¸à¸²à¸£à¸ªà¸³à¸£à¸§à¸ˆ)

Trace = à¸šà¸±à¸™à¸—à¸¶à¸à¸à¸²à¸£à¹€à¸”à¸´à¸™à¸—à¸²à¸‡à¸„à¹‰à¸™à¸žà¸šà¸„à¸§à¸²à¸¡à¸£à¸¹à¹‰ (discovery journey)

#### `GET /api/traces`
à¹à¸ªà¸”à¸‡à¸£à¸²à¸¢à¸à¸²à¸£ traces

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | à¸à¸£à¸­à¸‡à¸•à¸²à¸¡à¸„à¸³à¸„à¹‰à¸™à¸«à¸² |
| `status` | string | `raw`, `reviewed`, `distilled` |
| `project` | string | à¸à¸£à¸­à¸‡à¸•à¸²à¸¡ project |
| `limit` | number | à¸ˆà¸³à¸™à¸§à¸™à¸•à¹ˆà¸­à¸«à¸™à¹‰à¸² (default: 50) |
| `offset` | number | à¹€à¸£à¸´à¹ˆà¸¡à¸•à¹‰à¸™à¸ˆà¸²à¸à¸•à¸³à¹à¸«à¸™à¹ˆà¸‡ |

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
à¸”à¸¶à¸‡à¸‚à¹‰à¸­à¸¡à¸¹à¸¥ trace à¹€à¸”à¸µà¸¢à¸§

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
à¸”à¸¶à¸‡ trace chain (à¸•à¹‰à¸™à¸™à¹‰à¸³-à¸›à¸¥à¸²à¸¢à¸™à¹‰à¸³)

**Path Parameters:**
- `id` (string): Trace ID

**Query Parameters:**
- `direction` (string): `up` | `down` | `both` (default: `both`)

**Response:**
```json
{
  "upstream": [ /* traces à¸—à¸µà¹ˆà¸¡à¸²à¸à¹ˆà¸­à¸™ */ ],
  "current": { /* trace à¸›à¸±à¸ˆà¸ˆà¸¸à¸šà¸±à¸™ */ },
  "downstream": [ /* traces à¸—à¸µà¹ˆà¸•à¸²à¸¡à¸¡à¸² */ ]
}
```

---

#### `POST /api/traces/:prevId/link`
à¹€à¸Šà¸·à¹ˆà¸­à¸¡ trace à¹€à¸‚à¹‰à¸²à¸”à¹‰à¸§à¸¢à¸à¸±à¸™ (à¸ªà¸£à¹‰à¸²à¸‡ linked chain)

**Path Parameters:**
- `prevId` (string): Trace ID à¸à¹ˆà¸­à¸™à¸«à¸™à¹‰à¸²

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
à¸¢à¸à¹€à¸¥à¸´à¸à¸à¸²à¸£à¹€à¸Šà¸·à¹ˆà¸­à¸¡ trace

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
à¸”à¸¶à¸‡ linked chain à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸”à¸‚à¸­à¸‡ trace (à¹à¸šà¸šà¹€à¸Šà¸·à¹ˆà¸­à¸¡à¹‚à¸¢à¸‡à¸œà¹ˆà¸²à¸™ linkedPrevId/linkedNextId)

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

Phase 4 (v0.7.0) â€” à¹€à¸¥à¹€à¸¢à¸­à¸£à¹Œà¸«à¸™à¹ˆà¸§à¸¢à¸„à¸§à¸²à¸¡à¸ˆà¸³à¹à¸šà¸šà¸¥à¸³à¸”à¸±à¸šà¸Šà¸±à¹‰à¸™

#### `GET /api/user-model`
à¸”à¸¶à¸‡à¸‚à¹‰à¸­à¸¡à¸¹à¸¥ User Model (Layer 1) â€” à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹€à¸à¸µà¹ˆà¸¢à¸§à¸à¸±à¸šà¸œà¸¹à¹‰à¹ƒà¸Šà¹‰

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

**Base URL:** `http://nanoclaw:47779` (à¹ƒà¸™ Docker network) à¸«à¸£à¸·à¸­ `http://localhost:47779`  
**Note:** NanoClaw health API à¹„à¸¡à¹ˆà¸•à¹‰à¸­à¸‡ authentication (internal network only)

### Health à¹à¸¥à¸° Status

#### `GET /health`
à¸•à¸£à¸§à¸ˆà¸ªà¸­à¸šà¸ªà¸–à¸²à¸™à¸°à¸‚à¸­à¸‡ NanoClaw orchestrator

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
- `uptime`: à¸ˆà¸³à¸™à¸§à¸™à¸§à¸´à¸™à¸²à¸—à¸µà¸—à¸µà¹ˆà¸—à¸³à¸‡à¸²à¸™
- `version`: NanoClaw version

---

#### `GET /status`
à¸ªà¸–à¸²à¸™à¸°à¹‚à¸”à¸¢à¸¥à¸°à¹€à¸­à¸µà¸¢à¸” â€” containers, queue, resources

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
- `activeContainers`: à¸ˆà¸³à¸™à¸§à¸™ agent containers à¸—à¸µà¹ˆà¸à¸³à¸¥à¸±à¸‡à¸—à¸³à¸‡à¸²à¸™
- `queueDepth`: à¸ˆà¸³à¸™à¸§à¸™à¸‡à¸²à¸™à¸—à¸µà¹ˆà¸£à¸­à¸„à¸´à¸§
- `registeredGroups`: à¸£à¸²à¸¢à¸Šà¸·à¹ˆà¸­ groups à¸—à¸µà¹ˆà¸¥à¸‡à¸—à¸°à¹€à¸šà¸µà¸¢à¸™ (Telegram/WhatsApp)
- `resources`: à¸ªà¸–à¸²à¸™à¸° CPU à¹à¸¥à¸° memory
  - `currentMax`: concurrency limit à¸›à¸±à¸ˆà¸ˆà¸¸à¸šà¸±à¸™ (à¸›à¸£à¸±à¸šà¸­à¸±à¸•à¹‚à¸™à¸¡à¸±à¸•à¸´à¸•à¸²à¸¡ load)
  - `cpuUsage`: % à¸à¸²à¸£à¹ƒà¸Šà¹‰ CPU (1-min load average)
  - `memoryFree`: % memory à¸§à¹ˆà¸²à¸‡
- `recentErrors`: à¸‚à¹‰à¸­à¸œà¸´à¸”à¸žà¸¥à¸²à¸” 20 à¸£à¸²à¸¢à¸à¸²à¸£à¸¥à¹ˆà¸²à¸ªà¸¸à¸” (circular buffer)

---

## Error Handling

### HTTP Status Codes

| Code | Meaning | à¸•à¸±à¸§à¸­à¸¢à¹ˆà¸²à¸‡ |
|------|---------|----------|
| 200 | OK | à¸ªà¸³à¹€à¸£à¹‡à¸ˆ |
| 201 | Created | à¸ªà¸£à¹‰à¸²à¸‡à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸ªà¸³à¹€à¸£à¹‡à¸ˆ |
| 400 | Bad Request | à¸‚à¹‰à¸­à¸¡à¸¹à¸¥ request à¹„à¸¡à¹ˆà¸–à¸¹à¸à¸•à¹‰à¸­à¸‡ |
| 401 | Unauthorized | à¹„à¸¡à¹ˆà¸¡à¸µ auth token à¸«à¸£à¸·à¸­ token à¹„à¸¡à¹ˆà¸–à¸¹à¸à¸•à¹‰à¸­à¸‡ |
| 404 | Not Found | à¹„à¸¡à¹ˆà¸žà¸šà¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸—à¸µà¹ˆà¸£à¹‰à¸­à¸‡à¸‚à¸­ |
| 500 | Internal Server Error | à¹€à¸à¸´à¸”à¸‚à¹‰à¸­à¸œà¸´à¸”à¸žà¸¥à¸²à¸”à¸ à¸²à¸¢à¹ƒà¸™ server |

### Error Response Format

```json
{
  "error": "à¸£à¸²à¸¢à¸¥à¸°à¹€à¸­à¸µà¸¢à¸”à¸‚à¹‰à¸­à¸œà¸´à¸”à¸žà¸¥à¸²à¸”"
}
```

---

## Authentication (Oracle Sensitive Routes)

Sensitive routes à¸•à¹‰à¸­à¸‡à¸à¸²à¸£ Bearer token:

```bash
curl -H "Authorization: Bearer YOUR_ORACLE_AUTH_TOKEN" \
  http://oracle:47778/api/logs?limit=10
```

**Environment Variable:** `ORACLE_AUTH_TOKEN`  
Read routes (à¹€à¸Šà¹ˆà¸™ `/api/search`, `/api/consult`, `/api/list`) à¸¢à¸±à¸‡à¹ƒà¸Šà¹‰à¸‡à¸²à¸™à¹„à¸”à¹‰à¹‚à¸”à¸¢à¹„à¸¡à¹ˆà¹à¸™à¸š token à¹ƒà¸™ trusted internal network

NanoClaw health API à¹„à¸¡à¹ˆà¸•à¹‰à¸­à¸‡ authentication (internal only)

---

## à¸•à¸±à¸§à¸­à¸¢à¹ˆà¸²à¸‡à¸à¸²à¸£à¹ƒà¸Šà¹‰à¸‡à¸²à¸™

### à¸„à¹‰à¸™à¸«à¸²à¸„à¸§à¸²à¸¡à¸£à¸¹à¹‰à¹€à¸à¸µà¹ˆà¸¢à¸§à¸à¸±à¸š Docker
```bash
curl "http://oracle:47778/api/search?q=docker&limit=5&mode=hybrid" \
  -H "Authorization: Bearer $ORACLE_AUTH_TOKEN"
```

### à¸ªà¸£à¹‰à¸²à¸‡ Decision à¹ƒà¸«à¸¡à¹ˆ
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

### à¸ªà¹ˆà¸‡à¸‚à¹‰à¸­à¸„à¸§à¸²à¸¡à¹ƒà¸™ Thread
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

### à¸•à¸£à¸§à¸ˆà¸ªà¸­à¸šà¸ªà¸–à¸²à¸™à¸° NanoClaw
```bash
curl "http://nanoclaw:47779/status"
```

---

## Changelog

### v0.8.0 (2026-02-18)
- âœ… à¹€à¸žà¸´à¹ˆà¸¡ typing interval TTL (auto-expire after 5 min)
- âœ… Fix orphan container cleanup on shutdown
- âœ… à¹€à¸žà¸´à¹ˆà¸¡ `stop_grace_period` à¹ƒà¸™ docker-compose

### v0.7.1 (2026-02-01)
- âœ… Memory reliability improvements
- âœ… Cache optimization

### v0.7.0 (2026-01-15)
- âœ… Memory Layers (Phase 4)
- âœ… Trace linking API
- âœ… Layer filtering in search

### v0.6.0 (2025-12-20)
- âœ… Performance optimization
- âœ… Query router

---

## Support

- **Documentation:** [docs/](../docs/)
- **GitHub Issues:** [JellyCore Issues](https://github.com/b9b4ymiN/JellyCore/issues)
- **à¸„à¸³à¸–à¸²à¸¡:** à¸–à¸²à¸¡ Oracle à¸œà¹ˆà¸²à¸™ Telegram bot à¸«à¸£à¸·à¸­ API `/api/consult`

---

**à¸ªà¸£à¹‰à¸²à¸‡à¹‚à¸”à¸¢:** JellyCore Team  
**License:** MIT


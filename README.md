# JellyCore

<p align="center">
  <strong>🪼 Self-hosted Personal AI Platform</strong><br>
  ระบบ AI ส่วนตัวที่รันบน Docker — มี memory ถาวร, ค้นหาความรู้แบบ hybrid, รองรับภาษาไทย + อังกฤษ
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.6.0-blue" alt="v0.6.0">
  <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen" alt="Node.js 22+">
  <img src="https://img.shields.io/badge/bun-%3E%3D1.2-orange" alt="Bun 1.2+">
  <img src="https://img.shields.io/badge/docker-compose%20v2-blue" alt="Docker Compose v2">
  <img src="https://img.shields.io/badge/license-private-lightgrey" alt="Private">
</p>

## Overview

JellyCore เป็นแพลตฟอร์ม AI ส่วนตัวแบบ production-ready ที่รวม 4 services ในชุด Docker Compose เดียว:

| Service | Role | Tech |
|---------|------|------|
| **NanoClaw** | AI orchestrator — routes messages, spawns agent containers, manages queues | Node.js 22, TypeScript, grammY |
| **Oracle V2** | Knowledge engine — adaptive hybrid search (FTS5 + vector), bilingual chunking | Bun, SQLite, Drizzle ORM, Hono.js |
| **ChromaDB** | Vector database — semantic similarity search with token auth | ChromaDB 0.4.24 |
| **Thai NLP** | Thai language sidecar — tokenization, normalization, spellcheck | Python, PyThaiNLP, FastAPI |

```
┌──────────────────────────────────────────────────────────────┐
│                        JellyCore v0.6.0                      │
│                                                              │
│  ┌──────────┐    ┌──────────────┐    ┌────────────────────┐  │
│  │ Telegram │───▶│   NanoClaw   │───▶│  Agent Container   │  │
│  │   Bot    │◀───│ (Orchestrator)│◀───│  (Claude Code)     │  │
│  └──────────┘    └──────┬───────┘    └────────────────────┘  │
│                         │                                     │
│                         │ HTTP API                            │
│                         ▼                                     │
│  ┌───────────┐   ┌──────────────┐    ┌───────────────┐       │
│  │ Thai NLP  │◀──│  Oracle V2   │───▶│   ChromaDB    │       │
│  │ (Sidecar) │──▶│  (Knowledge) │    │   (Vectors)   │       │
│  └───────────┘   └──────────────┘    └───────────────┘       │
└──────────────────────────────────────────────────────────────┘
```

## Features

### Core Platform
- **Docker-in-Docker Agent Execution** — แต่ละ task รันใน container แยก พร้อม Claude Code instance ของตัวเอง
- **Telegram Bot** — MarkdownV2 formatted responses, อัตโนมัติ fallback เป็น plain text
- **Group-based Agent Profiles** — system prompts, tools, permissions ตั้งค่าแยกตาม group
- **Agent Swarms** — สร้างทีม AI agents ที่ทำงานร่วมกันในบทสนทนาเดียว
- **Scheduled Tasks** — Cron-based scheduling ผ่าน NanoClaw

### Search Intelligence (v0.6.0)
- **Adaptive Hybrid Search** — วิเคราะห์ query type (exact/semantic/mixed) แล้วปรับ FTS5 vs Vector weight อัตโนมัติ
- **Quality Correction** — วัด search result quality แล้ว override classifier ถ้าผิด (dampened priors + relevance metric)
- **Pluggable Embedding Models** — สลับ embedding model ได้ทันที (default: all-MiniLM-L6-v2, option: multilingual-e5-small)
- **Bilingual Smart Chunking** — overlap chunking (400 tokens, 80 overlap) รองรับทั้งไทยและอังกฤษ
- **Thai NLP Pipeline** — tokenization, normalization, spellcheck ครบทุก path (search, learn, index)

### Knowledge Engine
- **Hybrid Search** — FTS5 (BM25) + ChromaDB (cosine similarity) → RRF merge
- **Client-side Embeddings** — all-MiniLM-L6-v2 (384-dim) คำนวณใน Oracle, ไม่ต้องใช้ GPU
- **Embedding Versioning** — ติดตาม model + content hash, skip re-embed ถ้าไม่เปลี่ยน
- **19 MCP Tools** — search, learn, consult, index, และอื่นๆ

### Security & Operations
- **IPC Integrity Signing** — HMAC-signed communication ระหว่าง orchestrator กับ containers
- **Encrypted Auth Storage** — session data เข้ารหัสที่ rest
- **Production-ready** — Docker Compose with health checks, memory limits, auto-restart, named volumes

## Prerequisites

- **Docker Desktop** (Windows/macOS) or **Docker Engine** (Linux)
- **Docker Compose** v2+
- **Git**
- API key สำหรับ Anthropic-compatible endpoint (e.g., [Z.AI](https://z.ai))
- Telegram Bot Token (จาก [@BotFather](https://t.me/BotFather))

## Quick Start

### 1. Clone

```bash
git clone https://github.com/b9b4ymiN/JellyCore.git
cd jellycore
```

### 2. Configure Environment

```bash
cp .env.example .env
```

แก้ไข `.env`:

```dotenv
# Required
ANTHROPIC_API_KEY=your-api-key
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
JELLYCORE_AUTH_PASSPHRASE=min-16-char-passphrase

# Auto-generated if left empty
CHROMA_AUTH_TOKEN=
ORACLE_AUTH_TOKEN=

# Optional
ASSISTANT_NAME=Andy
TZ=Asia/Bangkok
EMBEDDING_MODEL=all-MiniLM-L6-v2    # or multilingual-e5-small for Thai
```

### 3. Build the Agent Container Image

```bash
docker build -t nanoclaw-agent:latest -f nanoclaw/container/Dockerfile nanoclaw/container
```

### 4. Start Services

```bash
docker compose up -d --build
```

Services ที่เริ่มทำงาน:
- **Thai NLP** — Thai language sidecar (internal)
- **ChromaDB** — vector DB (internal)
- **Oracle V2** — knowledge API บน `localhost:47778`
- **NanoClaw** — Telegram bot (long-polling)

### 5. Verify

```bash
# ตรวจสอบว่าทุก service healthy
docker compose ps

# ตรวจสอบ Oracle health
curl http://localhost:47778/api/health

# ดู logs
docker compose logs -f nanoclaw
```

## Project Structure

```
jellycore/
├── nanoclaw/                       # AI orchestrator (Body)
│   ├── src/
│   │   ├── index.ts                #   Main entry — state, message loop
│   │   ├── channels/               #   Telegram & WhatsApp adapters
│   │   ├── container-runner.ts     #   Docker-in-Docker agent spawner
│   │   ├── group-queue.ts          #   Per-group message queue
│   │   ├── task-scheduler.ts       #   Cron-based scheduling
│   │   └── ipc.ts                  #   IPC watcher & signing
│   └── container/                  #   Agent container image
│       ├── Dockerfile              #     Multi-stage: Node + Chromium + Claude Code
│       └── agent-runner/           #     Agent entrypoint & MCP bridges
├── oracle-v2/                      # Knowledge engine (Brain)
│   ├── src/
│   │   ├── server.ts               #   HTTP API (Hono.js, 19 MCP tools)
│   │   ├── indexer.ts              #   Batch indexer + Thai NLP + chunking
│   │   ├── embedder.ts             #   Pluggable embedding interface
│   │   ├── chunker.ts              #   Bilingual smart chunker (overlap)
│   │   ├── query-classifier.ts     #   Adaptive search query analysis
│   │   ├── chroma-http.ts          #   ChromaDB client (client-side embeddings)
│   │   ├── thai-nlp-client.ts      #   Thai NLP sidecar client
│   │   ├── embedding-cache.ts      #   Embedding versioning & cache
│   │   ├── db/                     #   Drizzle ORM schema & migrations
│   │   └── server/                 #   Handlers, dashboard, logging
│   ├── frontend/                   #   React dashboard (Vite)
│   ├── scripts/                    #   Migration & utility scripts
│   └── ψ/memory/                   #   Knowledge base (markdown files)
├── thai-nlp-sidecar/               # Thai language processing
│   └── ...                         #   FastAPI + PyThaiNLP
├── groups/                         # Agent group workspaces
│   ├── global/CLAUDE.md            #   Shared system prompt
│   └── main/CLAUDE.md              #   Default group config
├── docs/                           # Documentation
│   ├── DEPLOYMENT.md               #   Linux VPS deployment guide
│   ├── QUICKSTART.md               #   Local development guide
│   ├── v0.6.0-phase1-performance.md #  Phase 1 implementation plan
│   └── MASTER_PLAN/                #   Phased architecture roadmap
├── docker-compose.yml              # Development stack (4 services)
├── docker-compose.production.yml   # Production stack
├── Dockerfile.nanoclaw             # NanoClaw multi-stage build
└── README.md
```

## Architecture Details

### Message Flow

1. User ส่งข้อความผ่าน **Telegram**
2. **NanoClaw** รับข้อความ, จัดคิว request
3. NanoClaw สร้าง **agent container** (Docker-in-Docker)
4. Agent รัน Claude Code, เรียก tools, query Oracle
5. Agent output ส่งกลับผ่าน IPC (stdout markers)
6. Response ถูก format เป็น **Telegram MarkdownV2** แล้วส่งกลับ

### Knowledge Engine (Oracle V2)

Oracle ให้บริการ hybrid search ที่รวม:
- **SQLite FTS5** — full-text search with BM25 ranking (Thai-segmented via PyThaiNLP)
- **ChromaDB** — semantic vector search (cosine similarity, client-side embeddings)
- **Adaptive RRF Merge** — ปรับ weight ตาม query type + quality correction

Knowledge จัดเก็บใน:
- `ψ/memory/learnings/` — ข้อมูลและ insight ที่ AI ค้นพบ
- `ψ/memory/resonance/` — patterns และ principles
- `ψ/memory/retrospectives/` — session reflections

#### Search Pipeline (v0.6.0)

```
Query → Thai NLP Preprocessing → Query Classification
                                      │
                              ┌───────┴───────┐
                              ▼               ▼
                          FTS5 Search    Vector Search
                          (BM25)        (ChromaDB)
                              │               │
                              └───────┬───────┘
                                      ▼
                            Quality Correction
                            (measure + adjust)
                                      │
                                      ▼
                            Adaptive RRF Merge
                            (weighted by type)
                                      │
                                      ▼
                              Final Results
```

#### Indexing Pipeline (v0.6.0)

```
Markdown Files → Parse (headers/sections) → Smart Chunking
                                                  │
                                          ┌───────┴───────┐
                                          ▼               ▼
                                    Thai Chunks      English Chunks
                                   (via sidecar)    (via regex split)
                                          │               │
                                          └───────┬───────┘
                                                  ▼
                                    Thai NLP Segmentation (FTS5)
                                    Embedding Cache Check
                                          │
                                  ┌───────┴───────┐
                                  ▼               ▼
                              SQLite FTS5    ChromaDB Vectors
                            (segmented)     (skip if unchanged)
```

### Agent Containers

แต่ละ agent รันใน Docker container แยก พร้อม:
- Claude Code CLI
- MCP-HTTP bridge ไปยัง Oracle
- Group-specific system prompts และ tools
- Memory-limited execution with timeout
- Network access จำกัดเฉพาะ `jellycore-internal`

## Configuration

### Agent Groups

สร้าง agent profiles ใน `groups/<group-name>/CLAUDE.md`:

```markdown
# Agent Name

You are a specialized assistant for...

## Tools
- Oracle knowledge search
- File operations
- Web browsing
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | — | API key สำหรับ Anthropic-compatible endpoint |
| `TELEGRAM_BOT_TOKEN` | Yes | — | Telegram bot token จาก BotFather |
| `JELLYCORE_AUTH_PASSPHRASE` | Yes | — | Auth encryption passphrase (อย่างน้อย 16 ตัวอักษร) |
| `ANTHROPIC_BASE_URL` | No | — | Custom API endpoint (e.g., `https://api.z.ai/api/anthropic`) |
| `CHROMA_AUTH_TOKEN` | No | auto | ChromaDB authentication token |
| `ORACLE_AUTH_TOKEN` | No | auto | Oracle HTTP API auth token |
| `EMBEDDING_MODEL` | No | `all-MiniLM-L6-v2` | Embedding model (`all-MiniLM-L6-v2` หรือ `multilingual-e5-small`) |
| `ASSISTANT_NAME` | No | Andy | ชื่อ Bot |
| `CONTAINER_IMAGE` | No | `nanoclaw-agent:latest` | Agent container image |
| `CONTAINER_TIMEOUT` | No | 1800000 | Container timeout (ms, default 30 นาที) |
| `MAX_CONCURRENT_CONTAINERS` | No | 5 | จำนวน agent containers สูงสุดที่รันพร้อมกัน |
| `TZ` | No | `Asia/Bangkok` | Timezone |

### Embedding Model Options

| Model | Dimensions | Thai Support | Size | Best For |
|-------|-----------|-------------|------|----------|
| `all-MiniLM-L6-v2` | 384 | ★★☆☆☆ | ~23MB | Default, English-primary workloads |
| `multilingual-e5-small` | 384 | ★★★★☆ | ~120MB | Thai + multilingual, ARM64 compatible |

เปลี่ยน model โดยตั้ง `EMBEDDING_MODEL` ใน `.env` แล้วรัน:
```bash
cd oracle-v2 && bun run re-embed
```

## Deployment

### Docker Compose (Recommended)

```bash
# Development
docker compose up -d --build

# Production
docker compose -f docker-compose.production.yml up -d --build
```

### PM2 (Alternative)

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save && pm2 startup
```

ดูรายละเอียดเพิ่มเติมที่ [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## Development

### Local Setup

```bash
# Oracle V2
cd oracle-v2
bun install
bun run src/server.ts

# NanoClaw
cd nanoclaw
npm install
npx tsc
node dist/index.js
```

### Indexing Knowledge

```bash
# Index ψ/memory/ ทั้งหมดเข้า Oracle (with Thai NLP + smart chunking)
curl -X POST http://localhost:47778/api/index
```

### Running Tests

```bash
cd oracle-v2
bun test                              # ทุก test
bun test src/query-classifier.test.ts # Query classifier tests
bun test src/chunker.test.ts          # Smart chunker tests
```

ดูรายละเอียดเพิ่มเติมที่ [docs/QUICKSTART.md](docs/QUICKSTART.md)

## Version History

| Version | Highlights |
|---------|-----------|
| **v0.6.0** | Adaptive Hybrid Search, Pluggable Embedder, Bilingual Smart Chunking, Thai NLP Indexer |
| **v0.5.0** | Thai NLP Sidecar (PyThaiNLP), Embedding Versioning, Docker 4-service stack |
| **v0.4.0** | ChromaDB dual indexing, Hybrid FTS5 + Vector search, Oracle V2 foundation |

## Roadmap

ดูรายละเอียดที่ [docs/MASTER_PLAN/](docs/MASTER_PLAN/):

| Phase | Focus | Status |
|-------|-------|--------|
| Phase 0 | Security Foundation | ✅ Complete |
| Phase 1 | Performance & Search Intelligence | ✅ Complete (v0.6.0) |
| Phase 2 | Architecture Hardening | 📋 Planned |
| Phase 3 | Reliability & Resilience | 📋 Planned |
| Phase 4 | Integration & Channels | 🔄 In Progress |
| Phase 5 | Production Polish | 📋 Planned |

## License

Private project. All rights reserved.

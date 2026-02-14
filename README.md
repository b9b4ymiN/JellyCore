# JellyCore

**Self-hosted Personal AI Platform** — An autonomous AI assistant that runs in Docker containers with persistent memory, knowledge retrieval, and multi-channel messaging.

---

## Overview

JellyCore is a production-ready personal AI platform that combines three core services into a unified Docker Compose stack:

| Service | Role | Tech |
|---------|------|------|
| **NanoClaw** | AI orchestrator — routes messages, spawns agent containers, manages queues | Node.js 22, TypeScript, grammY |
| **Oracle V2** | Knowledge engine — hybrid search (FTS5 + vector), learning persistence | Bun, SQLite, Drizzle ORM |
| **ChromaDB** | Vector database — semantic similarity search with token auth | ChromaDB 0.4.24 |

```
┌─────────────────────────────────────────────────────────┐
│                      JellyCore                          │
│                                                         │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │ Telegram │───▶│   NanoClaw   │───▶│ Agent Container│  │
│  │   Bot    │◀───│ (Orchestrator)│◀───│ (Claude Code) │  │
│  └──────────┘    └──────┬───────┘    └───────────────┘  │
│                         │                                │
│                         │ HTTP API                       │
│                         ▼                                │
│                  ┌──────────────┐    ┌───────────────┐  │
│                  │  Oracle V2   │───▶│   ChromaDB    │  │
│                  │  (Knowledge) │    │   (Vectors)   │  │
│                  └──────────────┘    └───────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Features

- **Docker-in-Docker Agent Execution** — Each AI task runs in an isolated container with its own Claude Code instance
- **Persistent Knowledge Engine** — Oracle V2 indexes learnings, resonance patterns, and retrospectives with hybrid FTS5 + ChromaDB vector search
- **Client-side Embeddings** — all-MiniLM-L6-v2 (384-dim) computed by Oracle, no GPU required
- **Telegram Bot** — MarkdownV2 formatted responses with automatic fallback to plain text
- **Group-based Agent Profiles** — Customizable system prompts, tools, and permissions per agent group
- **Agent Swarms** — Spin up teams of collaborating AI agents in a single conversation
- **Scheduled Tasks** — Cron-based task scheduling via NanoClaw
- **IPC Integrity Signing** — HMAC-signed communication between orchestrator and containers
- **Encrypted Auth Storage** — WhatsApp/Telegram session data encrypted at rest
- **Production-ready** — Docker Compose with health checks, memory limits, auto-restart, and named volumes

## Prerequisites

- **Docker Desktop** (Windows/macOS) or **Docker Engine** (Linux)
- **Docker Compose** v2+
- **Git**
- API key for an Anthropic-compatible endpoint (e.g., [Z.AI](https://z.ai))
- Telegram Bot Token (via [@BotFather](https://t.me/BotFather))

## Quick Start

### 1. Clone

```bash
git clone --recurse-submodules https://github.com/<your-org>/jellycore.git
cd jellycore
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

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
```

### 3. Build the Agent Container Image

```bash
docker build -t nanoclaw-agent:latest -f nanoclaw/container/Dockerfile nanoclaw/container
```

### 4. Start Services

```bash
docker compose up -d --build
```

This starts all three services:
- **ChromaDB** — internal vector DB (no exposed port)
- **Oracle V2** — knowledge API on `localhost:47778`
- **NanoClaw** — Telegram bot (long-polling, no exposed port needed)

### 5. Verify

```bash
# Check all services are healthy
docker compose ps

# Check Oracle health
curl http://localhost:47778/api/health

# Check logs
docker compose logs -f nanoclaw
```

## Project Structure

```
jellycore/
├── nanoclaw/                  # AI orchestrator (Git submodule)
│   └── src/
│       ├── channels/          # Telegram, WhatsApp adapters
│       ├── core/              # Queue, container runner, scheduler
│       └── container/         # Agent container Dockerfile & config
├── oracle-v2/                 # Knowledge engine (Git submodule)
│   └── src/
│       ├── server.ts          # HTTP API server
│       ├── indexer.ts         # Batch document indexer
│       ├── chroma-http.ts     # ChromaDB client with client-side embeddings
│       └── ψ/memory/          # Knowledge base (learnings, resonance, retrospectives)
├── groups/                    # Agent group workspaces
│   ├── global/CLAUDE.md       # Shared system prompt
│   └── main/CLAUDE.md         # Default group prompt
├── MASTER_PLAN/               # Architecture & implementation roadmap
├── docker-compose.yml         # Development stack
├── docker-compose.production.yml  # Production stack
├── Dockerfile.nanoclaw        # NanoClaw multi-stage build
├── ecosystem.config.js        # PM2 config (alternative to Docker)
├── .env.example               # Environment variable template
├── QUICKSTART.md              # Local development guide
└── DEPLOYMENT.md              # Linux VPS deployment guide
```

## Architecture Details

### Message Flow

1. User sends message via **Telegram**
2. **NanoClaw** receives it, queues the request
3. NanoClaw spawns an **agent container** (Docker-in-Docker)
4. Agent runs with Claude Code, executes tools, queries Oracle
5. Agent output is captured via IPC (stdout markers)
6. Response is formatted as **Telegram MarkdownV2** and sent back

### Knowledge Engine (Oracle V2)

Oracle provides hybrid search combining:
- **SQLite FTS5** — full-text search with BM25 ranking
- **ChromaDB** — semantic vector search (cosine similarity)
- Results are merged and deduplicated for optimal recall

Knowledge is organized into:
- `learnings/` — insights and facts the AI discovers
- `resonance/` — patterns and recurring themes
- `retrospectives/` — reflections on past interactions

### Agent Containers

Each agent runs in an isolated Docker container with:
- Claude Code CLI
- MCP-HTTP bridge to Oracle
- Group-specific system prompts and tools
- Memory-limited execution with timeout
- Network access restricted to `jellycore-internal`

## Configuration

### Agent Groups

Create custom agent profiles in `groups/<group-name>/CLAUDE.md`:

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
| `ANTHROPIC_API_KEY` | Yes | — | API key for Anthropic-compatible endpoint |
| `TELEGRAM_BOT_TOKEN` | Yes | — | Telegram bot token from BotFather |
| `JELLYCORE_AUTH_PASSPHRASE` | Yes | — | Auth encryption passphrase (min 16 chars) |
| `ANTHROPIC_BASE_URL` | No | — | Custom API endpoint (e.g., `https://api.z.ai/api/anthropic`) |
| `CHROMA_AUTH_TOKEN` | No | auto | ChromaDB authentication token |
| `ORACLE_AUTH_TOKEN` | No | auto | Oracle HTTP API auth token |
| `ASSISTANT_NAME` | No | Andy | Bot display name |
| `CONTAINER_IMAGE` | No | `nanoclaw-agent:latest` | Agent container image |
| `CONTAINER_TIMEOUT` | No | 1800000 | Container timeout in ms (30 min) |
| `MAX_CONCURRENT_CONTAINERS` | No | 5 | Max parallel agent containers |
| `TZ` | No | `Asia/Bangkok` | Timezone for scheduled tasks |

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
# Install PM2
npm install -g pm2

# Start services
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for full Linux VPS deployment instructions.

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
# Index all documents in ψ/memory/ into Oracle
curl -X POST http://localhost:47778/api/index
```

See [QUICKSTART.md](QUICKSTART.md) for the full local development guide.

## Roadmap

The [MASTER_PLAN/](MASTER_PLAN/) directory contains the phased implementation roadmap:

| Phase | Focus | Status |
|-------|-------|--------|
| Phase 0 | Security Foundation | ✅ Complete |
| Phase 1 | Performance Upgrade | ✅ Complete |
| Phase 2 | Architecture Hardening | 🔄 In Progress |
| Phase 3 | Reliability & Resilience | 📋 Planned |
| Phase 4 | Integration & Channels | 🔄 In Progress |
| Phase 5 | Production Polish | 📋 Planned |

## License

Private project. All rights reserved.

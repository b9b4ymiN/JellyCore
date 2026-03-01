<p align="center">
  <img src="https://raw.githubusercontent.com/b9b4ymiN/JellyCore/main/nanoclaw/assets/logo.png" width="120" alt="JellyCore Logo">
</p>

<h1 align="center">JellyCore</h1>

<p align="center">
  <strong>🪼 Self-hosted Personal AI Platform with Persistent Memory</strong><br>
  A Docker-based AI assistant that remembers, learns, and evolves — with hybrid search, 5-layer cognitive memory, and isolated agent execution.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.8.1-blue?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/Node.js-22+-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 22+">
  <img src="https://img.shields.io/badge/Bun-1.2+-f9f1e1?style=flat-square&logo=bun&logoColor=black" alt="Bun 1.2+">
  <img src="https://img.shields.io/badge/Docker-Compose%20v2-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT License">
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-features">Features</a> •
  <a href="#%EF%B8%8F-configuration">Configuration</a> •
  <a href="#-strengths--limitations">Strengths & Limitations</a> •
  <a href="#-deployment">Deployment</a>
</p>

---

## 📖 What is JellyCore?

JellyCore is a **production-ready, self-hosted personal AI platform** that turns a Docker host into a fully autonomous AI assistant with:

- **Persistent multi-layer memory** — your AI actually remembers who you are, what you've taught it, and what it's learned
- **Hybrid knowledge search** — combines full-text (BM25) and vector (cosine similarity) search with adaptive weighting
- **Sandboxed agent execution** — every AI task runs in an isolated Docker container with its own Claude Code instance
- **Multi-channel support** — Telegram and WhatsApp interfaces with rich formatting
- **React dashboard** — 15-page web UI for knowledge management, observability, and analytics

Unlike cloud AI services, JellyCore gives you **full ownership** of your data, memory, and AI interactions — all running on your own hardware.

---

## 🏗 Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         JellyCore v0.8.1                             │
│                                                                      │
│   ┌──────────┐      ┌───────────────────┐     ┌──────────────────┐  │
│   │ Telegram │─────▶│     NanoClaw      │────▶│ Agent Container  │  │
│   │   Bot    │◀─────│  (Orchestrator)   │◀────│ (Claude Code)    │  │
│   └──────────┘      │                   │     │                  │  │
│   ┌──────────┐      │ • Message Queue   │     │ • Claude Agent   │  │
│   │ WhatsApp │─────▶│ • Task Scheduler  │     │ • MCP-HTTP Bridge│  │
│   │   Bot    │◀─────│ • IPC Manager     │     │ • Browser (Chrom)│  │
│   └──────────┘      │ • Container Pool  │     │ • Python / Git   │  │
│                     └────────┬──────────┘     └──────────────────┘  │
│                              │                                       │
│                              │ HTTP + MCP Protocol                   │
│                              ▼                                       │
│   ┌───────────┐      ┌──────────────────┐     ┌───────────────┐     │
│   │ Thai NLP  │◀────▶│    Oracle V2     │────▶│   ChromaDB    │     │
│   │ (Sidecar) │      │  (Knowledge)     │     │  (Vectors)    │     │
│   └───────────┘      │                  │     └───────────────┘     │
│     optional         │ • Hybrid Search  │                           │
│                      │ • 5-Layer Memory │     ┌───────────────┐     │
│                      │ • 19+ MCP Tools  │────▶│   React       │     │
│                      │ • Drizzle ORM    │     │   Dashboard   │     │
│                      └──────────────────┘     └───────────────┘     │
└──────────────────────────────────────────────────────────────────────┘
```

### Service Overview

| Service | Role | Runtime | Port |
|---------|------|---------|------|
| **NanoClaw** | Orchestrator — message routing, agent spawning, scheduling, IPC | Node.js 22 | 47779 |
| **Oracle V2** | Knowledge engine — hybrid search, 5-layer memory, 19+ MCP tools | Bun 1.2 | 47778 |
| **ChromaDB** | Vector database — semantic similarity search | Python | 8000 (internal) |
| **Thai NLP** | Thai language sidecar — tokenization, normalization | FastAPI + PyThaiNLP | internal (optional) |

### Message Flow

```
User sends message via Telegram/WhatsApp
  → NanoClaw receives and queues the message
    → NanoClaw spawns an isolated Docker container
      → Agent runs Claude Code with MCP tools
        → Agent queries Oracle for knowledge/memory
        → Agent performs tasks (browse, code, search)
      → Agent output returned via IPC (stdout markers)
    → Response formatted (MarkdownV2) and sent back to user
```

---

## ✨ Features

### 🧠 5-Layer Cognitive Memory

JellyCore implements a **cognitive science-inspired memory model** that gives the AI genuine long-term memory:

| Layer | Purpose | Example |
|-------|---------|---------|
| **User Model** | Who you are, preferences, context | "User prefers concise answers in Thai" |
| **Procedural** | How to do things, skills learned | "Deploy to production: run docker compose..." |
| **Semantic** | Facts, knowledge, learnings | "React 19 uses the new compiler" |
| **Episodic** | Past interactions, events | "Last Tuesday, user asked about K8s migration" |
| **Working** | Current session context | Active conversation state |

Memory entries include **confidence scores**, **access counts**, and **temporal decay** — older, unused memories fade naturally unless reinforced.

### 🔍 Adaptive Hybrid Search

The search pipeline automatically adapts its strategy based on query analysis:

```
Query → Thai NLP Preprocessing → Query Classification (exact/semantic/mixed)
                                        │
                                ┌───────┴───────┐
                                ▼               ▼
                            FTS5 Search    Vector Search
                            (BM25)        (ChromaDB)
                                │               │
                                └───────┬───────┘
                                        ▼
                              Quality Correction
                              (dampened priors + relevance metric)
                                        │
                                        ▼
                              Adaptive RRF Merge
                              (weighted by query type)
                                        │
                                        ▼
                                Final Results
```

- **SQLite FTS5** for exact keyword matching with BM25 ranking
- **ChromaDB** for semantic similarity with cosine distance and client-side embeddings
- **Quality correction** overrides the classifier when results indicate a mismatch
- **Bilingual chunking** — smart overlap chunking (400 tokens, 80 overlap) for Thai and English

### 🐳 Sandboxed Agent Execution

Every AI task runs in a **fully isolated Docker container**:

- Dedicated Claude Code CLI instance per request
- Chromium browser for web automation
- Python 3 + pip for scripting
- Git for repository operations
- MCP-HTTP bridge to Oracle knowledge base
- Memory-limited execution with configurable timeout
- Network restricted to internal Docker network
- Non-root execution (drops privileges after setup)

### 💬 Multi-Channel Support

| Channel | Library | Features |
|---------|---------|----------|
| **Telegram** | grammY | MarkdownV2 formatting, media support, 20+ slash commands, long-polling |
| **WhatsApp** | Baileys | Encrypted auth, auto-reconnection with exponential backoff, group sync |

### 📊 React Dashboard (15 Pages)

Full-featured web UI for knowledge management and observability:

- **Overview** — system health and summary statistics
- **Search** — interactive knowledge search with hybrid results
- **Activity & Feed** — real-time activity monitoring
- **Graph** — knowledge graph visualization
- **Forum & Decisions** — discussion threads and decision tracking
- **Traces** — request tracing and debugging
- **Admin** — system administration, logs, memory management

### ⏰ Task Scheduling

- **Cron-based scheduling** — recurring tasks with cron expressions
- **Database-backed** — tasks persist across restarts
- **Claim/retry/recovery** — stale task detection and automatic recovery
- **Cross-group scheduling** — schedule tasks targeting different agent groups
- **Heartbeat system** — configurable periodic status reports and recurring jobs

### 🔐 Security

- **HMAC-SHA256 IPC signing** — tamper-proof communication between host and containers
- **Encrypted auth storage** — session data encrypted at rest
- **Token-based auth** — ChromaDB and Oracle API endpoints protected
- **Container isolation** — each agent runs in its own sandbox
- **Mount validation** — strict allowlist for host path mounting
- **Non-root execution** — containers drop to unprivileged user after setup

---

## 🚀 Quick Start

### Prerequisites

| Requirement | Minimum Version | Notes |
|-------------|----------------|-------|
| **Docker Desktop** | Latest | Windows/macOS; use Docker Engine on Linux |
| **Docker Compose** | v2+ | Included with Docker Desktop |
| **Git** | Any | For cloning the repository |
| **API Key** | — | Anthropic API key or compatible endpoint (e.g., [Z.AI](https://z.ai)) |
| **Telegram Bot** | — | Token from [@BotFather](https://t.me/BotFather) |

### Step 1 — Clone the Repository

```bash
git clone https://github.com/b9b4ymiN/JellyCore.git
cd JellyCore
```

### Step 2 — Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```dotenv
# === Required ===
ANTHROPIC_API_KEY=your-anthropic-api-key
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI-jklMNOpqrSTUvwxYZ
JELLYCORE_AUTH_PASSPHRASE=your-secure-passphrase-min-16-chars

# === Auto-generated (leave empty on first run) ===
CHROMA_AUTH_TOKEN=
ORACLE_AUTH_TOKEN=

# === Optional ===
ASSISTANT_NAME=Andy
TZ=Asia/Bangkok
EMBEDDING_MODEL=all-MiniLM-L6-v2
```

### Step 3 — Build the Agent Container Image

```bash
docker build -t nanoclaw-agent:latest -f nanoclaw/container/Dockerfile nanoclaw/container
```

> **Note:** This image includes Chromium, Python, Git, and Claude Code CLI. First build takes ~5–10 minutes.

### Step 4 — Start All Services

```bash
# Development (with build)
docker compose up -d --build

# Production (with resource limits and log rotation)
docker compose -f docker-compose.production.yml up -d --build
```

### Step 5 — Verify

```bash
# Check all services are healthy
docker compose ps

# Verify Oracle API
curl http://localhost:47778/api/health

# Watch NanoClaw logs
docker compose logs -f nanoclaw
```

Once all services show **healthy**, send a message to your Telegram bot — JellyCore is ready! 🪼

---

## ⚙️ Configuration

### Environment Variables

#### Required

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key or compatible endpoint key |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from [@BotFather](https://t.me/BotFather) |
| `JELLYCORE_AUTH_PASSPHRASE` | Encryption passphrase for auth storage (minimum 16 characters) |

#### Auto-Generated

These are generated automatically on first run if left empty:

| Variable | Description |
|----------|-------------|
| `CHROMA_AUTH_TOKEN` | ChromaDB authentication token |
| `ORACLE_AUTH_TOKEN` | Oracle HTTP API authentication token |
| `JELLYCORE_IPC_SECRET` | HMAC signing secret for IPC integrity |

#### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_BASE_URL` | — | Custom API base URL (e.g., `https://api.z.ai/api/anthropic`) |
| `CLAUDE_CODE_OAUTH_TOKEN` | — | Alternative: Claude Code OAuth token instead of API key |
| `ORACLE_API_URL` | `http://oracle:47778` | Oracle endpoint for agent containers |
| `CONTAINER_IMAGE` | `nanoclaw-agent:latest` | Docker image for agent containers |
| `CONTAINER_TIMEOUT` | `1800000` | Agent container timeout in ms (default: 30 min) |
| `CONTAINER_MEMORY_LIMIT` | `512m` | Memory limit per agent container |
| `CONTAINER_CPU_LIMIT` | `1.0` | CPU limit per agent container |
| `MAX_CONCURRENT_CONTAINERS` | `5` (dev) / `2` (prod) | Maximum simultaneous agent containers |
| `AGENT_FULL_ACCESS` | `false` | ⚠️ Grants broad file + Docker socket access to containers |
| `ENABLED_CHANNELS` | `telegram` | Comma-separated: `telegram`, `whatsapp` |
| `EMBEDDING_MODEL` | `all-MiniLM-L6-v2` | Embedding model for vector search |
| `ASSISTANT_NAME` | `Andy` | Bot display name |
| `TZ` | `Asia/Bangkok` | Timezone for scheduled tasks and formatting |

### Embedding Models

| Model | Dimensions | Thai Support | Size | Best For |
|-------|-----------|-------------|------|----------|
| `all-MiniLM-L6-v2` | 384 | ★★☆☆☆ | ~23 MB | English-primary workloads, lower memory |
| `multilingual-e5-small` | 384 | ★★★★☆ | ~120 MB | Thai + multilingual content, ARM64 compatible |

To switch embedding models:

```bash
# 1. Update .env
EMBEDDING_MODEL=multilingual-e5-small

# 2. Re-embed all existing knowledge
cd oracle-v2 && bun run re-embed
```

### Agent Groups

Agent behavior is configured through **group workspaces** in `groups/`:

```
groups/
├── global/
│   ├── CLAUDE.md       # Shared system prompt (injected into every agent)
│   └── SOUL.md         # AI personality and identity definition
└── main/
    ├── CLAUDE.md       # Main group-specific instructions (admin privileges)
    └── USER.md         # User profile (auto-maintained by AI)
```

Create a custom agent group:

```bash
mkdir -p groups/my-team
```

Then add `CLAUDE.md` with group-specific instructions:

```markdown
# My Team Assistant

You specialize in data analysis and reporting.

## Rules
- Always provide sources for claims
- Format output as tables when possible
```

### Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Initialize the bot |
| `/help` | Show available commands |
| `/ping` | Quick health check |
| `/session` | View current session info |
| `/clear` | Clear conversation history |
| `/reset` | Full session reset |
| `/model` | Show or switch AI model |
| `/usage` | Token usage statistics |
| `/cost` | Cost breakdown |
| `/budget` | Budget management |
| `/status` | System status overview |
| `/health` | Detailed health report |
| `/containers` | Active container info |
| `/queue` | Message queue status |
| `/errors` | Recent error log |
| `/heartbeat` | Heartbeat system control |
| `/kill` | Force-stop active container |

---

## 📁 Project Structure

```
jellycore/
├── nanoclaw/                        # 🤖 AI Orchestrator ("The Body")
│   ├── src/
│   │   ├── index.ts                 #   Main entry — state machine, message loop
│   │   ├── channels/                #   Telegram (grammY) & WhatsApp (Baileys)
│   │   ├── container-runner.ts      #   Docker-in-Docker agent spawner
│   │   ├── group-queue.ts           #   Per-group message queue & concurrency
│   │   ├── task-scheduler.ts        #   Cron-based task scheduling
│   │   ├── ipc.ts                   #   HMAC-signed IPC with containers
│   │   ├── heartbeat.ts             #   Periodic status reports
│   │   ├── cost-intelligence.ts     #   Budget enforcement & model auto-downgrade
│   │   └── command-registry.ts      #   Slash command definitions
│   └── container/                   #   Agent container image
│       ├── Dockerfile               #     Multi-stage: Node + Chromium + Python + Claude
│       └── agent-runner/            #     Agent entrypoint + MCP bridges
│           ├── src/index.ts          #       Claude Agent SDK orchestration
│           ├── src/oracle-mcp-http.ts#       Oracle MCP-HTTP bridge
│           └── src/ipc-mcp-stdio.ts  #       Host communication MCP server
│
├── oracle-v2/                       # 🧠 Knowledge Engine ("The Brain")
│   ├── src/
│   │   ├── server.ts                #   Hono.js HTTP API (19+ MCP tools)
│   │   ├── indexer.ts               #   Batch indexer + Thai NLP + smart chunking
│   │   ├── embedder.ts              #   Pluggable embedding interface
│   │   ├── chunker.ts               #   Bilingual smart chunker (overlap)
│   │   ├── query-classifier.ts      #   Adaptive search query analysis
│   │   ├── chroma-http.ts           #   ChromaDB client (client-side embeddings)
│   │   └── db/                      #   Drizzle ORM schema & migrations
│   ├── frontend/                    #   React dashboard (Vite, 15 pages)
│   ├── scripts/                     #   Migration & utility scripts
│   └── ψ/memory/                    #   Knowledge base (Markdown files)
│       ├── learnings/               #     Facts and insights
│       ├── resonance/               #     Patterns and principles
│       └── retrospectives/          #     Session reflections
│
├── thai-nlp-sidecar/                # 🇹🇭 Thai Language Processing (optional)
│   ├── main.py                      #   FastAPI server wrapping PyThaiNLP
│   └── requirements.txt             #   fastapi, uvicorn, pythainlp
│
├── groups/                          # 👥 Agent Group Workspaces
│   ├── global/                      #   Shared: CLAUDE.md (system prompt) + SOUL.md (personality)
│   └── main/                        #   Default admin group
│
├── docs/                            # 📚 Documentation
│   ├── DEPLOYMENT.md                #   Linux VPS production deployment guide
│   ├── QUICKSTART.md                #   Local development setup guide
│   ├── MASTER_PLAN/                 #   7-phase architecture roadmap (all complete)
│   └── releases/                    #   Detailed release notes per version
│
├── docker-compose.yml               # Development stack (3 services)
├── docker-compose.production.yml    # Production stack (resource limits, logging)
├── Dockerfile.nanoclaw              # NanoClaw multi-stage build
└── ecosystem.config.js              # PM2 alternative deployment config
```

---

## 💪 Strengths & Limitations

### ✅ Strengths

| Area | Details |
|------|---------|
| **🧠 Genuine AI Memory** | 5-layer cognitive memory model with temporal decay, confidence scoring, and reinforcement. Your AI remembers context across sessions — not just chat history. |
| **🔍 Smart Search** | Adaptive hybrid search automatically selects the right strategy (exact vs. semantic vs. mixed) and self-corrects when results are poor. Zero manual tuning. |
| **🐳 Security by Isolation** | Every AI execution runs in a sandboxed Docker container with resource limits, restricted networking, and non-root privileges. No shared state between requests. |
| **🔌 Extensible via MCP** | Model Context Protocol provides a standardized tool interface. 19+ built-in tools; add new capabilities by writing MCP servers or skill files. |
| **🌐 Bilingual (Thai + English)** | First-class Thai language support — tokenization (PyThaiNLP), smart chunking, bilingual search, Thai timezone handling, Thai command descriptions. |
| **📊 Rich Observability** | React dashboard with 15 pages: search, activity feed, knowledge graph, decision tracking, request tracing, forum threads, and admin panels. |
| **💰 Cost Intelligence** | Automatic budget enforcement, per-session cost tracking, model auto-downgrade when approaching limits, and cost analytics via `/cost` command. |
| **🔧 Skills-based Extension** | Add capabilities by writing Claude Code skill files rather than modifying core code. Hot-loadable at runtime without redeployment. |
| **📦 Self-contained** | Single `docker compose up` deploys everything. No external databases, no cloud dependencies (beyond the LLM API key). |
| **🛡 Production Hardened** | Health checks on all services, graceful shutdown, auto-restart, log rotation, memory limits, encrypted auth, and HMAC-signed IPC. |

### ⚠️ Limitations

| Area | Details | Mitigation |
|------|---------|------------|
| **💻 Resource Intensive** | Agent containers include Chromium + Python + Node.js (~1 GB+ image). Stack requires minimum **2 GB RAM**, 4 GB+ recommended. | Tune `MAX_CONCURRENT_CONTAINERS` and `CONTAINER_MEMORY_LIMIT` to match your hardware. |
| **🐧 Linux-only for Production** | Docker Compose deployment has volume path/permission issues on Windows/macOS. Development works cross-platform. | Use a **Linux VPS** (Ubuntu 22.04+ recommended) for production deployments. |
| **📱 WhatsApp Fragility** | WhatsApp integration uses Baileys (unofficial API) — can break with WhatsApp updates; session management requires careful handling. | Telegram is the primary, stable channel. WhatsApp is available but considered experimental. |
| **🤖 Single AI Provider** | Currently optimized for Anthropic Claude via the official Agent SDK. No native OpenAI or local model support. | Works with any Anthropic-compatible proxy (e.g., Z.AI GLM endpoints). |
| **🇹🇭 Thai NLP Optional** | Thai NLP sidecar is **disabled by default**. Without it, Thai search falls back to whitespace tokenization with reduced accuracy. | Uncomment the thai-nlp service in docker-compose.yml for full Thai support. |
| **📈 No Horizontal Scaling** | Single-instance architecture (stateful SQLite sessions). Cannot distribute across multiple servers. | Designed for personal use (1–5 users). Vertical scaling (bigger VPS) works well. |
| **⏱ Cold Start Latency** | First message after idle requires container startup (~5–15 seconds). | Container pool pre-warms instances. Tune pool size and timeout to reduce cold starts. |
| **📝 Documentation Gaps** | Some docs are Thai-only. No standalone API reference for third-party integrations. | Refer to `docs/` folder, release notes, and source code CLAUDE.md files for details. |

---

## 🚢 Deployment

### Option 1: Docker Compose (Recommended)

#### Development

```bash
docker compose up -d --build
```

- Oracle API on `localhost:47778`
- NanoClaw health on `localhost:47779`
- ChromaDB internal only (no exposed port)

#### Production

```bash
docker compose -f docker-compose.production.yml up -d --build
```

Production configuration adds:
- **CPU & memory limits** on all services
- **Log rotation** — JSON file driver, 50 MB max, 5 files
- **Oracle port** — bound to `127.0.0.1` only (use reverse proxy for external)
- **Deployment resources** via Docker Compose `deploy` block

### Option 2: PM2 (Bare Metal)

For VPS deployments without Docker:

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save && pm2 startup
```

PM2 configuration includes:
- 1 GB memory limit for NanoClaw, 512 MB for Oracle
- Max 10 restarts with exponential backoff
- Log rotation to `/var/log/jellycore/`

### Reverse Proxy (HTTPS)

For exposing the Oracle dashboard with HTTPS, use Caddy:

```
# Caddyfile
oracle.yourdomain.com {
    reverse_proxy localhost:47778
}
```

### Backup Strategy

```bash
# Backup Oracle database
docker compose exec oracle tar czf /tmp/backup.tar.gz /data/oracle
docker compose cp oracle:/tmp/backup.tar.gz ./backups/

# Backup knowledge files
tar czf backups/psi-memory-$(date +%Y%m%d).tar.gz oracle-v2/ψ/memory/

# Backup NanoClaw state
docker compose exec nanoclaw tar czf /tmp/nc-backup.tar.gz /app/nanoclaw/store
docker compose cp nanoclaw:/tmp/nc-backup.tar.gz ./backups/
```

---

## 🧪 Development

### Local Setup

```bash
# Oracle V2 (requires Bun 1.2+)
cd oracle-v2
bun install
bun run src/server.ts           # HTTP API on :47778

# NanoClaw (requires Node.js 22+)
cd nanoclaw
npm install
npx tsc
node dist/index.js              # Or: npm run dev (tsx hot reload)

# React Dashboard
cd oracle-v2
bun run frontend:dev            # Dev server on :3000
```

### Running Tests

```bash
# Oracle V2 — Vitest with V8 coverage
cd oracle-v2
bun test                                # All tests
bun test src/query-classifier.test.ts   # Query classifier
bun test src/chunker.test.ts            # Smart chunker

# NanoClaw — Vitest
cd nanoclaw
npm test

# E2E — Playwright
cd oracle-v2
bun run test:e2e
```

### Knowledge Indexing

```bash
# Index all ψ/memory/ files into Oracle (FTS5 + ChromaDB vectors)
curl -X POST http://localhost:47778/api/index

# Re-embed after switching embedding model
cd oracle-v2 && bun run re-embed

# Reindex with Thai NLP processing
cd oracle-v2 && bun run reindex:thai-nlp
```

### Database Management

```bash
cd oracle-v2

# Visual database editor
bun run db:studio

# Run pending migrations
bun run db:migrate
```

---

## 🗺 Roadmap

All 7 phases of the original master plan have been **completed**:

| Phase | Focus | Status |
|-------|-------|--------|
| **Phase 0** | Security Foundation — IPC signing, encrypted auth, mount validation | ✅ Complete |
| **Phase 1** | Performance — Adaptive hybrid search, pluggable embeddings, smart chunking | ✅ Complete |
| **Phase 2** | Architecture Hardening — Drizzle ORM, modular handlers, graceful shutdown | ✅ Complete |
| **Phase 3** | Reliability — Auto-reconnection, container pool, dead letter queue | ✅ Complete |
| **Phase 4** | Integration — 5-layer memory, Telegram channel, MCP tools expansion | ✅ Complete |
| **Phase 5** | Production Polish — Streaming UX, cost intelligence, observability, context mastery | ✅ Complete |
| **Phase 6** | Scheduler & Heartbeat — Cron hardening, idle preemption, heartbeat jobs | ✅ Complete |

### Future Directions

- 🔄 Telegram Webhook mode (replacing long-polling)
- 🤖 Multi-provider LLM support (OpenAI, local models via Ollama)
- 📈 Horizontal scaling with shared state layer
- 🎙 Voice message processing
- 🧩 Plugin marketplace for community skills

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [docs/QUICKSTART.md](docs/QUICKSTART.md) | Local development setup guide |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Linux VPS production deployment guide |
| [docs/MASTER_PLAN/](docs/MASTER_PLAN/) | Complete architecture roadmap (7 phases) |
| [docs/releases/](docs/releases/) | Detailed release notes for all versions |
| [nanoclaw/README.md](nanoclaw/README.md) | NanoClaw — orchestrator documentation |
| [oracle-v2/README.md](oracle-v2/README.md) | Oracle V2 — knowledge engine documentation |
| [nanoclaw/docs/SPEC.md](nanoclaw/docs/SPEC.md) | Technical specification |
| [nanoclaw/docs/SECURITY.md](nanoclaw/docs/SECURITY.md) | Security model & threat analysis |

---

## 📋 Version History

| Version | Highlights |
|---------|-----------|
| **v0.8.1** | Task scheduler fix — idle container preemption for scheduled task execution |
| **v0.8.0** | Production polish — streaming UX, cost intelligence, context auto-compaction, observability |
| **v0.7.1** | Memory reliability improvements and edge case fixes |
| **v0.7.0** | Five-layer cognitive memory system with temporal decay and confidence scoring |
| **v0.6.0** | Adaptive hybrid search, pluggable embedder, bilingual smart chunking, Thai NLP indexer |
| **v0.5.0** | Thai NLP sidecar, embedding versioning, Docker 4-service stack |
| **v0.4.0** | ChromaDB dual indexing, hybrid FTS5 + vector search, Oracle V2 foundation |

---

## 🤝 Contributing

JellyCore follows a **"Skills over Features"** contribution model:

> *"Don't add features. Add skills."*

Instead of traditional PRs that expand the codebase, contributors write **Claude Code skill files** — reusable instruction sets that teach the AI new capabilities. This keeps the core small while making the platform endlessly extensible.

See [nanoclaw/CONTRIBUTING.md](nanoclaw/CONTRIBUTING.md) for full guidelines.

---

## 📄 License

MIT License — see [LICENSE](nanoclaw/LICENSE) for details.

Copyright © 2026 [Gavriel](https://github.com/b9b4ymiN)

---

<p align="center">
  <sub>Built with 🪼 by <a href="https://github.com/b9b4ymiN">b9b4ymiN</a> — Because your AI should remember you.</sub>
</p>

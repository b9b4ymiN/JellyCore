<p align="center">
  <img src="https://raw.githubusercontent.com/b9b4ymiN/JellyCore/main/nanoclaw/assets/logo.png" width="120" alt="JellyCore Logo">
</p>

<h1 align="center">JellyCore</h1>

<p align="center">
  <strong>ðŸª¼ Self-hosted Personal AI Platform with Persistent Memory</strong><br>
  A Docker-based AI assistant that remembers, learns, and evolves â€” with hybrid search, 5-layer cognitive memory, and isolated agent execution.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.9.0-blue?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/Node.js-22+-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 22+">
  <img src="https://img.shields.io/badge/Bun-1.2+-f9f1e1?style=flat-square&logo=bun&logoColor=black" alt="Bun 1.2+">
  <img src="https://img.shields.io/badge/Docker-Compose%20v2-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT License">
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> â€¢
  <a href="#-architecture">Architecture</a> â€¢
  <a href="#-features">Features</a> â€¢
  <a href="#%EF%B8%8F-configuration">Configuration</a> â€¢
  <a href="#-strengths--limitations">Strengths & Limitations</a> â€¢
  <a href="#-deployment">Deployment</a>
</p>

---

## ðŸ“– What is JellyCore?

JellyCore is a **production-ready, self-hosted personal AI platform** that turns a Docker host into a fully autonomous AI assistant with:

- **Persistent multi-layer memory** â€” your AI actually remembers who you are, what you've taught it, and what it's learned
- **Hybrid knowledge search** â€” combines full-text (BM25) and vector (cosine similarity) search with adaptive weighting
- **Sandboxed agent execution** â€” every AI task runs in an isolated Docker container with its own Claude Code instance
- **Multi-channel support** â€” Telegram and WhatsApp interfaces with rich formatting
- **React dashboard** â€” 15-page web UI for knowledge management, observability, and analytics

Unlike cloud AI services, JellyCore gives you **full ownership** of your data, memory, and AI interactions â€” all running on your own hardware.

---

## ðŸ— Architecture

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                         JellyCore v0.9.0                             â”‚
â”‚                                                                      â”‚
â”‚   â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”      â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”     â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚
â”‚   â”‚ Telegram â”‚â”€â”€â”€â”€â”€â–¶â”‚     NanoClaw      â”‚â”€â”€â”€â”€â–¶â”‚ Agent Container  â”‚  â”‚
â”‚   â”‚   Bot    â”‚â—€â”€â”€â”€â”€â”€â”‚  (Orchestrator)   â”‚â—€â”€â”€â”€â”€â”‚ (Claude Code)    â”‚  â”‚
â”‚   â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜      â”‚                   â”‚     â”‚                  â”‚  â”‚
â”‚   â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”      â”‚ â€¢ Message Queue   â”‚     â”‚ â€¢ Claude Agent   â”‚  â”‚
â”‚   â”‚ WhatsApp â”‚â”€â”€â”€â”€â”€â–¶â”‚ â€¢ Task Scheduler  â”‚     â”‚ â€¢ MCP-HTTP Bridgeâ”‚  â”‚
â”‚   â”‚   Bot    â”‚â—€â”€â”€â”€â”€â”€â”‚ â€¢ IPC Manager     â”‚     â”‚ â€¢ Browser (Chrom)â”‚  â”‚
â”‚   â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜      â”‚ â€¢ Container Pool  â”‚     â”‚ â€¢ Python / Git   â”‚  â”‚
â”‚                     â””â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜     â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚
â”‚                              â”‚                                       â”‚
â”‚                              â”‚ HTTP + MCP Protocol                   â”‚
â”‚                              â–¼                                       â”‚
â”‚   â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”      â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”     â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”     â”‚
â”‚   â”‚ Thai NLP  â”‚â—€â”€â”€â”€â”€â–¶â”‚    Oracle V2     â”‚â”€â”€â”€â”€â–¶â”‚   ChromaDB    â”‚     â”‚
â”‚   â”‚ (Sidecar) â”‚      â”‚  (Knowledge)     â”‚     â”‚  (Vectors)    â”‚     â”‚
â”‚   â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜      â”‚                  â”‚     â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜     â”‚
â”‚     optional         â”‚ â€¢ Hybrid Search  â”‚                           â”‚
â”‚                      â”‚ â€¢ 5-Layer Memory â”‚     â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”     â”‚
â”‚                      â”‚ â€¢ 19+ MCP Tools  â”‚â”€â”€â”€â”€â–¶â”‚   React       â”‚     â”‚
â”‚                      â”‚ â€¢ Drizzle ORM    â”‚     â”‚   Dashboard   â”‚     â”‚
â”‚                      â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜     â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜     â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

### Service Overview

| Service | Role | Runtime | Port |
|---------|------|---------|------|
| **NanoClaw** | Orchestrator â€” message routing, agent spawning, scheduling, IPC | Node.js 22 | 47779 |
| **Oracle V2** | Knowledge engine â€” hybrid search, 5-layer memory, 19+ MCP tools | Bun 1.2 | 47778 |
| **ChromaDB** | Vector database â€” semantic similarity search | Python | 8000 (internal) |
| **Thai NLP** | Thai language sidecar â€” tokenization, normalization | FastAPI + PyThaiNLP | internal (optional) |

### Message Flow

```
User sends message via Telegram/WhatsApp
  â†’ NanoClaw receives and queues the message
    â†’ NanoClaw spawns an isolated Docker container
      â†’ Agent runs Claude Code with MCP tools
        â†’ Agent queries Oracle for knowledge/memory
        â†’ Agent performs tasks (browse, code, search)
      â†’ Agent output returned via IPC (stdout markers)
    â†’ Response formatted (MarkdownV2) and sent back to user
```

---

## âœ¨ Features

### ðŸ§  5-Layer Cognitive Memory

JellyCore implements a **cognitive science-inspired memory model** that gives the AI genuine long-term memory:

| Layer | Purpose | Example |
|-------|---------|---------|
| **User Model** | Who you are, preferences, context | "User prefers concise answers in Thai" |
| **Procedural** | How to do things, skills learned | "Deploy to production: run docker compose..." |
| **Semantic** | Facts, knowledge, learnings | "React 19 uses the new compiler" |
| **Episodic** | Past interactions, events | "Last Tuesday, user asked about K8s migration" |
| **Working** | Current session context | Active conversation state |

Memory entries include **confidence scores**, **access counts**, and **temporal decay** â€” older, unused memories fade naturally unless reinforced.

### ðŸ” Adaptive Hybrid Search

The search pipeline automatically adapts its strategy based on query analysis:

```
Query â†’ Thai NLP Preprocessing â†’ Query Classification (exact/semantic/mixed)
                                        â”‚
                                â”Œâ”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”
                                â–¼               â–¼
                            FTS5 Search    Vector Search
                            (BM25)        (ChromaDB)
                                â”‚               â”‚
                                â””â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”˜
                                        â–¼
                              Quality Correction
                              (dampened priors + relevance metric)
                                        â”‚
                                        â–¼
                              Adaptive RRF Merge
                              (weighted by query type)
                                        â”‚
                                        â–¼
                                Final Results
```

- **SQLite FTS5** for exact keyword matching with BM25 ranking
- **ChromaDB** for semantic similarity with cosine distance and client-side embeddings
- **Quality correction** overrides the classifier when results indicate a mismatch
- **Bilingual chunking** â€” smart overlap chunking (400 tokens, 80 overlap) for Thai and English

### ðŸ³ Sandboxed Agent Execution

Every AI task runs in a **fully isolated Docker container**:

- Dedicated Claude Code CLI instance per request
- Chromium browser for web automation
- Python 3 + pip for scripting
- Git for repository operations
- MCP-HTTP bridge to Oracle knowledge base
- Memory-limited execution with configurable timeout
- Network restricted to internal Docker network
- Non-root execution (drops privileges after setup)

### ðŸ’¬ Multi-Channel Support

| Channel | Library | Features |
|---------|---------|----------|
| **Telegram** | grammY | MarkdownV2 formatting, media support, 20+ slash commands, long-polling |
| **WhatsApp** | Baileys | Encrypted auth, auto-reconnection with exponential backoff, group sync |

### ðŸ“Š React Dashboard (15 Pages)

Full-featured web UI for knowledge management and observability:

- **Overview** â€” system health and summary statistics
- **Search** â€” interactive knowledge search with hybrid results
- **Activity & Feed** â€” real-time activity monitoring
- **Graph** â€” knowledge graph visualization
- **Forum & Decisions** â€” discussion threads and decision tracking
- **Traces** â€” request tracing and debugging
- **Admin** â€” system administration, logs, memory management

### â° Task Scheduling

- **Cron-based scheduling** â€” recurring tasks with cron expressions
- **Database-backed** â€” tasks persist across restarts
- **Claim/retry/recovery** â€” stale task detection and automatic recovery
- **Cross-group scheduling** â€” schedule tasks targeting different agent groups
- **Heartbeat system** â€” configurable periodic status reports and recurring jobs

### ðŸ” Security

- **HMAC-SHA256 IPC signing** â€” tamper-proof communication between host and containers
- **Encrypted auth storage** â€” session data encrypted at rest
- **Token-based auth** â€” ChromaDB and Oracle API endpoints protected
- **Container isolation** â€” each agent runs in its own sandbox
- **Mount validation** â€” strict allowlist for host path mounting
- **Non-root execution** â€” containers drop to unprivileged user after setup

---

## ðŸš€ Quick Start

### Prerequisites

| Requirement | Minimum Version | Notes |
|-------------|----------------|-------|
| **Docker Desktop** | Latest | Windows/macOS; use Docker Engine on Linux |
| **Docker Compose** | v2+ | Included with Docker Desktop |
| **Git** | Any | For cloning the repository |
| **API Key** | â€” | Anthropic API key or compatible endpoint (e.g., [Z.AI](https://z.ai)) |
| **Telegram Bot** | â€” | Token from [@BotFather](https://t.me/BotFather) |

### Step 1 â€” Clone the Repository

```bash
git clone https://github.com/b9b4ymiN/JellyCore.git
cd JellyCore
```

### Step 2 â€” Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```dotenv
# === Required ===
ANTHROPIC_API_KEY=your-anthropic-api-key
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI-jklMNOpqrSTUvwxYZ
JELLYCORE_AUTH_PASSPHRASE=your-secure-passphrase-min-16-chars

# === Service tokens (set manually) ===
CHROMA_AUTH_TOKEN=replace-with-strong-token
ORACLE_AUTH_TOKEN=replace-with-strong-token

# === Optional ===
ASSISTANT_NAME=Fon
TZ=Asia/Bangkok
EMBEDDING_MODEL=all-MiniLM-L6-v2
```

If you want `mode=swarm` or `mode=codex`, prepare ChatGPT login auth first:

```bash
mkdir -p data/codex-auth
# place your ChatGPT login file at:
# data/codex-auth/auth.json
# (UTF-8 BOM is tolerated and stripped automatically)
```

Then enable runtime flags in `.env`:

```dotenv
AGENT_CODEX_ENABLED=true
AGENT_SWARM_ENABLED=true
AGENT_MODE_GLOBAL_DEFAULT=off
CODEX_AUTH_REQUIRED=true
CODEX_AUTH_PATH=data/codex-auth
CODEX_MODEL=gpt-5.3-codex
```

If you use `google_docs` MCP, you can install OAuth token with one shared file:

```bash
mkdir -p data/google-docs-auth
# no profile:
# data/google-docs-auth/token.json
# with GOOGLE_MCP_PROFILE=main:
# data/google-docs-auth/main/token.json
```

### Step 3 â€” Build the Agent Container Image

```bash
docker build \
  --build-arg VCS_REF="$(git rev-parse --short=12 HEAD)" \
  --build-arg BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t nanoclaw-agent:latest \
  -f nanoclaw/container/Dockerfile \
  nanoclaw/container
```

> **Note:** This image includes Chromium, Python, Git, and Claude Code CLI. First build takes ~5â€“10 minutes.
> Rebuild this image whenever `nanoclaw/container/agent-runner` changes, otherwise Codex runtime can drift from source.
> If `.env` sets `CONTAINER_IMAGE` to a custom tag, build that exact tag (not only `nanoclaw-agent:latest`).
> Lite option: `docker build -t nanoclaw-agent-lite:latest -f nanoclaw/container/Dockerfile.lite nanoclaw/container`

### Step 4 â€” Start All Services

```bash
# Development (with build)
docker compose up -d --build

# Production (with resource limits and log rotation)
docker compose -f docker-compose.production.yml up -d --build
```

### Step 5 â€” Verify

```bash
# Check all services are healthy
docker compose ps

# Verify Oracle API
curl http://localhost:47778/api/health

# Watch NanoClaw logs
docker compose logs -f nanoclaw

# Verify Codex readiness snapshot
curl http://localhost:47779/health
curl http://localhost:47779/status
```

Codex runtime behavior (when `mode=codex`):
1. Oracle MCP is wired as primary memory brain.
2. Nanoclaw MCP is wired for mode/state/delegate tools.
3. Active external MCP servers are wired from runtime config.

Once all services show **healthy**, send a message to your Telegram bot â€” JellyCore is ready! ðŸª¼

---

## âš™ï¸ Configuration

### Environment Variables

#### Required

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key or compatible endpoint key |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from [@BotFather](https://t.me/BotFather) |
| `JELLYCORE_AUTH_PASSPHRASE` | Encryption passphrase for auth storage (minimum 16 characters) |

#### Service Tokens

Set these explicitly in `.env` before start:

| Variable | Description |
|----------|-------------|
| `CHROMA_AUTH_TOKEN` | ChromaDB authentication token |
| `ORACLE_AUTH_TOKEN` | Oracle token for protected Oracle endpoints |

#### Auto-Generated

Generated by NanoClaw on first run if not provided:

| Variable | Description |
|----------|-------------|
| `JELLYCORE_IPC_SECRET` | HMAC signing secret for IPC integrity |

#### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_BASE_URL` | â€” | Custom API base URL (e.g., `https://api.z.ai/api/anthropic`) |
| `CLAUDE_CODE_OAUTH_TOKEN` | â€” | Alternative: Claude Code OAuth token instead of API key |
| `ORACLE_API_URL` | `http://oracle:47778` | Oracle endpoint for agent containers |
| `ORACLE_ALLOWED_ORIGINS` | `http://localhost:47778,http://127.0.0.1:47778,http://localhost:5173,http://127.0.0.1:5173` | CORS allowlist for Oracle browser access |
| `ORACLE_RATE_LIMIT_WINDOW_MS` | `60000` | Oracle rate-limit window size in milliseconds |
| `ORACLE_RATE_LIMIT_READ_LIMIT` | `60` | Max read-heavy requests per window (`/api/search`, `/api/consult`, `/api/file`) |
| `ORACLE_RATE_LIMIT_WRITE_LIMIT` | `30` | Max write-heavy requests per window (`/api/learn`, thread/decision/memory writes) |
| `ORACLE_HOST_PORT` | `47778` | Host port mapping for Oracle (`127.0.0.1:${ORACLE_HOST_PORT}:47778`) |
| `NANOCLAW_HOST_PORT` | `47779` | Host port mapping for NanoClaw health/status (`127.0.0.1:${NANOCLAW_HOST_PORT}:47779`) |
| `BACKUP_DIR` | `./backups` | Backup archive destination used by `scripts/backup.sh` |
| `BACKUP_RETENTION_DAYS` | `14` | Automatic cleanup window for old backup archives |
| `RCLONE_REMOTE` | â€” | Optional offsite backup destination for `rclone copy` |
| `CONTAINER_IMAGE` | `nanoclaw-agent:latest` | Docker image for agent containers |
| `AGENT_DOCKERFILE` | `Dockerfile` (or `Dockerfile.lite` when image name contains `lite`) | Dockerfile used by NanoClaw auto-build path |
| `CONTAINER_TIMEOUT` | `1800000` | Agent container timeout in ms (default: 30 min) |
| `CONTAINER_MEMORY_LIMIT` | `512m` | Memory limit per agent container |
| `CONTAINER_CPU_LIMIT` | `1.0` | CPU limit per agent container |
| `MAX_CONCURRENT_CONTAINERS` | `5` (dev) / `2` (prod) | Maximum simultaneous agent containers |
| `AGENT_FULL_ACCESS` | `false` | âš ï¸ Grants broad file + Docker socket access to containers (explicit opt-in recommended only for ops) |
| `AGENT_CODEX_ENABLED` | `false` | Enable Codex runtime selection |
| `AGENT_SWARM_ENABLED` | `false` | Enable Swarm routing mode |
| `AGENT_MODE_GLOBAL_DEFAULT` | `off` | Global default mode: `off\|swarm\|codex` |
| `LLM_PROVIDER` | `claude` | Agent-runner provider: `claude`, `openai`, or `ollama` |
| `OPENAI_BASE_URL` | `https://api.openai.com` | OpenAI-compatible base URL when `LLM_PROVIDER=openai` |
| `OPENAI_API_KEY` | â€” | API key for OpenAI-compatible provider |
| `OPENAI_MODEL` | `gpt-4.1` | Model ID for OpenAI-compatible provider |
| `OLLAMA_BASE_URL` | `http://host.containers.internal:11434` | Ollama endpoint when `LLM_PROVIDER=ollama` |
| `OLLAMA_MODEL` | `llama3.1` | Ollama model name |
| `CODEX_AUTH_REQUIRED` | `true` | Require ChatGPT login `auth.json` for Codex |
| `CODEX_AUTH_PATH` | `data/codex-auth` | Host path containing `auth.json` |
| `GOOGLE_DOCS_AUTH_PATH` | `data/google-docs-auth` | Shared host path for `google_docs` OAuth `token.json` bootstrap |
| `CODEX_MODEL` | `gpt-5.3-codex` | Codex model for direct/delegated execution |
| `CODEX_EXEC_TIMEOUT_MS` | `600000` | Codex execution timeout in milliseconds |
| `ENABLED_CHANNELS` | `telegram` | Comma-separated: `telegram`, `whatsapp` |
| `EMBEDDING_MODEL` | `all-MiniLM-L6-v2` | Embedding model for vector search |
| `ASSISTANT_NAME` | `Fon` | Bot display name |
| `TZ` | `Asia/Bangkok` | Timezone for scheduled tasks and formatting |

### Embedding Models

| Model | Dimensions | Thai Support | Size | Best For |
|-------|-----------|-------------|------|----------|
| `all-MiniLM-L6-v2` | 384 | â˜…â˜…â˜†â˜†â˜† | ~23 MB | English-primary workloads, lower memory |
| `multilingual-e5-small` | 384 | â˜…â˜…â˜…â˜…â˜† | ~120 MB | Thai + multilingual content, ARM64 compatible |

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
â”œâ”€â”€ global/
â”‚   â”œâ”€â”€ CLAUDE.md       # Shared system prompt (injected into every agent)
â”‚   â”œâ”€â”€ SOUL_FON.md     # Fon runtime identity/persona (fallback to SOUL.md)
â”‚   â”œâ”€â”€ SOUL_CODEX.md   # Codex runtime identity/persona (fallback to SOUL.md)
â”‚   â””â”€â”€ SOUL.md         # Shared fallback identity
â””â”€â”€ main/
    â”œâ”€â”€ CLAUDE.md       # Main group-specific instructions (admin privileges)
    â””â”€â”€ USER.md         # User profile (auto-maintained by AI)
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
| `/mode` | Show/set runtime mode + Codex auth/runtime readiness (`off`, `swarm`, `codex`) |
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

## ðŸ“ Project Structure

```
jellycore/
â”œâ”€â”€ nanoclaw/                        # ðŸ¤– AI Orchestrator ("The Body")
â”‚   â”œâ”€â”€ src/
â”‚   â”‚   â”œâ”€â”€ index.ts                 #   Main entry â€” state machine, message loop
â”‚   â”‚   â”œâ”€â”€ channels/                #   Telegram (grammY) & WhatsApp (Baileys)
â”‚   â”‚   â”œâ”€â”€ container-runner.ts      #   Docker-in-Docker agent spawner
â”‚   â”‚   â”œâ”€â”€ group-queue.ts           #   Per-group message queue & concurrency
â”‚   â”‚   â”œâ”€â”€ task-scheduler.ts        #   Cron-based task scheduling
â”‚   â”‚   â”œâ”€â”€ ipc.ts                   #   HMAC-signed IPC with containers
â”‚   â”‚   â”œâ”€â”€ heartbeat.ts             #   Periodic status reports
â”‚   â”‚   â”œâ”€â”€ cost-intelligence.ts     #   Budget enforcement & model auto-downgrade
â”‚   â”‚   â””â”€â”€ command-registry.ts      #   Slash command definitions
â”‚   â””â”€â”€ container/                   #   Agent container image
â”‚       â”œâ”€â”€ Dockerfile               #     Full runtime: Node + Chromium + Python + Claude
â”‚       â”œâ”€â”€ Dockerfile.lite          #     Lite runtime: text/code focus (no Chromium)
â”‚       â””â”€â”€ agent-runner/            #     Agent entrypoint + MCP bridges
â”‚           â”œâ”€â”€ src/index.ts          #       Claude Agent SDK orchestration
â”‚           â”œâ”€â”€ src/oracle-mcp-http.ts#       Oracle MCP-HTTP bridge
â”‚           â””â”€â”€ src/ipc-mcp-stdio.ts  #       Host communication MCP server
â”‚
â”œâ”€â”€ oracle-v2/                       # ðŸ§  Knowledge Engine ("The Brain")
â”‚   â”œâ”€â”€ src/
â”‚   â”‚   â”œâ”€â”€ server.ts                #   Hono.js HTTP API (19+ MCP tools)
â”‚   â”‚   â”œâ”€â”€ indexer.ts               #   Batch indexer + Thai NLP + smart chunking
â”‚   â”‚   â”œâ”€â”€ embedder.ts              #   Pluggable embedding interface
â”‚   â”‚   â”œâ”€â”€ chunker.ts               #   Bilingual smart chunker (overlap)
â”‚   â”‚   â”œâ”€â”€ query-classifier.ts      #   Adaptive search query analysis
â”‚   â”‚   â”œâ”€â”€ chroma-http.ts           #   ChromaDB client (client-side embeddings)
â”‚   â”‚   â””â”€â”€ db/                      #   Drizzle ORM schema & migrations
â”‚   â”œâ”€â”€ frontend/                    #   React dashboard (Vite, 15 pages)
â”‚   â”œâ”€â”€ scripts/                     #   Migration & utility scripts
â”‚   â””â”€â”€ Ïˆ/memory/                    #   Knowledge base (Markdown files)
â”‚       â”œâ”€â”€ learnings/               #     Facts and insights
â”‚       â”œâ”€â”€ resonance/               #     Patterns and principles
â”‚       â””â”€â”€ retrospectives/          #     Session reflections
â”‚
â”œâ”€â”€ thai-nlp-sidecar/                # ðŸ‡¹ðŸ‡­ Thai Language Processing (optional)
â”‚   â”œâ”€â”€ main.py                      #   FastAPI server wrapping PyThaiNLP
â”‚   â””â”€â”€ requirements.txt             #   fastapi, uvicorn, pythainlp
â”‚
â”œâ”€â”€ groups/                          # ðŸ‘¥ Agent Group Workspaces
â”‚   â”œâ”€â”€ global/                      #   Shared prompts + runtime souls (SOUL_FON/SOUL_CODEX/SOUL fallback)
â”‚   â””â”€â”€ main/                        #   Default admin group
â”‚
â”œâ”€â”€ docs/                            # ðŸ“š Documentation
â”‚   â”œâ”€â”€ DEPLOYMENT.md                #   Linux VPS production deployment guide
â”‚   â”œâ”€â”€ QUICKSTART.md                #   Local development setup guide
â”‚   â”œâ”€â”€ MASTER_PLAN/                 #   7-phase architecture roadmap (all complete)
â”‚   â””â”€â”€ releases/                    #   Detailed release notes per version
â”‚
â”œâ”€â”€ docker-compose.yml               # Development stack (3 services)
â”œâ”€â”€ docker-compose.production.yml    # Production stack (resource limits, logging)
â”œâ”€â”€ Dockerfile.nanoclaw              # NanoClaw multi-stage build
â””â”€â”€ ecosystem.config.js              # PM2 alternative deployment config
```

---

## ðŸ’ª Strengths & Limitations

### âœ… Strengths

| Area | Details |
|------|---------|
| **ðŸ§  Genuine AI Memory** | 5-layer cognitive memory model with temporal decay, confidence scoring, and reinforcement. Your AI remembers context across sessions â€” not just chat history. |
| **ðŸ” Smart Search** | Adaptive hybrid search automatically selects the right strategy (exact vs. semantic vs. mixed) and self-corrects when results are poor. Zero manual tuning. |
| **ðŸ³ Security by Isolation** | Every AI execution runs in a sandboxed Docker container with resource limits, restricted networking, and non-root privileges. No shared state between requests. |
| **ðŸ”Œ Extensible via MCP** | Model Context Protocol provides a standardized tool interface. 19+ built-in tools; add new capabilities by writing MCP servers or skill files. |
| **ðŸŒ Bilingual (Thai + English)** | First-class Thai language support â€” tokenization (PyThaiNLP), smart chunking, bilingual search, Thai timezone handling, Thai command descriptions. |
| **ðŸ“Š Rich Observability** | React dashboard with 15 pages: search, activity feed, knowledge graph, decision tracking, request tracing, forum threads, and admin panels. |
| **ðŸ’° Cost Intelligence** | Automatic budget enforcement, per-session cost tracking, model auto-downgrade when approaching limits, and cost analytics via `/cost` command. |
| **ðŸ”§ Skills-based Extension** | Add capabilities by writing Claude Code skill files rather than modifying core code. Hot-loadable at runtime without redeployment. |
| **ðŸ“¦ Self-contained** | Single `docker compose up` deploys everything. No external databases, no cloud dependencies (beyond the LLM API key). |
| **ðŸ›¡ Production Hardened** | Health checks on all services, graceful shutdown, auto-restart, log rotation, memory limits, encrypted auth, and HMAC-signed IPC. |

### âš ï¸ Limitations

| Area | Details | Mitigation |
|------|---------|------------|
| **ðŸ’» Resource Intensive** | Full agent image includes Chromium + Python + Node.js. | Use lite variant (`nanoclaw/container/Dockerfile.lite`) with `CONTAINER_IMAGE=nanoclaw-agent-lite:latest` for text/code-first workloads. |
| **ðŸ§ Linux-only for Production** | Docker Compose deployment has volume path/permission issues on Windows/macOS. Development works cross-platform. | Use a **Linux VPS** (Ubuntu 22.04+ recommended) for production deployments. |
| **ðŸ“± WhatsApp Fragility** | WhatsApp integration uses Baileys (unofficial API) â€” can break with WhatsApp updates; session management requires careful handling. | Telegram is the primary, stable channel. WhatsApp is available but considered experimental. |
| **ðŸ¤– Single AI Provider** | Currently optimized for Anthropic Claude via the official Agent SDK. No native OpenAI or local model support. | Works with any Anthropic-compatible proxy (e.g., Z.AI GLM endpoints). |
| **ðŸ‡¹ðŸ‡­ Thai NLP Optional** | Thai NLP sidecar is **disabled by default**. Without it, Thai search falls back to whitespace tokenization with reduced accuracy. | Run with profile: `docker compose --profile thai-nlp up -d --build` for full Thai support. |
| **ðŸ“ˆ No Horizontal Scaling** | Single-instance architecture (stateful SQLite sessions). Cannot distribute across multiple servers. | Designed for personal use (1â€“5 users). Vertical scaling (bigger VPS) works well. |
| **â± Cold Start Latency** | First message after idle requires container startup (~5â€“15 seconds). | Container pool pre-warms instances. Tune pool size and timeout to reduce cold starts. |
| **ðŸ“ Documentation Maintenance** | English docs are canonical; Thai translations may lag behind latest edits. | Follow `docs/LANGUAGE_POLICY.md` and update `docs/th/` pages when canonical docs change. |

---

## ï¿½ System Requirements

### Minimum (Development)

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| **CPU** | 2 cores | 4+ cores |
| **RAM** | 2 GB | 4â€“8 GB |
| **Disk** | 10 GB | 20+ GB (Chromium image + ChromaDB data) |
| **OS** | Any (with Docker Desktop) | Ubuntu 22.04+ / Debian 12+ |
| **Docker** | Docker Desktop or Engine v24+ | Latest stable |
| **Network** | Outbound HTTPS (API calls) | Static IP for Telegram webhook |

### Production (VPS)

| Resource | Recommended | Notes |
|----------|-------------|-------|
| **CPU** | 4 vCPU | Agent containers are CPU-hungry during code generation |
| **RAM** | 8 GB | Each container uses ~512 MB; stack itself uses ~2 GB |
| **Disk** | 40 GB SSD | NVMe preferred for SQLite + ChromaDB performance |
| **OS** | Ubuntu 22.04 LTS | Windows/macOS not supported in production |
| **Bandwidth** | 100 Mbps+ | Embedding model downloads + API calls |

> **Cost estimate:** A 4 vCPU / 8 GB VPS on Hetzner or DigitalOcean runs ~$20â€“40/month. The primary ongoing cost is the Anthropic API key (~$5â€“50/month depending on usage).

---

## ï¿½ðŸš¢ Deployment

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
- **Log rotation** â€” JSON file driver, 50 MB max, 5 files
- **Oracle port** â€” bound to `127.0.0.1` only (use reverse proxy for external)
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
# Linux/macOS
./scripts/backup.sh --dry-run
./scripts/backup.sh
./scripts/verify-backup.sh backups/jellycore-backup-<UTC_TIMESTAMP>.tar.gz
./scripts/restore.sh backups/jellycore-backup-<UTC_TIMESTAMP>.tar.gz --dry-run
```

```powershell
# Windows (Git Bash)
& 'C:\Program Files\Git\bin\bash.exe' -lc "cd '/c/path/to/jellycore' && ./scripts/backup.sh --dry-run"
& 'C:\Program Files\Git\bin\bash.exe' -lc "cd '/c/path/to/jellycore' && ./scripts/backup.sh"
& 'C:\Program Files\Git\bin\bash.exe' -lc "cd '/c/path/to/jellycore' && ./scripts/verify-backup.sh backups/jellycore-backup-<UTC_TIMESTAMP>.tar.gz"
```

---

## ðŸ”§ Troubleshooting

### Common Issues

<details>
<summary><strong>Container won't start â€” "image not found"</strong></summary>

```bash
# Rebuild the agent container image
docker build -t nanoclaw-agent:latest -f nanoclaw/container/Dockerfile nanoclaw/container

# Verify it exists
docker images | grep nanoclaw-agent
```

If `.env` sets `CONTAINER_IMAGE` to a custom tag, build that exact tag.

</details>

<details>
<summary><strong>Oracle health check fails</strong></summary>

```bash
# Check Oracle logs
docker compose logs oracle

# Common cause: ChromaDB not ready yet
docker compose logs chromadb

# Verify network connectivity
docker compose exec nanoclaw curl http://oracle:47778/api/health
```

Oracle waits for ChromaDB to be healthy. If ChromaDB is stuck, restart it:
```bash
docker compose restart chromadb
```

</details>

<details>
<summary><strong>Telegram bot not responding</strong></summary>

1. Verify `TELEGRAM_BOT_TOKEN` is correct in `.env`
2. Check NanoClaw logs: `docker compose logs -f nanoclaw`
3. Ensure the bot is not running elsewhere (Telegram allows only one active connection per bot token)
4. Try `/ping` â€” if the bot responds, the issue is container startup, not Telegram

</details>

<details>
<summary><strong>High memory usage / OOM kills</strong></summary>

```bash
# Reduce concurrent containers
MAX_CONCURRENT_CONTAINERS=1

# Lower container memory limit
CONTAINER_MEMORY_LIMIT=256m

# Check current memory usage
docker stats --no-stream
```

</details>

<details>
<summary><strong>WhatsApp session keeps disconnecting</strong></summary>

WhatsApp uses the Baileys unofficial API. Sessions can break after WhatsApp server updates.

```bash
# Re-authenticate
cd nanoclaw && npm run auth

# Clear old session data
rm -rf data/sessions/main/
```

Telegram is the recommended stable channel.

</details>

<details>
<summary><strong>Thai search returning poor results</strong></summary>

Enable the Thai NLP sidecar:
1. Run `docker compose --profile thai-nlp up -d --build`
2. (Optional) set `THAI_NLP_URL` in `.env` if using a non-default host
3. Reindex: `cd oracle-v2 && bun run reindex:thai-nlp`

Without the sidecar, Thai text is split on whitespace only.

</details>

<details>
<summary><strong>"JELLYCORE_AUTH_PASSPHRASE too short" error</strong></summary>

The passphrase must be at least 16 characters. Generate a strong one:
```bash
openssl rand -base64 24
```

</details>

### Debug Commands

| Command | Purpose |
|---------|---------|
| `docker compose logs -f nanoclaw` | Stream NanoClaw logs |
| `docker compose logs -f oracle` | Stream Oracle logs |
| `docker compose ps` | Check service health |
| `docker stats --no-stream` | Memory/CPU per container |
| `curl localhost:47778/api/health` | Oracle health check |
| `curl localhost:47779/health` | NanoClaw health check |
| `curl localhost:47779/status` | Full system status |

---

## â“ FAQ

**Q: Can I use OpenAI / GPT instead of Claude?**
A: Not natively. JellyCore is built on the Claude Agent SDK. However, any Anthropic-compatible proxy (e.g., Z.AI GLM endpoints) works by setting `ANTHROPIC_BASE_URL`. Native OpenAI support is on the roadmap.

**Q: Is this safe to run on a public server?**
A: Yes, with precautions. The Oracle API should stay behind a reverse proxy (bound to `127.0.0.1` in compose). Agent containers have restricted networking. Auth tokens protect sensitive endpoints (`/api/nanoclaw/*`, logs, and memory-admin routes). See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

**Q: How much does it cost to run?**
A: VPS: ~$20â€“40/month. Anthropic API: ~$5â€“50/month depending on usage. The `/cost` and `/budget` Telegram commands help monitor spend. Cost intelligence auto-downgrades models when approaching budget limits.

**Q: Can multiple people use the same instance?**
A: Yes, via agent groups. Each group (chat/channel) gets isolated context, memory, and container sandboxes. Designed for 1â€“5 users on a single instance.

**Q: What happens if the server restarts?**
A: All state persists. SQLite databases, knowledge files, and scheduled tasks survive restarts. Active container sessions are lost but the queue recovers gracefully.

**Q: How do I add new knowledge to the AI?**
A: Three ways: (1) Tell the AI directly â€” it automatically stores via `oracle_learn`, (2) Add Markdown files to `oracle-v2/Ïˆ/memory/` and reindex, (3) Use the React dashboard's knowledge management UI.

**Q: Does it support voice messages?**
A: Not yet. Voice message processing is on the roadmap.

---

## ðŸ”— Related Projects & Acknowledgments

| Project | Relationship |
|---------|-------------|
| [OpenClaw](https://github.com/openclaw/openclaw) | Inspiration â€” JellyCore's NanoClaw was built as a simpler, security-focused alternative |
| [Claude Code](https://code.claude.com) | Runtime â€” Agent execution uses the official Claude Agent SDK |
| [ChromaDB](https://www.trychroma.com/) | Vector store â€” powers semantic similarity search |
| [grammY](https://grammy.dev/) | Telegram bot framework |
| [Baileys](https://github.com/WhiskeySockets/Baileys) | WhatsApp client library |
| [Hono](https://hono.dev/) | HTTP framework for Oracle V2 |
| [Drizzle ORM](https://orm.drizzle.team/) | Type-safe database ORM |
| [PyThaiNLP](https://pythainlp.github.io/) | Thai language processing |

---

## ðŸ§ª Development

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
# Oracle V2 â€” Vitest with V8 coverage
cd oracle-v2
bun test                                # All tests
bun test src/query-classifier.test.ts   # Query classifier
bun test src/chunker.test.ts            # Smart chunker

# NanoClaw â€” Vitest
cd nanoclaw
npm test

# E2E â€” Playwright
cd oracle-v2
bun run test:e2e
```

### Knowledge Indexing

```bash
# Index all Ïˆ/memory/ files into Oracle (FTS5 + ChromaDB vectors)
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

## ðŸ—º Roadmap

All 7 phases of the original master plan have been **completed**:

| Phase | Focus | Status |
|-------|-------|--------|
| **Phase 0** | Security Foundation â€” IPC signing, encrypted auth, mount validation | âœ… Complete |
| **Phase 1** | Performance â€” Adaptive hybrid search, pluggable embeddings, smart chunking | âœ… Complete |
| **Phase 2** | Architecture Hardening â€” Drizzle ORM, modular handlers, graceful shutdown | âœ… Complete |
| **Phase 3** | Reliability â€” Auto-reconnection, container pool, dead letter queue | âœ… Complete |
| **Phase 4** | Integration â€” 5-layer memory, Telegram channel, MCP tools expansion | âœ… Complete |
| **Phase 5** | Production Polish â€” Streaming UX, cost intelligence, observability, context mastery | âœ… Complete |
| **Phase 6** | Scheduler & Heartbeat â€” Cron hardening, idle preemption, heartbeat jobs | âœ… Complete |

### Future Directions

- ðŸ”„ Telegram Webhook mode (replacing long-polling)
- ðŸ¤– Multi-provider LLM support (OpenAI, local models via Ollama)
- ðŸ“ˆ Horizontal scaling with shared state layer
- ðŸŽ™ Voice message processing
- ðŸ§© Plugin marketplace for community skills
- ðŸ Swarm+Codex policy packs (`AGENT.md`) for per-group routing strategy
- ðŸ“Š Codex auth/mode observability widgets and alerting
- ðŸ§µ Session-aware Codex runtime (optional stateful mode after v1 stabilization)

---

## ðŸ“š Documentation

| Document | Description |
|----------|-------------|
| [docs/QUICKSTART.md](docs/QUICKSTART.md) | Local development setup guide |
| [docs/th/QUICKSTART_TH.md](docs/th/QUICKSTART_TH.md) | Thai quickstart translation |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Linux VPS production deployment guide |
| [docs/RECOVERY.md](docs/RECOVERY.md) | Backup, verification, and restore runbook |
| [docs/LANGUAGE_POLICY.md](docs/LANGUAGE_POLICY.md) | Documentation language and translation policy |
| [docs/CRITICAL_PROBLEMS_ANALYSIS.md](docs/CRITICAL_PROBLEMS_ANALYSIS.md) | Full-stack audit â€” 18 critical/high issues with remediation plan |
| [docs/HUMAN_FRIEND_AI_PLAN.md](docs/HUMAN_FRIEND_AI_PLAN.md) | 5-phase plan to evolve JellyCore into a genuine AI companion |
| [docs/CODEX_AUTH_REQUIRED_SWARM.md](docs/CODEX_AUTH_REQUIRED_SWARM.md) | Swarm + Codex auth-required operations |
| [docs/CODEX_PERSONA_ORACLE_5LAYER_PLAN_v3.md](docs/CODEX_PERSONA_ORACLE_5LAYER_PLAN_v3.md) | Detailed rollout + phase status for Codex persona and Oracle 5-layer memory |
| [docs/MASTER_PLAN/](docs/MASTER_PLAN/) | Complete architecture roadmap (7 phases) |
| [docs/releases/](docs/releases/) | Detailed release notes for all versions |
| [nanoclaw/README.md](nanoclaw/README.md) | NanoClaw â€” orchestrator documentation |
| [oracle-v2/README.md](oracle-v2/README.md) | Oracle V2 â€” knowledge engine documentation |
| [nanoclaw/docs/SPEC.md](nanoclaw/docs/SPEC.md) | Technical specification |
| [nanoclaw/docs/SECURITY.md](nanoclaw/docs/SECURITY.md) | Security model & threat analysis |

---

## ðŸ“‹ Version History

| Version | Highlights |
|---------|-----------|
| **v0.9.0** | Swarm+Codex hardening: auth-required Codex, dual persona, 5-layer `<ctx>` with `<working>`, Codex write-back and runtime working memory |
| **v0.8.1** | Task scheduler fix â€” idle container preemption for scheduled task execution |
| **v0.8.0** | Production polish â€” streaming UX, cost intelligence, context auto-compaction, observability |
| **v0.7.1** | Memory reliability improvements and edge case fixes |
| **v0.7.0** | Five-layer cognitive memory system with temporal decay and confidence scoring |
| **v0.6.0** | Adaptive hybrid search, pluggable embedder, bilingual smart chunking, Thai NLP indexer |
| **v0.5.0** | Thai NLP sidecar, embedding versioning, Docker 4-service stack |
| **v0.4.0** | ChromaDB dual indexing, hybrid FTS5 + vector search, Oracle V2 foundation |

---

## ðŸ¤ Contributing

JellyCore follows a **"Skills over Features"** contribution model:

> *"Don't add features. Add skills."*

Instead of traditional PRs that expand the codebase, contributors write **Claude Code skill files** â€” reusable instruction sets that teach the AI new capabilities. This keeps the core small while making the platform endlessly extensible.

See [nanoclaw/CONTRIBUTING.md](nanoclaw/CONTRIBUTING.md) for full guidelines.

---

## ðŸ“„ License

MIT License â€” see [LICENSE](nanoclaw/LICENSE) for details.

Copyright Â© 2026 [Gavriel](https://github.com/b9b4ymiN)

---

<p align="center">
  <sub>Built with ðŸª¼ by <a href="https://github.com/b9b4ymiN">b9b4ymiN</a> â€” Because your AI should remember you.</sub>
</p>





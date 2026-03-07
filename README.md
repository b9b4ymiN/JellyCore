# JellyCore

JellyCore is a self-hosted AI platform with:
- persistent memory (Oracle V2),
- multi-channel orchestration (NanoClaw),
- isolated container execution for agent tasks,
- web operations UI (`/chat`, `/live`),
- optional Thai NLP sidecar for better Thai search quality.

This README is a clean rewrite focused on current behavior and practical operations.

## 1. What You Get

- Multi-channel assistant runtime (Telegram and WhatsApp)
- Hybrid search (FTS + vector) with adaptive weighting
- 5-layer memory model (user model, procedural, semantic, episodic, working)
- Two-way web chat sync with channel timeline
- Live processing trace from container events (SSE)
- Scheduler and heartbeat operations UI
- Optional Thai NLP pipeline (normalize, spellcheck, tokenize)

## 2. Core Services

| Service | Role | Default Host Port |
|---|---|---|
| `oracle` | Knowledge API + web frontend | `47778` |
| `nanoclaw` | Orchestrator + internal health/chat/live APIs | `47779` |
| `chromadb` | Vector database (internal) | internal only |
| `thai-nlp` | Thai language sidecar (optional profile) | internal only |

Important:
- Web UI lives on Oracle (`47778`), not NanoClaw (`47779`).
- If you open `http://127.0.0.1:47779/live`, `{"error":"Not found"}` is expected.

## 3. Quick Start

### 3.1 Prerequisites

- Docker Desktop (or Docker Engine + Compose v2)
- Git
- API key for your configured LLM provider
- Telegram bot token (if Telegram channel is enabled)

### 3.2 Clone and Configure

```bash
git clone https://github.com/b9b4ymiN/JellyCore.git
cd JellyCore
cp .env.example .env
```

Set at least:

```dotenv
ANTHROPIC_API_KEY=your-key
TELEGRAM_BOT_TOKEN=your-token
JELLYCORE_AUTH_PASSPHRASE=at-least-16-chars
CHROMA_AUTH_TOKEN=strong-token
ORACLE_AUTH_TOKEN=strong-token
```

### 3.3 Build Agent Image

```bash
docker build -t nanoclaw-agent:latest -f nanoclaw/container/Dockerfile nanoclaw/container
```

Optional lite image:

```bash
docker build -t nanoclaw-agent-lite:latest -f nanoclaw/container/Dockerfile.lite nanoclaw/container
```

### 3.4 Start Stack

```bash
docker compose up -d --build
```

With Thai NLP profile:

```bash
docker compose --profile thai-nlp up -d --build
```

### 3.5 Verify

```bash
docker compose ps
curl http://127.0.0.1:47778/api/health
curl http://127.0.0.1:47779/health
curl http://127.0.0.1:47779/status
```

## 4. Web Console Routes

Open:

- `http://127.0.0.1:47778/chat`
- `http://127.0.0.1:47778/live`

First access:
- The page requires admin token gate.
- Paste `ORACLE_AUTH_TOKEN` and save in browser local storage (`admin_token`).

### 4.1 `/chat` Behavior

- Sends message through Oracle proxy to NanoClaw (`POST /api/chat/send`)
- Loads timeline through Oracle proxy (`GET /api/chat/history`)
- Uses live event stream for progress updates (`GET /api/live/events`)
- Shows processing trace:
  - queued request id,
  - routing and runtime hints,
  - container start/output/end,
  - delayed response fallback note.

### 4.2 Two-way Sync

Web chat is mirrored to channel timeline:
- web user message is mirrored to channel,
- assistant reply is mirrored back to both channel and web history.

Result:
- Telegram/web history stays aligned.

## 5. Thai NLP and Search Quality

Thai pipeline is used in these paths:
- query time preprocessing: normalize -> spellcheck -> tokenize
- indexing/learn time preprocessing: normalize -> tokenize

### 5.1 Reindex with Thai NLP

```bash
cd oracle-v2
bun run reindex:thai-nlp
```

### 5.2 Verify It Is Active

1. Check `thai-nlp` logs:

```bash
docker compose logs -f thai-nlp
```

You should see requests to:
- `/normalize`
- `/spellcheck`
- `/tokenize`

2. Check search response metadata:
- `fts.tokens`
- `fts.queryMode` (`strict` or `or-fallback`)

### 5.3 FTS Fallback Strategy

For multi-token queries:
- strict query runs first,
- if strict has no result, token OR fallback is used.

This improves recall for Thai and mixed-language inputs.

### 5.4 Thai-only Learn Input Fix

`oracle_learn` now handles Thai-only patterns safely:
- fallback slug (`entry-*`) when ASCII slug is empty,
- suffixing (`-2`, `-3`, ...) to avoid filename collisions.

## 6. Telegram Formatting Notes

Telegram output conversion is hardened:
- better MarkdownV2 escaping,
- Markdown/ASCII table conversion to code blocks,
- plain-text fallback when Telegram parse fails.

This avoids artifacts like raw `**bold**` and broken table borders.

## 7. Common Commands

```bash
# logs
docker compose logs -f nanoclaw
docker compose logs -f oracle
docker compose logs -f thai-nlp

# health/status
curl http://127.0.0.1:47778/api/health
curl http://127.0.0.1:47779/health
curl http://127.0.0.1:47779/status

# rebuild one service
docker compose up -d --build oracle
docker compose up -d --build nanoclaw
```

## 8. Troubleshooting

### 8.1 `/live` or `/chat` does not work

Checklist:
- open `47778` routes, not `47779`
- verify `oracle` and `nanoclaw` are healthy
- ensure `admin_token` matches `ORACLE_AUTH_TOKEN`
- check browser console/network for `401/403`

### 8.2 Chat shows `Reconnecting`

- Live SSE is disconnected.
- UI falls back to timed hints and history polling.
- verify `/api/live/events` auth and service health.

### 8.3 Thai search is weak

- start with Thai NLP profile enabled
- run reindex command
- verify sidecar log endpoints
- inspect `fts.queryMode` in search response

### 8.4 Web request delayed

- Check container startup time in trace panel
- Check model output stream delays in logs
- Use `/chat` trace and `/status` to identify queue/backlog

## 9. Key Paths

| Path | Purpose |
|---|---|
| `nanoclaw/src` | Orchestrator logic, channel routing, container runner |
| `nanoclaw/src/health-server.ts` | Health/status/chat/live endpoints |
| `oracle-v2/src/server` | Oracle API routes and handlers |
| `oracle-v2/frontend/src/pages/Chat.tsx` | Web `/chat` UI |
| `oracle-v2/frontend/src/pages/LiveOps.tsx` | Web `/live` UI |
| `oracle-v2/src/server/routes/chat-proxy.ts` | Oracle chat proxy |
| `oracle-v2/src/server/routes/live-proxy.ts` | Oracle live SSE proxy |
| `oracle-v2/src/thai-nlp-client.ts` | Thai NLP client |
| `oracle-v2/scripts/reindex-with-thai-nlp.ts` | Reindex script |
| `thai-nlp-sidecar` | Optional Thai NLP service |

## 10. Documentation

- `docs/QUICKSTART.md`
- `docs/DEPLOYMENT.md`
- `docs/RECOVERY.md`
- `docs/API_REFERENCE_TH.md`
- `docs/MASTER_PLAN/`
- `docs/releases/`

## 11. License

MIT. See `LICENSE`.


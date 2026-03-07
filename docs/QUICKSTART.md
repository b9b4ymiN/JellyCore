# JellyCore Quickstart (English)

This is the canonical quickstart in English. Thai translation is available at `docs/th/QUICKSTART_TH.md`.

## 1) Prerequisites

- Docker Desktop running
- Node.js 20+
- Bun 1.3+
- Git

## 2) Environment file

Copy `.env.example` to `.env` and fill required secrets:

```powershell
Copy-Item .env.example .env
```

Important defaults:

- `AGENT_FULL_ACCESS=false` (recommended secure default)
- Configure `ORACLE_AUTH_TOKEN` for protected Oracle routes
- Optionally set `ORACLE_ALLOWED_ORIGINS` for browser CORS allowlist
- Optional host-port overrides: `ORACLE_HOST_PORT`, `NANOCLAW_HOST_PORT`
- Provider abstraction (default): `LLM_PROVIDER=claude` (`openai`/`ollama` optional)

## 3) Start services with Docker

```powershell
docker compose up -d chromadb oracle docker-socket-proxy nanoclaw
docker compose ps
```

Health checks:

```powershell
curl http://127.0.0.1:47778/api/health
curl http://127.0.0.1:47779/health
curl http://127.0.0.1:47779/metrics
curl http://127.0.0.1:47778/metrics
```

## 4) Run tests (recommended)

```powershell
cd nanoclaw; npm test
cd ../oracle-v2; bun test src/integration/http.test.ts
cd ../oracle-v2; bun test src/integration/security-http.test.ts
cd ../oracle-v2; bun run test:e2e
cd ../oracle-v2/frontend; bun run build
cd ../../thai-nlp-sidecar; pytest tests -q
```

## 5) Optional Thai NLP sidecar

```powershell
docker compose --profile thai-nlp up -d thai-nlp
```

Oracle will still run if sidecar is unavailable (graceful fallback).

## 6) Backup/restore

```powershell
# Linux/macOS shell
./scripts/backup.sh --dry-run
./scripts/backup.sh
./scripts/verify-backup.sh backups/<snapshot>.tar.gz
./scripts/restore.sh backups/<snapshot>.tar.gz --dry-run

# Windows PowerShell (invoke Git Bash)
& 'C:\Program Files\Git\bin\bash.exe' -lc "cd '/c/path/to/jellycore' && ./scripts/backup.sh --dry-run"
& 'C:\Program Files\Git\bin\bash.exe' -lc "cd '/c/path/to/jellycore' && ./scripts/backup.sh"
```

See `docs/RECOVERY.md` for full recovery steps.

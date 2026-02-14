# 5.5 — Documentation Suite

> เอกสารครบ 5 ชุด — เพื่อให้ maintain, debug, recover ได้แม้ผ่านไปนาน

**Status:** ⬜ Not Started  
**Effort:** Large  
**Priority:** 🔴 High  
**Weakness Ref:** —

---

## 🎯 เป้าหมาย

เอกสาร 5 ชุดที่ครอบคลุม: Architecture, Security, Recovery, Runbook, API — เพื่อให้ operate ระบบได้อย่างมั่นใจ

---

## ✅ Checklist

### 1. ARCHITECTURE.md

- [ ] System overview diagram (ASCII)
- [ ] Component descriptions:
  - NanoClaw — role, tech stack, key files
  - Oracle V2 — role, tech stack, key files
  - ChromaDB — role, usage pattern
  - Dashboard — role, access
- [ ] Data flow diagram:
  - Message in → Queue → Container → Oracle → Response
  - Learn flow → Oracle → SQLite + ChromaDB
- [ ] Communication protocols:
  - NanoClaw ↔ Oracle: HTTP REST
  - NanoClaw ↔ WhatsApp: Baileys WebSocket
  - NanoClaw ↔ Telegram: Bot API polling/webhook
  - NanoClaw ↔ Containers: Docker API + filesystem IPC
  - Oracle ↔ ChromaDB: HTTP client
- [ ] Directory structure (tree)
- [ ] Technology decisions rationale:
  - Why MCP-HTTP Bridge (not subprocess)
  - Why PM2 (not systemd for app)
  - Why Caddy (not nginx)
  - Why LUKS (not app-level encryption)

### 2. SECURITY.md

- [ ] Threat model:
  - VPS compromise scenario
  - API key leak scenario
  - WhatsApp session hijack
  - Container escape (mitigated)
- [ ] Security measures:
  - LUKS encryption at rest
  - WhatsApp auth encryption (AES-256-GCM)
  - Container mount restrictions (read-only /workspace)
  - IPC HMAC signing
  - ChromaDB token authentication
  - Caddy auto-TLS
  - Docker socket read-only mount
- [ ] Secret management:
  - `.env` file (not in Git)
  - Docker secrets (optional upgrade path)
  - Keyfile permissions (400)
- [ ] Access control:
  - Dashboard: basic auth via Caddy
  - Oracle API: localhost only (or basic auth)
  - ChromaDB: token auth
- [ ] Incident response:
  - Key rotation procedure
  - Session invalidation steps
  - Data breach checklist

### 3. RECOVERY.md

- [ ] Backup strategy:
  - What: SQLite DB, ChromaDB, WhatsApp auth
  - When: Every 6 hours (cron)
  - Where: `/data/jellycore/backups/` + off-site
  - Retention: 30 backups
- [ ] Recovery procedures:
  - **Full restore:** `scripts/restore.sh <backup-name>`
  - **Oracle DB only:** `sqlite3 restore` command
  - **WhatsApp re-auth:** QR code re-scan procedure
  - **ChromaDB rebuild:** Re-index from SQLite source
- [ ] Disaster recovery:
  - New VPS setup from scratch (time estimate)
  - Data import from off-site backup
  - DNS/Caddy reconfiguration
- [ ] Testing backup integrity:
  - Monthly test restore to temp directory
  - Verify document count matches

### 4. RUNBOOK.md

- [ ] Day-to-day operations:
  ```
  # Start system
  ./scripts/deploy.sh start
  
  # Stop system
  ./scripts/deploy.sh stop
  
  # View logs
  ./scripts/deploy.sh logs [service]
  
  # Check health
  ./scripts/deploy.sh health
  
  # Manual backup
  ./scripts/backup.sh
  ```
- [ ] Common issues & solutions:
  - WhatsApp disconnected → `scripts/reauth-whatsapp.sh`
  - Oracle not responding → `docker compose restart oracle`
  - ChromaDB slow → check disk space, restart
  - Container stuck → `docker rm -f <container>`
  - Queue backed up → check rate limiter, increase concurrency
  - High memory → check for orphan containers
- [ ] Monitoring:
  - Health endpoint URLs
  - What to check in `/metrics`
  - Alert webhook setup
- [ ] Scaling considerations:
  - When to upgrade VPS (memory > 80% sustained)
  - When to add ChromaDB resources
  - Message volume thresholds

### 5. API.md

- [ ] Oracle API endpoints:
  ```
  GET  /health          — Health check
  POST /oracle/consult  — Query knowledge base
  POST /oracle/learn    — Store new knowledge
  GET  /oracle/search   — Search documents
  POST /oracle/decisions/create — Create decision
  GET  /oracle/decisions       — List decisions
  ... (all 19 MCP tools documented)
  ```
- [ ] Request/Response examples:
  ```json
  // POST /oracle/consult
  Request:
  { "query": "What is TypeScript?" }
  
  Response:
  {
    "answer": "...",
    "sources": [...],
    "confidence": 0.95
  }
  ```
- [ ] Error codes:
  - 400: Bad request (missing fields)
  - 401: Unauthorized (wrong token)
  - 429: Rate limited
  - 503: Service unavailable
- [ ] Rate limits documentation
- [ ] NanoClaw internal endpoints:
  - `GET /health` — System health
  - `GET /metrics` — Prometheus metrics

### ทดสอบ (Documentation Review)

- [ ] All 5 documents created
- [ ] No broken links or references
- [ ] Code examples are runnable
- [ ] Procedures verified by executing them
- [ ] Another person can follow RUNBOOK to operate system

---

## 🧪 Definition of Done

1. 5 documents: ARCHITECTURE.md, SECURITY.md, RECOVERY.md, RUNBOOK.md, API.md
2. All procedures tested and verified
3. Diagrams accurate to final implementation
4. Code examples copy-pasteable and working
5. Readable by someone unfamiliar with the project

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `docs/ARCHITECTURE.md` | JellyCore | **Create** |
| `docs/SECURITY.md` | JellyCore | **Create** |
| `docs/RECOVERY.md` | JellyCore | **Create** |
| `docs/RUNBOOK.md` | JellyCore | **Create** |
| `docs/API.md` | JellyCore | **Create** |

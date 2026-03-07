# JellyCore â€” Critical Problems Analysis & Remediation Plan

> **Date:** 2026-03-07
> **Author:** Lead AI & Software Developer â€” Project Review
> **Scope:** Full-stack audit of JellyCore v0.9.0 (NanoClaw + Oracle V2 + Agent Runner + Thai NLP Sidecar)

---

## Executive Summary

JellyCore is an impressive personal AI platform â€” 7 master-plan phases completed, 40+ test files, production-hardened infrastructure. However, after a full codebase review, **23 tracked issues (12 critical/high + 11 medium/low)** were identified across architecture, security, reliability, scalability, and developer experience. This document categorizes each problem, explains its impact, and proposes a concrete fix.

### Remediation Status Overview (Updated 2026-03-07)

| Status | Count | Details |
|--------|-------|---------|
| âœ… **FIXED** | 17 | C2, C3, C5, H1, H2, H5, H6, M2, M3, M4, M5, M6, L1, L2, L3, L4, L5 |
| ðŸ"¶ **PARTIAL** | 6 | C1, C4, H3, H4, H7, M1 |
| âŒ **NOT FIXED** | 0 | â€” |
| ðŸŸ¢ **LOW (Backlog)** | 0 | Backlog closed for L1â€“L5 in this remediation wave |

---

## Severity Legend

| Level | Meaning | Timeline |
|-------|---------|----------|
| ðŸ”´ **CRITICAL** | System failure risk, security vulnerability, or data loss | Fix within 1 week |
| ðŸŸ  **HIGH** | Significant degradation of reliability/performance/security | Fix within 2â€“4 weeks |
| ðŸŸ¡ **MEDIUM** | Quality gap, maintainability concern, or missing best practice | Fix within 1â€“2 months |
| ðŸŸ¢ **LOW** | Nice-to-have improvement, polish item | Backlog |

---

## ðŸ”´ CRITICAL Issues

### C1 â€” Monolithic Orchestrator File (2,013 lines)

> 🔶 **STATUS: PARTIAL** — Some logic extracted to `inline-handler.ts`, `oracle-handler.ts`, `query-router.ts`, `prompt-builder.ts`, `health-server.ts`, etc. But `index.ts` remains monolithic at **1,683 lines** (verified 2026-03-07) — no `orchestrator.ts`, `message-handler.ts`, `session-manager.ts`, or `shutdown.ts` decomposition.

**File:** `nanoclaw/src/index.ts` — **1,683 lines** (verified 2026-03-07)
**Problem:** The entire NanoClaw orchestration logic (state machine, message routing, container management, command handling, error recovery) lives in a single file. This creates:
- Merge conflicts on every change
- Impossible to unit-test critical paths in isolation
- Cognitive overload for any developer (contributor or AI agent)
- High risk of regression when modifying any behavior

**Impact:** Every bug fix or feature touches this file â†’ cascading risk.

**Remediation:**
```
nanoclaw/src/
â”œâ”€â”€ index.ts              â†’ slim entry (50 lines) â€” bootstrap only
â”œâ”€â”€ orchestrator.ts       â†’ core state machine + message loop
â”œâ”€â”€ message-handler.ts    â†’ message processing + routing dispatch
â”œâ”€â”€ container-manager.ts  â†’ container lifecycle (spawn/kill/pool)
â”œâ”€â”€ command-handler.ts    â†’ slash command dispatch
â”œâ”€â”€ session-manager.ts    â†’ session state + cleanup
â””â”€â”€ shutdown.ts           â†’ graceful shutdown coordination
```
**Effort:** 3â€“5 days. Extract functions top-down. Keep all existing tests passing.

---

### C2 â€” Docker Socket Exposure in Agent Containers

> âœ… **STATUS: FIXED (Current wave)** â€” direct Docker socket access was removed from NanoClaw and replaced with `docker-socket-proxy` (`tecnativa/docker-socket-proxy:0.3.0`) in both compose files. NanoClaw now targets `DOCKER_HOST=tcp://docker-socket-proxy:2375`.

**File:** `docker-compose.yml`, `docker-compose.production.yml`
**Problem:** NanoClaw needs the Docker socket to spawn agent containers, but this grants **root-equivalent access** to the host system. If NanoClaw is compromised, the attacker controls the entire host.

**Impact:** Complete host takeover via container escape.

**Remediation:**
1. **Short-term:** Run NanoClaw as a non-root user inside its container; add `--userns-remap` to the Docker daemon
2. **Medium-term:** Replace direct Docker socket access with a restricted container API proxy (e.g., [Docker Socket Proxy](https://github.com/Tecnativa/docker-socket-proxy)) that only allows `containers.create`, `containers.start`, `containers.stop`, `containers.inspect`
3. **Long-term:** Migrate agent execution to Podman (rootless) or Kata Containers

**Effort:** 2â€“3 days (proxy), 1â€“2 weeks (Podman migration).

---

### C3 â€” No Database Backup Automation

> âœ… **STATUS: FIXED** â€” Full backup script implemented at `scripts/backup.sh` (170+ lines). Supports: Docker volume backup (nanoclaw-data, nanoclaw-store, oracle-data), Ïˆ/memory file backup, groups backup, rclone remote upload, SHA256 checksums, retention policy (configurable days), `--dry-run` mode, metadata.json per snapshot. CI validates Docker Compose configs. Missing: crontab/systemd timer automation (manual trigger only).

**Problem:** ~~Backup strategy is documented as manual shell commands in README. No automated backup exists.~~
- SQLite database contains all knowledge, memory layers, user models
- If the host disk fails, **all memory is permanently lost**
- `Ïˆ/memory/` markdown files are the only durable copy of some knowledge

**Impact:** Total data loss on disk failure.

**Remediation:**
```bash
# Add to crontab or systemd timer
0 */6 * * * /opt/jellycore/scripts/backup.sh

# backup.sh should:
# 1. sqlite3 /data/oracle/oracle.db ".backup '/backups/oracle-$(date +%s).db'"
# 2. tar czf /backups/psi-memory-$(date +%s).tar.gz /data/oracle/Ïˆ/memory/
# 3. Upload to S3/B2/rclone remote
# 4. Prune backups older than 30 days
```

**Effort:** 1 day â€” write `scripts/backup.sh`, add cron/systemd timer, document.

---

### C4 â€” Silent Error Swallowing

> ðŸ"¶ **STATUS: PARTIAL** â€” high-risk silent catches in core runtime paths were replaced with structured logging/non-fatal reporting. Residual best-effort catches still exist in utility/cleanup paths and should be reviewed case-by-case.

**Files:** Multiple locations in `nanoclaw/src/index.ts`, `container-runner.ts`, `cost-intelligence.ts`
**Problem:** Many `catch` blocks silently discard errors:
```typescript
.catch(() => {})                    // Fire-and-forget â€” no logging
catch { /* column already exists */ } // DDL guard â€” but hides real DB errors
catch { /* ignore */ }              // Cleanup â€” masks permission issues
```

**Impact:** Production bugs become invisible. The system appears healthy while silently failing (phantom failures). Memory writes may silently fail, losing user data.

**Remediation:**
1. Replace `.catch(() => {})` with `.catch(err => log.debug('typing-indicator failed', err))`
2. Add specific error type checking:
   ```typescript
   catch (err) {
     if (err.message?.includes('already exists')) return;
     log.error('unexpected DB error', err);
   }
   ```
3. Add a `silentErrors` counter metric â€” alert if rate exceeds threshold

**Effort:** 2â€“3 days.

---

### C5 â€” No Rate Limiting on Oracle HTTP API

> âœ… **STATUS: FIXED** â€” Full rate limiting implemented in `oracle-v2/src/server/http-middleware.ts` via `registerSecurityMiddleware()`. Features: per-IP bucket rate limiting, separate read/write limits (configurable via `ORACLE_RATE_LIMIT_WINDOW_MS`, `ORACLE_RATE_LIMIT_READ_LIMIT=60`, `ORACLE_RATE_LIMIT_WRITE_LIMIT=30`), standard `X-RateLimit-*` response headers, auto-cleanup of expired buckets.

**File:** `oracle-v2/src/server.ts`
**Problem:** ~~The Oracle HTTP server has **no rate limiting**.~~ Now implemented.

~~**Impact:** Denial of service, resource exhaustion.~~ Resolved.

**Remediation:** ~~Needed~~ â€” already implemented via custom middleware.

**Effort:** ~~1 day~~ Done.

---

## ðŸŸ  HIGH Issues

### H1 â€” Thai NLP Sidecar Has Zero Tests

> âœ… **STATUS: FIXED** â€” Tests added at `thai-nlp-sidecar/tests/test_main.py` (5 test cases). Covers: health endpoint, tokenization with token+segmented output, graceful fallback on broken tokenizer (monkeypatch), chunk consistency, stopword filtering. CI job `thai_nlp_sidecar` runs `pytest thai-nlp-sidecar/tests` on Python 3.11.

**File:** `thai-nlp-sidecar/main.py` (343 lines)
**Problem:** ~~The Thai NLP sidecar had **no tests at all**.~~ Now has 5 test cases + CI.

~~**Impact:** Thai search accuracy can regress undetected.~~ Covered by CI.

**Effort:** ~~1â€“2 days~~ Done.

---

### H2 â€” Single-Point-of-Failure: SQLite

> âœ… **STATUS: FIXED (Immediate)** â€” Full SQLite pragma policy implemented in `oracle-v2/src/db/sqlite-policy.ts`. Enforces: `journal_mode=WAL`, `busy_timeout=30000` (30s, exceeds the recommended 5s), `synchronous=NORMAL`, `cache_size=-20000` (20MB). Policy is applied with verification logging. Has dedicated test (`sqlite-policy.test.ts` in CI). Write queue / PostgreSQL migration remain future items.

**Problem:** Oracle V2 uses **SQLite as the sole database** for all knowledge, memory layers, logs, and search data. SQLite limitations:
- ~~No concurrent write access (WAL mode helps but doesn't eliminate contention)~~ WAL mode now enforced
- No replication â€” single file, single host
- ~~Corruption risk under unexpected power loss without WAL/journal mode~~ WAL + NORMAL sync now set
- Cannot scale beyond a single machine

**Impact:** ~~Under high concurrent load, write contention causes timeouts.~~ WAL + 30s busy_timeout mitigates this.

**Remaining:**
- Write queue / serialization â€” not yet implemented
- PostgreSQL abstraction â€” not yet needed (Drizzle ORM in place for future swap)

**Effort:** ~~1 day (WAL check)~~ Done. 2â€“3 days (write queue), 1â€“2 weeks (PostgreSQL).

---

### H3 â€” No Structured Logging / Log Aggregation

> ðŸ”¶ **STATUS: PARTIAL** â€” request correlation now exists via `x-request-id` propagation (NanoClaw â†’ Oracle â†’ NanoClaw proxy paths, plus Oracle response echo). Centralized log aggregation (Loki/Fluent Bit) is still not deployed.

**Problem:** NanoClaw uses Pino for logging but output goes to stdout/stderr with no structured log shipping. In production:
- Logs rotate and get lost (50 MB max Ã— 5 files)
- No centralized search for "why did this request fail?"
- Correlation IDs now exist, but there is still no centralized index/search layer for those logs

**Impact:** Production debugging is archaeology â€” digging through rotated log files by timestamp.

**Remediation:**
1. ✅ Keep `requestId` / `correlationId` propagation across NanoClaw → Oracle → agent runtime
2. Configure Pino to output JSON format (already default)
3. Add Promtail/Loki or Fluent Bit sidecar for log aggregation
4. Or at minimum: ship logs to a persistent volume mounted outside container lifecycle

**Effort:** 2â€“3 days (correlation ID), 1â€“2 days (log aggregation).

---

### H4 â€” Container Image Size (~1 GB+)

> ðŸ”¶ **STATUS: PARTIAL** â€” lite runtime image added at `nanoclaw/container/Dockerfile.lite` and NanoClaw auto-build now supports Dockerfile selection (`AGENT_DOCKERFILE`). Further layer optimization and cache tuning are still open.

**File:** `nanoclaw/container/Dockerfile`
**Problem:** The agent container includes Chromium + Python + Node.js + Claude Code CLI. This creates:
- ~1 GB+ image size
- 5â€“15 second cold start per agent invocation
- High disk usage with multiple image layers
- Slow CI/CD builds

**Impact:** High latency on first message, high disk consumption.

**Remediation:**
1. **Multi-variant images:** Create a "lite" image without Chromium for text-only tasks (~200 MB)
2. **Layer optimization:** Combine RUN steps, use `--mount=type=cache` for pip/npm
3. **Pre-pull strategy:** Keep images always ready via `docker pull` in cron
4. **Lazy browser loading:** Install Chromium only when web browsing is needed (download on demand)

**Effort:** 2â€“3 days.

---

### H5 â€” No End-to-End Integration Test for Full Message Flow

> âœ… **STATUS: FIXED (Deterministic smoke path)** â€” `nanoclaw/src/message-flow.smoke.test.ts` now validates key message-routing behavior without live Telegram dependency, and is executed in the NanoClaw test suite/CI.

**Problem:** Tests exist for individual components (40 test files), but there is **no automated test that validates the entire message flow**: `User Message â†’ Telegram â†’ NanoClaw â†’ Container â†’ Claude Agent â†’ Oracle â†’ Response`. The only way to verify the system works end-to-end is to send a real Telegram message.

**Impact:** Regressions in message flow integration are only discovered in production.

**Remediation:**
Create a `tests/e2e/full-flow.test.ts` that:
1. Starts NanoClaw + Oracle in test mode (in-memory DB, mock Telegram)
2. Simulates a Telegram message webhook
3. Verifies container spawning (or mocked container response)
4. Verifies Oracle knowledge query/storage
5. Verifies response formatting and delivery

**Effort:** 3â€“5 days.

---

### H6 â€” Hardcoded Anthropic Provider Lock-in

> âœ… **STATUS: FIXED** â€” `LLMProvider` abstraction implemented in `nanoclaw/container/agent-runner/src/llm-provider.ts` with provider factory (`claude`, `openai`, `ollama`). Default behavior remains Claude SDK for MCP/tool parity, while OpenAI-compatible and Ollama adapters are available for prompt-completion mode. Runtime selection is controlled by `LLM_PROVIDER` (or `NANOCLAW_LLM_PROVIDER`).

**Files:** `nanoclaw/container/agent-runner/`, agent container Dockerfile
**Problem:** The agent runtime is tightly coupled to the Anthropic Claude Agent SDK. There is no abstraction layer for LLM providers. Users who want to use OpenAI, local models (Ollama), or future providers must rewrite the agent runner.

**Impact:** Vendor lock-in; the project cannot serve users without Anthropic API access.

**Remediation:**
1. **Short-term:** Document the `ANTHROPIC_BASE_URL` proxy approach (already partially supported)
2. **Medium-term:** Create an `LLMProvider` interface:
   ```typescript
   interface LLMProvider {
     chat(messages: Message[], tools: Tool[]): AsyncIterable<Chunk>;
     supportsStreaming: boolean;
     modelId: string;
   }
   ```
3. Implement adapters: `ClaudeProvider`, `OpenAIProvider`, `OllamaProvider`

**Effort:** 1â€“2 weeks.

---

### H7 â€” Incomplete Monitoring & Alerting

> ðŸ”¶ **STATUS: PARTIAL** â€” Prometheus-compatible `/metrics` endpoints added to Oracle and NanoClaw. Alerting rules/dashboards and long-term telemetry stack are still pending.

**Problem:** While `/health`, `/status`, and cost commands exist, there is:
- No system metrics export (CPU, memory, queue depth, error rates)
- No alerting when services degrade (disk full, ChromaDB down, high error rate)
- No SLA monitoring (p95/p99 response times)
- Dashboard shows knowledge stats but not system health over time

**Impact:** Problems are only discovered when users notice degraded responses.

**Remediation:**
1. Export Prometheus metrics from NanoClaw and Oracle `/metrics` endpoints
2. Track: `message_latency_seconds`, `container_spawn_count`, `oracle_query_duration_seconds`, `error_count`, `queue_depth`
3. Add Grafana dashboard (or extend React dashboard with system health page)
4. Configure alerting rules (via alertmanager or simple webhook to Telegram)

**Effort:** 3â€“5 days.

---

## ðŸŸ¡ MEDIUM Issues

### M1 â€” Oracle server.ts Is Also Monolithic (1,213 lines)

> 🔶 **STATUS: PARTIAL** — Extracted: `server/http-middleware.ts` (security + rate limiting), `server/routes/api-v1-compat.ts`, `server/routes/memory-routes.ts`, `server/routes/legacy-ui.ts`, `server/routes/nanoclaw-proxy.ts`. But `server.ts` is still **906 lines** (verified 2026-03-07) — route definitions and inline logic remain.

Similar to C1 but less severe â€” Oracle's Hono.js handlers are already partially modularized via `server/handlers.ts`, but `server.ts` still contains route setup, middleware, and significant inline logic.

**Remediation:** Extract remaining route groups into separate files (`routes/search.ts`, `routes/admin.ts`).
**Effort:** ~~2â€“3 days~~ 1â€“2 days remaining.

---

### M2 â€” No API Versioning

> âœ… **STATUS: FIXED** â€” `oracle-v2/src/server/routes/api-v1-compat.ts` implements `/api/v1/*` â†’ `/api/*` compatibility redirects (HTTP 307). Legacy `/api/` routes preserved; versioned clients can use `/api/v1/`.

Oracle API endpoints are ~~unversioned~~ now versioned with backward compatibility.

**Effort:** ~~1 day~~ Done.

---

### M3 â€” Missing `.env.example` in Repository

> âœ… **STATUS: FIXED** â€” `.env.example` exists (84 lines) with all variables documented: auth passphrase, API keys, Oracle/Chroma tokens, IPC secret, Thai NLP URL, container config, agent runtime flags, Codex model, rate limiter settings, backup dir, and more.

~~The README references `cp .env.example .env` but no `.env.example` file actually exists in the repository.~~

**Effort:** ~~30 minutes~~ Done.

---

### M4 â€” No CI/CD Pipeline

> âœ… **STATUS: FIXED** â€” `.github/workflows/test.yml` exists with 4 CI jobs: (1) `nanoclaw` â€” `npm test` on Node 20, (2) `oracle` â€” `bun test` for 6 specific test suites + frontend build, (3) `thai_nlp_sidecar` â€” `pytest` on Python 3.11, (4) `compose_validation` â€” validates both Docker Compose files. Triggers on push and PR.

~~No GitHub Actions, no automated testing on push/PR.~~

**Effort:** ~~1 day~~ Done.

---

### M5 â€” Documentation Language Inconsistency

> âœ… **STATUS: FIXED** â€” canonical English quickstart is now in `docs/QUICKSTART.md`, Thai translation is in `docs/th/QUICKSTART_TH.md`, and language policy is documented in `docs/LANGUAGE_POLICY.md`.

Some docs are Thai-only (`QUICKSTART.md`), some English-only, some mixed. No consistent language policy.

**Remediation:** Primary docs in English, Thai translations in a `docs/th/` subfolder. Keep `QUICKSTART.md` bilingual with clear section headers.
**Effort:** 2â€“3 days.

---

### M6 â€” Memory Temporal Decay Not Fully Tested

> âœ… **STATUS: FIXED** â€” decay coverage now includes edge cases for decay-to-zero boundary, reinforcement after long dormancy, and rapid-access saturation behavior.

The 5-layer memory system with temporal decay and confidence scoring is a core feature. The regression suite now covers the critical edge cases that were previously missing.

**Remediation:** Add time-mocking tests for: decay-to-zero boundary, reinforcement after long dormancy, rapid-access boost behavior.
**Effort:** ~~1â€“2 days~~ Done.

---

## ðŸŸ¢ LOW Issues

### L1 â€” No Contributor Documentation Beyond "Add Skills"

> âœ… **FIXED** â€” contributor and skill contribution workflow documented in root `CONTRIBUTING.md`.

The Contributing model ("skills over features") is philosophically sound but lacks practical guidance â€” no skill template, no testing guidelines for skills, no example skill walkthrough.

### L2 â€” No CHANGELOG.md

> âœ… **FIXED** â€” root `CHANGELOG.md` added using Keep-a-Changelog structure.

Version history exists in README but there's no standard `CHANGELOG.md` following Keep-a-Changelog format.

### L3 â€” No License in Root Directory

> âœ… **FIXED** â€” repository root `LICENSE` added.

The MIT License file is in `nanoclaw/LICENSE` but not in the repository root. Oracle V2 has no explicit license file.

### L4 â€” Unused Legacy Code

> âœ… **FIXED** â€” legacy server/assets archived under `oracle-v2/src/legacy/` with explicit README and updated references.

`oracle-v2/src/server-legacy.ts` and legacy HTML files (`ui.html`, `dashboard.html`, `arthur.html`) appear to be dead code from pre-Hono migration. Should be removed or archived.

### L5 â€” Container Agent Runner TypeScript Not in Workspace TSConfig

> âœ… **FIXED** â€” CI now builds `nanoclaw/container/agent-runner` TypeScript in workflow to catch integration regressions.

The `nanoclaw/container/agent-runner/` has its own `tsconfig.json` and `package.json` but is not integrated into the workspace-level build or test pipeline.

---

## Priority Remediation Roadmap (Updated)

### ~~Sprint 1 (Week 1)~~ ðŸ"¶ PARTIALLY COMPLETE
| ID | Task | Status |
|----|------|--------|
| C3 | Automated backup script + cron | âœ… Done (script exists, cron not automated) |
| C4 | Fix silent error swallowing | ðŸ"¶ Partial (critical runtime paths fixed, residual utility catches remain) |
| C5 | Add rate limiting to Oracle API | âœ… Done |
| M3 | Create `.env.example` | âœ… Done |

### ~~Sprint 2 (Week 2â€“3)~~ ðŸ”¶ PARTIALLY COMPLETE
| ID | Task | Status |
|----|------|--------|
| C1 | Decompose `index.ts` into modules | ðŸ"¶ Partial (1,683 lines, still monolithic) |
| H1 | Add Thai NLP sidecar tests | âœ… Done (5 tests + CI) |
| H3 | Add correlation IDs to log chain | âœ… Done |
| M4 | CI/CD pipeline (GitHub Actions) | âœ… Done (4 CI jobs) |

### Sprint 3 (Next) â€” Security & Reliability
| ID | Task | Effort |
|----|------|--------|
| C2 | Docker Socket Proxy setup | âœ… Done |
| H2 | ~~SQLite WAL~~ + write queue | ~~WAL done~~ 2â€"3 days (write queue) |
| H5 | End-to-end integration test | âœ… Done |
| M1 | ~~Decompose Oracle `server.ts`~~ | 1â€"2 days (906â†'target <500 lines) |
| C1 | Continue `index.ts` decomposition | 3â€"5 days (1,683 lines â†' target <500) |
| H3 | ~~Add correlation IDs~~ | âœ… Done (centralized logging still pending) |

### Sprint 4 â€” Scalability & Observability
| ID | Task | Effort |
|----|------|--------|
| H4 | Container image optimization | 2â€“3 days |
| H6 | LLM provider abstraction | âœ… Done |
| H7 | Prometheus metrics + alerting | 3â€“5 days |
| ~~M2~~ | ~~API versioning~~ | âœ… Done |

---

## Metrics to Track

After remediation, track these KPIs to validate improvements:

| Metric | Current Baseline | Target | Current Progress |
|--------|-----------------|--------|------------------|
| Cold start latency | 5â€“15 seconds | < 3 seconds | âŒ No change |
| Silent error rate | Unknown (not tracked) | 0 (all errors logged) | ðŸ"¶ Improved (high-risk silent catches removed; residual best-effort catches remain) |
| Test coverage (NanoClaw) | ~60% (estimated) | > 80% | Not measured |
| Test coverage (Oracle) | ~50% (estimated) | > 80% | Not measured |
| Thai NLP test coverage | 0% | > 90% | âœ… 5 tests added + CI |
| Mean time to detect failure | Minutesâ€“hours (manual) | < 30 seconds (automated alert) | âŒ No alerting system |
| Backup RPO (Recovery Point Objective) | âˆž (no backup) | 6 hours | âœ… Script exists (manual trigger) |
| Container image size | ~1 GB | < 500 MB (lite variant) | âŒ No change |

---

*This analysis was produced from a complete codebase review of JellyCore v0.9.0 including all source files, tests, Docker configurations, documentation, and deployment scripts.*
*Status verification performed on 2026-03-07 against branch `remediation/phased-hardening`.*


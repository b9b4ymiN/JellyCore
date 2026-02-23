# Container Management Plan — NanoClaw

> Version: 1.0 | Date: 2026-02-23  
> Author: Architecture Review  

---

## 1. Architecture Overview (Quick Reference)

```
┌─────────────────────────────────────────────────────────────┐
│  nanoclaw (host process)                                    │
│                                                             │
│  Telegram ─► MessageBus ─► GroupQueue ─► ContainerPool     │
│                                                ↕            │
│                                         ContainerRunner     │
│                                                ↕            │
│                                    docker run nanoclaw-agent│
│                                                ↕ (IPC/file) │
│                                         IpcWatcher          │
│                                                             │
│  Heartbeat ─────────────────────────────────────────────►  │
│  TaskScheduler ─────────────────────────────────────────►  │
└─────────────────────────────────────────────────────────────┘
```

Key constants (from `.env` / defaults):

| Config | Default | Purpose |
|---|---|---|
| `MAX_CONCURRENT_CONTAINERS` | 5 | Global concurrency cap |
| `POOL_MAX_SIZE` | 5 | Max pre-warmed standby containers |
| `POOL_IDLE_TIMEOUT` | 5 min | Destroy idle pool container |
| `POOL_MAX_REUSE` | 10 | Reuses before forced recycle |
| `CONTAINER_TIMEOUT` | 30 min | Hard kill if container hangs |
| `IDLE_TIMEOUT` | 30 min | Close stdin when agent goes idle |
| `TYPING_MAX_TTL` | 5 min | Stop typing indicator |
| `SESSION_MAX_AGE_MS` | 24h | Rotate Claude session |
| `CONTAINER_MEMORY_LIMIT` | 512m | Docker OOM guard |
| `CONTAINER_CPU_LIMIT` | 1.0 | Docker CPU cap |

---

## 2. Container Lifecycle State Machine

```
                    ┌──────────┐
           spawn    │ warming  │  30s timeout
    ────────────►   │          │ ──────────────► DESTROYED
                    └────┬─────┘
                         │ _ready file written
                         ▼
                    ┌──────────┐
        ◄── pool ── │  ready   │
        acquire()   │          │ ◄── release() (keepAlive=true, reuseCount<10)
                    └────┬─────┘
                         │ acquire()
                         ▼
                    ┌──────────┐
                    │  in-use  │ ── container exits ──► pool.delete()
                    │          │
                    └────┬─────┘
                         │ reuseCount >= POOL_MAX_REUSE
                         ▼
                    ┌──────────┐
                    │ draining │ ── docker stop ──► DESTROYED
                    └──────────┘
```

**Cold spawn** (pool miss):
```
docker run -i --name nanoclaw-{group}-{ts}
  --memory 512m --cpus 1.0
  -v {hostGroupDir}:/workspace/group
  -v {hostSessionDir}:/home/node/.claude
  -v {hostIpcDir}:/workspace/ipc
  nanoclaw-agent:latest
```

---

## 3. Known Failure Modes & Fixes

### R1 — Group Not Registered (Race Condition)

**Problem:** `onAutoRegister()` is synchronous but `registeredGroups` map update races
with message processing firing 100ms later via the debounce timer.

**Fix (implemented):** The 100ms debounce in `MessageBus` provides enough margin.
Verify by adding a guard in `processGroupMessages`:

```typescript
// Already handled by the existence check:
const group = registeredGroups[chatJid];
if (!group) return true;
```

**Monitoring:** If `"Group not found"` appears in logs for a known chat, restart nanoclaw;
the recovery scan will pick up the message.

---

### R9 — Telegram Polling Dies Silently

**Problem:** grammY polling stops with no automatic recovery.  
**Fix (implemented in `telegram.ts`):** Health timer now calls `bot.stop()`, recreates the
`Bot` instance, and restarts polling when unresponsive for >2 min.

**Additional recommendation:** Add a process-level watchdog. In `ecosystem.config.js`:

```javascript
{
  name: 'nanoclaw',
  script: 'bun src/index.ts',
  watch: false,
  autorestart: true,
  max_restarts: 50,
  restart_delay: 3000,
  exp_backoff_restart_delay: 100,
  max_memory_restart: '1G',
}
```

---

### R5 — Pool Container Assigned But Never Responds

**Problem:** `_assignment.json` written to IPC input dir but agent-runner inside
container is not polling (container crashed in standby mode before ready).

**Diagnosis:**
```bash
# See all nanoclaw containers and their status
docker ps --filter name=nanoclaw- --format "table {{.Names}}\t{{.Status}}\t{{.CreatedAt}}"

# Check pool container logs
docker logs nanoclaw-pool-main-<ts> --tail 50
```

**Fix plan:**
1. Add container output timeout in `container-runner.ts`:
   - After `assignTask()`, set a timer. If no output within `CONTAINER_TIMEOUT`, kill and respawn.
2. The `ContainerPool.release()` already destroys containers that crash (via `proc.on('close')`).
3. Ensure `POOL_IDLE_TIMEOUT` (5 min) is not so long that dead containers stay in pool.

---

### R14 — Agent Runs But Outputs `result: null`

**Problem:** Container exits with status 0 but stdout contained no
`---NANOCLAW_OUTPUT_START---` marker.

**Fix (implemented in `index.ts`):** Streaming callback now detects `status=success` +
`result=null` + `outputSentToUser=false` and sends a fallback Thai message.

**Root cause investigation in agent-runner:**
```bash
# Run a container manually to see raw stdout
docker run -i nanoclaw-agent:latest <<< '{"prompt":"hello","groupFolder":"main","chatJid":"tg:1","isMain":true,"secrets":{}}'
```
If no markers appear, fix `container/agent-runner/` to always emit them.

---

### R10 — Old Timestamp Skips Messages

**Problem:** Telegram delivers retried messages with old `msg.date` values (Unix epoch).
`getNewMessages()` compares ISO timestamps — a message with `date < lastTimestamp` is never processed.

**Fix recommendation:** Change the timestamp comparison in `db.ts:getNewMessages` to
compare epoch integers rather than ISO strings. Also consider storing `received_at`
(wall clock time when nanoclaw received it) separately from `msg.date`.

---

### R11 — Max Retries Exhausted, Message Lost

**Problem:** After 5 container failures the message is permanently dropped.

**Fix recommendation:** Store the unprocessed message ID in a `dead_letter_queue` SQLite table.
Add an IPC command `/retry-dead-letter` that re-enqueues them.

---

## 4. Professional Container Management Checklist

### 4.1 Daily Operations

```bash
# Check running containers
docker ps --filter name=nanoclaw- --format "table {{.Names}}\t{{.Status}}\t{{.RunningFor}}\t{{.Ports}}"

# Check health endpoint
curl http://localhost:47779/health | jq .

# Check nanoclaw logs (PM2)
pm2 logs nanoclaw --lines 100

# Check SQLite DB stats
bun scripts/db-stats.ts  # (create this utility)
```

### 4.2 Container Image Management

```bash
# Rebuild image after agent-runner changes
cd nanoclaw && ./container/build.sh

# Tag with version
docker tag nanoclaw-agent:latest nanoclaw-agent:$(date +%Y%m%d-%H%M)

# Prune old images (keep last 3)
docker images nanoclaw-agent --format "{{.Tag}}" | tail -n +4 | xargs -I{} docker rmi nanoclaw-agent:{}

# Check image size
docker image inspect nanoclaw-agent:latest --format '{{.Size}}' | numfmt --to iec
```

### 4.3 Emergency Procedures

**Bot unresponsive (no reply at all):**
```bash
# 1. Check if nanoclaw process is alive
pm2 status nanoclaw

# 2. Check for zombie containers consuming resources
docker stats --no-stream --filter name=nanoclaw-

# 3. Kill all agent containers and restart
docker ps --filter name=nanoclaw- -q | xargs -r docker rm -f
pm2 restart nanoclaw
```

**Container pool corrupt state:**
```bash
# Force-clear IPC assignment files
find data/ipc -name '_assignment.json' -delete
find data/ipc -name '_ready' -delete

# Restart nanoclaw — startup recovery will re-warm pool
pm2 restart nanoclaw
```

**Message stuck in processing forever:**
```bash
# Find the hanging container
docker ps --filter name=nanoclaw- --format "{{.Names}}\t{{.Status}}" | grep -v "Exited"

# Kill it — GroupQueue will retry on next poll (30s)
docker rm -f nanoclaw-agent-main-<ts>
```

### 4.4 Resource Limits Tuning

Edit `.env`:

```env
# Increase for faster agents on high-RAM machines
CONTAINER_MEMORY_LIMIT=1g
CONTAINER_CPU_LIMIT=2.0

# More concurrent containers (ensure host RAM allows: N × memory_limit)
MAX_CONCURRENT_CONTAINERS=8
POOL_MAX_SIZE=5

# Shorter timeout for interactive feel
CONTAINER_TIMEOUT=600000   # 10 min instead of 30

# Shorter idle before stdin close (save resources)
IDLE_TIMEOUT=300000  # 5 min
```

### 4.5 Observability — Recommended Additions

| What | How | Priority |
|---|---|---|
| Container crash rate | Parse `proc.on('close', code)` → structured log metric | High |
| Cold-start latency tracking | Already `containerPool.coldSpawnFallbacks` — expose in `/health` | High |
| Per-group response time P95 | Extend `trackUsage()` to emit histogram | Medium |
| Dead letter queue | SQLite table for messages exhausting retries | High |
| Pool hit rate | `reusedCount / (reusedCount + coldFallbacks)` in `/health` | Medium |
| Telegram bot uptime | Expose `connected` + `lastUpdateTime` in `/health` | High |

### 4.6 Health Endpoint Enhancement

Add to `health-server.ts` — expose pool stats:

```typescript
// In the /health response object
poolStats: containerPool.getStats(),
// → { total, ready, inUse, warming, maxSize, reusedCount, coldSpawnFallbacks }

telegramConnected: channels.find(c => c.name === 'telegram')?.isConnected() ?? null,
```

---

## 5. Root Cause Fix Priority Matrix

| ID | Severity | Fix Status | Action |
|---|---|---|---|
| R9 | 🔴 Critical | ✅ Fixed | Telegram auto-reconnect implemented |
| R8 | 🔴 Critical | ✅ Fixed | TTL expiry sends "still working" message |
| R14 | 🔴 Critical | ✅ Fixed | Null result fallback message sent |
| R5 | 🟠 High | 🔲 TODO | Add assignment timeout + pool health probe |
| R10 | 🟠 High | 🔲 TODO | Fix timestamp comparison to use epoch integers |
| R11 | 🟠 High | 🔲 TODO | Implement dead-letter queue |
| R1 | 🟡 Medium | 🔲 Verified safe | 100ms debounce gives sufficient margin |
| R2 | 🟡 Medium | 🔲 UX | Add user-facing hint when trigger is missing |
| R3 | 🟡 Medium | 🔲 Monitor | Cursor rollback logic is correct; log audit |
| R6 | 🟡 Medium | 🔲 TODO | Wrap budget-offline send in try/catch |
| R7 | 🟢 Low | 🔲 Expected | Oracle fallback behavior is by design |
| R12 | 🟢 Low | 🔲 N/A | Only occurs if both channels active with JID collision |
| R13 | 🟢 Low | 🔲 Process | Add `docker build` to CI/CD before deploy |

---

## 6. Recommended `.env` for Production

```env
# Core
ASSISTANT_NAME=Andy
TELEGRAM_BOT_TOKEN=<token>
CONTAINER_IMAGE=nanoclaw-agent:latest

# Resources
CONTAINER_MEMORY_LIMIT=768m
CONTAINER_CPU_LIMIT=1.5
MAX_CONCURRENT_CONTAINERS=6
CONTAINER_TIMEOUT=900000        # 15 min hard kill

# Pool
POOL_MIN_SIZE=1
POOL_MAX_SIZE=5
POOL_IDLE_TIMEOUT=300000        # 5 min
POOL_MAX_REUSE=10
POOL_WARMUP_INTERVAL=30000

# UX
IDLE_TIMEOUT=600000             # 10 min
TYPING_MAX_TTL=300000           # 5 min
SESSION_MAX_AGE_HOURS=24

# Heartbeat
HEARTBEAT_ENABLED=true
HEARTBEAT_INTERVAL_MS=1800000   # 30 min

# Oracle
ORACLE_BASE_URL=http://oracle-v2:47778

# Scheduler
SCHEDULER_POLL_INTERVAL=10000
```

---

## 7. Monitoring Alert Thresholds

| Metric | Warning | Critical | Source |
|---|---|---|---|
| Active containers | ≥ `MAX-1` | = `MAX` | `/health` |
| Queue depth | ≥ 10 | ≥ 18 | `/health` |
| Cold spawn rate | > 50% | > 80% | pool stats |
| Container errors (1h) | > 3 | > 10 | health-server `recentErrors` |
| Heartbeat silence | > 45 min | > 2h | heartbeat system |
| Telegram connected | false | — | health endpoint |
| Docker daemon | — | not responding | `ensureDockerRunning()` |

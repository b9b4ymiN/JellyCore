---
name: jellycore-ops
description: "Operate JellyCore services in Docker Compose with a safe runbook: start, stop, restart, health-check, inspect logs, and collect diagnostics. Use when asked about service status, outages, deployment verification, or runtime operations."
allowed-tools: Bash(docker*:*), Bash(curl:*), Bash(grep:*), Bash(awk:*)
---

# JellyCore Operations

Use this runbook for production-safe service operations.

## Safety Rules

- Verify target environment before running commands.
- Prefer read-only diagnostics before restart actions.
- Do not run destructive Docker prune/remove commands unless explicitly requested.

## Standard Flow

1. Check status
```bash
docker compose ps
```

2. Check health endpoints
```bash
curl -fsS http://localhost:47778/api/health
curl -fsS http://localhost:47779/health
```

3. Inspect focused logs
```bash
docker compose logs --tail=200 oracle
docker compose logs --tail=200 nanoclaw
docker compose logs --tail=200 chromadb
```

4. Recover by smallest action
```bash
docker compose restart <service>
```

5. Re-verify status and health

## Delivery Format

- Incident summary (symptom, scope, likely root cause)
- Actions taken (ordered)
- Current status (healthy/degraded/down)
- Next recommendation

Load [references/commands.md](references/commands.md) for detailed command variants.

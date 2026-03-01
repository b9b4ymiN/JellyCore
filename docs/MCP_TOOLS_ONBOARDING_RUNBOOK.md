# MCP Tools Onboarding Runbook

Version: 1.0  
Updated: March 1, 2026  
Owner: JellyCore Platform Team

---

## 1) Purpose

This runbook defines the standard process to add new MCP tools safely and make sure they are actually callable by AI at runtime.
For the current tier/profile baseline, see `docs/MCP_BASELINE_POLICY.md`.

It covers:
- external MCP servers (for example: `notebooklm`, `yfinance`, `oura`)
- optional runtime `.mcp.json` overrides (`mcpServers` format)
- Oracle MCP bridge validation (`oracle-mcp-http.js`)
- deployment, verification, troubleshooting, and rollback

---

## 2) Source Of Truth

When working on MCP tools, use these files as source of truth:

- `nanoclaw/container/Dockerfile`
- `nanoclaw/container/config/mcps.json`
- `nanoclaw/container/config/mcp-governance.json`
- `nanoclaw/.mcp.json` (optional runtime override in Claude MCP format)
- `nanoclaw/src/container-runner.ts` (runtime secret allowlist)
- `docker-compose.yml`
- `docker-compose.production.yml`
- `nanoclaw/container/agent-runner/src/index.ts` (runtime tool allowlist + MCP status logs)
- `nanoclaw/scripts/verify-external-mcp.ts` (real MCP handshake verification)
- `nanoclaw/scripts/validate-mcp-governance.ts` (policy/config drift validation)

Runtime inspection endpoint:
- `GET /ops/tools` on `http://localhost:47779/ops/tools`

---

## 3) Preconditions

Before adding any MCP tool:

- Docker daemon is healthy.
- You know which image tag NanoClaw actually uses.
- Required secrets/tokens are available in `.env`.

Commands:

```bash
docker info
docker exec jellycore-nanoclaw printenv CONTAINER_IMAGE
```

If `CONTAINER_IMAGE` is empty, use your default image tag consistently (for example `nanoclaw-agent:latest`).

---

## 4) Standard Onboarding Workflow

### Step A - Add MCP package into agent image

Edit `nanoclaw/container/Dockerfile`:
- install MCP package/repo
- build dependencies needed by that MCP
- avoid writing non-MCP logs to stdout during stdio operation

Guideline:
- MCP stdio protocol must keep stdout clean (JSON-RPC only).
- If upstream server prints startup logs, redirect prints to stderr in image patching.

### Step B - Register server in `mcps.json`

Add entry in `nanoclaw/container/config/mcps.json`:

```json
{
  "name": "my-mcp",
  "description": "My MCP description",
  "enabled": true,
  "startupMode": "always",
  "allowGroups": [],
  "command": "node",
  "args": ["/opt/my-mcp/dist/index.js"],
  "requiredEnv": [],
  "env": {}
}
```

Field policy:
- `enabled`: hard on/off switch
- `startupMode`: `always` or `on_demand`
- `allowGroups`: group allowlist (`[]` means all groups)
- `requiredEnv`: startup gate
- `env`: env mapping for MCP process

Optional runtime override:
- `nanoclaw/.mcp.json` can be used in Claude MCP format (`mcpServers`)
- it is mirrored into each session at `/home/node/.claude/.mcp.json`
- `groups/<group-folder>/.mcp.json` has highest priority for that group

Tier governance:
- Maintain tier/profile metadata in `nanoclaw/container/config/mcp-governance.json`
- Recommended tiers:
  - `core`: needed frequently and should stay enabled by default
  - `optional`: useful but can be disabled in specific operations
  - `experimental`: trial-only tools, disabled unless explicitly enabled
- Validate governance drift with:

```bash
npm run mcp:policy
```

### Step C - Expose required secrets

If MCP needs secrets:
- add env variable names to `allowedVars` in `nanoclaw/src/container-runner.ts`
- add variable mapping in compose files (`docker-compose.yml` and production variant)
- set value in `.env`

OAuth token file guidance (example: Google Docs MCP):
- without `GOOGLE_MCP_PROFILE`:
  - agent-side path: `/home/node/.claude/config/google-docs-mcp/token.json`
  - persistent host-volume path (inside `jellycore-nanoclaw`): `/app/nanoclaw/data/sessions/<group-folder>/.claude/config/google-docs-mcp/token.json`
- with `GOOGLE_MCP_PROFILE=<profile>`:
  - agent-side path: `/home/node/.claude/config/google-docs-mcp/<profile>/token.json`
  - persistent host-volume path (inside `jellycore-nanoclaw`): `/app/nanoclaw/data/sessions/<group-folder>/.claude/config/google-docs-mcp/<profile>/token.json`

### Step D - Build and deploy

Always build the image tag that NanoClaw actually uses:

```bash
IMG=$(docker exec jellycore-nanoclaw printenv CONTAINER_IMAGE | tr -d '\r')
[ -z "$IMG" ] && IMG="nanoclaw-agent:latest"

docker build --no-cache -t "$IMG" -f nanoclaw/container/Dockerfile nanoclaw/container
docker compose up -d --force-recreate nanoclaw
```

---

## 5) Verification (Required)

You must pass all checks below.

### 5.1 Runtime inventory check

```bash
curl -s http://localhost:47779/ops/tools
```

Expected:
- `sdk.allowedTools` includes MCP prefixes (for example `mcp__notebooklm__*`)
- `mcp.external.activeCount` matches intended active servers

### 5.2 MCP handshake check (real stdio)

From `nanoclaw/`:

```bash
set -a; source ~/JellyCore/.env; set +a
MCP_VERIFY_DOCKER_NETWORK=jellycore_jellycore-internal CONTAINER_IMAGE="$IMG" npx -y tsx scripts/verify-external-mcp.ts
```

Expected:
- `oracle: PASS`
- each enabled external MCP: `PASS`
- output ends with `MCP verification passed`

Also run policy validation:

```bash
npm run mcp:policy
```

Or run both checks in one command:

```bash
npm run mcp:check
```

Notes:
- `MCP_VERIFY_STRICT=true` makes missing required env fail immediately.
- This script performs `initialize` + `tools/list` against each server.

### 5.3 Telegram session check

After deployment:
- run `/clear`
- ask AI to list MCP tools
- call one tool from each critical MCP (for example Oracle search, yfinance quote, NotebookLM health/auth check)

---

## 6) Definition Of Done

A tool onboarding is done only if all are true:

- image build succeeds for the production image tag
- `/ops/tools` shows the MCP namespace and active state as expected
- `verify-external-mcp.ts` reports PASS for `oracle` and target MCPs
- AI can call target MCP from Telegram in a fresh session
- docs updated (`Dockerfile`, `mcps.json`, runbook/README changes)

---

## 7) Troubleshooting Guide

### Symptom: `/ops/tools` shows configured, but AI says MCP not available

Actions:
- run `/clear` to reset session
- check `sdk.allowedTools` in `/ops/tools`
- check NanoClaw logs for `mcp_status` events

```bash
docker logs jellycore-nanoclaw --since 5m | grep -Ei "MCP event|mcp_status|External MCP"
```

### Symptom: `tsx: command not found`

Use:

```bash
npx -y tsx scripts/verify-external-mcp.ts
```

### Symptom: external MCP fails with JSON/protocol parse errors

Likely stdout contamination from server logs.

Actions:
- patch upstream server startup prints to stderr in Dockerfile
- use unbuffered runtime where needed (for Python, `python3 -u`)

### Symptom: `dockerfile parse error ... unknown instruction: &&`

Cause:
- chaining `&&` directly after heredoc close marker (`PY`/`EOF`)

Fix:
- split into separate `RUN` instructions after heredoc block

### Symptom: `apt-get ... exit code 100`

Actions:
- retry build
- add apt retry options
- inspect full build logs

```bash
docker build --progress=plain -t "$IMG" -f nanoclaw/container/Dockerfile nanoclaw/container 2>&1 | tee /tmp/build.log
grep -nE "E:|Err:" /tmp/build.log | tail -n 50
```

---

## 8) Rollback Procedure

Fast rollback:

1. Disable MCP by env override:

```bash
NANOCLAW_EXTERNAL_MCP_DISABLED=my-mcp
```

2. Recreate NanoClaw service:

```bash
docker compose up -d --force-recreate nanoclaw
```

3. Confirm with `/ops/tools`.

Hard rollback:

1. Remove MCP entry from `mcps.json`
2. Remove install block from Dockerfile
3. Rebuild image and redeploy

---

## 9) PR Checklist Template

Copy into your PR description:

- [ ] MCP installed in `nanoclaw/container/Dockerfile`
- [ ] MCP registered in `nanoclaw/container/config/mcps.json`
- [ ] required secrets wired (`container-runner` + compose + `.env`)
- [ ] `npm run typecheck` passes
- [ ] `nanoclaw/container/agent-runner npm run build` passes
- [ ] `/ops/tools` shows expected namespace/state
- [ ] `verify-external-mcp.ts` shows PASS for Oracle + target MCP
- [ ] Telegram fresh-session test passed (`/clear` then tool call)
- [ ] rollback path documented

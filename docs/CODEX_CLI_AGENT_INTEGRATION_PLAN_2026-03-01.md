# Codex CLI Integration Plan for NanoClaw

> Version: 2.0 (execution-ready)  
> Date: 2026-03-01  
> Scope: Add Codex CLI as selectable agent beside existing Claude flow, without breaking current production behavior.

---

## 1) Goals and Scope

### Primary goals (MVP)
1. Keep current Claude path fully working.
2. Add Codex as a second agent option per group/session.
3. Allow explicit switching with `/agent` commands.
4. Preserve existing stdin/stdout marker protocol so host orchestration stays stable.

### Secondary goals (Phase 2)
1. Add auto-selection rules (`claude` vs `codex`) with safe defaults.
2. Support group-level policy via `AGENT.md`.

### Out of scope for MVP
1. Multi-agent collaboration (`/ask both`, sequential/parallel/handoff).
2. Deep answer-merging logic across two model outputs.

---

## 2) Current-State Findings (from codebase audit)

1. Container runtime user is `node`; home path is `/home/node` (not `/home/appuser`).
2. Current agent execution path is tightly coupled to Claude SDK in `nanoclaw/container/agent-runner/src/index.ts`.
3. Session persistence is single key per `group_folder` in `sessions` table.
4. Slash commands are inline-routed through:
   - `nanoclaw/src/command-registry.ts`
   - `nanoclaw/src/inline-handler.ts`
   - `nanoclaw/src/query-router.ts`
5. Scheduler and heartbeat flows also use container agent path, so agent selection must cover:
   - live user messages
   - scheduled tasks
   - heartbeat jobs

---

## 3) Architecture Decisions

1. Integration strategy: `Wrap Codex CLI` (not SDK rewrite) for fastest stable delivery.
2. Auth strategy: default to dedicated JellyCore path (`data/codex-auth`) and mount read-only into container.
3. Rollout strategy: feature flag `AGENT_CODEX_ENABLED=false` by default.
4. Session strategy: store per-group active agent preference and separate session IDs per agent.
5. Collaboration features: postpone until basic switching and auto mode are stable in production.

---

## 4) Detailed Implementation Plan

## Phase 0 - CLI contract spike (0.5 day)

### Objective
Lock the exact non-interactive Codex CLI invocation and output contract before coding adapters.

### Tasks
1. Verify CLI commands inside container image:
   - `codex --version`
   - `codex --help`
   - candidate non-interactive invocation for prompt execution
2. Capture stdout/stderr behavior and exit codes for:
   - success
   - auth missing
   - timeout/network error
3. Decide one canonical command template for runner.

### Deliverable
Short note in plan issue/PR with final command contract.

### Acceptance criteria
1. One reproducible command can execute prompt non-interactively.
2. Output parse strategy is defined (JSON/plain + fallback).

---

## Phase 1 - Container and config foundation (1 day)

### Files
1. `nanoclaw/container/Dockerfile`
2. `nanoclaw/src/config.ts`
3. `nanoclaw/src/container-runner.ts`
4. `.env.example`

### Changes
1. Install Codex CLI in agent image:
   - `npm install -g @openai/codex`
2. Add config:
   - `CODEX_AUTH_PATH` (default `data/codex-auth`)
   - `CODEX_MODEL` (default `gpt-5`)
   - `CODEX_TEMPERATURE` (default `0.7`)
   - `AGENT_CODEX_ENABLED` (default `false`)
3. Mount auth directory read-only:
   - host: `CODEX_AUTH_PATH`
   - container: `/home/node/.codex`
4. Extend secret allowlist for `OPENAI_API_KEY` in container stdin payload (optional fallback to auth file).

### Acceptance criteria
1. Container builds successfully with Codex CLI installed.
2. If `CODEX_AUTH_PATH` exists, mount appears in final `docker run` args.
3. No change in Claude-only behavior when `AGENT_CODEX_ENABLED=false`.

---

## Phase 2 - Agent abstraction types and persistence (1 day)

### Files
1. `nanoclaw/src/agents/types.ts` (new)
2. `nanoclaw/src/agents/router.ts` (new)
3. `nanoclaw/src/db.ts`
4. `nanoclaw/src/types.ts` (if shared type extension needed)

### Data model
Use explicit preference store:
1. New table `group_agent_preferences`:
   - `group_folder TEXT PRIMARY KEY`
   - `mode TEXT NOT NULL` (`claude` | `codex` | `auto`)
   - `updated_at TEXT NOT NULL`
2. Extend sessions table with agent dimension via new table:
   - `agent_sessions(group_folder TEXT, agent_type TEXT, session_id TEXT, session_started_at TEXT, PRIMARY KEY(group_folder, agent_type))`

This avoids risky migrations on current `sessions` primary key and keeps backward compatibility.

### Acceptance criteria
1. Existing installs migrate automatically without data loss.
2. Claude session continuity remains unchanged.
3. Codex session is stored separately from Claude session.

---

## Phase 3 - Container runner agent adapters (2 days)

### Files
1. `nanoclaw/container/agent-runner/src/index.ts`
2. `nanoclaw/container/agent-runner/src/claude-runner.ts` (new, extracted)
3. `nanoclaw/container/agent-runner/src/codex-runner.ts` (new)
4. `nanoclaw/container/agent-runner/package.json` (if new runtime deps required)

### Changes
1. Add `agent` field to container input (`claude` default if omitted).
2. Refactor current Claude logic into `claude-runner.ts`.
3. Implement Codex adapter that:
   - receives same input protocol
   - executes Codex CLI command
   - emits output wrapped by existing markers:
     - `---NANOCLAW_OUTPUT_START---`
     - `---NANOCLAW_OUTPUT_END---`
4. Normalize Codex result into shared output shape:
   - `status`
   - `result`
   - `newSessionId` (if available; optional)
   - `error`

### Acceptance criteria
1. Same host parser can consume Claude and Codex outputs.
2. Runner never emits raw unwrapped payloads.
3. Timeout/error cases are mapped to clear `status:error`.

---

## Phase 4 - Host routing and `/agent` commands (1.5 days)

### Files
1. `nanoclaw/src/index.ts`
2. `nanoclaw/src/command-registry.ts`
3. `nanoclaw/src/inline-handler.ts`
4. `nanoclaw/src/query-router.ts` (command routing remains inline)
5. `nanoclaw/src/db.ts` (read/write preference)

### Changes
1. Add commands:
   - `/agent` -> show current mode + options
   - `/agent claude`
   - `/agent codex`
   - `/agent auto`
2. Add router decision order:
   - user command override (if provided)
   - stored group preference
   - fallback default `claude`
3. Update `runAgent()` path to pass selected `agent` into container input.
4. Ensure scheduler and heartbeat runs use same resolution policy.

### Acceptance criteria
1. User can switch agent mode and see confirmation.
2. Next messages use selected agent without restarting service.
3. `/clear` clears relevant sessions safely for active mode.

---

## Phase 5 - Auto mode + group policy file (1 day)

### Files
1. `nanoclaw/src/agents/router.ts`
2. `groups/{group}/AGENT.md` (new optional policy file per group)

### Changes
1. Add simple deterministic auto rules:
   - `codex` for code/edit/CLI-heavy requests
   - `claude` for memory-heavy/reasoning conversation
2. If `AGENT.md` exists, override defaults per group.
3. On parse failure, fail safe to `claude`.

### Acceptance criteria
1. Auto mode works without requiring `AGENT.md`.
2. Invalid `AGENT.md` does not crash runtime.
3. Selected agent is visible in logs for observability.

---

## Phase 6 - Documentation + operational runbook (0.5 day)

### Files
1. `docs/CODEX_INTEGRATION.md` (new)
2. `.env.example`
3. `README.md` (short reference section)

### Content
1. Authentication setup and mount path.
2. Feature flags and defaults.
3. `/agent` usage.
4. Troubleshooting:
   - auth missing
   - CLI unavailable
   - timeout

### Acceptance criteria
1. New operator can enable Codex with docs only.
2. Rollback to Claude-only mode documented in <= 3 steps.

---

## 5) Testing Plan

### Unit tests
1. `nanoclaw/src/command-registry.test.ts`
2. `nanoclaw/src/commands.test.ts`
3. `nanoclaw/src/db.test.ts`
4. `nanoclaw/src/container-runner.test.ts`
5. New tests for `agents/router.ts`

### Integration checks
1. Claude mode still returns normal output.
2. Codex mode returns output through same marker protocol.
3. `/agent` command persists and survives restart.
4. Scheduled task path works with configured agent mode.

### Smoke checks (manual)
1. `/agent codex` then ask simple prompt.
2. `/agent claude` then ask same prompt.
3. `/agent auto` with coding prompt vs conversational prompt.

---

## 6) Rollout and Rollback

### Rollout
1. Deploy with `AGENT_CODEX_ENABLED=false`.
2. Build and verify image in staging.
3. Enable flag for one non-critical group.
4. Monitor errors/timeouts for 24 hours.
5. Expand gradually.

### Rollback
1. Set `/agent claude` for affected groups.
2. Set `AGENT_CODEX_ENABLED=false`.
3. Rebuild/restart service if needed.
4. No DB rollback required (new tables are additive).

---

## 7) Risks and Mitigations

1. Codex CLI output format drift
   - Mitigation: parser fallback + strict marker wrapping in runner.
2. Auth token expiration
   - Mitigation: explicit auth error mapping and operator guide.
3. Session cross-contamination between agents
   - Mitigation: separate session store per `(group, agent)`.
4. Container image bloat
   - Mitigation: keep only required global packages; monitor image size in CI.
5. Hidden regression in scheduler/heartbeat flows
   - Mitigation: include both flows in integration test matrix.

---

## 8) Timeline (re-estimated)

1. Phase 0: 0.5 day
2. Phase 1: 1 day
3. Phase 2: 1 day
4. Phase 3: 2 days
5. Phase 4: 1.5 days
6. Phase 5: 1 day
7. Phase 6: 0.5 day

Total for full plan: 7.5 days  
MVP cutoff (through Phase 4): 6 days

---

## 9) Recommended answers to open questions

1. Authentication: choose **Option B** (`data/codex-auth`) as primary for portability/deploy repeatability.
2. Collaboration: **defer** for initial release; ship reliable switching first.
3. Priority: **A -> B -> C** (`switching` then `auto-select` then `collab`).
4. Integration method: **A (wrap Codex CLI)** for MVP; consider SDK only after stable production baseline.

---

## 10) Definition of Done (MVP)

1. `/agent claude|codex|auto` works and persists.
2. Both agents execute through one shared container protocol.
3. Claude path has zero behavior regression in existing tests.
4. Codex path has passing smoke tests and documented setup.
5. Feature can be disabled instantly via config flag.

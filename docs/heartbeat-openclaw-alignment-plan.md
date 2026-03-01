# Heartbeat Alignment Plan (OpenClaw-style)

## Goal
Make JellyCore heartbeat behavior match OpenClaw heartbeat intent:
- user-facing heartbeat is useful, low-noise, and action-oriented
- "OK" heartbeat does not spam channels unless explicitly enabled
- alerts are visible and prioritized
- heartbeat controls support mute/delivery behavior without disabling internal checks

## Current Gaps
- Reporter sends a long status dump every cycle.
- Repeated identical errors are surfaced repeatedly.
- Oracle health in heartbeat points to mismatched URL/path in some environments.
- Config lacks OpenClaw-style visibility controls (`showOk`, `showAlerts`, indicator, delivery mute).

## Implementation Steps

### Step 1: Add runtime controls (config + IPC/MCP)
Changes:
- Extend heartbeat runtime config with:
  - `showOk: boolean`
  - `showAlerts: boolean`
  - `useIndicator: boolean`
  - `deliveryMuted: boolean`
  - `alertRepeatCooldownMs: number`
  - `heartbeatPrompt: string`
  - `ackMaxChars: number`
- Keep existing fields for backward compatibility (`enabled`, `intervalMs`, etc.).
- Allow `configure_heartbeat` to patch new fields from agent side.

Acceptance:
- GET `/heartbeat/config` returns new fields.
- PATCH `/heartbeat/config` updates new fields safely.

Test:
- Run unit tests for IPC auth/config path and heartbeat config patching.

### Step 2: Refactor reporter to alert-first behavior
Changes:
- Build concise heartbeat output with these rules:
  - parse heartbeat response for exact `HEARTBEAT_OK`
  - if `HEARTBEAT_OK` and `showOk=false`, skip delivery
  - if alert and `showAlerts=true`, send alert message
  - optional leading status indicator when `useIndicator=true`
- Reduce noisy sections in regular heartbeat messages:
  - remove verbose "recent task failures" dump from periodic heartbeat
  - summarize only key state and actionable failures
- Deduplicate repeated alerts with cooldown (`alertRepeatCooldownMs`).

Acceptance:
- No periodic "wall of logs" in normal/OK cycles.
- Alerts still deliver with clear reason.

Test:
- Add focused unit tests for parser + visibility matrix.

### Step 3: Fix Oracle health endpoint/base URL mismatch
Changes:
- Resolve Oracle base URL with fallback order:
  1) `ORACLE_BASE_URL`
  2) `ORACLE_API_URL`
  3) default internal URL
- Heartbeat Oracle checks use API paths that exist in Oracle service:
  - `/api/health`
  - `/api/stats`
- Keep compatibility fallback for legacy paths if needed.

Acceptance:
- Heartbeat no longer reports false "Oracle unreachable" when Oracle is healthy.

Test:
- Add/adjust tests for Oracle URL/path resolver behavior.

### Step 4: Validation and regression pass
Changes:
- Run targeted tests first, then full nanoclaw test suite.
- Verify no regressions in heartbeat jobs and IPC permissions.

Acceptance:
- All modified tests pass.
- Existing heartbeat job tests remain green.

Test commands:
- `npm test -- heartbeat.test.ts`
- `npm test -- ipc-auth.test.ts`
- `npm test` (full in `nanoclaw/`)

## Rollout Notes
- Recommended default runtime values:
  - `showOk=false`
  - `showAlerts=true`
  - `useIndicator=true`
  - `deliveryMuted=false`
  - `alertRepeatCooldownMs=3600000` (1h)
- If operators want temporary silence without losing checks:
  - set `deliveryMuted=true` instead of `enabled=false`.

## Execution Log
- [x] Step 1 completed
  - Added runtime heartbeat controls in config/runtime patch path.
  - Extended MCP `configure_heartbeat` to set new fields.
- [x] Step 2 completed
  - Refactored heartbeat reporter to alert-first flow with `HEARTBEAT_OK` parser.
  - Added delivery gating (`showOk/showAlerts/deliveryMuted`) and alert dedupe cooldown.
- [x] Step 3 completed
  - Fixed Oracle URL resolution and API path fallback (`/api/health`, `/api/stats`).
- [x] Step 4 completed
  - Added focused tests for parser/visibility/config validation.
  - Ran targeted tests and full `nanoclaw` test suite.

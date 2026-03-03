# Codex Persona + Oracle 5-Layer Integration Plan

Version: 3.0  
Date: 2026-03-03  
Target Release: v0.9.0

## Goal

Make Codex runtime behave like a first-class agent with:

1. Its own identity/persona.
2. Shared user awareness with Fon.
3. Oracle-backed 5-layer memory integration.
4. Safe fallback to Fon on Codex auth/runtime failure.

## Locked Constraints

1. Codex requires ChatGPT login auth file at `data/codex-auth/auth.json`.
2. No API-key fallback in Codex path.
3. Modes remain `off | swarm | codex`.
4. Scheduler/heartbeat remain Fon-only.

## Architecture Direction

1. Shared brain: Oracle is the single memory backend for Fon and Codex.
2. Dual persona: runtime-specific soul files:
   - `groups/global/SOUL_FON.md`
   - `groups/global/SOUL_CODEX.md`
   - fallback: `groups/global/SOUL.md`
3. Single identity: keep one `stable_user_id` across runtimes.
4. Runtime tagging: memory operations tagged by `agent_runtime`.

## Phase Execution Status

1. Phase 0: Spec lock and rollout shape - completed.
2. Phase 1: Persona layer separation - completed.
3. Phase 2: Codex memory hydration (read 5-layer packet) - completed.
4. Phase 3: Codex write-back policy to Oracle 5-layer - completed.
5. Phase 4: Working-memory emulation for stateless Codex - completed.
6. Phase 5: Swarm delegation protocol hardening - completed.
7. Phase 6: Observability/commands/docs/release finalization - completed.

## Phase Details

### Phase 1: Persona Layer Separation

Scope:

1. Add runtime-specific soul files for Fon and Codex.
2. Load persona by runtime with fallback to `SOUL.md`.
3. Keep existing behavior stable when files are absent.

Acceptance:

1. Fon and Codex can have separate persona definitions.
2. Runtime does not fail if persona file is missing.
3. Build/test pass with no regression.

### Phase 2: Codex Memory Hydration

Scope:

1. Build a compact pre-context packet for Codex from Oracle 5-layer:
   - user model
   - procedural
   - semantic
   - episodic
   - working summary
2. Enforce context budget and deterministic truncation.

Acceptance:

1. Codex responses reference user/memory context.
2. Latency increase remains acceptable.
3. Runtime packet now includes `<working>` summary for layer 5.

### Phase 3: Codex Write-Back Policy

Scope:

1. Classify Codex output into memory write candidates.
2. Write by layer with confidence/policy guards.
3. Tag writes with runtime/source metadata.

Acceptance:

1. Read-after-write works for Codex-generated memory.
2. Noise/memory pollution remains controlled.
3. Runtime write metadata includes `runtime=codex` and `source=codex_runtime`.

### Phase 4: Stateful Emulation

Scope:

1. Add compact working summary store per `(group, runtime)`.
2. Feed summary back into Codex prompts each turn.
3. Add retention and cleanup policy.

Acceptance:

1. Codex shows continuity across turns despite stateless v1 execution.
2. Working summary persisted per `(group_folder, agent_runtime)` and injected on codex runs.

### Phase 5: Swarm Delegation Hardening

Scope:

1. Standardize delegation packet format from Fon to Codex.
2. Standardize structured result payload back to Fon.
3. Keep Codex failure fallback to Fon deterministic.

Acceptance:

1. Delegate workflows are reliable and traceable.
2. `delegate_to_codex` now uses packet + structured JSON envelope (`task_id`, `status`, `result`).

### Phase 6: Observability + Release

Scope:

1. Expose persona/mode/auth readiness in status surfaces.
2. Add release docs for v0.9.0.
3. Finalize runbook for operators.

Acceptance:

1. Operators can run and debug from docs only.
2. Rollback remains <= 3 steps.

## Test Strategy Per Phase

1. Run unit/integration tests after each phase.
2. Keep `nanoclaw` typecheck/build/test green after every phase.
3. Keep `agent-runner` build green after every phase.
4. Do not move to next phase if current phase is red.

## Rollout Strategy

1. Ship behind existing mode/flag gates.
2. Enable for non-critical groups first.
3. Monitor fallback/error/auth-block metrics before wider rollout.

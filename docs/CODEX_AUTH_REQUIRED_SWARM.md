# Codex Auth Required Swarm Runbook

This runbook defines the mandatory Codex auth contract for JellyCore Swarm mode.

## Contract (Required)

1. Codex can run only when `data/codex-auth/auth.json` exists.
2. The file must come from ChatGPT account login.
3. No API-key fallback is allowed for Codex runtime.
4. Runtime auth path in agent container is `/home/node/.codex/auth.json`.
5. Host syncs auth into per-group runtime home (`data/sessions/<group>/.codex`) so Codex can write runtime cache safely.

## Required auth.json fields

`auth.json` is considered ready only when all checks pass:

1. File exists.
2. JSON is valid.
3. `tokens.access_token` is present and non-empty.
4. `tokens.refresh_token` is present and non-empty.
5. `tokens.id_token` is present and non-empty.
6. `tokens.account_id` is present and non-empty.

If any check fails:

1. `/mode codex` and `/mode swarm` are rejected.
2. Existing `swarm` traffic falls back to Fon for Codex-targeted routes.
3. Existing `codex` traffic falls back to Fon.
4. Logs emit `codex_auth_blocked` with reason (`missing_auth_file`, `invalid_json`, `missing_tokens_fields`).

Note:
- UTF-8 BOM in `auth.json` is handled automatically (BOM is stripped before JSON parsing).
- runtime now also has a separate readiness gate (`codex_runtime_ready`) to catch stale/broken images.

## Runtime readiness + drift detection

Codex route is allowed only when both are true:
1. `codex_auth_ready: true`
2. `codex_runtime_ready: true`

Runtime gate checks:
1. agent image exists and can be inspected
2. compiled runner contains `--skip-git-repo-check`
3. compiled runner parser supports current Codex JSON event schema (`item.completed`)

Additional visibility:
1. `codex_image_revision`
2. `codex_drift_detected` (source revision vs image revision mismatch)

## Codex MCP brain/tooling contract

1. In `mode=codex`, runner auto-wires MCP servers for Codex from the same runtime config sources as Fon.
2. Codex always gets:
   - `oracle` MCP (primary memory/brain)
   - `nanoclaw` MCP (mode/state/delegate tools)
3. Active external MCP servers from config are also wired into Codex runtime.
4. For identity/history/preferences prompts, Codex is instructed to query Oracle MCP first.
5. If an MCP is configured but unavailable at runtime, Codex must report it explicitly and continue with fallback behavior.

## Modes

Supported modes:

1. `off`
2. `swarm`
3. `codex`

Behavior:

1. `off`: all lanes use Fon.
2. `swarm`: code/debug user requests route direct to Codex (when auth ready), others use Fon. Fon can call `delegate_to_codex`.
3. `codex`: user lane routes to Codex first. On Codex failure, one fallback attempt to Fon.
4. Scheduler/heartbeat lanes always use Fon.

## Persona + Memory Runtime Notes (v0.9.0)

1. Runtime soul files:
   - Fon: `groups/global/SOUL_FON.md` (fallback `groups/global/SOUL.md`)
   - Codex: `groups/global/SOUL_CODEX.md` (fallback `groups/global/SOUL.md`)
2. Codex receives a compact 5-layer packet in `<ctx>`:
   - `<user>`
   - `<procedural>`
   - `<recent>`
   - `<knowledge>`
   - `<working>`
3. Codex write-back policy:
   - episodic write on valid outputs
   - procedural write for code/debug outputs with clear actionable steps
   - semantic write for long non-procedural outputs
4. Codex runtime working memory:
   - persisted per `(group_folder, codex)` in DB
   - auto-injected as `<runtime_working>...</runtime_working>` on next codex run
   - cleared by `/clear`
5. `delegate_to_codex` MCP tool now returns JSON envelope:
   - `version`, `task_id`, `status`, `result`
   - errors return structured JSON with `status=error`

## Enable checklist

1. Put `auth.json` at `data/codex-auth/auth.json`.
2. Set env:
   - `AGENT_CODEX_ENABLED=true`
   - `AGENT_SWARM_ENABLED=true`
   - `CODEX_AUTH_REQUIRED=true`
3. Restart stack:
   - `docker compose up -d --build`
4. Verify:
   - `/mode` should show `codex_auth_ready: true`
   - `/mode` should show `codex_runtime_ready: true`
   - `/mode swarm` or `/mode codex` should be accepted

## Mode commands

1. `/mode` show current effective mode + auth/runtime state
2. `/mode off|swarm|codex` set current group override
3. `/mode inherit` clear current group override
4. `/mode default off|swarm|codex` set global default
5. `/mode set <group> <off|swarm|codex>` set override for specific group
6. `/mode clear <group>` clear override for specific group

## MCP tools (AI control)

1. `get_agent_mode`
2. `set_agent_mode`
3. `delegate_to_codex`

`set_agent_mode` rejects `swarm|codex` when auth is blocked.

## Troubleshooting

1. `missing_auth_file`
   - Ensure `data/codex-auth/auth.json` exists on host.
2. `invalid_json`
   - Validate JSON format.
3. `missing_tokens_fields`
   - Re-login with ChatGPT account and replace file.
4. Codex command errors/timeouts
   - Verify `codex` CLI is installed in agent image.
   - Check container logs and `CODEX_EXEC_TIMEOUT_MS`.
5. `codex_runtime_blocked:runner_missing_skip_git_repo_check`
   - Rebuild the image referenced by `CONTAINER_IMAGE` and restart `nanoclaw`.
6. `codex_runtime_blocked:runner_missing_json_parser`
   - Rebuild image with latest `agent-runner` code.
7. `codex_drift_detected: true`
   - Image revision is stale vs source; perform full rebuild + restart.
8. `codex_auth_blocked:unauthorized`
   - `auth.json` exists but token is invalid/expired.
   - Re-login ChatGPT in Codex CLI and replace `data/codex-auth/auth.json`.

## Rollback (<= 3 steps)

1. Set mode off: `/mode off` (or `/mode default off`).
2. Disable flags: `AGENT_CODEX_ENABLED=false`, `AGENT_SWARM_ENABLED=false`.
3. Restart services: `docker compose up -d --build`.

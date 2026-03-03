# Codex Auth Required Swarm Runbook

This runbook defines the mandatory Codex auth contract for JellyCore Swarm mode.

## Contract (Required)

1. Codex can run only when `data/codex-auth/auth.json` exists.
2. The file must come from ChatGPT account login.
3. No API-key fallback is allowed for Codex runtime.
4. Runtime mount path in agent container is `/home/node/.codex/auth.json` (read-only).

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
   - `/mode swarm` or `/mode codex` should be accepted

## Mode commands

1. `/mode` show current effective mode + auth state
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

## Rollback (<= 3 steps)

1. Set mode off: `/mode off` (or `/mode default off`).
2. Disable flags: `AGENT_CODEX_ENABLED=false`, `AGENT_SWARM_ENABLED=false`.
3. Restart services: `docker compose up -d --build`.

# Telegram Commands: Professional Audit & Operations Guide

## Scope

This document defines all Telegram slash commands in NanoClaw, how they are validated, and how to add/remove them safely.

## Single Source of Truth

- Registry: `src/command-registry.ts`
- Runtime handlers: `src/inline-handler.ts` (`COMMAND_HANDLERS`)
- Router classification: `src/query-router.ts`
- Telegram menu registration: `src/channels/telegram.ts`

## Command Inventory

### General
- `/start` - start message
- `/help` - command reference
- `/ping` - quick liveness check
- `/me` - user profile summary
- `/soul` - AI personality summary

### Session
- `/session` - session/context health
- `/clear` - clear session (action)
- `/reset` - reset USER.md profile
- `/model` - model routing config

### Cost
- `/usage` - daily usage summary
- `/cost` - monthly spend summary
- `/budget` - view/update budget

### Admin
- `/status` - system status
- `/health` - detailed health status
- `/containers` - running containers
- `/queue` - queue/concurrency status
- `/errors` - recent error buffer
- `/kill <name>` - stop target container
- `/restart` - restart current group runtime path
- `/docker` - Docker resource summary

## Reliability Guarantees

1. All slash commands are routed to inline tier (no silent container detour).
2. Unknown slash commands return fast recovery text with `/help` guidance.
3. Command execution is wrapped with fail-safe catch; users receive actionable error text.
4. Telegram command menu is sanitized before registration (dedupe + format guard).
5. Markdown send fallback remains in place for Telegram message parse failures.

## Add/Remove Command Procedure

1. Update `COMMAND_DEFINITIONS` in `src/command-registry.ts`.
2. Add/remove corresponding handler in `COMMAND_HANDLERS` in `src/inline-handler.ts`.
3. If command has args, parse from `ctx.args` in handler.
4. Run validation suite:

```bash
cd nanoclaw
npm run typecheck
npm run test
```

Expected:
- `commands.test.ts` coverage passes for all registered commands.
- `command-registry.test.ts` invariants pass (uniqueness + Telegram compatibility).

## Self-Healing Behavior

- If command handler throws: inline layer catches, logs, and returns recovery guidance.
- If Telegram menu contains invalid/duplicate entries: registration auto-sanitizes.
- If unknown command arrives: bot responds immediately with next-step suggestion.

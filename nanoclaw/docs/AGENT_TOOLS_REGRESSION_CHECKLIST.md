# Agent Tools Regression Checklist

Use this checklist before release/canary after reliability changes.

## Automated test gate

Run:

```bash
cd nanoclaw
npm run typecheck
npm run test
npm run build

cd container/agent-runner
npm run build
```

Expected:
- All commands exit with code 0.
- `vitest` shows all tests passed.

## Scenario checklist

1. Memory 5 layers policy
- Verify `PromptBuilder` injects `<user>`, `<procedural>`, `<recent>`, `<knowledge>` when data exists.
- Verify stable `chat_jid -> userId` mapping remains deterministic.
- Evidence: `src/prompt-builder.test.ts`, `src/db.test.ts`.

2. Time/timezone contract
- Verify `once` schedule contract is local timestamp without `Z` suffix in MCP docs/tool schema.
- Verify scheduler validation still rejects malformed timestamps.
- Evidence: `container/agent-runner/src/ipc-mcp-stdio.ts`, `src/ipc-auth.test.ts`.

3. Oracle governance
- Verify runtime policy file exists and is loaded: `container/config/oracle-write-policy.json`.
- Verify `main` can use full write tools, non-main defaults to selected writes.
- Verify write calls append JSONL audit rows to `/workspace/ipc/oracle-write-audit.log`.
- Evidence: `container/agent-runner/src/index.ts`, `container/agent-runner/src/oracle-mcp-http.ts`.

4. Browser fallback
- Verify capability probe reports healthy when `agent-browser` is missing but Python Playwright fallback is available.
- Verify smoke instructions exist in skills (`agent-browser`, `python`).
- Evidence: `src/capability-probe.ts`, `src/capability-probe.test.ts`, skills docs.

## Canary checks (24-48h)

- Monitor `/status`:
  - `capabilities.agentBrowser`
  - `docker.spawnFailureStreak`
  - `dlq` counters
- Monitor `/ops/tools` for expected MCP/skills/tool visibility.
- Sample DLQ retries via `/ops/dlq` and `/ops/dlq/:traceId/retry`.


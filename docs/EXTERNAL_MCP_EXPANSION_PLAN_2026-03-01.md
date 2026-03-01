# External MCP Expansion Plan

Version: 1.0  
Date: March 1, 2026  
Owner: JellyCore Platform Team  
Status: In Progress (P0 completed, P1-A completed, P1-B started)

---

## 1) Executive Summary

This plan covers 4 requested upgrades:

1. Assess `notebooklm-mcp` safety and integrate it with policy controls (default enabled).
2. Add `yahoo-finance-mcp` for stock/market intelligence.
3. Add first-class enable/disable controls for all external MCP servers (`oura`, `notebooklm`, etc.).
4. Provide a no-cost Workspace Docs MCP path.

Decision summary:

| Item | Decision | Notes |
|---|---|---|
| NotebookLM MCP | GO (with controls) | Medium operational risk, high research value, default enabled |
| Yahoo Finance MCP | GO | Read-heavy finance data, no credentials required |
| External MCP enable/disable | MUST-HAVE before wide rollout | Prevent unnecessary attack surface and tool clutter |
| Workspace Docs MCP (free) | GO, phased | Start with zero-cost local docs path, then optional SaaS connectors |

---

## 2) Current State (From Local Codebase)

Current behavior:

- External MCP config is loaded from `nanoclaw/container/config/mcps.json`.
- External MCP servers are activated when all `requiredEnv` variables are present.
- Agent gets external tool patterns via `mcp__<name>__*`.
- Runtime inventory is visible via `GET /ops/tools`.

Current limitations:

- No explicit `enabled: true/false` switch in MCP config.
- No user-facing runtime toggle command for external MCPs.
- No "on-demand activation" policy per MCP.

---

## 3) Safety Assessment: `notebooklm-mcp`

### 3.1 Risk conclusion

`notebooklm-mcp` is **not inherently destructive** (it is not a shell-execution MCP and does not need privileged host access by design), but it has **medium operational/security risk** due to browser automation and persistent auth state.

### 3.2 Key risks and controls

| Risk | Impact | Level | Required Control |
|---|---|---|---|
| Browser automation account flagging / anti-bot detection | Account disruption | Medium | Use dedicated Google account, not personal primary account |
| Persistent auth/cookie profile in container filesystem | Credential exposure risk | Medium | Isolate per-group profile storage, strict filesystem scope, do not export tokens |
| Sensitive document leakage via prompts | Data governance issue | Medium | Restrict use to approved groups, policy prompt for sensitive data handling |
| Rate limits | Workflow interruptions | Low-Medium | Add operational runbook for account switching and throttling |

### 3.3 Go/No-Go

**GO**, with guardrails:

- Enabled by default, but reversible at runtime.
- Optional on-demand mode remains available per group.
- Dedicated NotebookLM account.
- Clear fallback when unavailable.

---

## 4) Target Architecture

### 4.1 External MCP lifecycle controls

Extend MCP config model to support enable/disable and startup policy:

```json
{
  "name": "notebooklm",
  "description": "NotebookLM research",
  "enabled": true,
  "startupMode": "always",
  "allowGroups": ["main"],
  "command": "notebooklm-mcp",
  "args": [],
  "requiredEnv": [],
  "env": {}
}
```

Proposed semantics:

- `enabled`: hard switch.
- `startupMode`:
  - `always`: load when session starts.
  - `on_demand`: load only when explicitly enabled by command/tool.
- `allowGroups`: optional allowlist by `group.folder`.

### 4.2 Runtime controls (user + AI)

Add management surface:

- User commands:
  - `/mcp list`
  - `/mcp enable <name>`
  - `/mcp disable <name>`
  - `/mcp status`
- AI tool (nanoclaw MCP):
  - `set_external_mcp_state(name, enabled)`
  - `list_external_mcp_states()`

State storage:

- Persist overrides in host data store (e.g. `data/external-mcp-state.json` or SQLite table).
- Apply overrides in `agent-runner` before building `mcpServers`.

---

## 5) Workstreams

### WS-A: External MCP Enable/Disable Foundation (Priority: P0)

Objective:

- Make external MCPs safely controllable without image rebuild.

Planned code areas:

- `nanoclaw/container/config/mcps.json` (schema extension)
- `nanoclaw/container/agent-runner/src/index.ts` (policy-aware server loading)
- `nanoclaw/src/index.ts` and `nanoclaw/src/health-server.ts` (`/ops/tools` visibility)
- `nanoclaw/container/agent-runner/src/ipc-mcp-stdio.ts` (management tools/commands)

Acceptance criteria:

- External MCP can be disabled even when env is present.
- Per-group on/off status is visible in `/ops/tools`.
- Toggle takes effect for new agent sessions immediately.

---

### WS-B: NotebookLM MCP Integration (Priority: P1)

Objective:

- Add NotebookLM research capabilities with controlled access.

Implementation approach:

1. Install MCP in agent image (pinned version).
2. Add `notebooklm` server entry in `mcps.json` with `enabled=true` by default.
3. Configure persistent data path for NotebookLM auth/profile per group.
4. Enable only for approved group(s), initially `main`.

Operational policy:

- Use dedicated Google account.
- Treat as optional/research-only tool.
- Add incident runbook for auth reset and rate-limit cases.

Acceptance criteria:

- User can run: `/mcp enable notebooklm`.
- Agent can call NotebookLM tools after enable.
- Auth and library state persist across sessions for the same group.

---

### WS-C: Yahoo Finance MCP Integration (Priority: P1)

Objective:

- Add financial market tooling for stock analysis and monitoring.

Implementation approach:

1. Install from source in agent image (pinned commit/tag).
2. Configure MCP server in `mcps.json` (default enabled for all groups; optional `on_demand` mode).
3. Add usage policy text in group/system prompt:
   - Data is informational, not investment advice.
   - Always include timestamp and source context in output.

Acceptance criteria:

- Agent can call tools such as:
  - `get_stock_info`
  - `get_historical_stock_prices`
  - `get_financial_statement`
  - `get_option_chain`
- Tool responses are usable in scheduled monitoring tasks.

---

### WS-D: Workspace Docs MCP (No-Cost Path) (Priority: P2)

Objective:

- Add workspace document access with zero mandatory paid services.

Recommended rollout order:

1. **Phase D1 (Recommended, zero-cost, low-risk):**
   - Local docs access via official MCP filesystem approach and existing Oracle indexing.
   - No paid API required.
2. **Phase D2 (Optional free-tier SaaS connectors):**
   - Notion official MCP (remote OAuth) if team uses Notion free plan.
   - Google Drive MCP community server if team uses Google Docs/Drive.

Decision rule:

- Start D1 first for reliability and governance.
- Add D2 only when there is clear workflow value and owner for OAuth maintenance.

Acceptance criteria:

- Agent can answer questions from local workspace docs without external paid dependency.
- Optional connectors can be enabled/disabled with same external MCP policy framework.

---

## 6) Delivery Timeline

| Phase | Dates (Target) | Deliverable |
|---|---|---|
| P0 | March 2-4, 2026 | External MCP lifecycle controls (`enabled`, on-demand, status) |
| P1-A | March 5-7, 2026 | `yahoo-finance-mcp` integrated and validated |
| P1-B | March 8-11, 2026 | `notebooklm-mcp` integrated (default enabled) + auth persistence |
| P2 | March 12-14, 2026 | No-cost Workspace Docs D1 integration + recommendation memo for D2 |

---

## 7) Test and Validation Plan

Functional:

- Verify enable/disable command flow.
- Verify per-group policy enforcement.
- Verify tool availability in `/ops/tools`.

Security and governance:

- Verify disabled MCP is not exposed in agent tool list.
- Verify missing required env still blocks startup.
- Verify audit trail for MCP toggle actions.

Operational:

- Restart nanoclaw and confirm state persistence.
- Validate failure modes:
  - external MCP process down
  - auth expired (NotebookLM)
  - provider rate limit

---

## 8) Rollback Strategy

Fast rollback:

1. Disable target MCP via runtime toggle.
2. Confirm removal in `/ops/tools`.
3. Restart affected sessions only.

Hard rollback:

1. Remove MCP entry from `mcps.json`.
2. Rebuild image without package.
3. Remove related env from compose files.

---

## 9) Definition of Done

The initiative is done when:

1. `notebooklm-mcp` and `yahoo-finance-mcp` are integrated with explicit governance.
2. External MCPs are controllable (enable/disable) without code edits.
3. Workspace docs have a no-cost path in production use.
4. `/ops/tools` accurately reports external MCP configured/active/disabled status.
5. Runbooks exist for auth, rate-limit, and fallback behavior.

---

## 10) Source References

- NotebookLM MCP repository:
  - https://github.com/PleasePrompto/notebooklm-mcp
  - https://raw.githubusercontent.com/PleasePrompto/notebooklm-mcp/main/README.md
  - https://raw.githubusercontent.com/PleasePrompto/notebooklm-mcp/main/docs/tools.md
  - https://raw.githubusercontent.com/PleasePrompto/notebooklm-mcp/main/docs/configuration.md
  - https://raw.githubusercontent.com/PleasePrompto/notebooklm-mcp/main/docs/troubleshooting.md
- Yahoo Finance MCP repository:
  - https://github.com/Alex2Yang97/yahoo-finance-mcp
  - https://raw.githubusercontent.com/Alex2Yang97/yahoo-finance-mcp/main/README.md
  - https://raw.githubusercontent.com/Alex2Yang97/yahoo-finance-mcp/main/pyproject.toml
  - https://raw.githubusercontent.com/Alex2Yang97/yahoo-finance-mcp/main/server.py
- Workspace Docs MCP references:
  - https://github.com/modelcontextprotocol/servers
  - https://developers.notion.com/guides/mcp/hosting-open-source-mcp
  - https://github.com/petergarety/gdrive-mcp
  - https://github.com/piotr-agier/google-drive-mcp

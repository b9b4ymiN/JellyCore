# MCP Baseline Policy

Version: 1.0  
Updated: March 1, 2026

## 1) Goal

Define a single professional baseline for MCP operations so the team can:
- keep all required tools available by default
- disable selected tools safely when needed
- avoid config drift between policy and runtime config

## 2) Source Files

- `nanoclaw/container/config/mcps.json` (runtime external MCP config)
- `nanoclaw/container/config/mcp-governance.json` (tier/profile policy)
- `nanoclaw/.mcp.json` (optional runtime override)

## 3) Tier Classification (Current)

| Server | Tier | Default | Reason |
|---|---|---|---|
| `yfinance` | core | enabled | Market workflows are primary use-case |
| `notebooklm` | core | enabled | Research workflows are primary use-case |
| `google_docs` | core | enabled | Workspace authoring and reporting workflows |
| `oura` | optional | enabled | Personal health data, not always needed |

Non-external core namespaces (always available in this system):
- `mcp__nanoclaw__*`
- `mcp__oracle__*`

## 4) Operating Profiles

Defined in `mcp-governance.json`:

- `all-enabled` (default): all external MCPs active
- `research-only`: disable `oura,yfinance`
- `minimal-risk`: disable `oura,notebooklm,google_docs`

Apply profile by setting:

```bash
NANOCLAW_EXTERNAL_MCP_DISABLED=<comma-separated server names>
```

Then recreate NanoClaw:

```bash
docker compose up -d --force-recreate nanoclaw
```

## 5) Required Checks

Before/after MCP changes:

```bash
cd nanoclaw
npm run mcp:policy
npm run mcp:verify
```

Runtime confirmation:

```bash
curl -s http://localhost:47779/ops/tools
```

## 6) Change Rule

When adding/removing MCP servers:

1. Update `mcps.json`
2. Update `mcp-governance.json`
3. Run `npm run mcp:policy`
4. Run `npm run mcp:verify`
5. Deploy and check Telegram with `/clear`

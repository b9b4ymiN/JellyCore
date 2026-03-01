# Agent Container - MCP Configuration

`mcps.json` defines which external MCP servers are available in the agent container.
`oracle-write-policy.json` defines Oracle write governance by group and tool.

Each server in `servers` is evaluated with this policy:
- `enabled !== false`
- `startupMode !== "on_demand"` (auto-start only)
- all `requiredEnv` vars are present in runtime secrets
- current group is in `allowGroups` (when configured)

Current default in this repo:
- all configured MCPs are `enabled: true`
- all configured MCPs use `startupMode: "always"`

---

## How to add a new MCP

### Step 1 - Install the MCP package in the Dockerfile

Edit `nanoclaw/container/Dockerfile` and add an install step in the runtime stage.

Example:

```dockerfile
# My Custom MCP
RUN git clone --depth=1 https://github.com/example/my-mcp /opt/my-mcp \
    && cd /opt/my-mcp \
    && npm install \
    && npm run build \
    && rm -rf /opt/my-mcp/.git
```

Or for npm-published MCPs:

```dockerfile
RUN npm install -g @example/my-mcp
```

Important:
- If the MCP uses standard `tsc` output (not a bundled build), keep `node_modules`.

### Step 2 - Add the server entry to `mcps.json`

```json
{
  "name": "my-mcp",
  "description": "What this MCP does",
  "enabled": true,
  "startupMode": "always",
  "allowGroups": [],
  "command": "node",
  "args": ["/opt/my-mcp/build/index.js"],
  "requiredEnv": ["MY_MCP_API_KEY"],
  "env": {
    "MY_MCP_API_KEY": "MY_MCP_API_KEY"
  }
}
```

Fields:
- `name` - lowercase, becomes `mcp__<name>__*` tool prefix seen by the agent
- `enabled` - hard enable/disable switch (default `true`)
- `startupMode` - `always` or `on_demand` (default `always`)
- `allowGroups` - optional allowlist by `group.folder` (empty = all groups)
- `requiredEnv` - all of these must be set in runtime secrets for the server to start
- `env` - maps `{ envVarInsideMCPServer: envVarInSecrets }`

### Step 3 - Expose token/secret vars at runtime

In `nanoclaw/src/container-runner.ts` -> `readSecrets()`, add your variable in `allowedVars`:

```typescript
'MY_MCP_API_KEY',
```

In `docker-compose.yml` and `docker-compose.production.yml`, add the variable in nanoclaw `environment`:

```yaml
- MY_MCP_API_KEY=${MY_MCP_API_KEY}
```

Then set the value in your `.env`.

### Step 4 - Rebuild and restart

```bash
docker build -t nanoclaw-agent:latest -f nanoclaw/container/Dockerfile nanoclaw/container
docker compose up -d nanoclaw
```

---

## Existing MCPs

| Name | Description | Required Token |
|------|-------------|----------------|
| `oura` | Oura Ring data: sleep, readiness, activity, HRV, SpO2 | `OURA_PERSONAL_ACCESS_TOKEN` |
| `yfinance` | Yahoo Finance: prices, fundamentals, options, recommendations | none |
| `notebooklm` | NotebookLM research via browser automation | none (interactive Google login) |

---

## Oracle Write Governance

`oracle-write-policy.json` shape:

```json
{
  "default": {
    "mode": "selected",
    "allow": ["oracle_user_model_update"]
  },
  "groups": {
    "main": {
      "mode": "full",
      "allow": ["*"]
    }
  }
}
```

Modes:
- `none` - no write tools
- `selected` - only tools listed in `allow`
- `full` - all write tools

Runtime behavior:
- Group mapping uses `group.folder` (for example `main`).
- Every write call is appended to `/workspace/ipc/oracle-write-audit.log` as JSONL.

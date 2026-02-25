# Agent Container — MCP Configuration

`mcps.json` defines which **external MCP servers** are activated inside the agent container.
`oracle-write-policy.json` defines **Oracle write governance** by group and tool.

Each server in the `servers` array is started automatically if all its `requiredEnv` vars are present in the container's runtime secrets.

---

## How to add a new MCP

### Step 1 — Install the MCP package in the Dockerfile

Edit `nanoclaw/container/Dockerfile` and add an install step in the runtime stage. Example:

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

> **Important**: If the MCP uses standard `tsc` output (not a bundled build), keep `node_modules` — do **not** run `rm -rf node_modules` after the build.

### Step 2 — Add the server entry to `mcps.json`

```json
{
  "name": "my-mcp",
  "description": "What this MCP does",
  "command": "node",
  "args": ["/opt/my-mcp/build/index.js"],
  "requiredEnv": ["MY_MCP_API_KEY"],
  "env": {
    "MY_MCP_API_KEY": "MY_MCP_API_KEY"
  }
}
```

Fields:
- `name` — lowercase, becomes `mcp__<name>__*` tool prefix seen by the agent
- `requiredEnv` — ALL of these must be set (truthy) in the runtime secrets for the server to start
- `env` — maps `{ envVarInsideMCPServer: envVarInSecrets }`

### Step 3 — Expose the token as a runtime secret

In `nanoclaw/src/container-runner.ts` → `readSecrets()`, add the var name to `allowedVars`:

```typescript
'MY_MCP_API_KEY',
```

In `docker-compose.yml` and `docker-compose.production.yml`, add to the nanoclaw `environment` block:

```yaml
- MY_MCP_API_KEY=${MY_MCP_API_KEY}
```

Add the actual value to your `.env` file on the server.

### Step 4 — Rebuild and restart

```bash
docker build -t nanoclaw-agent:latest -f nanoclaw/container/Dockerfile nanoclaw/container
docker compose up -d nanoclaw
```

---

## Existing MCPs

| Name | Description | Required Token |
|------|-------------|----------------|
| `oura` | Oura Ring — sleep, readiness, activity, HRV, SpO2 | `OURA_PERSONAL_ACCESS_TOKEN` |

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

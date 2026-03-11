# Oracle MCP SSE Transport

Oracle MCP Server รองรับ SSE (Server-Sent Events) Transport สำหรับการเชื่อมต่อจากระยะไกลผ่าน HTTP

## Overview

| Feature | Description |
|---------|-------------|
| **Protocol** | MCP over SSE (JSON-RPC 2.0) |
| **Endpoint** | `http://localhost:47778/mcp` |
| **Authentication** | Bearer Token (`ORACLE_AUTH_TOKEN`) |
| **Session Mode** | Stateful with SSE notifications |

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/mcp` | SSE stream for server-to-client notifications |
| `POST` | `/mcp` | Client-to-server JSON-RPC messages |
| `DELETE` | `/mcp` | Session termination |
| `GET` | `/mcp/status` | Session status (debug/metrics) |

## Connection Flow

```
┌──────────┐                              ┌──────────┐
│  Client  │                              │  Server  │
└────┬─────┘                              └────┬─────┘
     │                                         │
     │  1. GET /mcp (SSE connection)           │
     │────────────────────────────────────────>│
     │                                         │
     │  2. event: endpoint                     │
     │     data: /mcp?sessionId=xxx            │
     │<────────────────────────────────────────│
     │                                         │
     │  3. POST /mcp?sessionId=xxx (JSON-RPC)  │
     │────────────────────────────────────────>│
     │                                         │
     │  4. event: message (response via SSE)   │
     │<────────────────────────────────────────│
     │                                         │
     │  5. POST /mcp?sessionId=xxx (more msgs) │
     │────────────────────────────────────────>│
     │                                         │
     │  6. event: message (response via SSE)   │
     │<────────────────────────────────────────│
```

## Quick Start

### 1. Start Oracle Server

```bash
# Using Docker
docker-compose up -d

# Or directly with Bun
cd oracle-v2
bun run dev
```

### 2. Test Connection

```bash
# Get your auth token from .env
TOKEN="your-oracle-auth-token"

# Check MCP status
curl -H "Authorization: Bearer $TOKEN" http://localhost:47778/mcp/status

# Connect via SSE (returns session ID)
curl -N -H "Authorization: Bearer $TOKEN" \
  -H "Accept: text/event-stream" \
  http://localhost:47778/mcp
# Output: event: endpoint
#         data: /mcp?sessionId=YOUR_SESSION_ID
```

### 3. Initialize MCP Session

```bash
SESSION_ID="your-session-id"

curl -X POST "http://localhost:47778/mcp?sessionId=$SESSION_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "my-client", "version": "1.0.0"}
    }
  }'
```

## Available Tools

Oracle MCP Server provides 22 tools for knowledge management:

### Search & Discover

| Tool | Description |
|------|-------------|
| `oracle_search` | Hybrid search (FTS5 + ChromaDB vectors) |
| `oracle_list` | Browse all documents |
| `oracle_concepts` | List topic coverage |
| `oracle_stats` | Get knowledge base statistics |

### Consult & Reflect

| Tool | Description |
|------|-------------|
| `oracle_consult` | Get guidance for decisions |
| `oracle_reflect` | Random wisdom for alignment |

### Learn & Remember

| Tool | Description |
|------|-------------|
| `oracle_learn` | Add new patterns/learnings |
| `oracle_thread` | Multi-turn discussions |
| `oracle_threads` | List discussion threads |
| `oracle_thread_read` | Read thread history |
| `oracle_thread_update` | Update thread status |

### Trace & Distill

| Tool | Description |
|------|-------------|
| `oracle_trace` | Log discovery sessions |
| `oracle_trace_list` | Find past traces |
| `oracle_trace_get` | Get trace details |
| `oracle_trace_link` | Chain related traces |
| `oracle_trace_chain` | View full chain |

### Decisions

| Tool | Description |
|------|-------------|
| `oracle_decisions_create` | Track important decisions |
| `oracle_decisions_list` | Review pending decisions |
| `oracle_decisions_get` | Get decision details |
| `oracle_decisions_update` | Update decision status |

### Supersede

| Tool | Description |
|------|-------------|
| `oracle_supersede` | Mark old documents as outdated |

## Client Implementation Examples

### TypeScript/JavaScript

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const AUTH_TOKEN = process.env.ORACLE_AUTH_TOKEN;
const SERVER_URL = 'http://localhost:47778/mcp';

const transport = new SSEClientTransport(
  new URL(SERVER_URL),
  {
    requestInit: {
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`
      }
    }
  }
);

const client = new Client({
  name: 'oracle-client',
  version: '1.0.0'
}, {
  capabilities: {}
});

await client.connect(transport);

// List available tools
const { tools } = await client.request(
  { method: 'tools/list' },
  { timeout: 5000 }
);

// Search Oracle knowledge
const result = await client.request(
  {
    method: 'tools/call',
    params: {
      name: 'oracle_search',
      arguments: { query: 'git safety patterns' }
    }
  },
  { timeout: 10000 }
);

console.log(result);
```

### Python

```python
import asyncio
from mcp import ClientSession
from mcp.client.sse import sse_client

AUTH_TOKEN = "your-oracle-auth-token"
SERVER_URL = "http://localhost:47778/mcp"

async def main():
    headers = {"Authorization": f"Bearer {AUTH_TOKEN}"}

    async with sse_client(SERVER_URL, headers=headers) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            # List tools
            tools = await session.list_tools()
            print(f"Available tools: {len(tools.tools)}")

            # Search Oracle
            result = await session.call_tool(
                "oracle_search",
                arguments={"query": "git safety patterns"}
            )
            print(result.content)

asyncio.run(main())
```

### cURL (Manual Testing)

```bash
TOKEN="your-oracle-auth-token"
BASE_URL="http://localhost:47778"

# 1. Start SSE connection in background
curl -N -H "Authorization: Bearer $TOKEN" \
  -H "Accept: text/event-stream" \
  "$BASE_URL/mcp" &
SSE_PID=$!

# Wait for session ID
sleep 1

# 2. Get session ID from SSE output (or capture it)
SESSION_ID="your-session-id"

# 3. Initialize
curl -X POST "$BASE_URL/mcp?sessionId=$SESSION_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl-test","version":"1.0"}}}'

# 4. Call oracle_search
curl -X POST "$BASE_URL/mcp?sessionId=$SESSION_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"oracle_search","arguments":{"query":"patterns"}}}'

# 5. Cleanup
kill $SSE_PID
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ORACLE_MCP_ENABLED` | `true` | Enable/disable MCP SSE |
| `ORACLE_MCP_PATH` | `/mcp` | MCP endpoint path |
| `ORACLE_MCP_SESSION_TIMEOUT_MS` | `3600000` | Session timeout (1 hour) |
| `ORACLE_AUTH_TOKEN` | (required) | Bearer token for authentication |

### Docker Compose

```yaml
services:
  oracle:
    image: jellycore-oracle:latest
    environment:
      - ORACLE_AUTH_TOKEN=${ORACLE_AUTH_TOKEN}
      - ORACLE_MCP_ENABLED=true
      - ORACLE_MCP_PATH=/mcp
    ports:
      - "47778:47778"
```

## Security

1. **Authentication**: All MCP requests require valid Bearer token
2. **TLS/HTTPS**: Recommended for production deployments
3. **Rate Limiting**: Inherits HTTP server rate limits
4. **Session Timeout**: Default 1 hour, configurable

## Troubleshooting

### 401 Unauthorized

```bash
# Check token is correct
curl -H "Authorization: Bearer $TOKEN" http://localhost:47778/mcp/status
```

### Session Not Found

Ensure you establish SSE connection first:
1. GET `/mcp` to start SSE stream
2. Capture `sessionId` from `endpoint` event
3. Use same `sessionId` for all POST requests

### SSE Returns HTML

This was fixed in latest version. Ensure you're using updated image:
```bash
docker build -t jellycore-oracle:latest .
docker-compose down && docker-compose up -d
```

### No Response via SSE

- Check POST request includes `sessionId` parameter
- Verify SSE connection is still active
- Check server logs: `docker logs jellycore-oracle`

## Architecture

```
oracle-v2/
├── src/
│   ├── index.ts                    # MCP Server (stdio transport)
│   ├── server.ts                   # HTTP Server (Hono.js)
│   ├── mcp-sse.ts                  # SSE Transport implementation
│   └── server/routes/
│       ├── mcp-sse.ts              # SSE routes (GET/POST/DELETE)
│       └── mcp-server-factory.ts   # MCP server with handlers
```

## See Also

- [MCP Specification](https://modelcontextprotocol.io/)
- [Oracle Development Guide](../DEV_WORKFLOW.md)
- [Docker Deployment](../docker-compose.yml)

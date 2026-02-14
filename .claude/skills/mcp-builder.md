---
name: mcp-builder
description: Model Context Protocol (MCP) server development - build, test, and deploy MCP servers with TypeScript/Python
---

# MCP Builder — Model Context Protocol Expert

Expert skill for building MCP (Model Context Protocol) servers that extend Claude's capabilities with custom tools, resources, and prompts.

## When to Activate

- Building new MCP servers from scratch
- Creating custom tools for Claude
- Exposing APIs, databases, or services to Claude
- Implementing MCP resources (file systems, knowledge bases)
- Setting up MCP HTTP bridges
- Debugging MCP communication issues
- Converting existing APIs to MCP format

## MCP Architecture

### Core Concepts

```typescript
// MCP Server provides:
// 1. Tools - Functions Claude can call
// 2. Resources - Data Claude can read
// 3. Prompts - Reusable prompt templates
```

**Components:**
- **MCP Server** - Exposes capabilities via stdio or HTTP
- **MCP Client** - Claude Desktop, IDEs, or custom clients
- **Transport Layer** - stdio (local) or HTTP/SSE (remote)

## Creating MCP Servers

### TypeScript/Node.js MCP Server

```typescript
// server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Initialize server
const server = new Server(
  {
    name: 'my-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'search_database',
        description: 'Search the knowledge database',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query',
            },
            limit: {
              type: 'number',
              description: 'Max results',
              default: 10,
            },
          },
          required: ['query'],
        },
      },
    ],
  };
});

// Implement tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'search_database') {
    const results = await searchDatabase(args.query, args.limit);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(results, null, 2),
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// Start server with stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP server running on stdio');
}

main().catch(console.error);
```

### Python MCP Server

```python
# server.py
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

app = Server("my-python-mcp")

@app.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="analyze_data",
            description="Analyze data and return insights",
            inputSchema={
                "type": "object",
                "properties": {
                    "data": {"type": "string"},
                    "method": {"type": "string", "enum": ["stats", "ml"]}
                },
                "required": ["data"]
            }
        )
    ]

@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    if name == "analyze_data":
        result = analyze(arguments["data"], arguments.get("method", "stats"))
        return [TextContent(type="text", text=str(result))]
    
    raise ValueError(f"Unknown tool: {name}")

if __name__ == "__main__":
    import asyncio
    asyncio.run(stdio_server(app))
```

## MCP HTTP Bridge

For remote servers or containerized services:

```typescript
// http-bridge.ts
import express from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

const app = express();

app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  await server.connect(transport);
});

app.post('/messages', async (req, res) => {
  // Handle MCP messages over HTTP
});

app.listen(3000, () => {
  console.log('MCP HTTP server running on port 3000');
});
```

## Resources & Prompts

### Exposing Resources

```typescript
import { ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'file:///docs/api.md',
        name: 'API Documentation',
        mimeType: 'text/markdown',
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  const content = await readFile(uri);
  
  return {
    contents: [
      {
        uri,
        mimeType: 'text/markdown',
        text: content,
      },
    ],
  };
});
```

### Reusable Prompts

```typescript
import { ListPromptsRequestSchema, GetPromptRequestSchema } from '@modelcontextprotocol/sdk/types.js';

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: 'code_review',
        description: 'Review code for quality and security',
        arguments: [
          {
            name: 'code',
            description: 'Code to review',
            required: true,
          },
        ],
      },
    ],
  };
});
```

## Best Practices

### Tool Design

1. **Clear Naming** - Use descriptive tool names (verb_noun)
2. **Detailed Descriptions** - Help Claude understand when to use each tool
3. **Strong Schemas** - Use JSON Schema for validation
4. **Error Handling** - Return helpful error messages
5. **Idempotency** - Tools should be safe to retry

### Security

```typescript
// ✅ GOOD: Validate all inputs
if (!isValidQuery(args.query)) {
  throw new Error('Invalid query format');
}

// ✅ GOOD: Rate limiting
const rateLimiter = new RateLimiter({ maxRequests: 100, window: 60000 });
await rateLimiter.check(clientId);

// ✅ GOOD: Authentication
if (!validateApiKey(request.headers.authorization)) {
  throw new Error('Unauthorized');
}

// ❌ BAD: Exposing sensitive operations without checks
await db.query(`DELETE FROM users WHERE id = ${userId}`); // SQL injection!
```

### Testing

```typescript
// test/server.test.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

describe('MCP Server', () => {
  it('should list available tools', async () => {
    const tools = await client.listTools();
    expect(tools).toHaveLength(3);
    expect(tools[0].name).toBe('search_database');
  });

  it('should execute tool successfully', async () => {
    const result = await client.callTool('search_database', {
      query: 'test',
      limit: 5,
    });
    expect(result.content[0].type).toBe('text');
  });
});
```

## Configuration

### Claude Desktop Integration

```json
// claude_desktop_config.json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["/path/to/build/server.js"]
    },
    "python-server": {
      "command": "python",
      "args": ["/path/to/server.py"]
    },
    "remote-server": {
      "url": "http://localhost:3000/sse",
      "transport": "sse"
    }
  }
}
```

### Environment Variables

```bash
# .env
MCP_SERVER_PORT=3000
MCP_LOG_LEVEL=debug
DATABASE_URL=postgresql://localhost/db
API_KEY=secret-key
```

## Common Patterns

### Database Access Tool

```typescript
{
  name: 'query_database',
  description: 'Query the database with read-only access',
  inputSchema: {
    type: 'object',
    properties: {
      table: { type: 'string', enum: ['users', 'posts', 'comments'] },
      filters: { type: 'object' },
      limit: { type: 'number', maximum: 100, default: 10 }
    },
    required: ['table']
  }
}
```

### File System Access

```typescript
{
  name: 'read_project_file',
  description: 'Read files from the project directory',
  inputSchema: {
    type: 'object',
    properties: {
      path: { 
        type: 'string',
        pattern: '^[a-zA-Z0-9/_.-]+$' // Prevent path traversal
      }
    },
    required: ['path']
  }
}
```

### External API Integration

```typescript
{
  name: 'fetch_weather',
  description: 'Get current weather for a location',
  inputSchema: {
    type: 'object',
    properties: {
      city: { type: 'string' },
      country: { type: 'string' },
      units: { type: 'string', enum: ['metric', 'imperial'], default: 'metric' }
    },
    required: ['city']
  }
}
```

## Debugging

### Enable Verbose Logging

```typescript
// Set environment variable
process.env.MCP_LOG_LEVEL = 'debug';

// Or use built-in logging
server.onerror = (error) => {
  console.error('MCP Error:', error);
};
```

### Test with MCP Inspector

```bash
# Install MCP inspector
npm install -g @modelcontextprotocol/inspector

# Run your server with inspector
mcp-inspector node build/server.js
```

## Package.json Setup

```json
{
  "name": "my-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "my-mcp-server": "./build/server.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^0.5.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node build/server.js"
  }
}
```

## References

- [MCP Specification](https://spec.modelcontextprotocol.io)
- [MCP SDK GitHub](https://github.com/modelcontextprotocol/sdk)
- [Claude MCP Documentation](https://modelcontextprotocol.io)
- [Example MCP Servers](https://github.com/modelcontextprotocol/servers)

---

**Pro Tips:**
- Start with stdio transport for local development
- Use HTTP/SSE for production deployments
- Always validate and sanitize tool inputs
- Implement graceful error handling
- Log all tool invocations for debugging
- Use TypeScript for better type safety
- Write tests for all tools before deploying

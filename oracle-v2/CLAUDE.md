# Oracle V2 — Developer Context

Oracle V2 is JellyCore's knowledge engine: hybrid FTS5 + ChromaDB search, 5-layer memory, and 20+ MCP tools.

## Quick Context

| Runtime | Port | DB | Framework |
|---------|------|----|-----------|
| Bun | 47778 | SQLite (Drizzle ORM) + ChromaDB | Hono.js |

## Key Directories

| Path | Purpose |
|------|---------|
| `src/` | Core logic: indexer, search, MCP server, HTTP handlers |
| `src/indexer.ts` | File watcher + document ingestion pipeline |
| `src/index.ts` | HTTP server startup + MCP handler registration |
| `frontend/` | React dashboard (Vite) |
| `scripts/` | CLI tools (re-index, migrate, etc.) |
| `ψ/memory/` | Knowledge files: `learnings/`, `resonance/`, `retrospectives/` |
| `ψ/inbox/handoff/` | Session handoff notes |
| `tests/` | Unit tests (Vitest) |
| `e2e/` | End-to-end tests (Playwright) |

## Dev Commands

```bash
bun run dev          # Start Oracle with hot reload
bun test             # Run unit tests
bun run build        # Compile for production
bun run db:migrate   # Apply Drizzle migrations
bun run db:studio    # Open Drizzle Studio
```

## Key Patterns

- **ORM**: Drizzle — always define schema in `src/schema.ts`, run `bun run db:generate` after changes
- **Migrations**: stored in `drizzle/` — commit migration files, never edit them manually
- **Memory indexer**: reads from `ψ/memory/{resonance,learnings,retrospectives}` — file changes trigger re-index automatically
- **Auth**: Bearer token (`ORACLE_AUTH_TOKEN`) required on all non-health endpoints

## Full Dev Workflow

See [DEV_WORKFLOW.md](DEV_WORKFLOW.md) for the complete Claude Code workflow guide (phases, retrospectives, git).

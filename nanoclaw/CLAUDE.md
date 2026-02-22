# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process that connects to Telegram, routes messages to Claude Agent SDK running in Docker containers. Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/telegram.ts` | Telegram bot connection, grammY, send/receive |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/heartbeat-config.ts` | Heartbeat runtime config, activity/error tracking |
| `src/heartbeat-reporter.ts` | Status message builder, restartable timers |
| `src/heartbeat-jobs.ts` | Smart job runner: claim, timeout, parallel batch |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group agent instructions (isolated) |
| `container/skills/agent-browser.md` | Browser automation tool (available to all agents via Bash) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

Service management:
```bash
docker compose up -d nanoclaw      # Start service
docker compose restart nanoclaw    # Restart service
docker compose logs -f nanoclaw    # Follow logs
docker compose down                # Stop all services
```

## Agent Container Build Cache

Docker BuildKit caches layers aggressively. `--no-cache` alone does NOT invalidate COPY steps if the build context hasn't changed. To force a clean rebuild:

```bash
docker builder prune -f
./container/build.sh
```

Always verify after rebuild: `docker run -i --rm --entrypoint wc nanoclaw-agent:latest -l /app/src/index.ts`

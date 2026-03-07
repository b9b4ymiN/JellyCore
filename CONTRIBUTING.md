# Contributing

## Scope

JellyCore accepts contributions for:

- Runtime reliability and security
- Oracle memory and API behavior
- NanoClaw orchestration and channel adapters
- Skills-based extensions for new capabilities

## Local validation before PR

Run the core matrix locally before opening a PR:

```powershell
cd nanoclaw; npm test
cd ../oracle-v2; bun test src/integration/http.test.ts src/integration/security-http.test.ts
cd ../oracle-v2; bun run test:e2e
cd ../oracle-v2/frontend; bun run build
cd ../../thai-nlp-sidecar; pytest tests -q
docker compose -f docker-compose.yml config -q
docker compose -f docker-compose.production.yml config -q
```

## Skill contribution checklist

When adding a new skill:

1. Create `SKILL.md` with clear trigger conditions and boundaries.
2. Keep examples runnable and minimal.
3. Add explicit prerequisites (env vars, APIs, tools).
4. Include failure-mode handling and fallback behavior.
5. Add tests or at least deterministic validation steps.

Minimal skill structure:

```text
<skill-name>/
  SKILL.md
  scripts/        # optional helper scripts
  references/     # optional focused references
  assets/         # optional templates/snippets
```

## Pull request guidance

- Keep changes scoped and reviewable.
- Do not mix unrelated refactors with bug fixes.
- Document any new env vars and operational impacts.
- If behavior changes, include integration tests for it.

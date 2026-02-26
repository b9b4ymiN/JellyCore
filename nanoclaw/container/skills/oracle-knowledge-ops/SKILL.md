---
name: oracle-knowledge-ops
description: "Operate Oracle knowledge workflows: check API health, validate search quality, run indexing or embedding refresh scripts, and confirm memory-layer behavior. Use for search quality issues, stale knowledge, indexing failures, and Oracle maintenance tasks."
allowed-tools: Bash(curl:*), Bash(bun*:*), Bash(docker*:*), Bash(rg:*)
---

# Oracle Knowledge Operations

Use this workflow when Oracle knowledge behavior is wrong or stale.

## 1) Baseline Health

```bash
curl -fsS http://localhost:47778/api/health
curl -fsS "http://localhost:47778/api/stats"
```

## 2) Validate User-Facing Behavior

```bash
curl -fsS "http://localhost:47778/api/search?q=test&limit=5"
curl -fsS "http://localhost:47778/api/consult?q=test"
```

## 3) Choose Maintenance Action

- Reindex knowledge (when content changed, index stale, missing docs):
```bash
cd oracle-v2
bun run index
```

- Refresh embeddings (when model changed or vector quality is poor):
```bash
cd oracle-v2
bun run re-embed
```

## 4) Verify Completion

- API health remains OK
- Search returns expected docs
- Stats show updated indexing timestamps/counters

## Output Requirements

- Problem statement
- Actions and commands run
- Verification evidence
- Remaining risk and follow-up

Load [references/api-checks.md](references/api-checks.md) for endpoint-level checklists.

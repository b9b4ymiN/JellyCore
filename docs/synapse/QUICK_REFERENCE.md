# Synapse Quick Reference

## One-Liner

```
Synapse = Graphiti (Graph+Temporal) + Oracle-v2 (Five-Layers+Thai-NLP)
```

## Key Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Base | Graphiti | 24K stars, proven, temporal graph |
| Strategy | Fork + Inject | 3-5 days vs 2-3 weeks |
| Graph DB | FalkorDB | Easy setup, Redis-based |
| Embedding | multilingual-e5-large | Better Thai support |

## Timeline

```
Day 1-2: Setup + Fork Graphiti
Day 2-3: Add Five-Layer Model
Day 3:   Add Thai NLP
Day 4:   Add MCP Tools
Day 5:   Integration + Deploy
```

## What We Get Free (Graphiti)

- Temporal Knowledge Graph
- Entity extraction
- Contradiction handling
- Hybrid retrieval
- MCP Server
- Provenance (Episodes)

## What We Add (Oracle-v2)

- Five-Layer Memory Model
- Thai NLP Sidecar
- Decay Scoring
- User Model
- Procedural Memory
- Supersede Pattern

## MCP Tools

```
Memory:  remember, recall, forget, context
Graph:   query, timeline, entities, relations
User:    profile, preferences
System:  stats, health, backup
```

## Five Layers

```
1. user_model   → Never decay
2. procedural   → Slow decay (139 days)
3. semantic     → Normal decay (69 days)
4. episodic     → TTL 90 days
5. working      → Session only
```

## Commands

```bash
# Setup
git clone https://github.com/getzep/graphiti synapse
docker run -d -p 6379:6379 falkordb/falkordb
pip install -e ".[dev]"

# Run MCP
cd mcp_server && python -m graphiti_mcp_server

# Test
curl http://localhost:8000/health
```

## Files

```
synapse/
├── graphiti/           # Original (keep)
├── synapse/            # Our additions
│   ├── layers/         # Five-layer model
│   ├── nlp/            # Thai NLP
│   └── mcp/            # Extended tools
└── mcp_server/         # Graphiti MCP (keep)
```

## Next Steps

1. ✅ Planning complete
2. ⬜ Fork Graphiti
3. ⬜ Setup FalkorDB
4. ⬜ Add layers
5. ⬜ Add Thai NLP
6. ⬜ Add MCP tools
7. ⬜ Integrate with JellyCore

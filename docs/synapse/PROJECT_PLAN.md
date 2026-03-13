# Synapse - Unified AI Memory System

> **"One Brain. Infinite Connections."**

**Status:** Planning
**Created:** 2026-03-13
**Author:** Fon (AI) + Boat (Human)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Problem Statement](#problem-statement)
3. [Solution Overview](#solution-overview)
4. [Architecture](#architecture)
5. [Implementation Strategy](#implementation-strategy)
6. [Tech Stack](#tech-stack)
7. [MCP Tools](#mcp-tools)
8. [Timeline](#timeline)
9. [Risk Assessment](#risk-assessment)
10. [Appendix](#appendix)

---

## Executive Summary

Synapse เป็นโปรเจคสร้างระบบสมองหลักใหม่สำหรับ JellyCore ที่รวมข้อดีจาก:

- **Oracle-v2** - Five-Layer Memory + Thai NLP
- **Graphiti (Zep)** - Knowledge Graph + Temporal Facts
- **Supermemory** - User Profiles + Connectors

**Strategy:** Fork Graphiti + Inject Oracle-v2 features

**Timeline:** 3-5 days

**Key Innovation:**
- Temporal Knowledge Graph ที่รองรับภาษาไทย
- Five-Layer Memory Model
- Real-time Indexing
- Auto Contradiction Handling

---

## Problem Statement

### จุดอ่อนของ Oracle-v2 (ปัจจุบัน)

| # | จุดอ่อน | ระดับ | หมายเหตุ |
|---|--------|------|---------|
| 1 | No Real-time Indexing | สูง | ต้อง manual re-index |
| 2 | No Knowledge Graph | สูง | เป็น flat documents |
| 3 | Limited Scalability | กลาง | SQLite ไม่เหมาะกับ large scale |
| 4 | Single Point of Failure | กลาง | ไม่มี auto backup |
| 5 | Embedding Model | ต่ำ | all-MiniLM-L6-v2 เก่าแล้ว |

### สิ่งที่ Oracle-v2 มีและดีอยู่แล้ว

| Feature | Status |
|---------|--------|
| Five-Layer Memory | ✅ ดีมาก |
| Thai NLP Sidecar | ✅ ดีมาก |
| Decay Scoring | ✅ มีแล้ว |
| Confidence Scoring | ✅ มีแล้ว |
| Episodic Memory + TTL | ✅ มีแล้ว |
| Supersede Pattern | ✅ มีแล้ว |

---

## Solution Overview

### Option E: Fork Graphiti + Inject Oracle-v2

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   BASE: Graphiti (Python)                                       │
│   ─────────────────────                                         │
│   ✅ Temporal Knowledge Graph                                   │
│   ✅ Entity extraction                                          │
│   ✅ Contradiction handling                                     │
│   ✅ Hybrid retrieval (semantic + BM25 + graph)                 │
│   ✅ MCP Server built-in                                        │
│   ✅ Provenance (Episodes)                                      │
│                                                                 │
│   INJECT FROM Oracle-v2:                                        │
│   ────────────────────────                                      │
│   ✅ Five-Layer Memory Model                                    │
│   ✅ Thai NLP Sidecar                                           │
│   ✅ User Model (preferences, expertise)                        │
│   ✅ Procedural Memory (how-to patterns)                        │
│   ✅ Decay Scoring System                                       │
│   ✅ Supersede Pattern ("Nothing is Deleted")                   │
│                                                                 │
│   ADD NEW:                                                      │
│   ──────────                                                    │
│   ✅ Real-time Indexing (immediate, not batch)                  │
│   ✅ Unified MCP interface                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Why Fork + Merge?

| Aspect | Build New (Option D) | Fork + Merge (Option E) |
|--------|---------------------|------------------------|
| **Time** | 2-3 weeks | 3-5 days |
| **Risk** | High | Low |
| **Code Quality** | Unknown | Proven (24K stars) |
| **Maintenance** | All on us | Upstream updates available |
| **Knowledge Graph** | Must build | ✅ Already exists |
| **Temporal** | Must build | ✅ Already exists |
| **MCP Server** | Must build | ✅ Already exists |
| **Contradiction** | Must build | ✅ Already exists |

---

## Architecture

### System Overview

```
                              ┌─────────────┐
                              │    USER     │
                              └──────┬──────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                          MCP SERVER (Port 47780)                            │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                         MCP TOOLS                                    │   │
│   ├─────────────────────────────────────────────────────────────────────┤   │
│   │                                                                     │   │
│   │   MEMORY LAYER                                                      │   │
│   │   ──────────────                                                    │   │
│   │   • synapse_remember     → Add new memory (auto layer detect)      │   │
│   │   • synapse_recall       → Search memories (hybrid)                │   │
│   │   • synapse_forget       → Decay/archive/delete                   │   │
│   │   • synapse_context      → Get user context for system prompt     │   │
│   │                                                                     │   │
│   │   GRAPH LAYER                                                        │   │
│   │   ──────────────                                                    │   │
│   │   • synapse_query        → Graph traversal queries                 │   │
│   │   • synapse_timeline     → "What was true when" queries            │   │
│   │   • synapse_entities     → List/Manage entities                    │   │
│   │   • synapse_relations    → List/Manage relationships               │   │
│   │                                                                     │   │
│   │   USER LAYER                                                         │   │
│   │   ──────────────                                                    │   │
│   │   • synapse_profile      → Get/Update user profile                 │   │
│   │   • synapse_preferences  → Get/Update preferences                  │   │
│   │                                                                     │   │
│   │   SYSTEM                                                             │   │
│   │   ──────────────                                                    │   │
│   │   • synapse_stats        → Database statistics                     │   │
│   │   • synapse_health       → Health check                            │   │
│   │   • synapse_backup       → Manual backup trigger                   │   │
│   │                                                                     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                        CORE ENGINE                                          │
│                                                                             │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│   │   LAYER      │  │   GRAPH      │  │   THAI       │  │   REAL-TIME  │    │
│   │   ENGINE     │  │   ENGINE     │  │   NLP        │  │   INDEXER    │    │
│   ├──────────────┤  ├──────────────┤  ├──────────────┤  ├──────────────┤    │
│   │              │  │              │  │              │  │              │    │
│   │ • User Model │  │ • Entities   │  │ • Normalize  │  │ • Event      │    │
│   │ • Procedural │  │ • Relations  │  │ • Tokenize   │  │   Queue      │    │
│   │ • Semantic   │  │ • Facts      │  │ • Spellcheck │  │ • Worker     │    │
│   │ • Episodic   │  │ • Temporal   │  │              │  │ • Immediate  │    │
│   │              │  │              │  │              │  │   Index      │    │
│   └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                        STORAGE LAYER                                        │
│                                                                             │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                 │
│   │              │    │              │    │              │                 │
│   │   FalkorDB   │    │  ChromaDB    │    │   SQLite     │                 │
│   │   (Graph)    │    │  (Vector)    │    │  (Metadata)  │                 │
│   │              │    │              │    │              │                 │
│   │ • Nodes      │    │ • Embeddings │    │ • User Model │                 │
│   │ • Edges      │    │ • Semantic   │    │ • Logs       │                 │
│   │ • Temporal   │    │   Search     │    │ • Backup     │                 │
│   │              │    │              │    │              │                 │
│   └──────────────┘    └──────────────┘    └──────────────┘                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Five-Layer Memory System

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                        FIVE-LAYER MEMORY                                    │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Layer 1: USER_MODEL                                                       │
│   ──────────────────────                                                    │
│   • Preferences (language, style, timezone)                                │
│   • Expertise levels per topic                                             │
│   • Common topics                                                           │
│   • Personality notes                                                       │
│                                                                             │
│   → Decay: NEVER                                                            │
│   → Storage: SQLite (private)                                               │
│   → Graph: (User) node with properties                                      │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Layer 2: PROCEDURAL                                                       │
│   ──────────────────────                                                    │
│   • "How to work" patterns                                                  │
│   • Trigger → Procedure mapping                                            │
│   • Success count tracking                                                  │
│                                                                             │
│   → Decay: SLOW (λ = 0.005, half-life ~139 days)                           │
│   → Storage: FalkorDB + ChromaDB                                            │
│   → Graph: (Procedure) nodes with trigger edges                            │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Layer 3: SEMANTIC                                                         │
│   ──────────────────────                                                    │
│   • Principles (core beliefs)                                               │
│   • Patterns (observed patterns)                                           │
│   • Learnings (facts discovered)                                           │
│                                                                             │
│   → Decay: NORMAL (λ = 0.01, half-life ~69 days)                           │
│   → Storage: FalkorDB + ChromaDB                                            │
│   → Graph: Entity nodes + Fact edges                                        │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Layer 4: EPISODIC                                                         │
│   ──────────────────────                                                    │
│   • Conversation summaries                                                  │
│   • Task outcomes                                                           │
│   • Session context                                                         │
│                                                                             │
│   → Decay: TTL-based (90 days, extendable on access)                       │
│   → Storage: FalkorDB + ChromaDB                                            │
│   → Graph: Episode nodes with temporal edges                               │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Layer 5: WORKING                                                          │
│   ──────────────────────                                                    │
│   • Current session context                                                 │
│   • Active task information                                                 │
│   • Temporary scratchpad                                                    │
│                                                                             │
│   → Decay: SESSION (cleared on session end)                                │
│   → Storage: In-memory only                                                 │
│   → Graph: None                                                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Knowledge Graph Schema

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                        GRAPH SCHEMA (FalkorDB)                              │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   NODES                                                                     │
│   ─────                                                                     │
│                                                                             │
│   (User)                                                                    │
│     ├── id: string                                                          │
│     ├── name: string                                                        │
│     ├── memory_layer: "user_model"                                          │
│     ├── properties: json (preferences, expertise)                          │
│     └── created_at: timestamp                                               │
│                                                                             │
│   (Entity)                                                                  │
│     ├── id: string                                                          │
│     ├── type: string (Person, Tech, Project, Concept, ...)                 │
│     ├── name: string                                                        │
│     ├── summary: string (evolving)                                          │
│     ├── memory_layer: "semantic" | "procedural" | "episodic"               │
│     ├── confidence: float (0.0-1.0)                                        │
│     ├── decay_score: float (0.0-1.0)                                       │
│     ├── created_at: timestamp                                               │
│     └── updated_at: timestamp                                               │
│                                                                             │
│   (Episode)                                                                 │
│     ├── id: string                                                          │
│     ├── summary: string                                                     │
│     ├── topics: string[]                                                    │
│     ├── outcome: string                                                     │
│     ├── memory_layer: "episodic"                                            │
│     ├── recorded_at: timestamp                                              │
│     └── expires_at: timestamp                                               │
│                                                                             │
│                                                                             │
│   EDGES (with Temporal Properties)                                         │
│   ────────────────────────────────                                         │
│                                                                             │
│   -[RELATES_TO]->                                                           │
│     ├── type: string (likes, uses, knows, works_at, ...)                   │
│     ├── valid_at: timestamp (when it became true)                          │
│     ├── invalid_at: timestamp (when it became false, null = still true)    │
│     ├── confidence: float (0.0-1.0)                                        │
│     ├── source: string (episode_id or "explicit")                          │
│     └── metadata: json                                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Strategy

### Phase 1: Setup (Day 1-2)

```bash
# 1. Fork Graphiti
git clone https://github.com/getzep/graphiti synapse
cd synapse

# 2. Setup FalkorDB
docker run -d -p 6379:6379 -p 3000:3000 --name falkordb falkordb/falkordb

# 3. Install dependencies
pip install -e ".[dev]"

# 4. Test Graphiti MCP Server
cd mcp_server
pip install -e .
python -m graphiti_mcp_server
```

### Phase 2: Add Five Layers (Day 2-3)

```python
# synapse/layers/types.py

from enum import Enum

class MemoryLayer(Enum):
    USER_MODEL = "user_model"    # Never decay
    PROCEDURAL = "procedural"    # Slow decay (λ = 0.005)
    SEMANTIC = "semantic"        # Normal decay (λ = 0.01)
    EPISODIC = "episodic"        # TTL-based (90 days)
    WORKING = "working"          # Session-based


class DecayConfig:
    LAMBDA_DEFAULT = 0.01        # Half-life ~69 days
    LAMBDA_PROCEDURAL = 0.005    # Half-life ~139 days
    TTL_EPISODIC_DAYS = 90
    TTL_EXTEND_DAYS = 30
```

```python
# synapse/layers/decay.py

import math
from datetime import datetime

def compute_decay_score(
    updated_at: datetime,
    access_count: int,
    memory_layer: MemoryLayer
) -> float:
    """
    Compute decay score based on recency and access.

    Formula: decay_score = recency_factor × access_factor

    recency_factor = e^(-λ × days_since_update)
    access_factor = min(1.0, 0.5 + access_count × 0.05)
    """
    if memory_layer == MemoryLayer.USER_MODEL:
        return 1.0  # Never decay

    now = datetime.now()
    days_since = (now - updated_at).days

    # Pick λ based on layer
    lambda_val = (
        DecayConfig.LAMBDA_PROCEDURAL
        if memory_layer == MemoryLayer.PROCEDURAL
        else DecayConfig.LAMBDA_DEFAULT
    )

    recency_factor = math.exp(-lambda_val * days_since)
    access_factor = min(1.0, 0.5 + access_count * 0.05)

    return recency_factor * access_factor
```

### Phase 3: Add Thai NLP (Day 3)

```python
# synapse/nlp/thai.py

import httpx
from typing import List

class ThaiNLPClient:
    """Client for Thai NLP sidecar service."""

    def __init__(self, base_url: str = "http://thai-nlp:8000"):
        self.base_url = base_url
        self.client = httpx.AsyncClient(timeout=10.0)

    async def normalize(self, text: str) -> str:
        """Normalize Thai text."""
        response = await self.client.post(
            f"{self.base_url}/normalize",
            json={"text": text}
        )
        return response.json()["normalized"]

    async def tokenize(self, text: str) -> List[str]:
        """Tokenize Thai text."""
        response = await self.client.post(
            f"{self.base_url}/tokenize",
            json={"text": text}
        )
        return response.json()["tokens"]

    async def spellcheck(self, text: str) -> str:
        """Spellcheck Thai text."""
        response = await self.client.post(
            f"{self.base_url}/spellcheck",
            json={"text": text}
        )
        return response.json()["corrected"]


def detect_thai(text: str) -> bool:
    """Detect if text contains Thai characters."""
    for char in text:
        if '\u0E00' <= char <= '\u0E7F':
            return True
    return False
```

### Phase 4: Add MCP Tools (Day 4)

```python
# synapse/mcp/tools.py

from mcp.server import Server
from mcp.types import Tool, TextContent

server = Server("synapse")

@server.list_tools()
async def list_tools():
    return [
        Tool(
            name="synapse_remember",
            description="Add new memory with auto layer detection",
            inputSchema={
                "type": "object",
                "properties": {
                    "content": {"type": "string"},
                    "layer": {"type": "string", "enum": ["auto", "user_model", "procedural", "semantic", "episodic"]},
                    "concepts": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["content"],
            },
        ),
        Tool(
            name="synapse_recall",
            description="Search memories with hybrid retrieval",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "layer": {"type": "string"},
                    "limit": {"type": "number", "default": 10},
                    "temporal_filter": {"type": "string", "enum": ["current", "all", "at_time"]},
                    "at_time": {"type": "string"},
                },
                "required": ["query"],
            },
        ),
        Tool(
            name="synapse_timeline",
            description="Query what was true at a specific time",
            inputSchema={
                "type": "object",
                "properties": {
                    "entity": {"type": "string"},
                    "relation": {"type": "string"},
                    "at_time": {"type": "string"},
                },
                "required": ["entity"],
            },
        ),
        Tool(
            name="synapse_context",
            description="Get user context for system prompt injection",
            inputSchema={
                "type": "object",
                "properties": {
                    "user_id": {"type": "string"},
                    "include_procedural": {"type": "boolean", "default": True},
                    "include_recent_episodes": {"type": "boolean", "default": True},
                },
                "required": ["user_id"],
            },
        ),
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    if name == "synapse_remember":
        # Implementation
        pass
    elif name == "synapse_recall":
        # Implementation
        pass
    # ... other tools
```

### Phase 5: Real-time Indexing (Day 5)

Graphiti already supports incremental updates! Just verify:

```python
# synapse/indexer/realtime.py

from graphiti_core import Graphiti

class RealtimeIndexer:
    """Ensure immediate indexing on all operations."""

    def __init__(self, graphiti: Graphiti):
        self.graphiti = graphiti

    async def add_memory(self, content: str, **kwargs):
        """Add memory with immediate indexing."""
        # Graphiti already does this by default
        result = await self.graphiti.add_episode(
            name=kwargs.get("name", "memory"),
            episode_body=content,
            source_description=kwargs.get("source", "synapse"),
        )

        # Additional: Update layer metadata
        await self._update_layer_metadata(result, kwargs.get("layer"))

        return result

    async def _update_layer_metadata(self, result, layer):
        """Add memory_layer to nodes."""
        # Implementation
        pass
```

---

## Tech Stack

| Component | Technology | Notes |
|-----------|-----------|-------|
| **Language** | Python 3.10+ | Graphiti base |
| **Graph DB** | FalkorDB | Redis-based, easy setup |
| **Vector DB** | ChromaDB | Built into Graphiti |
| **Embedding** | multilingual-e5-large | Better Thai support |
| **NLP** | Thai Sidecar | From Oracle-v2 |
| **MCP** | MCP SDK v1.x | Streamable HTTP |
| **Runtime** | Docker | Easy deployment |

---

## MCP Tools

### Memory Layer

| Tool | Description |
|------|-------------|
| `synapse_remember` | Add new memory (auto layer detection) |
| `synapse_recall` | Search memories (hybrid: FTS + vector + graph) |
| `synapse_forget` | Decay/archive/delete memory |
| `synapse_context` | Get user context for system prompt |

### Graph Layer

| Tool | Description |
|------|-------------|
| `synapse_query` | Graph traversal queries |
| `synapse_timeline` | "What was true when" queries |
| `synapse_entities` | List/Manage entities |
| `synapse_relations` | List/Manage relationships |

### User Layer

| Tool | Description |
|------|-------------|
| `synapse_profile` | Get/Update user profile |
| `synapse_preferences` | Get/Update preferences |

### System

| Tool | Description |
|------|-------------|
| `synapse_stats` | Database statistics |
| `synapse_health` | Health check |
| `synapse_backup` | Manual backup trigger |

---

## Timeline

```
Day 1: Setup
├── Fork Graphiti
├── Setup FalkorDB
└── Test MCP Server

Day 2: Five Layers
├── Add MemoryLayer enum
├── Add decay calculator
└── Add layer classifier

Day 3: Thai NLP
├── Create Thai NLP client
├── Integrate into text pipeline
└── Test Thai detection

Day 4: MCP Tools
├── Add synapse_remember
├── Add synapse_recall
├── Add synapse_timeline
├── Add synapse_context
└── Add synapse_profile

Day 5: Integration
├── Real-time indexing verification
├── Docker compose setup
├── Migrate data from Oracle-v2
└── Deploy to JellyCore
```

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Graphiti API changes | Low | Medium | Pin version, test updates |
| FalkorDB performance | Low | Medium | Can switch to Neo4j |
| Thai NLP accuracy | Medium | Low | Fine-tune as needed |
| Data migration issues | Medium | High | Test with sample data first |
| MCP compatibility | Low | High | Test with multiple clients |

---

## Appendix

### A. References

- [Graphiti GitHub](https://github.com/getzep/graphiti)
- [Graphiti Paper](https://arxiv.org/abs/2501.13956)
- [FalkorDB Docs](https://docs.falkordb.com/)
- [MCP Protocol](https://modelcontextprotocol.io/)

### B. Related Projects

- Oracle-v2: `C:\Programing\PersonalAI\jellycore\oracle-v2`
- Thai NLP Sidecar: `C:\Programing\PersonalAI\jellycore\thai-nlp-sidecar`
- JellyCore: `C:\Programing\PersonalAI\jellycore`

### C. Comparison Sources

- Supermemory: https://github.com/supermemoryai/supermemory
- Graphiti: https://github.com/getzep/graphiti
- Oracle-v2: https://github.com/Soul-Brews-Studio/oracle-v2

---

**Last Updated:** 2026-03-13
**Next Review:** After Phase 1 completion

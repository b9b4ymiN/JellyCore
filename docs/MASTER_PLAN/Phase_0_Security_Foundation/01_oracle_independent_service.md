# 0.1 — แยก Oracle V2 เป็น Independent Service

> แก้จุดอ่อน: A8 (Tight Coupling), P5 (ChromaDB Cold Start), P6 (Container Recompile)

**Status:** ✅ Done  
**Effort:** Large  
**Priority:** 🔴 Critical Path — ต้องทำก่อน Item 0.2 และ 0.8

---

## 📋 ปัญหาเดิม

Oracle V2 ถูก spawn เป็น **Bun subprocess ภายใน agent container ทุกตัว** ผ่าน MCP stdio:
- ต้อง install Bun ใน container image (+200MB)
- ChromaDB cold start ทุกครั้งที่ spawn container (Python + uvx = หลายวินาที)
- Upgrade Oracle ต้อง rebuild container image
- ทุก container ใช้ memory สำหรับ Oracle + ChromaDB instance แยกกัน

**ที่มา:** NanoClaw `container/agent-runner/src/index.ts` → `mcpServers` config

---

## 🎯 เป้าหมาย

Oracle V2 ทำงานเป็น **Docker service แยก** ที่:
- Start ครั้งเดียว, ใช้ร่วมกันทุก container
- เชื่อมต่อผ่าน HTTP API (port 47778, internal network only)
- Upgrade/restart ได้อิสระจาก NanoClaw
- ChromaDB start ครั้งเดียวกับ Oracle service

---

## ✅ Checklist

### Setup Oracle V2 Docker Service

- [ ] Fork/clone Oracle V2 repo เข้า `jellycore/oracle-v2/`
- [ ] สร้าง `oracle-v2/Dockerfile`:
  ```dockerfile
  FROM oven/bun:1.2-slim
  WORKDIR /app
  COPY package.json bun.lock ./
  RUN bun install --frozen-lockfile
  COPY . .
  RUN bun run build  # ถ้ามี build step
  EXPOSE 47778
  CMD ["bun", "run", "src/server.ts"]
  ```
- [ ] สร้าง Docker Compose entry สำหรับ Oracle:
  ```yaml
  oracle:
    build: ./oracle-v2
    restart: unless-stopped
    mem_limit: 512m
    environment:
      - ORACLE_PORT=47778
      - ORACLE_REPO_ROOT=/data/knowledge
      - ORACLE_DATA_DIR=/data/oracle
    volumes:
      - oracle-data:/data/oracle
      - oracle-knowledge:/data/knowledge
    networks:
      - jellycore-internal
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:47778/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
  ```

### ปรับ Oracle V2 Config สำหรับ Container

- [ ] ปรับ `src/server/db.ts` → ใช้ env vars สำหรับ paths:
  - `ORACLE_DATA_DIR` → SQLite database path
  - `ORACLE_REPO_ROOT` → knowledge base root
- [ ] ตรวจสอบว่า HTTP server (`src/server.ts`) bind `0.0.0.0` (ไม่ใช่ `127.0.0.1`)
- [ ] ปรับ ChromaDB connection → ชี้ไปที่ ChromaDB Docker service แทน local subprocess
  - แก้ `src/chroma-mcp.ts` → แทนที่ `uvx chroma-mcp` ด้วย `ChromaClient({ path: 'http://chromadb:8000' })`
- [ ] ตรวจสอบ Drizzle migration ทำงานถูกต้องบน mounted volume

### ทดสอบ Oracle V2 Standalone

- [ ] `docker compose up oracle chromadb` → ทั้ง 2 service healthy
- [ ] `curl http://localhost:47778/api/health` → `200 OK`
- [ ] `curl http://localhost:47778/api/stats` → ได้ database stats
- [ ] `curl "http://localhost:47778/api/search?q=test"` → ได้ search results (ว่างก็ได้)
- [ ] Knowledge base indexer: `docker exec oracle bun run src/indexer.ts` → index สำเร็จ
- [ ] ทดสอบ `oracle_learn` ผ่าน HTTP API: `POST /api/learn` → data ปรากฏใน search

### ปรับ NanoClaw Container Image

- [ ] ลบ Bun installation จาก `container/Dockerfile` (ถ้าเคยเพิ่ม)
- [ ] ลบ Oracle V2 source code copy จาก Dockerfile
- [ ] ลบ Oracle MCP server config จาก `container/agent-runner/src/index.ts` → `mcpServers`
  - (จะถูกแทนที่ด้วย MCP-HTTP Bridge ใน Item 0.2)
- [ ] Rebuild container image: `docker build -t nanoclaw-agent:latest ./container/`
- [ ] Verify image size ลดลง (ไม่มี Bun + Oracle)

---

## 🧪 Definition of Done

1. `docker compose up oracle chromadb` → healthy ภายใน 30s
2. Oracle HTTP API ตอบ search/learn/consult/stats ได้ถูกต้อง
3. NanoClaw container image ไม่มี Bun/Oracle อยู่ข้างใน
4. Oracle restart ได้โดยไม่กระทบ NanoClaw host process
5. ChromaDB ใช้ร่วมกันผ่าน HTTP (ไม่ใช่ subprocess per container)

---

## 📎 Files to Modify

| File | Repo | Action |
|------|------|--------|
| `container/Dockerfile` | NanoClaw | Remove Bun + Oracle |
| `container/agent-runner/src/index.ts` | NanoClaw | Remove Oracle from `mcpServers` |
| `src/server.ts` | Oracle V2 | Verify bind 0.0.0.0 |
| `src/server/db.ts` | Oracle V2 | Use env var paths |
| `src/chroma-mcp.ts` | Oracle V2 | Replace with HTTP ChromaDB client |
| `docker-compose.yml` | JellyCore | Add oracle + chromadb services |

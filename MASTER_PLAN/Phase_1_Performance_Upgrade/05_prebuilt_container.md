# 1.5 — Pre-Built Agent Container Image

> แก้จุดอ่อน: P6 (Container TypeScript Recompilation)

**Status:** ✅ Complete  
**Effort:** Medium  
**Priority:** 🟡 Medium

---

## 📋 ปัญหาเดิม

ทุก container invocation recompile TypeScript ใหม่ — ไม่มี compilation cache ข้าม invocations

**ที่มา:** NanoClaw `container/Dockerfile`

---

## 🎯 เป้าหมาย

Container image มี **pre-compiled JavaScript** → cold start <3s (ลดจาก ~10s)

---

## ✅ Checklist

### Multi-Stage Dockerfile

- [ ] แก้ `container/Dockerfile`:
  ```dockerfile
  # Stage 1: Build
  FROM node:22-slim AS builder
  WORKDIR /build
  COPY container/agent-runner/package*.json ./
  RUN npm ci
  COPY container/agent-runner/ .
  RUN npx tsc  # Compile once during build
  
  # Stage 2: Runtime
  FROM node:22-slim
  WORKDIR /app
  
  # Install runtime dependencies only
  RUN apt-get update && apt-get install -y chromium curl && rm -rf /var/lib/apt/lists/*
  
  # Copy compiled JS + node_modules
  COPY --from=builder /build/dist/ ./dist/
  COPY --from=builder /build/node_modules/ ./node_modules/
  COPY --from=builder /build/package.json ./
  
  # Install claude-code globally
  RUN npm install -g @anthropic-ai/claude-code
  
  ENTRYPOINT ["node", "dist/index.js"]
  ```

### ปรับ Build Script

- [ ] แก้ `container/build.sh`:
  - Docker BuildKit enabled (`DOCKER_BUILDKIT=1`)
  - Cache mount สำหรับ npm: `--mount=type=cache,target=/root/.npm`
  - Tag: `nanoclaw-agent:latest`
- [ ] เพิ่ม `container/agent-runner/tsconfig.json` → output ไป `dist/`
  ```json
  {
    "compilerOptions": {
      "outDir": "dist",
      "rootDir": "src",
      "target": "ES2022",
      "module": "Node16",
      "strict": true
    }
  }
  ```

### ปรับ Container Runner

- [ ] แก้ `src/container-runner.ts`:
  - Entrypoint: `node /app/dist/index.js` (compiled JS, not TypeScript)
  - ไม่มี TypeScript compilation ตอน runtime
  - ลด `CONTAINER_TIMEOUT` awareness (faster start = less wait)

### Optimize Image Size

- [ ] ลบ dev dependencies จาก runtime image:
  - No TypeScript compiler
  - No `@types/*` packages  
  - No test frameworks
- [ ] ใช้ `.dockerignore`:
  ```
  node_modules
  *.ts
  !*.d.ts
  tests/
  .git/
  ```
- [ ] Target image size: <500MB (ลดจากเดิม)

### ทดสอบ

- [ ] `docker build` สำเร็จ → image created
- [ ] `docker images nanoclaw-agent` → ดู size
- [ ] Spawn container → agent ready ภายใน 3s (วัดจาก docker run → first output)
- [ ] Agent ทำงานปกติ (query Claude, execute tools, IPC)
- [ ] MCP-HTTP Bridge compiled + works ใน container

---

## 🧪 Definition of Done

1. Container cold start <5s (target <3s)
2. No TypeScript compilation at runtime
3. Image size <500MB
4. Agent functionality unchanged

---

## 📎 Files to Modify

| File | Repo | Action |
|------|------|--------|
| `container/Dockerfile` | NanoClaw | Multi-stage build |
| `container/build.sh` | NanoClaw | BuildKit + cache |
| `container/agent-runner/tsconfig.json` | NanoClaw | Output to dist/ |
| `container/.dockerignore` | NanoClaw | **Create** |
| `src/container-runner.ts` | NanoClaw | Update entrypoint path |

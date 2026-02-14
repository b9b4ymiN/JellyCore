# 5.1 — Docker Compose Production Config

> รวมทุก service ใน single docker-compose — สั่ง `docker compose up` แล้วใช้งานได้

**Status:** ⬜ Not Started  
**Effort:** Large  
**Priority:** 🔴 High  
**Weakness Ref:** A1 (SPOF), P6 (Container Recompile)

---

## 🎯 เป้าหมาย

Docker Compose ที่ production-ready: ครบทุก service, health checks, volume mounts, resource limits, logging

---

## ✅ Checklist

### Docker Compose File

- [ ] สร้าง `docker-compose.yml`:
  ```yaml
  version: "3.9"
  
  services:
    nanoclaw:
      build:
        context: ./nanoclaw
        dockerfile: Dockerfile
      container_name: jellycore-nanoclaw
      restart: unless-stopped
      environment:
        - NODE_ENV=production
        - ORACLE_URL=http://oracle:47778
        - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
        - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      volumes:
        - encrypted-data:/data
        - /var/run/docker.sock:/var/run/docker.sock:ro
      depends_on:
        oracle:
          condition: service_healthy
      healthcheck:
        test: ["CMD", "node", "-e", "fetch('http://localhost:3000/health')"]
        interval: 30s
        timeout: 10s
        retries: 3
      deploy:
        resources:
          limits:
            memory: 1G
            cpus: '1.0'
      logging:
        driver: "json-file"
        options:
          max-size: "50m"
          max-file: "5"
  
    oracle:
      build:
        context: ./oracle-v2
        dockerfile: Dockerfile
      container_name: jellycore-oracle
      restart: unless-stopped
      environment:
        - DB_PATH=/data/oracle.db
        - CHROMA_DB_PATH=/data/chromadb
        - CHROMA_URL=http://chromadb:8000
      volumes:
        - encrypted-data:/data
      ports:
        - "127.0.0.1:47778:47778"
      healthcheck:
        test: ["CMD", "bun", "-e", "fetch('http://localhost:47778/health')"]
        interval: 30s
        timeout: 10s
        retries: 3
      deploy:
        resources:
          limits:
            memory: 512M
            cpus: '0.5'
      logging:
        driver: "json-file"
        options:
          max-size: "50m"
          max-file: "5"
  
    chromadb:
      image: chromadb/chroma:latest
      container_name: jellycore-chromadb
      restart: unless-stopped
      environment:
        - CHROMA_SERVER_AUTH_CREDENTIALS=${CHROMA_AUTH_TOKEN}
        - CHROMA_SERVER_AUTH_PROVIDER=chromadb.auth.token_authn.TokenAuthenticationServerProvider
        - IS_PERSISTENT=TRUE
        - PERSIST_DIRECTORY=/data/chromadb
      volumes:
        - encrypted-data:/data/chromadb
      ports:
        - "127.0.0.1:8000:8000"
      healthcheck:
        test: ["CMD", "curl", "-f", "http://localhost:8000/api/v1/heartbeat"]
        interval: 30s
        timeout: 5s
        retries: 3
      deploy:
        resources:
          limits:
            memory: 512M
            cpus: '0.5'
  
    dashboard:
      build:
        context: ./oracle-v2/dashboard
        dockerfile: Dockerfile
      container_name: jellycore-dashboard
      restart: unless-stopped
      ports:
        - "127.0.0.1:5173:5173"
      depends_on:
        oracle:
          condition: service_healthy
      deploy:
        resources:
          limits:
            memory: 256M
            cpus: '0.25'
  
  volumes:
    encrypted-data:
      driver: local
      driver_opts:
        type: none
        o: bind
        device: /data/jellycore
  ```

### NanoClaw Dockerfile

- [ ] สร้าง `nanoclaw/Dockerfile`:
  ```dockerfile
  FROM node:22-slim AS builder
  WORKDIR /app
  COPY package*.json ./
  RUN npm ci --production=false
  COPY . .
  RUN npm run build
  
  FROM node:22-slim
  WORKDIR /app
  COPY --from=builder /app/dist ./dist
  COPY --from=builder /app/node_modules ./node_modules
  COPY --from=builder /app/package.json ./
  
  # PM2 for process management
  RUN npm install -g pm2
  COPY ecosystem.config.cjs ./
  
  EXPOSE 3000
  CMD ["pm2-runtime", "ecosystem.config.cjs"]
  ```

### Oracle Dockerfile

- [ ] สร้าง `oracle-v2/Dockerfile`:
  ```dockerfile
  FROM oven/bun:1.2-slim
  WORKDIR /app
  COPY package.json bun.lock* ./
  RUN bun install --production --frozen-lockfile
  COPY . .
  
  EXPOSE 47778
  CMD ["bun", "run", "src/index.ts"]
  ```

### Dashboard Dockerfile

- [ ] สร้าง `oracle-v2/dashboard/Dockerfile`:
  ```dockerfile
  FROM node:22-slim AS builder
  WORKDIR /app
  COPY package*.json ./
  RUN npm ci
  COPY . .
  RUN npm run build
  
  FROM nginx:alpine
  COPY --from=builder /app/dist /usr/share/nginx/html
  COPY nginx.conf /etc/nginx/conf.d/default.conf
  EXPOSE 5173
  ```

### Environment Config

- [ ] สร้าง `.env.example`:
  ```env
  # === API Keys ===
  ANTHROPIC_API_KEY=sk-ant-...
  
  # === Telegram ===
  TELEGRAM_BOT_TOKEN=123456:ABC-...
  
  # === ChromaDB ===
  CHROMA_AUTH_TOKEN=secret-token-here
  
  # === Paths ===
  DATA_DIR=/data/jellycore
  ```
- [ ] `.env` → `.gitignore`

### Caddy Reverse Proxy

- [ ] สร้าง `Caddyfile`:
  ```caddyfile
  jellycore.example.com {
    # Dashboard
    handle /dashboard/* {
      reverse_proxy localhost:5173
    }
    
    # Oracle API (authenticated)
    handle /api/* {
      basicauth {
        admin $2a$14$...
      }
      reverse_proxy localhost:47778
    }
    
    # Health check (public)
    handle /health {
      reverse_proxy localhost:3000
    }
  }
  ```

### Docker Ignore Files

- [ ] `.dockerignore` in each service:
  ```
  node_modules
  .git
  .env
  *.md
  tests/
  .vscode/
  ```

### ทดสอบ

- [ ] `docker compose build` → ทุก image build สำเร็จ
- [ ] `docker compose up -d` → ทุก service healthy
- [ ] `docker compose ps` → 4 services running
- [ ] `docker compose logs --tail 20` → no errors
- [ ] `curl http://localhost:47778/health` → 200 OK
- [ ] `docker compose down && docker compose up -d` → restart clean
- [ ] Resource limits respected (check `docker stats`)

---

## 🧪 Definition of Done

1. Single `docker compose up -d` starts entire system
2. All services pass health checks
3. Services auto-restart on crash
4. Resource limits enforced
5. Logs rotated (max 250MB total per service)
6. Caddy provides TLS termination

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `docker-compose.yml` | JellyCore (root) | **Create** |
| `nanoclaw/Dockerfile` | NanoClaw | **Create** |
| `oracle-v2/Dockerfile` | Oracle V2 | **Create** |
| `oracle-v2/dashboard/Dockerfile` | Oracle V2 | **Create** |
| `.env.example` | JellyCore (root) | **Create** |
| `Caddyfile` | JellyCore (root) | **Create** |
| `.dockerignore` (x3) | Each service | **Create** |

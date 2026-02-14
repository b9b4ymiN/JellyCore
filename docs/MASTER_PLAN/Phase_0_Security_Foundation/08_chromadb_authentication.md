# 0.8 — ChromaDB Authentication

> แก้จุดอ่อน: S5 (ChromaDB Has No Authentication)

**Status:** ✅ Done  
**Effort:** Small  
**Priority:** 🟡 Medium  
**Depends on:** Item 0.1 (Oracle uses ChromaDB via HTTP)

---

## 📋 ปัญหาเดิม

ChromaDB runs ไม่มี authentication — local process ใดก็อ่าน/เขียน/ลบ vector embeddings ได้  
Vector embeddings = semantic layer ของ knowledge base → ถ้าถูก poison = agent ได้ misleading context

**ที่มา:** Oracle V2 `src/chroma-mcp.ts`

---

## 🎯 เป้าหมาย

ChromaDB ใช้ token authentication + อยู่ใน Docker internal network เท่านั้น (ไม่ expose port)

---

## ✅ Checklist

### Setup ChromaDB Docker Service

- [ ] เพิ่ม ChromaDB ใน `docker-compose.yml`:
  ```yaml
  chromadb:
    image: chromadb/chroma:latest
    restart: unless-stopped
    mem_limit: 1g
    environment:
      - CHROMA_SERVER_AUTHN_PROVIDER=chromadb.auth.token_authn.TokenAuthenticationServerProvider
      - CHROMA_SERVER_AUTHN_CREDENTIALS=<generated-token>
      - CHROMA_AUTH_TOKEN_TRANSPORT_HEADER=Authorization
      - IS_PERSISTENT=TRUE
      - PERSIST_DIRECTORY=/chroma/chroma
      - ANONYMIZED_TELEMETRY=FALSE
    volumes:
      - chroma-data:/chroma/chroma
    networks:
      - jellycore-internal    # internal only, ไม่ expose port
    healthcheck:
      test: ["CMD", "curl", "-f", "-H", "Authorization: Bearer <token>", "http://localhost:8000/api/v1/heartbeat"]
      interval: 30s
      timeout: 5s
      retries: 3
  ```

### Generate Auth Token

- [ ] เพิ่มใน `.env`:
  ```
  CHROMA_AUTH_TOKEN=<crypto.randomBytes(32).toString('hex')>
  ```
- [ ] `.env.example` → เพิ่ม `CHROMA_AUTH_TOKEN=`
- [ ] Docker Compose reference: `${CHROMA_AUTH_TOKEN}`

### ปรับ Oracle V2 ChromaDB Client

- [ ] แก้ Oracle V2 → แทนที่ `chroma-mcp.ts` (uvx subprocess) ด้วย direct HTTP client:
  ```typescript
  import { ChromaClient } from 'chromadb';
  
  const chroma = new ChromaClient({
    path: process.env.CHROMA_URL || 'http://chromadb:8000',
    auth: {
      provider: 'token',
      credentials: process.env.CHROMA_AUTH_TOKEN,
      tokenHeaderType: 'AUTHORIZATION'
    }
  });
  ```
- [ ] ลบ `src/chroma-mcp.ts` (ไม่ต้องการ Python subprocess อีกต่อไป)
- [ ] ปรับ search handlers ให้ใช้ ChromaClient โดยตรง

### Network Isolation

- [ ] ตรวจสอบว่า ChromaDB อยู่ในเฉพาะ `jellycore-internal` network
- [ ] ไม่มี port mapping ใน Docker Compose (ไม่ expose ออก host)
- [ ] เฉพาะ Oracle service ที่ connect ได้

### ทดสอบ

- [ ] `docker compose up chromadb` → healthy
- [ ] `curl http://localhost:8000/api/v1/heartbeat` จาก host → connection refused (ไม่ expose)
- [ ] Oracle service → connect ด้วย token → สำเร็จ
- [ ] Oracle service → connect ไม่มี token → 401 Unauthorized
- [ ] Oracle search ทำงานปกติผ่าน ChromaDB

---

## 🧪 Definition of Done

1. ChromaDB ต้องมี valid token เพื่อ access
2. ChromaDB ไม่ expose port ออก host
3. Oracle V2 connect ด้วย token ได้ปกติ
4. ไม่มี Python subprocess (uvx) อีกต่อไป — ใช้ HTTP client โดยตรง

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `docker-compose.yml` | JellyCore | Add chromadb service with auth |
| `.env.example` | JellyCore | Add CHROMA_AUTH_TOKEN |
| `src/chroma-mcp.ts` | Oracle V2 | **Delete** — replace with direct client |
| `src/server/handlers.ts` | Oracle V2 | Use ChromaClient directly |
| `src/index.ts` | Oracle V2 | Update ChromaDB initialization |

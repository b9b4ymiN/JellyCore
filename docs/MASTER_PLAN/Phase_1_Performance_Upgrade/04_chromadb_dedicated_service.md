# 1.4 — ChromaDB Dedicated Service

> แก้จุดอ่อน: P5 (ChromaDB uvx Subprocess Overhead)

**Status:** ✅ Complete  
**Effort:** Small  
**Priority:** 🟡 Medium  
**Note:** ทำร่วมกับ Phase 0 Item 0.1 + 0.8 (Oracle independent + ChromaDB auth)

---

## 📋 ปัญหาเดิม

ChromaDB accessed ผ่าน Python subprocess (`uvx chroma-mcp`) → cold start หลายวินาที (Python + package resolution)

**ที่มา:** Oracle V2 `src/chroma-mcp.ts`

---

## 🎯 เป้าหมาย

ChromaDB เป็น **Docker container ที่ always running** → ไม่มี cold start → Oracle connect ผ่าน HTTP

---

## ✅ Checklist

### Docker Service (ดำเนินการร่วมกับ Phase 0.8)

- [ ] ตรวจสอบว่า ChromaDB Docker service จาก Item 0.8 ทำงานแล้ว
- [ ] Verify: ChromaDB container healthy + responding ภายใน 10s หลัง `docker compose up`

### ปรับ Oracle V2 Client

- [ ] ตรวจสอบว่า Oracle V2 ใช้ `ChromaClient` HTTP client แล้ว (จาก Item 0.8)
- [ ] ลบ `src/chroma-mcp.ts` ถ้ายังไม่ได้ลบ
- [ ] ลบ `uvx` dependency references
- [ ] ปรับ embedding function config:
  - ChromaDB default embedding (Sentence Transformers) → ยัง OK สำหรับ basic
  - Future: เพิ่ม OpenAI/Anthropic embedding option

### Connection Pooling

- [ ] Oracle V2 → ใช้ ChromaClient instance เดียว (singleton) ไม่สร้างใหม่ทุก request
- [ ] Implement reconnection logic:
  ```typescript
  let chromaClient: ChromaClient | null = null;
  
  async function getChromaClient(): Promise<ChromaClient> {
    if (!chromaClient) {
      chromaClient = new ChromaClient({ path: CHROMA_URL, auth: ... });
    }
    // Verify connection
    try {
      await chromaClient.heartbeat();
    } catch {
      chromaClient = new ChromaClient({ path: CHROMA_URL, auth: ... });
    }
    return chromaClient;
  }
  ```

### ทดสอบ

- [ ] Oracle startup → ChromaDB connected ภายใน 1s (ไม่มี Python cold start)
- [ ] Search with vectors → ผลลัพธ์ถูกต้อง
- [ ] ChromaDB restart → Oracle reconnect อัตโนมัติ
- [ ] Memory usage: ChromaDB container <512MB with 10K documents

---

## 🧪 Definition of Done

1. ไม่มี Python subprocess (uvx) ใน Oracle V2
2. ChromaDB always-running Docker service
3. Oracle connect ภายใน 1s (no cold start)
4. Reconnection works after ChromaDB restart

---

## 📎 Files to Modify

| File | Repo | Action |
|------|------|--------|
| `src/chroma-mcp.ts` | Oracle V2 | **Delete** (replaced in 0.8) |
| `src/server/handlers.ts` | Oracle V2 | Use singleton ChromaClient |
| `docker-compose.yml` | JellyCore | Verify chromadb service |

# 0.2 — สร้าง MCP-HTTP Bridge

> แก้จุดอ่อน: A8 (Tight Coupling) — ให้ Agent ใช้ `mcp__oracle__*` tools ได้โดยไม่ต้อง run Oracle ใน container

**Status:** ✅ Done  
**Effort:** Medium  
**Priority:** 🔴 Critical Path  
**Depends on:** Item 0.1 (Oracle must be running as HTTP service)

---

## 📋 ปัญหาเดิม

Agent ใน container เรียก Oracle ผ่าน MCP stdio subprocess → Oracle ต้องอยู่ใน container  
ต้องการ: Agent ยังใช้ `mcp__oracle__*` tools ได้เหมือนเดิม แต่ Oracle อยู่นอก container

---

## 🎯 เป้าหมาย

สร้าง **thin MCP server** (stdio) ที่ทำงานใน container → แปลง MCP tool calls เป็น HTTP requests ไปยัง Oracle service → แปลง HTTP responses กลับเป็น MCP results

```
Container Agent ──MCP stdio──► MCP-HTTP Bridge ──HTTP──► Oracle API (:47778)
                   (ภายใน container)                     (Docker service)
```

---

## ✅ Checklist

### สร้าง Bridge Module

- [ ] สร้างไฟล์ `container/agent-runner/src/oracle-mcp-http.ts`
- [ ] Implement MCP server (stdio transport) ด้วย `@modelcontextprotocol/sdk`
- [ ] Map Oracle MCP tools → HTTP endpoints:

  | MCP Tool | HTTP Method | Endpoint |
  |----------|-------------|----------|
  | `oracle_search` | GET | `/api/search?q={query}&mode={mode}` |
  | `oracle_consult` | GET | `/api/consult?q={query}` |
  | `oracle_reflect` | GET | `/api/reflect` |
  | `oracle_learn` | POST | `/api/learn` |
  | `oracle_list` | GET | `/api/list?page={page}` |
  | `oracle_stats` | GET | `/api/stats` |
  | `oracle_concepts` | GET | `/api/concepts` |
  | `oracle_thread` | POST | `/api/thread` |
  | `oracle_threads` | GET | `/api/threads` |
  | `oracle_thread_read` | GET | `/api/thread/{id}` |
  | `oracle_thread_update` | PATCH | `/api/thread/{id}` |
  | `oracle_decisions_list` | GET | `/api/decisions` |
  | `oracle_decisions_create` | POST | `/api/decisions` |
  | `oracle_decisions_get` | GET | `/api/decisions/{id}` |
  | `oracle_decisions_update` | PATCH | `/api/decisions/{id}` |
  | `oracle_trace` | POST | `/api/traces` |
  | `oracle_trace_list` | GET | `/api/traces` |
  | `oracle_trace_get` | GET | `/api/traces/{id}` |
  | `oracle_supersede` | POST | `/api/supersede` |

### Implement Error Handling & Retry

- [ ] HTTP request timeout: 10 วินาที per request
- [ ] Retry policy: 3 attempts, exponential backoff (1s → 2s → 4s)
- [ ] Oracle unreachable → return MCP error "Knowledge service temporarily unavailable"
- [ ] HTTP 4xx → return MCP error ด้วย Oracle error message
- [ ] HTTP 5xx → retry → ถ้าหมด retries → return MCP error

### Implement Read-Only Mode

- [ ] รับ `ORACLE_READ_ONLY` env var
- [ ] ถ้า `true` → ซ่อน write tools ออกจาก tool list:
  - `oracle_learn`, `oracle_thread`, `oracle_thread_update`
  - `oracle_decisions_create`, `oracle_decisions_update`
  - `oracle_trace`, `oracle_supersede`
- [ ] Non-main groups → force `ORACLE_READ_ONLY=true`

### Implement Auth Token

- [ ] รับ `ORACLE_AUTH_TOKEN` env var
- [ ] ส่ง `Authorization: Bearer {token}` header กับทุก HTTP request
- [ ] Oracle service validate token → reject ถ้าไม่ตรง

### Register Bridge ใน Agent Runner

- [ ] แก้ `container/agent-runner/src/index.ts` → เพิ่ม MCP-HTTP Bridge ใน `mcpServers`:
  ```typescript
  oracle: {
    command: 'node',
    args: [path.join(__dirname, 'oracle-mcp-http.js')],
    env: {
      ORACLE_API_URL: process.env.ORACLE_API_URL || 'http://oracle:47778',
      ORACLE_AUTH_TOKEN: process.env.ORACLE_AUTH_TOKEN,
      ORACLE_READ_ONLY: isMainGroup ? 'false' : 'true'
    }
  }
  ```
- [ ] เพิ่ม `'mcp__oracle__*'` ใน `allowedTools` array (ถ้ายังไม่มี)

### ปรับ Container Network

- [ ] Agent containers ต้อง connect เข้า `jellycore-internal` Docker network
- [ ] แก้ `src/container-runner.ts` → เพิ่ม `--network jellycore-internal` flag เมื่อ spawn container
- [ ] ตรวจสอบว่า container resolve `http://oracle:47778` ได้ผ่าน Docker DNS

### ทดสอบ

- [ ] Unit test: Bridge แปลง MCP call → HTTP request ถูกต้อง
- [ ] Unit test: HTTP error → MCP error ถูกต้อง
- [ ] Unit test: Read-only mode ซ่อน write tools
- [ ] Integration test: Agent ใน container เรียก `oracle_search` → ได้ผลลัพธ์จาก Oracle service
- [ ] Integration test: Agent เรียก `oracle_learn` → data ปรากฏใน Oracle
- [ ] Integration test: Non-main group → `oracle_learn` ถูก reject (read-only)

---

## 🧪 Definition of Done

1. Agent container เรียก `mcp__oracle__search` → ได้ search results จาก Oracle HTTP API
2. Write tools (learn, decide) ทำงานได้ใน main group
3. Non-main groups ใช้ได้เฉพาะ read tools
4. Oracle service restart → Bridge reconnect อัตโนมัติ (retry)
5. ไม่มี Oracle process (Bun) ทำงานภายใน container

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `container/agent-runner/src/oracle-mcp-http.ts` | NanoClaw | **Create** — MCP-HTTP Bridge |
| `container/agent-runner/src/index.ts` | NanoClaw | Modify — register bridge in mcpServers |
| `container/agent-runner/package.json` | NanoClaw | Verify `@modelcontextprotocol/sdk` dependency |
| `src/container-runner.ts` | NanoClaw | Add `--network` flag |
| `src/server.ts` | Oracle V2 | Add Bearer token validation middleware |

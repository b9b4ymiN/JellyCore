# 4.5 — End-to-End Integration Test

> ทดสอบระบบทั้งหมดแบบ end-to-end — ทุก channel ทุก flow ทำงานครบ

**Status:** ⬜ Not Started  
**Effort:** Medium  
**Priority:** 🔴 High (Gate to Phase 5)  
**Depends on:** Items 4.1–4.4

---

## 🎯 เป้าหมาย

ทดสอบ full pipeline จริง: Message In → Agent + Oracle → Response Out สำหรับทุก channel และทุก feature

---

## ✅ Checklist

### Test Environment Setup

- [ ] `docker-compose.test.yml`:
  ```yaml
  services:
    oracle-test:
      build: ./oracle-v2
      environment:
        - DB_PATH=/tmp/test-oracle.db
        - CHROMA_DB_PATH=/tmp/test-chroma
        - TEST_MODE=true
      ports:
        - "47779:47778"
    
    nanoclaw-test:
      build: ./nanoclaw
      environment:
        - ORACLE_URL=http://oracle-test:47778
        - TEST_MODE=true
      depends_on:
        - oracle-test
  ```
- [ ] Test data fixture: seed Oracle with sample knowledge
- [ ] Mock WhatsApp connection (Baileys test adapter)
- [ ] Mock Telegram bot (HTTP stub)

### Flow 1: WhatsApp → Agent → Oracle → Response

- [ ] Test: User sends message via WhatsApp
- [ ] Test: Message routed to container agent
- [ ] Test: Agent queries Oracle for relevant knowledge
- [ ] Test: Agent responds with knowledge-informed answer
- [ ] Test: Response delivered back to WhatsApp
- [ ] Test: Response time < 5s (target < 3s)

### Flow 2: Telegram → Agent → Oracle → Response

- [ ] Test: User sends message via Telegram
- [ ] Test: `/start` → welcome message
- [ ] Test: Regular message → agent container → response
- [ ] Test: Oracle integration works same as WhatsApp
- [ ] Test: Parallel messages from both channels → no conflict

### Flow 3: Learn → Search → Recall

- [ ] Test: Send "เรียนรู้: TypeScript ..." → Oracle stores knowledge
- [ ] Test: Send "TypeScript คืออะไร?" → Oracle returns stored knowledge
- [ ] Test: Send "ค้นหา: ..." → FTS5 + ChromaDB results returned
- [ ] Test: Concept linking works (related topics suggested)

### Flow 4: Conversation Memory Cycle

- [ ] Test: Have conversation → end → summary stored
- [ ] Test: New conversation → recall previous context
- [ ] Test: "เมื่อวานคุยเรื่องอะไร?" → accurate answer

### Flow 5: Resilience

- [ ] Test: Oracle service down → circuit breaker → graceful fallback
- [ ] Test: Container crash → auto-restart → no message lost
- [ ] Test: Queue persistence → restart NanoClaw → pending messages still processed
- [ ] Test: Rate limit → burst of 20 messages → queued properly

### Flow 6: Multi-Channel Consistency

- [ ] Test: Learn from WhatsApp → query from Telegram → same knowledge
- [ ] Test: Learn from Telegram → query from WhatsApp → same knowledge
- [ ] Test: Decision created from WhatsApp → visible from Telegram

### Performance Benchmarks

- [ ] Cold start: first message → response < 8s
- [ ] Warm start: subsequent messages → response < 3s
- [ ] Oracle search latency < 200ms
- [ ] 10 concurrent conversations → no timeout
- [ ] Memory usage stable after 100 conversations (no leak)

### Automated Test Script

- [ ] สร้าง `tests/e2e/`:
  ```
  tests/e2e/
  ├── setup.ts          # Spin up test environment
  ├── teardown.ts       # Clean up
  ├── whatsapp.test.ts  # WhatsApp flow tests
  ├── telegram.test.ts  # Telegram flow tests
  ├── knowledge.test.ts # Learn/search/recall tests
  ├── memory.test.ts    # Conversation memory tests
  ├── resilience.test.ts # Failure scenario tests
  └── benchmark.test.ts # Performance benchmarks
  ```
- [ ] CI-ready: `npm run test:e2e` or `bun test:e2e`

---

## 🧪 Definition of Done

1. ทุก flow (1–6) ผ่าน
2. ทุก benchmark ผ่านเกณฑ์
3. Test script automated — run ซ้ำได้
4. No data leak between test runs
5. Documentation: ที่ `tests/e2e/README.md`

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `docker-compose.test.yml` | JellyCore | **Create** |
| `tests/e2e/setup.ts` | JellyCore | **Create** |
| `tests/e2e/teardown.ts` | JellyCore | **Create** |
| `tests/e2e/whatsapp.test.ts` | JellyCore | **Create** |
| `tests/e2e/telegram.test.ts` | JellyCore | **Create** |
| `tests/e2e/knowledge.test.ts` | JellyCore | **Create** |
| `tests/e2e/memory.test.ts` | JellyCore | **Create** |
| `tests/e2e/resilience.test.ts` | JellyCore | **Create** |
| `tests/e2e/benchmark.test.ts` | JellyCore | **Create** |
| `tests/e2e/README.md` | JellyCore | **Create** |

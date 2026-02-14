# 4.1 — Context-Aware Prompt Builder

> ทำให้ Agent มี Oracle knowledge มาประกอบทุก response

**Status:** ⬜ Not Started  
**Effort:** Medium  
**Priority:** 🔴 Core Feature

---

## 🎯 เป้าหมาย

ก่อน spawn container ทุกครั้ง → query Oracle → inject relevant knowledge + user preferences + recent context เข้า system prompt  
ทำให้ AI "aware" ของทุกอย่างที่เคยเรียนรู้

---

## ✅ Checklist

### สร้าง Prompt Builder Module

- [ ] สร้าง `src/prompt-builder.ts`:
  ```typescript
  interface PromptContext {
    knowledge: string[];      // relevant documents from Oracle search
    userPrefs: string[];      // known user preferences
    recentDecisions: string[]; // recent decisions from Oracle
    conversationSummary: string; // last conversation summary
    confidence: number;       // 0-1, how relevant the context is
  }
  
  async function buildContextualPrompt(
    userMessage: string,
    userId: string,
    groupId: string
  ): Promise<PromptContext>
  ```

### Query Oracle for Context

- [ ] Implement context gathering (3 queries, parallel):
  ```typescript
  const [knowledge, prefs, decisions] = await Promise.all([
    // 1. Search relevant knowledge
    oracleApi.search(userMessage, { limit: 5 }),
    
    // 2. Get user preferences
    oracleApi.search(`user preferences ${userId}`, { mode: 'vector', limit: 3 }),
    
    // 3. Recent decisions
    oracleApi.listDecisions({ limit: 3, status: 'active' }),
  ]);
  ```

### Format Context for System Prompt

- [ ] Inject context as XML ใน agent system prompt:
  ```xml
  <oracle_context confidence="0.85">
    <relevant_knowledge>
      - Document: "TypeScript patterns" (relevance: 0.92)
        Content: ...
      - Document: "Previous discussion about X" (relevance: 0.78)
        Content: ...
    </relevant_knowledge>
    
    <user_preferences>
      - Prefers Thai language for casual, English for technical
      - Likes concise answers
    </user_preferences>
    
    <recent_decisions>
      - Decision: "Use Docker for deployment" (2026-02-10)
    </recent_decisions>
    
    <conversation_history>
      Last conversation (2026-02-13): Discussed project architecture...
    </conversation_history>
  </oracle_context>
  ```

### Caching

- [ ] Cache context per-session (same group + within 5 min):
  ```typescript
  const contextCache = new LRUCache<string, PromptContext>({
    max: 50,
    ttl: 5 * 60 * 1000 // 5 minutes
  });
  ```
- [ ] Cache key: `${groupId}:${hashOfUserMessage.slice(0, 50)}`
- [ ] Follow-up messages ใน session เดียว → ใช้ cached context

### Integrate with Container Runner

- [ ] แก้ `src/container-runner.ts` หรือ `src/index.ts`:
  - ก่อน spawn container → `buildContextualPrompt()`
  - Append context XML ต่อท้าย CLAUDE.md content หรือ system prompt
  - Pass via env var (`ORACLE_CONTEXT`) หรือ IPC file

### Oracle API Client

- [ ] สร้าง `src/oracle-client.ts`:
  ```typescript
  class OracleClient {
    constructor(private baseUrl: string, private authToken: string) {}
    
    async search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
    async consult(query: string): Promise<ConsultResult>;
    async learn(title: string, content: string, concepts: string[]): Promise<void>;
    async listDecisions(opts?: ListOptions): Promise<Decision[]>;
    async health(): Promise<boolean>;
  }
  ```
- [ ] Timeout: 5s per request
- [ ] Retry: 2 attempts
- [ ] Graceful fallback: ถ้า Oracle down → prompt ไม่มี context (ยังทำงานได้)

### ทดสอบ

- [ ] ส่ง message เกี่ยวกับ topic ที่มีใน Oracle → response มี relevant context
- [ ] ส่ง message ที่ไม่เกี่ยว → context confidence ต่ำ → minimal injection
- [ ] Oracle down → agent ยังตอบได้ (ไม่มี context)
- [ ] Follow-up message → ใช้ cached context (ไม่ query ซ้ำ)
- [ ] Measure: context query latency <500ms

---

## 🧪 Definition of Done

1. Agent response มี context จาก Oracle knowledge base
2. Context query latency <500ms (cached <5ms)
3. Oracle down → graceful fallback (no crash)
4. Context format ชัดเจนใน system prompt

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `src/prompt-builder.ts` | NanoClaw | **Create** — context builder |
| `src/oracle-client.ts` | NanoClaw | **Create** — Oracle HTTP client |
| `src/container-runner.ts` or `src/index.ts` | NanoClaw | Integrate prompt builder |

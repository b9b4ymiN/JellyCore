# 1.8 — Smart Query Router

> แก้จุดอ่อน: W2 (LLM Model Routing & Cost Control), W3 (Container Cold Start ทุก Query)

**Status:** ✅ Complete  
**Effort:** Medium  
**Priority:** 🔴 High — ลด cost + ลด latency อย่างมีนัยสำคัญ

---

## 📋 ปัญหาเดิม

ทุก message (แม้แค่ "สวัสดี" หรือ "ขอบคุณ") ต้อง spawn container + เรียก Claude API → สิ้นเปลือง:
- Container cold start 3-10 วินาที
- API credits สำหรับ trivial messages
- Queue congestion จาก simple queries

**ที่มา:** NanoClaw `src/index.ts` → ทุก message ถูก route เข้า container เหมือนกัน

---

## 🎯 เป้าหมาย

จัดประเภท message ก่อน process → route ไปยัง handler ที่เหมาะสม → ลด container spawn 50-70%

---

## ✅ Checklist

### สร้าง Query Classifier

- [ ] สร้าง `src/query-router.ts`:
  ```typescript
  type QueryTier = 'inline' | 'oracle-only' | 'container-light' | 'container-full';

  interface QueryClassification {
    tier: QueryTier;
    model: 'haiku' | 'sonnet' | 'opus';
    reason: string;
    confidence: number;
  }

  function classifyQuery(message: string, context: MessageContext): QueryClassification
  ```

### Implement Classification Rules

- [ ] **Tier 1 — Inline** (ไม่ spawn container):
  ```
  Patterns:
  - Greetings: /^(สวัสดี|hello|hi|hey|ดี)/i
  - Thanks: /^(ขอบคุณ|thanks|thank you|thx)/i
  - Acknowledgment: /^(ok|ได้|โอเค|รับทราบ|เข้าใจ)/i
  - Simple yes/no: /^(ใช่|ไม่|yes|no|yep|nope)/i
  - Admin commands: /^\/(status|health|backup|help)/
  
  Response: Template-based หรือ predefined response
  Latency: <50ms
  ```

- [ ] **Tier 2 — Oracle Only** (query Oracle, ไม่ spawn container):
  ```
  Patterns:
  - Knowledge recall: "รู้อะไรเกี่ยวกับ...", "จำได้ไหมว่า..."
  - Simple search: "หา...", "ค้นหา..."
  - Memory commands: "จำไว้ว่า...", "ลืม..."
  - Status queries: "เมื่อวานคุยเรื่องอะไร"
  
  Response: Oracle API call + format results
  Model: None (template) หรือ Haiku (format only)
  Latency: <500ms
  ```

- [ ] **Tier 3 — Container Light** (spawn container, short context):
  ```
  Patterns:
  - General questions: "อธิบาย...", "คืออะไร", "ทำยังไง"
  - Short tasks: ไม่มี code blocks, <200 chars
  
  Model: Claude Haiku
  Context: Minimal Oracle injection
  Latency: <5s
  ```

- [ ] **Tier 4 — Container Full** (spawn container, full context):
  ```
  Patterns:
  - Code: มี ```, "เขียนโค้ด", "debug", "fix"
  - Analysis: "วิเคราะห์", "เปรียบเทียบ", "review"
  - Multi-step: ข้อความยาว, หลายคำถาม, complex reasoning
  - File operations: "สร้างไฟล์", "แก้ไฟล์"
  
  Model: Claude Sonnet/Opus
  Context: Full Oracle injection + conversation history
  Latency: <15s
  ```

### Implement Inline Handler

- [ ] สร้าง `src/inline-handler.ts`:
  ```typescript
  const responses: Record<string, string[]> = {
    greeting: ['สวัสดีครับ! มีอะไรให้ช่วยไหม? 🤖', 'หวัดดีครับ!'],
    thanks: ['ยินดีครับ! 😊', 'ยินดีช่วยเสมอครับ'],
    acknowledge: ['รับทราบครับ ✅'],
  };
  
  async function handleInline(msg: IncomingMessage): Promise<string> {
    const type = classifyInline(msg.content);
    return randomPick(responses[type]);
  }
  ```

### Implement Oracle-Only Handler

- [ ] สร้าง `src/oracle-handler.ts`:
  ```typescript
  async function handleOracleOnly(msg: IncomingMessage): Promise<string> {
    const oracleClient = new OracleClient(ORACLE_URL, AUTH_TOKEN);
    
    if (isMemoryStore(msg.content)) {
      // "จำไว้ว่า X" → oracle_learn
      const extracted = extractLearning(msg.content);
      await oracleClient.learn(extracted);
      return '✅ จำไว้แล้วครับ';
    }
    
    if (isSearch(msg.content)) {
      // "หา X" → oracle_search
      const results = await oracleClient.search(extractQuery(msg.content));
      return formatSearchResults(results);
    }
    
    // oracle_consult for general knowledge queries
    const answer = await oracleClient.consult(msg.content);
    return formatConsultResult(answer);
  }
  ```

### Integrate with Message Router

- [ ] แก้ `src/index.ts` → processMessage():
  ```typescript
  async function processMessage(msg: IncomingMessage) {
    const classification = classifyQuery(msg.content, getContext(msg));
    
    switch (classification.tier) {
      case 'inline':
        const reply = await handleInline(msg);
        await sendReply(msg, reply);
        break;
        
      case 'oracle-only':
        const oracleReply = await handleOracleOnly(msg);
        await sendReply(msg, oracleReply);
        break;
        
      case 'container-light':
        await spawnContainer(msg, { model: 'haiku', contextLevel: 'minimal' });
        break;
        
      case 'container-full':
        await spawnContainer(msg, { model: classification.model, contextLevel: 'full' });
        break;
    }
    
    // Track cost
    trackUsage(msg, classification);
  }
  ```

### Cost Tracking

- [ ] สร้าง `src/cost-tracker.ts`:
  ```typescript
  interface UsageRecord {
    timestamp: Date;
    tier: QueryTier;
    model: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
    userId: string;
  }
  
  // SQLite table: usage_tracking
  // Daily/monthly aggregation
  // Budget alerts: warn at 80%, block at 100%
  ```

- [ ] เพิ่ม SQLite table สำหรับ cost tracking:
  ```sql
  CREATE TABLE usage_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    user_id TEXT NOT NULL,
    tier TEXT NOT NULL,
    model TEXT,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    estimated_cost_usd REAL DEFAULT 0,
    response_time_ms INTEGER
  );
  ```

- [ ] Dashboard endpoint: `GET /api/cost/summary`:
  ```json
  {
    "today": { "requests": 45, "cost": 0.82, "byTier": {...} },
    "thisMonth": { "requests": 1200, "cost": 18.50, "budget": 50.00 },
    "budgetUsed": 37
  }
  ```

### ทดสอบ

- [ ] "สวัสดี" → inline reply <50ms (ไม่ spawn container)
- [ ] "หาข้อมูลเรื่อง Docker" → Oracle search → reply <500ms (ไม่ spawn container)
- [ ] "เขียนโค้ด Python sort algorithm" → container-full + Sonnet
- [ ] "อธิบาย REST API สั้นๆ" → container-light + Haiku
- [ ] Cost tracking records ทุก request
- [ ] Budget alert เมื่อ >80%
- [ ] Classification accuracy >85% บน test set 100 messages

---

## 🧪 Definition of Done

1. Messages classified ก่อน process ทุกครั้ง
2. Inline + Oracle-only handlers ลด container spawn ≥50%
3. Response latency: inline <50ms, oracle-only <500ms
4. Cost tracking active + budget alerts working
5. ไม่มี false negatives (complex query ถูก route ไป inline)

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `src/query-router.ts` | NanoClaw | **Create** — classification engine |
| `src/inline-handler.ts` | NanoClaw | **Create** — template responses |
| `src/oracle-handler.ts` | NanoClaw | **Create** — Oracle-only handler |
| `src/cost-tracker.ts` | NanoClaw | **Create** — usage tracking |
| `src/index.ts` | NanoClaw | Modify — integrate router |
| `src/db.ts` | NanoClaw | Add usage_tracking table |

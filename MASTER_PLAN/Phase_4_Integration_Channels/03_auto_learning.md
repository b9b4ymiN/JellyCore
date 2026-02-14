# 4.3 — Auto-Learning System

> Agent เรียนรู้จากทุกบทสนทนา → เก็บ patterns, preferences, corrections ลง Oracle

**Status:** ⬜ Not Started  
**Effort:** Medium  
**Priority:** 🟡 Medium

---

## 🎯 เป้าหมาย

Agent auto-extract learnings จากบทสนทนา → store ใน Oracle → ใช้ประกอบ future responses  
ไม่ต้องบอกให้จำ — จำเอง

---

## ✅ Checklist

### สร้าง Auto-Learner Module

- [ ] สร้าง `src/auto-learner.ts`:
  ```typescript
  interface Learning {
    type: 'preference' | 'correction' | 'decision' | 'fact' | 'pattern';
    content: string;
    concepts: string[];
    source: string;  // conversation reference
    confidence: number;
  }
  
  async function extractLearnings(
    conversation: ConversationSummary
  ): Promise<Learning[]>
  ```

### Hook into Agent Response Lifecycle

- [ ] ใช้ `onPreCompact` callback ใน agent-runner:
  - เมื่อ conversation ยาว → Claude compact → **ก่อน compact → extract learnings**
  - Alternative: extract หลัง conversation end (idle timeout)
  
- [ ] Extract via Oracle consult หรือ structured prompt:
  ```
  Given this conversation, extract any:
  1. User preferences (likes, dislikes, communication style)
  2. Corrections (user corrected the AI)
  3. Decisions made
  4. New facts learned
  5. Patterns observed
  
  Return as JSON array.
  ```

### Deduplication

- [ ] ก่อน store → ตรวจว่าซ้ำหรือไม่:
  ```typescript
  async function isDuplicate(learning: Learning): Promise<boolean> {
    const existing = await oracleClient.search(learning.content, { mode: 'vector', limit: 3 });
    // If top result similarity > 0.85 → duplicate
    return existing.length > 0 && existing[0].score > 0.85;
  }
  ```
- [ ] ถ้าซ้ำ → merge (update existing) แทน create ใหม่

### Rate Limiting

- [ ] Max learnings per session: 5
- [ ] Max learnings per day: 50
- [ ] Skip low-confidence learnings (<0.5)

### Store via Oracle

- [ ] เรียก Oracle API:
  ```typescript
  await oracleClient.learn({
    title: `[Auto] ${learning.type}: ${learning.content.slice(0, 50)}`,
    content: learning.content,
    concepts: learning.concepts,
    metadata: {
      source: 'auto-learning',
      type: learning.type,
      confidence: learning.confidence,
      session: sessionId,
    }
  });
  ```

### Learning Types & Detection Patterns

- [ ] **Preferences:**
  - User says "ผมชอบ...", "อย่าทำแบบ...", "ผมไม่ชอบ..."
  - Communication style: ภาษาที่ user ใช้, ความยาว responses ที่ prefer

- [ ] **Corrections:**
  - User says "ไม่ใช่...", "ผิด", "จริงๆ แล้ว..."
  - User re-asks same question with more context

- [ ] **Decisions:**
  - "ใช้ X ดีกว่า", "ตัดสินใจแล้ว", "ไปทาง..."
  - Agent helped decide → record decision + reasoning

- [ ] **Facts:**
  - User provides new information: "ผมใช้ MacBook", "office อยู่ที่..."
  - Technical facts: versions, libraries, patterns used

### ทดสอบ

- [ ] บอก AI "ผมชอบคำตอบสั้นๆ" → Oracle ได้ learning type=preference
- [ ] แก้ไข AI "ไม่ใช่ ถูกต้องคือ X" → Oracle ได้ learning type=correction
- [ ] ตัดสินใจ "ใช้ Docker" → Oracle ได้ learning type=decision
- [ ] Duplicate learning → merged, not duplicated
- [ ] >5 learnings ใน session → excess dropped
- [ ] Future conversation → context includes learned preferences

---

## 🧪 Definition of Done

1. Agent extracts learnings from conversations automatically
2. Learnings deduplicated before store
3. Rate limited (5/session, 50/day)
4. Future prompts include relevant learned context
5. Learning types categorized correctly

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `src/auto-learner.ts` | NanoClaw | **Create** — extraction + store |
| `container/agent-runner/src/index.ts` | NanoClaw | Hook onPreCompact for learning |
| `src/oracle-client.ts` | NanoClaw | Add learn() method |

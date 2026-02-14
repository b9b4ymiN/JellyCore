# 4.10 — Self-Reflection Loop

> เพิ่มความฉลาด: AI ประเมินคุณภาพคำตอบตัวเองและปรับปรุง

**Status:** ⬜ Not Started  
**Effort:** Medium  
**Priority:** 🟡 Medium  
**Depends on:** Item 4.1 (Prompt Builder), Item 1.8 (Smart Query Router)

---

## 📋 ปัญหาเดิม

- AI ตอบแล้วจบ ไม่มีการประเมินว่าคำตอบดีหรือไม่
- ไม่มี feedback loop เพื่อปรับปรุงคำตอบในอนาคต
- ความผิดพลาดซ้ำๆ ไม่ถูกจดจำ

---

## 🎯 เป้าหมาย

1. Post-response evaluation: หลังตอบ → ให้ AI ประเมินคำตอบตัวเอง
2. Quality scoring: ให้คะแนน confidence, relevance, completeness
3. Adaptive prompting: ใช้ reflection history ปรับ prompt ในอนาคต

---

## ✅ Checklist

### Reflection Engine

- [ ] สร้าง `src/reflection.ts` ใน Oracle V2:
  ```typescript
  interface ReflectionResult {
    quality: number; // 0-1 overall quality
    confidence: number; // 0-1 how sure am I
    relevance: number; // 0-1 did I answer the question
    completeness: number; // 0-1 is the answer complete
    issues: string[]; // identified problems
    improvements: string[]; // what could be better
    shouldRetry: boolean; // quality too low → retry
  }

  const REFLECTION_PROMPT = `
You just answered a user's question. Evaluate your own answer:

USER QUESTION: {question}
YOUR ANSWER: {answer}
CONTEXT USED: {context}

Score each dimension 0.0-1.0:
- confidence: How certain are you about this answer?
- relevance: Does this directly answer the question?
- completeness: Is the answer thorough enough?

List any issues or things that could be improved.
If overall quality < 0.5, recommend retry with different approach.

Reply as JSON: { confidence, relevance, completeness, issues: [], improvements: [], shouldRetry }
`;

  async function reflect(
    question: string,
    answer: string,
    context: string
  ): Promise<ReflectionResult> {
    const prompt = REFLECTION_PROMPT
      .replace('{question}', question)
      .replace('{answer}', answer)
      .replace('{context}', context);
    
    // Use lightweight model for reflection (cost-efficient)
    const result = await callModel(prompt, { 
      model: 'claude-sonnet',
      maxTokens: 500,
    });
    
    const parsed = JSON.parse(result);
    const quality = (parsed.confidence + parsed.relevance + parsed.completeness) / 3;
    
    return {
      quality,
      ...parsed,
      shouldRetry: quality < 0.5,
    };
  }
  ```

- [ ] Store reflection results:
  ```sql
  CREATE TABLE IF NOT EXISTS reflections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    question TEXT NOT NULL,
    answer_hash TEXT NOT NULL,
    quality REAL NOT NULL,
    confidence REAL NOT NULL,
    relevance REAL NOT NULL,
    completeness REAL NOT NULL,
    issues TEXT, -- JSON array
    improvements TEXT, -- JSON array
    created_at TEXT DEFAULT (datetime('now'))
  );
  
  CREATE INDEX idx_reflections_quality ON reflections(quality);
  CREATE INDEX idx_reflections_created ON reflections(created_at);
  ```

### Quality-Based Retry

- [ ] ถ้า quality < 0.5 → retry ด้วย approach ต่างไป:
  ```typescript
  async function answerWithReflection(
    question: string, 
    context: string
  ): Promise<string> {
    const MAX_RETRIES = 2;
    let bestAnswer = '';
    let bestQuality = 0;
    
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const answer = await generateAnswer(question, context, {
        attempt, // varies prompt strategy per attempt
      });
      
      const reflection = await reflect(question, answer, context);
      
      // Store reflection
      await saveReflection(question, answer, reflection);
      
      if (reflection.quality > bestQuality) {
        bestAnswer = answer;
        bestQuality = reflection.quality;
      }
      
      if (!reflection.shouldRetry || reflection.quality > 0.7) {
        break; // Good enough
      }
      
      // Retry with improvements
      context += `\n\nPrevious attempt issues: ${reflection.issues.join(', ')}`;
    }
    
    return bestAnswer;
  }
  ```

### Adaptive Prompting

- [ ] ใช้ reflection history ปรับ system prompt:
  ```typescript
  async function getReflectionInsights(): Promise<string> {
    // Get recent low-quality reflections
    const lowQuality = await db.all(`
      SELECT issues, improvements 
      FROM reflections 
      WHERE quality < 0.6 
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    
    if (lowQuality.length === 0) return '';
    
    const commonIssues = extractCommonPatterns(lowQuality);
    
    return `
Based on recent self-evaluations, pay special attention to:
${commonIssues.map(i => `- ${i}`).join('\n')}
    `.trim();
  }
  ```

### Selective Reflection

- [ ] ไม่ reflect ทุก message (ต้นทุนสูง):
  ```typescript
  function shouldReflect(query: QueryClassification): boolean {
    // Only reflect on complex queries
    if (query.tier === 'inline') return false;
    if (query.tier === 'oracle-only') return false;
    
    // Reflect on container queries and important ones
    return query.tier === 'container-full' || query.importance > 0.7;
  }
  ```

### User Feedback Integration

- [ ] User feedback (ถ้ามี) override AI reflection:
  ```typescript
  // Telegram inline buttons: 👍 / 👎
  async function handleUserFeedback(
    conversationId: string, 
    feedback: 'positive' | 'negative'
  ): Promise<void> {
    await db.run(`
      UPDATE reflections 
      SET user_feedback = ?, quality = CASE 
        WHEN ? = 'negative' THEN MIN(quality, 0.3) 
        ELSE MAX(quality, 0.7) 
      END
      WHERE conversation_id = ?
    `, feedback, feedback, conversationId);
  }
  ```

### ทดสอบ

- [ ] Simple greeting → ไม่ trigger reflection
- [ ] Complex knowledge query → reflection runs
- [ ] Quality < 0.5 → retry once with improved context
- [ ] Reflection results stored in DB
- [ ] User 👎 → quality scored down
- [ ] Adaptive prompting includes common issues

---

## 🧪 Definition of Done

1. Reflection runs on container-tier queries
2. Quality < 0.5 triggers automatic retry (max 2)
3. Reflection history stored and queryable
4. Common issues feed back into system prompt
5. User feedback integrated with reflection scores
6. Cost controlled: reflection uses sonnet, not opus

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `src/reflection.ts` | Oracle V2 | **Create** — reflection engine |
| `src/server/db.ts` | Oracle V2 | Add reflections table |
| `src/prompt/adaptive.ts` | Oracle V2 | **Create** — adaptive prompting |
| `src/channels/telegram/feedback.ts` | NanoClaw | **Create** — inline buttons |

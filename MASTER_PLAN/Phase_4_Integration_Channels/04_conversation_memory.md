# 4.4 — Conversation Memory Pipeline

> จดจำบทสนทนาข้ามเซสชัน — "เมื่อวานคุยเรื่องอะไร" → ตอบได้

**Status:** ⬜ Not Started  
**Effort:** Medium  
**Priority:** 🟡 Medium  
**Depends on:** Item 4.3 (Auto-Learning)

---

## 🎯 เป้าหมาย

เมื่อ conversation จบ → summarize → store ใน Oracle → conversation ใหม่ → recall previous context

---

## ✅ Checklist

### Conversation End Detection

- [ ] Detect conversation end:
  - Container idle timeout hit (10 min no activity)
  - Container completed + output sent
  - User sends "จบ", "ขอบคุณ", "bye"
- [ ] Trigger: `onConversationEnd(groupId, messages, agentResponses)`

### Summarization

- [ ] สร้าง `src/conversation-summarizer.ts`:
  ```typescript
  async function summarizeConversation(
    messages: Message[],
    responses: AgentResponse[]
  ): Promise<ConversationSummary> {
    // Use Oracle consult or Claude mini to summarize:
    // - Main topics discussed
    // - Key outcomes/decisions
    // - Action items
    // - User sentiment/satisfaction
    
    return {
      summary: "...",
      topics: ["architecture", "deployment"],
      decisions: ["Use Docker"],
      actionItems: ["Setup VPS"],
      participants: ["user"],
      duration: endTime - startTime,
      messageCount: messages.length,
    };
  }
  ```

### Store Conversation Memory

- [ ] Store via Oracle:
  ```typescript
  await oracleClient.learn({
    title: `[Conversation] ${date}: ${topics.join(', ')}`,
    content: `
      ## Summary
      ${summary}
      
      ## Topics
      ${topics.map(t => `- ${t}`).join('\n')}
      
      ## Decisions
      ${decisions.map(d => `- ${d}`).join('\n')}
      
      ## Action Items
      ${actionItems.map(a => `- ${a}`).join('\n')}
    `,
    concepts: ['conversation', ...topics],
    metadata: {
      type: 'conversation_summary',
      groupId,
      date,
      messageCount,
      duration,
    }
  });
  ```

### Recall on New Conversation

- [ ] ปรับ prompt builder (Item 4.1):
  - Query Oracle: `search("conversation summary", { concepts: [userId], limit: 3 })`
  - Inject ใน system prompt:
    ```xml
    <conversation_history>
      Previous conversation (2026-02-13):
      - Discussed: project architecture, deployment
      - Decided: Use Docker
      - Action items: Setup VPS
      
      Previous conversation (2026-02-12):
      - Discussed: AI assistant features
      - Decided: Use Oracle V2 for knowledge
    </conversation_history>
    ```

### Decision Auto-Tracking

- [ ] เมื่อ summarizer detect decision:
  ```typescript
  for (const decision of summary.decisions) {
    await oracleClient.createDecision({
      title: decision,
      context: summary.summary,
      status: 'active',
      source: `conversation:${groupId}:${date}`,
    });
  }
  ```

### ทดสอบ

- [ ] Have conversation → end → summary stored in Oracle
- [ ] Start new conversation → "เมื่อวานคุยเรื่องอะไร" → accurate recall
- [ ] Decision detected → auto-created in Oracle decisions
- [ ] Multiple conversations → summaries accumulate correctly
- [ ] Oracle search "conversation" → shows summary documents

---

## 🧪 Definition of Done

1. Conversations auto-summarized on end
2. Summaries stored in Oracle knowledge base
3. New conversations recall previous context
4. Decisions auto-tracked
5. "What did we discuss yesterday?" → accurate answer

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `src/conversation-summarizer.ts` | NanoClaw | **Create** |
| `src/prompt-builder.ts` | NanoClaw | Add conversation recall |
| `src/oracle-client.ts` | NanoClaw | Add createDecision() method |
| `src/index.ts` or `src/group-queue.ts` | NanoClaw | Hook conversation end |

# 4.7 — 4-Layer Memory System

> แก้จุดอ่อน: W7 (Memory System ตื้นเกินไป) — สร้าง structured memory ที่จำได้ลึกซึ้งขึ้น

**Status:** ⬜ Not Started  
**Effort:** Large  
**Priority:** 🔴 High — Core Intelligence  
**Depends on:** Items 4.3 (Auto-Learning), 4.4 (Conversation Memory)

---

## 📋 ปัญหาเดิม

ระบบ memory ปัจจุบัน (4.3 + 4.4) เก็บแค่:
- Conversation summaries (episodic) → flat, ไม่มี structure
- Auto-learnings (semantic) → ไม่แยก type ชัดเจน
- ไม่มี procedural memory (วิธีทำที่เรียนรู้จาก user)
- ไม่มี user model (ข้อมูลส่วนตัวที่รู้เกี่ยวกับ user)

---

## 🎯 เป้าหมาย

Memory 4 ชั้น ที่ทำงานประสานกัน: Working → Episodic → Semantic → Procedural + User Model

---

## ✅ Checklist

### Memory Type Definitions

- [ ] สร้าง `src/memory/types.ts`:
  ```typescript
  // Layer 1: Working Memory (ระยะสั้น — ตลอด session)
  interface WorkingMemory {
    sessionId: string;
    groupId: string;
    conversationContext: string[];
    activeTask: string | null;
    currentTopics: string[];
    recentMentions: Map<string, number>; // entity → mention count
    ttl: number; // session lifetime
  }

  // Layer 2: Episodic Memory (เหตุการณ์ — 90 วัน)
  interface EpisodicMemory {
    id: string;
    type: 'conversation_summary';
    date: string;
    topics: string[];
    decisions: string[];
    actionItems: string[];
    sentiment: 'positive' | 'neutral' | 'negative';
    satisfactionLevel: number; // 0-1
    messageCount: number;
    duration: number;
    ttl: number; // 90 days → archive
  }

  // Layer 3: Semantic Memory (ความรู้ — ไม่หมดอายุ, decay)
  interface SemanticMemory {
    id: string;
    type: 'fact' | 'knowledge' | 'correction';
    content: string;
    concepts: string[];
    confidence: number;
    accessCount: number;
    lastAccessedAt: string;
    decayScore: number; // 0-1, decreases over time
    source: string;
  }

  // Layer 4: Procedural Memory (วิธีการ — ไม่หมดอายุ)
  interface ProceduralMemory {
    id: string;
    type: 'preference' | 'pattern' | 'workflow' | 'style';
    trigger: string;      // เมื่อ user ทำ/พูด X
    action: string;       // AI ควรทำ Y
    examples: string[];   // ตัวอย่างที่เคยเกิดขึ้น
    frequency: number;    // จำนวนครั้งที่ pattern นี้เกิด
    confidence: number;
  }

  // User Model (โปรไฟล์ — อัปเดตต่อเนื่อง)
  interface UserModel {
    userId: string;
    name: string | null;
    timezone: string | null;
    activeHours: { start: number; end: number } | null;
    expertise: Record<string, 'beginner' | 'intermediate' | 'advanced' | 'expert'>;
    communicationPrefs: {
      language: 'thai' | 'english' | 'mixed';
      responseLength: 'short' | 'medium' | 'detailed';
      formality: 'casual' | 'professional' | 'mixed';
      codeCommentLanguage: 'thai' | 'english';
    };
    interests: string[];
    activeProjects: string[];
    techStack: string[];
    lastInteractionAt: string;
    totalInteractions: number;
  }
  ```

### Working Memory Manager

- [ ] สร้าง `src/memory/working-memory.ts`:
  ```typescript
  class WorkingMemoryManager {
    private sessions: Map<string, WorkingMemory> = new Map();
    
    // Create/get session
    getOrCreate(groupId: string): WorkingMemory;
    
    // Update with new message
    update(groupId: string, message: string, response: string): void;
    
    // Get context for prompt building
    getContext(groupId: string): WorkingMemoryContext;
    
    // Cleanup expired sessions
    cleanup(): void;
  }
  ```

### User Model Manager

- [ ] สร้าง `src/memory/user-model.ts`:
  ```typescript
  class UserModelManager {
    // Load user model from Oracle
    async load(userId: string): Promise<UserModel>;
    
    // Update specific fields
    async updateExpertise(userId: string, topic: string, level: string): Promise<void>;
    async updatePreference(userId: string, key: string, value: any): Promise<void>;
    
    // Infer from conversation
    async inferFromConversation(
      userId: string,
      messages: Message[],
      responses: string[]
    ): Promise<Partial<UserModel>>;
    
    // Store to Oracle
    async save(model: UserModel): Promise<void>;
  }
  ```

- [ ] User Model inference rules:
  ```typescript
  // Detect expertise level
  if (usesAdvancedTerminology(messages)) expertise[topic] = 'advanced';
  
  // Detect language preference  
  if (thaiRatio > 0.7) communicationPrefs.language = 'thai';
  
  // Detect response length preference
  if (feedbackOnLongResponse === 'negative') responseLength = 'short';
  
  // Detect active project
  if (mentionsProject(messages)) activeProjects.push(projectName);
  ```

### Oracle MCP Tools สำหรับ Memory

- [ ] เพิ่ม tools ใน Oracle V2:
  ```typescript
  // oracle_user_model_get → GET /api/user-model/:userId
  // oracle_user_model_update → PATCH /api/user-model/:userId
  // oracle_memory_search → GET /api/memory/search?type=...&q=...
  ```

- [ ] เพิ่ม Oracle schema:
  ```sql
  CREATE TABLE user_models (
    user_id TEXT PRIMARY KEY,
    model_json TEXT NOT NULL, -- JSON serialized UserModel
    updated_at TEXT NOT NULL
  );
  
  CREATE TABLE procedural_memories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    trigger_pattern TEXT NOT NULL,
    action TEXT NOT NULL,
    examples TEXT, -- JSON array
    frequency INTEGER DEFAULT 1,
    confidence REAL DEFAULT 0.5,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  ```

### Integrate with Prompt Builder

- [ ] ปรับ `src/prompt-builder.ts` → query ทุก memory layer:
  ```typescript
  async function buildContextualPrompt(msg, userId, groupId) {
    const [
      workingMem,
      episodicMem,
      semanticMem,
      proceduralMem,
      userModel,
    ] = await Promise.all([
      workingMemoryManager.getContext(groupId),
      oracleClient.memorySearch({ type: 'episodic', userId, limit: 3 }),
      oracleClient.search(msg.content, { limit: 5 }),
      oracleClient.memorySearch({ type: 'procedural', userId, limit: 5 }),
      userModelManager.load(userId),
    ]);
    
    return formatMultiLayerContext({
      working: workingMem,
      episodic: episodicMem,
      semantic: semanticMem,
      procedural: proceduralMem,
      userModel: userModel,
    });
  }
  ```

- [ ] Format multi-layer context:
  ```xml
  <memory_context>
    <user_model>
      Name: {name} | Expertise: TypeScript(advanced), Docker(intermediate)
      Prefs: Thai casual, short responses | Projects: JellyCore
    </user_model>
    
    <working_memory>
      Current topics: Docker deployment, container optimization
      Active task: Setting up production VPS
    </working_memory>
    
    <procedural_memory>
      - เมื่อ user ถามเรื่อง code → ให้ตอบพร้อม comments ภาษาอังกฤษ
      - เมื่อ user ถาม "ทำยังไง" → ให้ตอบเป็น step-by-step
      - เมื่อ user ส่ง code มา → check syntax ก่อนตอบ
    </procedural_memory>

    <recent_conversations>
      Yesterday: Discussed Docker Compose setup, decided to use Caddy
      2 days ago: Debugged WhatsApp reconnection issue
    </recent_conversations>
    
    <relevant_knowledge>
      [source:1] Docker Compose best practices...
      [source:2] JellyCore architecture decisions...
    </relevant_knowledge>
  </memory_context>
  ```

### ทดสอบ

- [ ] First conversation → working memory created
- [ ] Follow-up message → working memory has previous context
- [ ] Session end → episodic memory stored
- [ ] Auto-learning detects preference → procedural memory created
- [ ] "ผมชอบคำตอบสั้นๆ" → user model updated, future responses shorter
- [ ] "รู้อะไรเกี่ยวกับผม" → all memory layers queried
- [ ] Memory layers don't conflict (priority: working > procedural > episodic > semantic)

---

## 🧪 Definition of Done

1. 4 memory layers + user model implemented
2. Prompt builder queries all layers in parallel
3. User model inferred from conversations
4. Procedural memory learns from corrections + patterns
5. Context format includes all layers with clear separation
6. Memory query latency <500ms total

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `src/memory/types.ts` | NanoClaw | **Create** — type definitions |
| `src/memory/working-memory.ts` | NanoClaw | **Create** — session memory |
| `src/memory/user-model.ts` | NanoClaw | **Create** — user model |
| `src/prompt-builder.ts` | NanoClaw | Integrate multi-layer memory |
| `src/server/handlers.ts` | Oracle V2 | Add memory search + user model endpoints |
| `src/server/db.ts` | Oracle V2 | Add user_models + procedural_memories tables |

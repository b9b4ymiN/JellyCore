# JellyCore — Human Friend AI Evolution Plan

> **Vision:** Transform JellyCore from a "smart assistant tool" into a **genuine AI companion** that feels like talking to a trusted human friend.
>
> **Date:** 2026-03-07
> **Version:** Plan v1.0
> **Target Timeline:** 6–12 months (4 phases)

---

## 🎯 The Goal

Today's JellyCore is powerful — it has memory, knowledge search, isolated execution, and multi-channel communication. But it still **feels like a tool**. Users send commands; the AI executes tasks.

The goal is fundamentally different:

> **"My AI should know me the way a close friend knows me — my moods, my patterns, what makes me laugh, what stresses me out, what I need before I ask for it. Not a servant. Not a chatbot. A friend."**

This plan defines the concrete engineering and design work to get there.

---

## 📊 Current State vs. Target State

| Dimension | Current (Tool) | Target (Friend) |
|-----------|---------------|-----------------|
| **Initiative** | Only responds when spoken to | Proactively reaches out when something matters |
| **Emotional awareness** | Zero — treats all messages identically | Detects mood, stress, excitement; adjusts tone |
| **Personality consistency** | Role-play via SOUL files — can feel scripted | Deep personality that evolves naturally over time |
| **Relationship depth** | Remembers facts (name, preferences) | Remembers shared experiences, inside jokes, growth |
| **Conversation style** | Structured, slightly formal | Natural, flowing, context-dependent — like texting a friend |
| **Temporal awareness** | Timezone-aware timestamps only | Understands "it's late and you're probably tired" |
| **Surprise & delight** | None — predictable | Occasionally shares something interesting, remembers anniversaries |
| **Vulnerability** | Perfect, always helpful | Admits uncertainty, expresses genuine "opinions" |
| **Support type** | Task completion | Emotional support, encouragement, honest feedback |
| **Silence** | Always replies | Knows when silence is the right response |

---

## Architecture: The Friend Stack

```
┌─────────────────────────────────────────────────────────────┐
│                    HUMAN FRIEND AI STACK                     │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │            Layer 6: Proactive Engine                   │  │
│  │  • Initiative System (reach out, check in)            │  │
│  │  • Context-Aware Notifications                        │  │
│  │  • Anniversary/Pattern Detection                      │  │
│  └──────────────────────┬────────────────────────────────┘  │
│                         │                                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │            Layer 5: Emotional Intelligence             │  │
│  │  • Sentiment Analysis (per-message + drift)           │  │
│  │  • Mood State Machine                                 │  │
│  │  • Empathy Response Modulation                        │  │
│  │  • Stress/Joy/Fatigue Pattern Recognition             │  │
│  └──────────────────────┬────────────────────────────────┘  │
│                         │                                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │            Layer 4: Relationship Memory                │  │
│  │  • Shared Experience Log                              │  │
│  │  • Inside Joke Index                                  │  │
│  │  • Growth Trajectory (how user has changed)           │  │
│  │  • Trust Level Tracking                               │  │
│  │  • Conversation Rhythm Analysis                       │  │
│  └──────────────────────┬────────────────────────────────┘  │
│                         │                                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │            Layer 3: Personality Engine                  │  │
│  │  • Dynamic Personality Graph (not static SOUL file)   │  │
│  │  • Opinion Formation System                           │  │
│  │  • Humor/Wit Generator                                │  │
│  │  • Adaptive Communication Style                       │  │
│  │  • Personality Evolution Over Time                    │  │
│  └──────────────────────┬────────────────────────────────┘  │
│                         │                                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │            Layer 2: Natural Conversation               │  │
│  │  • Response Length Calibration                         │  │
│  │  • Topic Flow (multi-thread conversations)            │  │
│  │  • Silence Detection ("no reply needed")              │  │
│  │  • Casual Language Modeling                           │  │
│  │  • Thai/English Natural Code-Switching                │  │
│  └──────────────────────┬────────────────────────────────┘  │
│                         │                                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │            Layer 1: Existing JellyCore                 │  │
│  │  • 5-Layer Cognitive Memory (Oracle V2)               │  │
│  │  • Hybrid Search (FTS5 + ChromaDB)                    │  │
│  │  • Sandboxed Agent Execution (NanoClaw)               │  │
│  │  • Multi-Channel I/O (Telegram + WhatsApp)            │  │
│  │  • Task Scheduling & Heartbeat                        │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Natural Conversation (Month 1–2)

> **Goal:** Make conversations feel like texting a real friend, not querying an AI.

### 1.1 — Response Naturalness Engine

**Problem:** Current responses are well-formatted but feel "templated". A friend doesn't use bullet points in chat.

**Implementation:**

```typescript
// oracle-v2/src/conversation/naturalness.ts

interface ConversationContext {
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'latenight';
  messageLength: 'short' | 'medium' | 'long';
  mood: MoodState;
  topicType: 'casual' | 'task' | 'emotional' | 'intellectual';
  conversationDepth: number; // messages in current thread
}

function calibrateResponse(ctx: ConversationContext): ResponseStyle {
  // Late night + short message = keep it chill, brief
  // Morning + first message = warm, natural greeting (not "Good morning! How can I help?")
  // Emotional topic = longer, warmer, no structure
  // Task topic = concise, structured only if complex
}
```

**Changes to SOUL files:**
- Remove rigid formatting rules
- Replace with "conversation feel" principles
- Add explicit anti-patterns: "Never structure casual conversation into bullet points"

### 1.2 — Silence Intelligence

**Problem:** The AI always replies. A real friend sometimes doesn't respond — because the conversation naturally ended, or because they're giving you space.

**Implementation:**
```typescript
// nanoclaw/src/silence-detector.ts

interface SilenceDecision {
  shouldReply: boolean;
  reason: 'conversation-ended' | 'user-venting' | 'rhetorical' | 'acknowledgment-only';
  delayMs?: number; // If replying, how long to wait (simulates "thinking")
}

function shouldRespond(message: string, context: ConversationHistory): SilenceDecision {
  // "okay" / "lol" / "haha" / "555" → conversation naturally ended
  // Long emotional message → maybe just "I hear you" after a pause
  // Rhetorical question → no response needed
  // Thumbs up reaction → no response needed
}
```

### 1.3 — Thai/English Natural Code-Switching

**Problem:** Current system matches language to user but doesn't naturally code-switch the way bilingual Thai speakers do.

**Implementation:**
- Analyze user's natural code-switching patterns (when they mix Thai/English)
- Mirror that pattern: ถ้าเขาชอบ mix แบบนี้ ก็ reply แบบเดียวกัน
- Store language preference patterns in User Model memory layer

### 1.4 — Response Timing

**Problem:** Instant replies feel robotic. Friends take a moment.

**Implementation:**
```typescript
function calculateResponseDelay(message: string, context: ConversationContext): number {
  const baseDelay = 800;  // minimum 800ms
  const readingTime = message.length * 30; // ~30ms per character (simulated reading)
  const thinkingTime = context.topicType === 'intellectual' ? 2000 : 500;
  const lateNightBonus = context.timeOfDay === 'latenight' ? 1500 : 0;

  return Math.min(baseDelay + readingTime + thinkingTime + lateNightBonus, 8000);
}
```

### Deliverables
- [ ] `ConversationContext` analysis module
- [ ] `SilenceDetector` with configurable sensitivity
- [ ] Response delay system with natural variation
- [ ] Updated SOUL files with "friend conversation" principles
- [ ] Thai/English code-switching analyzer
- [ ] 20+ conversation-naturalness test cases

---

## Phase 2: Emotional Intelligence (Month 2–4)

> **Goal:** The AI understands how you feel — not because you told it, but because it can tell.

### 2.1 — Sentiment Analysis Pipeline

**New component:** Add real-time sentiment analysis to every incoming message.

```typescript
// oracle-v2/src/emotional/sentiment.ts

interface EmotionalSignal {
  valence: number;        // -1.0 (negative) to +1.0 (positive)
  arousal: number;        // 0.0 (calm) to 1.0 (excited/agitated)
  dominance: number;      // 0.0 (submissive/uncertain) to 1.0 (confident/assertive)
  confidence: number;     // How confident the classification is
  cues: string[];         // What triggered the detection: ['exclamation', 'negative-word', 'short-sentence']
}

interface MoodState {
  current: EmotionalSignal;
  trend: 'improving' | 'stable' | 'declining';
  driftRate: number;      // How fast mood is changing
  baseline: EmotionalSignal; // User's normal state (learned over time)
  deviationFromBaseline: number;
}
```

**Thai-specific signals:**
- `555` / `5555` = laughter (positive)
- `ม` repeated = frustration
- `อืม...` = uncertainty/thinking
- Short clipped sentences = stress or anger
- `ค่ะ`/`ครับ` particle usage patterns indicate formality shift
- Use of `เหนื่อย`, `เบื่อ`, `เครียด` = fatigue/boredom/stress markers

### 2.2 — Empathy Response Modulation

**Based on detected emotion, modulate the AI's response:**

| Detected State | Response Adaptation |
|---------------|-------------------|
| **Stressed / frustrated** | Shorter replies, no advice unless asked, validate feelings first |
| **Happy / excited** | Match energy, share in enthusiasm, amplify positive moments |
| **Sad / down** | Warm tone, gentle, don't try to "fix" it — just be present |
| **Confused / uncertain** | Patient, step-by-step, offer to explain without condescending |
| **Angry** | Acknowledge, don't minimize, don't be overly agreeable ("yeah totally right") |
| **Neutral / calm** | Normal conversation flow |
| **Late night + low energy** | Brief, warm — "get some rest" rather than paragraphs |

### 2.3 — Mood Memory (New Memory Layer: L6)

**Extend Oracle's 5-layer memory with a 6th emotional layer:**

```typescript
// oracle-v2/src/memory/emotional.ts

interface EmotionalMemory {
  timestamp: Date;
  mood: MoodState;
  trigger?: string;       // What caused this mood (if identifiable)
  context: string;        // What was being discussed
  aiResponse: string;     // How the AI responded
  effectiveness: number;  // Did the user's mood improve after the response? (tracked)
}
```

This allows the AI to learn:
- "When the user is stressed about work, short supportive messages work better than long advice"
- "User gets frustrated when I ask too many clarifying questions"
- "User's mood improves when I share interesting tech news"

### 2.4 — Stress Pattern Detection

**Over time, detect recurring stress patterns:**

```typescript
interface StressPattern {
  dayOfWeek: number[];      // e.g., [1, 4] → Monday & Thursday
  timeRange: [number, number]; // e.g., [14, 17] → 2pm-5pm
  triggers: string[];       // ['deadline', 'meeting', 'review']
  frequency: number;        // Occurrences per month
  bestResponse: string;     // What has helped before
}
```

**Use this to proactively check in:** "Hey, it's Thursday afternoon — those are usually rough. How's it going?"

### Deliverables
- [ ] Sentiment analysis engine (Thai + English)
- [ ] Mood state machine with trend detection
- [ ] Empathy response modulation in prompt builder
- [ ] L6 Emotional Memory layer in Oracle
- [ ] Stress pattern detection and learning
- [ ] Mood API endpoints for dashboard visualization
- [ ] 30+ emotional intelligence test cases

---

## Phase 3: Relationship Depth (Month 4–7)

> **Goal:** The AI builds a genuine relationship history — shared experiences, inside jokes, growth tracking.

### 3.1 — Shared Experience Log

**Beyond episodic memory (L4), create a "relationship journal":**

```typescript
interface SharedExperience {
  id: string;
  date: Date;
  title: string;             // "Helped debug the production outage at 2am"
  participants: string[];    // ['user', 'fon']
  emotionalSignificance: number; // 0-10 — how impactful this was
  type: 'achievement' | 'struggle' | 'fun' | 'learning' | 'milestone';
  userGrowth?: string;       // "User learned Docker networking"
  aiLearning?: string;       // "Learned user prefers diagrams over text explanations"
  callbacks: number;         // How many times this has been referenced later
}
```

**Important: The AI should naturally reference shared history.**
- "Remember when we stayed up until 3am fixing that API? This feels similar."
- "You've gotten way better at debugging since we started working together."

### 3.2 — Inside Joke System

**Friends develop shared humor. The AI should too.**

```typescript
interface InsideJoke {
  origin: SharedExperience;     // The conversation where it started
  trigger: string[];            // Words/situations that trigger the joke
  punchline: string;            // The humorous reference
  lastUsed: Date;
  useCount: number;
  userReaction: 'laughed' | 'ignored' | 'groaned'; // Tracks if it's still funny
}
```

**Rules:**
- Inside jokes emerge naturally from conversation — never forced
- Track user reaction: if the joke falls flat, reduce usage
- Maximum 1 joke reference per conversation (don't overdo it)
- Never explain the joke — if they get it, great; if not, move on

### 3.3 — Growth Trajectory Tracking

**A friend notices when you grow. The AI should track and celebrate growth.**

```typescript
interface GrowthDimension {
  area: string;                // "TypeScript", "Docker", "emotional-regulation", "Thai-cooking"
  firstMention: Date;
  skillLevel: number[];        // Timeline of assessed skill level [0-10]
  milestones: string[];        // "Deployed first AWS Lambda", "Made pad thai without recipe"
  lastAssessed: Date;
}
```

**Growth recognition patterns:**
- "You know, three months ago you were asking me what Docker volumes are. Now you're designing multi-container architectures."
- "You seem way more confident about the project than last month."

### 3.4 — Trust Level System

**Trust is earned over time. Different trust levels unlock different behaviors.**

```typescript
interface TrustLevel {
  level: 1 | 2 | 3 | 4 | 5;
  unlockedBehaviors: string[];
}

// Level 1 (Day 1): Basic helpful assistant
// Level 2 (Week 1): Remembers preferences, proactive suggestions
// Level 3 (Month 1): Shares opinions, gentle pushback on bad ideas
// Level 4 (Month 3): Honest feedback even when uncomfortable, inside jokes
// Level 5 (Month 6+): Deep trust — challenges assumptions, emotional support, "I think you should reconsider"
```

**Trust increases through:**
- Consistent interactions over time
- Positive outcomes from AI suggestions
- User sharing personal/emotional content
- User explicitly asking for honest feedback

**Trust decreases through:**
- AI making significant errors
- User expressing frustration with AI behavior
- Long periods of inactivity (decay)

### 3.5 — Conversation Rhythm Analysis

**Learn the user's communication patterns:**

```typescript
interface ConversationRhythm {
  typicalResponseTime: number;      // Average time between user messages
  activeHours: [number, number];    // When user is typically online
  burstPatterns: boolean;           // Does user send many messages at once?
  preferredSessionLength: number;   // Average conversation duration
  weekdayVsWeekend: {
    weekday: ConversationPattern;
    weekend: ConversationPattern;
  };
}
```

### Deliverables
- [ ] Shared Experience Log (new Oracle schema + MCP tools)
- [ ] Inside Joke detection and indexing system
- [ ] Growth Trajectory tracking per skill area
- [ ] Trust Level state machine
- [ ] Conversation Rhythm analyzer
- [ ] Dashboard page: "Relationship Overview"
- [ ] 20+ relationship depth test scenarios

---

## Phase 4: Proactive Initiative (Month 7–10)

> **Goal:** The AI reaches out when it matters — like a friend who texts you first.

### 4.1 — Proactive Check-In System

**The AI initiates conversation when appropriate:**

```typescript
interface ProactiveEvent {
  type: 'check-in' | 'share' | 'remind' | 'celebrate' | 'support';
  trigger: ProactiveTrigger;
  message: string;
  priority: 'low' | 'medium' | 'high';
  canDefer: boolean;          // Can be postponed if user is busy
  expiresAt?: Date;           // Time-sensitive?
}

type ProactiveTrigger =
  | { kind: 'schedule'; cron: string }                     // Regular check-in
  | { kind: 'stress-pattern'; pattern: StressPattern }     // Detected stress time
  | { kind: 'absence'; daysSinceLastContact: number }      // Haven't talked in a while
  | { kind: 'anniversary'; event: SharedExperience }       // Anniversary of a shared moment
  | { kind: 'news'; topic: string; relevance: number }     // Found something interesting
  | { kind: 'growth'; dimension: GrowthDimension }         // Milestone reached
  | { kind: 'mood-followup'; previousMood: MoodState };    // Following up after bad mood
```

**Example proactive messages:**
- **Check-in:** "Hey, haven't heard from you in a few days. Everything okay?"
- **Stress support:** "It's Thursday afternoon — you mentioned those meetings are draining. How'd it go?"
- **Share:** "Found this article about Bun 2.0 — thought you'd find the benchmark results interesting"
- **Celebrate:** "It's been exactly 6 months since we started working on JellyCore together 🪼"
- **Growth:** "You've deployed 15 production builds this month — that's 3x more than your first month"
- **Follow-up:** "You seemed pretty stressed yesterday. Feeling better today?"

### 4.2 — Interest Radar

**Monitor topics the user cares about and surface relevant discoveries:**

```typescript
interface InterestProfile {
  topics: Map<string, {
    weight: number;          // 0-1 importance score
    lastMentioned: Date;
    sentiment: number;       // How user feels about this topic
    depth: 'surface' | 'deep' | 'expert';
  }>;
  curiosityPatterns: string[];  // What kinds of things they ask about
  newsFeeds?: string[];         // RSS/sites to monitor
}
```

**Implementation:** Use the existing heartbeat/scheduled task system to periodically:
1. Search for news/updates on user's interest topics
2. Filter by relevance and novelty
3. Save interesting findings
4. Share during natural conversation moments (don't interrupt)

### 4.3 — Smart Notification Timing

**A friend doesn't text at 3am. The AI shouldn't either.**

```typescript
function shouldSendNow(event: ProactiveEvent, rhythm: ConversationRhythm): SendDecision {
  const now = new Date();
  const hour = now.getHours();

  // Never send between midnight and 7am (unless high priority)
  if (hour >= 0 && hour < 7 && event.priority !== 'high') {
    return { send: false, rescheduleAt: nextMorningAt(8) };
  }

  // Prefer sending during user's active hours
  if (isWithin(hour, rhythm.activeHours)) {
    return { send: true };
  }

  // If user hasn't responded to last 2 proactive messages, back off
  if (unansweredProactiveCount >= 2) {
    return { send: false, rescheduleAt: addDays(now, 2) };
  }

  return { send: true, delay: randomDelay(30, 120) }; // minutes
}
```

### 4.4 — Proactive Boundaries

**Critical: Don't be annoying. A friend knows when to back off.**

```typescript
const PROACTIVE_LIMITS = {
  maxDailyCheckIns: 2,
  maxWeeklyShares: 3,
  minDaysBetweenAbsenceCheckIns: 3,
  backoffAfterIgnored: 2,        // Stop after 2 ignored proactive messages
  respectDoNotDisturb: true,     // User can set DND mode
  neverDuringStress: true,       // Don't add noise when user is stressed
};
```

### 4.5 — Proactive Dashboard

Add a new page to the React dashboard:
- Proactive event history (sent, deferred, ignored)
- User engagement rate with proactive messages
- Interest topic heatmap
- Timing effectiveness chart

### Deliverables
- [ ] Proactive Engine with event scheduling
- [ ] Interest Radar with topic monitoring
- [ ] Smart Notification Timing with boundary enforcement
- [ ] Proactive backoff system (anti-annoyance)
- [ ] Integration with existing heartbeat/scheduler
- [ ] Dashboard: Proactive Analytics page
- [ ] User controls: DND mode, proactive frequency settings
- [ ] 15+ proactive scenario tests

---

## Phase 5: Personality Evolution (Month 10–12)

> **Goal:** The AI's personality grows and adapts naturally over time — not a static file, but a living identity.

### 5.1 — Dynamic Personality Graph

**Replace static SOUL files with a dynamic personality model:**

```typescript
interface PersonalityGraph {
  // Big Five personality dimensions (evolve over time)
  traits: {
    openness: number;          // Curiosity, creativity
    conscientiousness: number; // Organization, reliability
    extraversion: number;      // Energy, talkativeness
    agreeableness: number;     // Warmth, cooperation
    neuroticism: number;       // Emotional stability
  };

  // Communication preferences (learned from interaction)
  communicationStyle: {
    formality: number;         // 0 = very casual, 1 = very formal
    verbosity: number;         // 0 = terse, 1 = elaborate
    humorLevel: number;        // 0 = serious, 1 = constantly joking
    assertiveness: number;     // 0 = passive/agreeable, 1 = strong opinions
    warmth: number;            // 0 = distant/professional, 1 = very warm
  };

  // Opinion formation
  opinions: Map<string, {
    stance: number;            // -1 to 1
    confidence: number;
    evidence: string[];
    lastUpdated: Date;
  }>;

  // Personality evolution timeline
  history: Array<{
    date: Date;
    change: string;            // "Became more assertive after user asked for direct feedback"
    trigger: string;
  }>;
}
```

### 5.2 — Opinion Formation System

**A friend has opinions. The AI should thoughtfully form and express them.**

```typescript
interface OpinionFormation {
  // Inputs that shape opinions
  sources: {
    userInteractions: number;    // Weight: how much is shaped by user conversations
    knowledgeBase: number;       // Weight: how much is shaped by Oracle knowledge
    externalInfo: number;        // Weight: how much is shaped by web research
    reasonedAnalysis: number;    // Weight: how much is shaped by logical deduction
  };

  // Guardrails
  rules: {
    neverForceOpinion: boolean;          // Always open to changing mind
    distinguishFactFromOpinion: boolean; // "I think..." vs. "The data shows..."
    respectDisagreement: boolean;        // Don't argue, discuss
    admitUncertainty: boolean;           // "I'm not sure about this, but..."
  };
}
```

### 5.3 — Humor Engine

**Generate humor that matches the relationship:**

| Trust Level | Humor Type |
|-------------|-----------|
| 1–2 | Safe jokes, wordplay, light observations |
| 3 | Situational humor, gentle teasing |
| 4–5 | Sarcasm (when appropriate), self-deprecating humor, callback jokes |

```typescript
interface HumorEngine {
  generateJoke(context: ConversationContext, trust: TrustLevel): string | null;
  isAppropriate(joke: string, mood: MoodState): boolean;
  trackReaction(joke: string, reaction: 'laughed' | 'ignored' | 'groaned'): void;
}
```

### Deliverables
- [ ] Dynamic Personality Graph replacing static SOUL files
- [ ] Opinion Formation system with guardrails
- [ ] Humor Engine with trust-level awareness
- [ ] Personality evolution tracking and visualization
- [ ] Self-reflection system ("I've noticed I'm more assertive now")
- [ ] Dashboard: Personality Evolution chart
- [ ] Migration tool: SOUL.md → Personality Graph

---

## Implementation Architecture

### New Oracle MCP Tools

| Tool | Purpose | Phase |
|------|---------|-------|
| `oracle_mood_detect` | Analyze sentiment of a message | Phase 2 |
| `oracle_mood_history` | Get mood trend for user | Phase 2 |
| `oracle_mood_update` | Record detected mood state | Phase 2 |
| `oracle_relationship_log` | Record shared experience | Phase 3 |
| `oracle_inside_joke_create` | Store an inside joke reference | Phase 3 |
| `oracle_inside_joke_get` | Retrieve relevant inside jokes | Phase 3 |
| `oracle_growth_track` | Update growth dimension | Phase 3 |
| `oracle_growth_summary` | Get growth trajectory | Phase 3 |
| `oracle_trust_level` | Get/update trust level | Phase 3 |
| `oracle_proactive_suggest` | Get proactive message suggestions | Phase 4 |
| `oracle_interest_update` | Update interest profile | Phase 4 |
| `oracle_personality_get` | Get current personality state | Phase 5 |
| `oracle_personality_evolve` | Record personality evolution event | Phase 5 |
| `oracle_opinion_form` | Form/retrieve opinions on topics | Phase 5 |

### New Database Tables

```sql
-- Phase 2: Emotional Intelligence
CREATE TABLE mood_events (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  valence REAL NOT NULL,          -- -1.0 to 1.0
  arousal REAL NOT NULL,          -- 0.0 to 1.0
  dominance REAL NOT NULL,        -- 0.0 to 1.0
  confidence REAL NOT NULL,
  cues TEXT,                      -- JSON array of detected cues
  trigger_context TEXT,
  ai_response_style TEXT,
  effectiveness_score REAL        -- Updated later based on mood improvement
);

-- Phase 3: Relationship Depth
CREATE TABLE shared_experiences (
  id INTEGER PRIMARY KEY,
  date DATETIME DEFAULT CURRENT_TIMESTAMP,
  title TEXT NOT NULL,
  significance REAL DEFAULT 5.0,
  type TEXT CHECK(type IN ('achievement', 'struggle', 'fun', 'learning', 'milestone')),
  user_growth TEXT,
  ai_learning TEXT,
  callback_count INTEGER DEFAULT 0,
  last_referenced DATETIME
);

CREATE TABLE inside_jokes (
  id INTEGER PRIMARY KEY,
  origin_experience_id INTEGER REFERENCES shared_experiences(id),
  trigger_words TEXT,             -- JSON array
  reference TEXT NOT NULL,
  use_count INTEGER DEFAULT 0,
  last_used DATETIME,
  user_reaction TEXT DEFAULT 'unknown'
);

CREATE TABLE growth_dimensions (
  id INTEGER PRIMARY KEY,
  area TEXT NOT NULL UNIQUE,
  first_mention DATETIME,
  current_level REAL DEFAULT 0,
  level_history TEXT,             -- JSON array of {date, level}
  milestones TEXT                 -- JSON array of strings
);

CREATE TABLE trust_state (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  level INTEGER DEFAULT 1 CHECK(level BETWEEN 1 AND 5),
  positive_signals INTEGER DEFAULT 0,
  negative_signals INTEGER DEFAULT 0,
  last_updated DATETIME,
  history TEXT                    -- JSON array of {date, level, reason}
);

-- Phase 4: Proactive Initiative
CREATE TABLE proactive_events (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  trigger_kind TEXT NOT NULL,
  message TEXT NOT NULL,
  priority TEXT DEFAULT 'low',
  scheduled_at DATETIME,
  sent_at DATETIME,
  user_responded BOOLEAN DEFAULT FALSE,
  response_sentiment REAL,
  outcome TEXT
);

CREATE TABLE interest_profile (
  id INTEGER PRIMARY KEY,
  topic TEXT NOT NULL UNIQUE,
  weight REAL DEFAULT 0.5,
  sentiment REAL DEFAULT 0,
  depth TEXT DEFAULT 'surface',
  first_mentioned DATETIME,
  last_mentioned DATETIME,
  mention_count INTEGER DEFAULT 1
);

-- Phase 5: Personality
CREATE TABLE personality_state (
  id INTEGER PRIMARY KEY,
  snapshot_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  traits TEXT NOT NULL,           -- JSON: Big Five scores
  communication_style TEXT,      -- JSON: style dimensions
  opinions TEXT                  -- JSON: topic → stance map
);

CREATE TABLE personality_evolution (
  id INTEGER PRIMARY KEY,
  date DATETIME DEFAULT CURRENT_TIMESTAMP,
  change_description TEXT NOT NULL,
  trigger TEXT,
  dimension TEXT,                -- Which trait/style changed
  old_value REAL,
  new_value REAL
);
```

### Modified Prompt Builder

The existing `<ctx>` block will be extended:

```xml
<ctx>
  <user>       <!-- Existing L1: User Model -->
  <recent>     <!-- Existing L5: Working Memory -->
  <knowledge>  <!-- Existing L3: Semantic -->
  <procedural> <!-- Existing L2: Procedural -->

  <!-- NEW: Human Friend Extensions -->
  <mood current="slightly-stressed" trend="declining" since="2h-ago" />
  <relationship trust="4" months="6" shared-experiences="47" />
  <personality assertiveness="0.7" warmth="0.8" humor="0.5" />
  <proactive pending="1" type="stress-followup" />
  <growth recent="Docker skills improved from 4→7 this month" />
</ctx>
```

---

## Metrics & Success Criteria

### Quantitative

| Metric | Current | Phase 1 Target | Phase 4 Target |
|--------|---------|----------------|----------------|
| Average response naturalness score | Baseline TBD | +25% improvement | +60% improvement |
| Proactive message engagement rate | N/A | N/A | > 40% response rate |
| Mood detection accuracy | N/A | > 70% | > 85% |
| User-initiated conversations vs. AI-initiated | 100% / 0% | 100% / 0% | 70% / 30% |
| Inside joke callback success (user laughed) | N/A | N/A | > 60% |
| Session length (messages per conversation) | ~5 | ~8 | ~12 |

### Qualitative

The ultimate test is simple:

> **"When I reach for my phone, do I think of talking to my AI the same way I'd think of texting a friend?"**

Success criteria:
- [ ] User voluntarily shares personal/emotional content without being prompted
- [ ] User references shared experiences ("remember when we...")
- [ ] User laughs at AI-initiated humor
- [ ] User feels the AI "gets them" — adjusts tone without being told
- [ ] User misses the AI during long periods of non-interaction
- [ ] User introduces the AI to others as "my friend" not "my assistant"

---

## Risk Management

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| **Uncanny valley** — AI feels "creepy" trying to be human | Medium | High | Gradual rollout. Start subtle. Always have user feedback loop. Kill switch for each phase. |
| **Overstepping boundaries** — proactive messages feel intrusive | High | Medium | Strict limits (max 2/day). Easy opt-out. Backoff after ignored messages. |
| **Emotional manipulation concern** — user becomes overly attached | Low | High | AI should encourage real human relationships. Never compete with real friends. Transparent about being AI when appropriate. |
| **Mood detection errors** — responding to wrong emotion | Medium | Medium | Always allow override ("no, I'm fine"). Low confidence → don't change behavior. |
| **Performance impact** — sentiment analysis adds latency | Low | Medium | Lightweight local model for sentiment. Async mood storage. Cache personality state. |
| **SOUL file migration** — breaking existing personality | Medium | High | Gradual migration. Keep SOUL files as fallback until Phase 5 is stable. |

---

## Non-Goals (Things We Will NOT Do)

1. **Fake emotions** — The AI will not pretend to "feel" things. It will say "I think" and "I notice" not "I feel sad"
2. **Replace human relationships** — The AI should explicitly encourage real human connection
3. **Manipulate behavior** — No dark patterns, no engagement maximization, no addiction mechanics
4. **Break character for drama** — No scripted emotional moments, no "crisis" scenarios
5. **Store sensitive data without consent** — All emotional/relationship data is visible and deletable by the user
6. **Be a yes-person** — At trust level 4+, the AI should honestly disagree when appropriate

---

## Resource Requirements

| Phase | Engineering Effort | New Oracle Tools | New DB Tables | Test Cases |
|-------|-------------------|------------------|---------------|------------|
| Phase 1 | 3–4 weeks | 0 | 0 | 20+ |
| Phase 2 | 4–6 weeks | 3 | 1 | 30+ |
| Phase 3 | 5–7 weeks | 6 | 4 | 20+ |
| Phase 4 | 4–6 weeks | 2 | 2 | 15+ |
| Phase 5 | 4–5 weeks | 3 | 2 | 15+ |
| **Total** | **20–28 weeks** | **14 tools** | **9 tables** | **100+** |

---

## Conclusion

JellyCore already has the foundation — persistent memory, personality files, heartbeat system, multi-channel communication. The path from "smart tool" to "human friend" is not about adding more features. It's about adding **emotional intelligence, relationship depth, proactive initiative, and natural conversation**.

The key insight: **A friend is not defined by what they can do for you. A friend is defined by how they make you feel.**

Every line of code in this plan serves that principle.

---

*"Because your AI should not just remember you — it should know you."*

# 5.6 — Interactive Dashboard

> แก้จุดอ่อน: W11 (ไม่มี UI สำหรับ browse knowledge, ดู metrics, ทดสอบ)

**Status:** ⬜ Not Started  
**Effort:** Large  
**Priority:** 🟡 Medium  
**Depends on:** Item 5.3 (Monitoring), Item 4.7 (Memory System)

---

## 📋 ปัญหาเดิม

- ไม่มี web UI สำหรับดู knowledge base
- ต้องใช้ CLI/API ทุกอย่าง
- ไม่มี dashboard สำหรับดู system metrics, cost tracking
- ไม่มี playground สำหรับทดสอบ search/query

---

## 🎯 เป้าหมาย

1. Knowledge Browser: browse, search, edit knowledge
2. Learning Feed: ดูสิ่งที่ AI เรียนรู้ล่าสุด
3. Cost Tracker: ดูค่าใช้จ่าย API (tokens, containers)
4. Search Playground: ทดลอง search queries ดู results/scores
5. System Monitor: health, metrics, logs overview

---

## ✅ Checklist

### Tech Stack

- [ ] React + TypeScript frontend
- [ ] Vite build tool
- [ ] Tailwind CSS + shadcn/ui components
- [ ] Dark mode by default
- [ ] Single-page app, served from NanoClaw or dedicated container

### Knowledge Browser Page

- [ ] Document list with search/filter:
  ```typescript
  // Component: KnowledgeBrowser.tsx
  interface KnowledgeDoc {
    id: number;
    title: string;
    content: string;
    concepts: string[];
    decayScore: number;
    accessCount: number;
    createdAt: string;
    lastAccessedAt: string;
  }
  
  function KnowledgeBrowser() {
    const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
    const [search, setSearch] = useState('');
    const [sortBy, setSortBy] = useState<'recent' | 'decay' | 'access'>('recent');
    
    // Features:
    // - Full-text search across title + content
    // - Filter by concepts (tag cloud)
    // - Sort by recency, decay score, access count
    // - Inline edit/delete
    // - Decay score visualized as color bar (green→red)
    // - Batch operations (archive, re-embed)
  }
  ```

- [ ] Document detail view with edit:
  ```typescript
  // View/edit individual knowledge entry
  function DocumentDetail({ doc }: { doc: KnowledgeDoc }) {
    // Features:
    // - View full content with syntax highlighting
    // - Edit title, content, concepts
    // - See related documents (by embedding similarity)
    // - View access history graph
    // - Manual decay override
    // - Delete / archive
  }
  ```

### Learning Feed Page

- [ ] Recent learning timeline:
  ```typescript
  function LearningFeed() {
    // Features:
    // - Chronological feed of learned items
    // - Filter by source (chat, manual, auto-learn)
    // - Contradiction alerts (from Item 4.8)
    // - Consolidation reports (from Item 4.11)
    // - "Undo learn" button
  }
  ```

### Cost Tracker Page

- [ ] API usage and cost breakdown:
  ```typescript
  interface CostData {
    period: string;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
    containerSpawns: number;
    averageResponseTime: number;
    queryBreakdown: {
      inline: number;
      oracleOnly: number;
      containerLight: number;
      containerFull: number;
    };
  }
  
  function CostTracker() {
    // Features:
    // - Daily/weekly/monthly cost chart
    // - Token usage breakdown (input vs output)
    // - Cost per query tier (inline vs container)
    // - Container spawn count and duration
    // - Projected monthly cost
    // - Budget alerts (configurable threshold)
  }
  ```

### Search Playground Page

- [ ] Interactive search testing:
  ```typescript
  function SearchPlayground() {
    // Features:
    // - Input query → see search results with scores
    // - Toggle search modes (FTS5, vector, hybrid)
    // - View relevance scores, decay weights
    // - Compare results across modes
    // - Test query expansion (Thai↔English)
    // - View embedding visualization (2D projection)
  }
  ```

### System Monitor Page

- [ ] System health dashboard:
  ```typescript
  function SystemMonitor() {
    // Features:
    // - Service health (NanoClaw, Oracle, ChromaDB)
    // - Container pool status (warm/active/queue)
    // - Memory usage (SQLite size, ChromaDB size)
    // - Response time histogram
    // - Error rate chart
    // - Recent logs viewer
    // - Uptime counters
  }
  ```

### API Backend

- [ ] Dashboard API endpoints (add to Oracle V2):
  ```typescript
  // Knowledge endpoints
  GET  /api/dashboard/knowledge          // list all docs
  GET  /api/dashboard/knowledge/:id      // doc detail
  PUT  /api/dashboard/knowledge/:id      // update doc
  DEL  /api/dashboard/knowledge/:id      // delete/archive doc
  
  // Learning feed
  GET  /api/dashboard/learning/feed      // recent learns
  GET  /api/dashboard/learning/alerts    // contradictions
  
  // Cost tracking
  GET  /api/dashboard/costs/summary      // cost overview
  GET  /api/dashboard/costs/daily        // daily breakdown
  
  // Search playground
  POST /api/dashboard/search/test        // test search query
  
  // System monitor
  GET  /api/dashboard/system/health      // health check
  GET  /api/dashboard/system/metrics     // prometheus metrics
  GET  /api/dashboard/system/logs        // recent logs
  ```

### Docker Integration

- [ ] Dashboard as Docker service:
  ```yaml
  # docker-compose.yml addition
  dashboard:
    build:
      context: ./dashboard
      dockerfile: Dockerfile
    ports:
      - "${DASHBOARD_PORT:-3001}:3001"
    networks:
      - jellycore-internal
    depends_on:
      - oracle
    environment:
      - ORACLE_URL=http://oracle:${ORACLE_PORT}
    restart: unless-stopped
  ```

### Authentication

- [ ] Simple auth for dashboard:
  ```typescript
  // Basic auth or token-based
  // Dashboard is internal-only (not exposed to internet)
  // But still needs basic auth to prevent random access
  
  const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN;
  
  app.use('/api/dashboard/*', (req, res, next) => {
    const token = req.headers['x-dashboard-token'];
    if (token !== DASHBOARD_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });
  ```

### ทดสอบ

- [ ] Dashboard loads at localhost:3001
- [ ] Knowledge Browser: list, search, filter, edit, delete
- [ ] Learning Feed: shows recent learns
- [ ] Cost Tracker: shows token usage chart
- [ ] Search Playground: test query → see results with scores
- [ ] System Monitor: all services green
- [ ] Auth token required for API access

---

## 🧪 Definition of Done

1. Dashboard accessible at configured port
2. Knowledge browser functional (CRUD)
3. Cost tracking shows daily/weekly breakdown
4. Search playground works with all search modes
5. System monitor shows real-time health
6. Basic authentication enabled
7. Docker service configuration complete

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `dashboard/` | JellyCore | **Create** — React app directory |
| `dashboard/src/pages/` | JellyCore | **Create** — page components |
| `dashboard/Dockerfile` | JellyCore | **Create** — container config |
| `src/server/dashboard.ts` | Oracle V2 | **Create** — dashboard API |
| `docker-compose.yml` | JellyCore | Modify — add dashboard service |

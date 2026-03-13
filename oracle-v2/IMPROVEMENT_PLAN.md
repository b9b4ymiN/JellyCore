# 🎯 Oracle-v2 Improvement Plan
## แผนการแก้ไขตามบทความ "จุดอ่อน Oracle-v2"

**วันที่จัดทำ**: 2026-01-15  
**ผู้รายงาน**: Codex (ฝน 🌧️)  
**สถานะ**: Draft v1.0  
**โปรเจค**: JellyCore / Oracle-v2

---

## 📊 สรุปภาพรวม

| จุดอ่อน | ความร้ายแรง | สถานะปัจจุบัน | ลำดับความสำคัญ |
|---------|-------------|---------------|----------------|
| 1. Indexing Latency | 🔴 Critical | ❌ ยังไม่แก้ | P0 (ทำก่อน) |
| 2. Conversation History | 🟡 Medium | ⚠️ มีบางส่วน | P1 |
| 3. Single Point of Failure | 🟡 Medium | ⚠️ มีความเสี่ยง | P2 |
| 4. Limited Scalability | 🟠 High | ⚠️ มีข้อจำกัด | P3 |
| 5. Knowledge Graph | 🟡 Medium | ❓ ต้องตรวจสอบ | P2 |
| 6. Confidence Scoring | 🟢 Low | ⚠️ มีแล้ว (confidence field) | P3 |
| 7. Context Window (ไม่มีในรายงาน) | - | - | - |
| 8. Manual Schema | 🟢 Low | ⚠️ ยัง manual | P4 |
| 9. Forgetting Mechanism | ✅ Done | ✅ มี decay.ts แล้ว | ✅ เสร็จแล้ว |
| 10. Embedding Model | 🟢 Low | ✅ ยอมรับได้ | P5 |

---

## 🔥 Priority 0: Indexing Latency และ Real-time Updates

### 🎯 เป้าหมาย
ทำให้ข้อมูลที่เพิ่งเรียนรู้ค้นหาได้ทันที ภายใน 2-5 วินาที แทนที่จะต้องรอ manual reindex

### 📋 ปัญหาปัจจุบัน
```typescript
// ตอนนี้: oracle_learn เขียนไฟล์ แต่ไม่ index ทันที
await oracle_learn({ pattern: "..." })  // เขียนไฟล์ .md
// → ข้อมูลค้นหาไม่เจอจนกว่าจะรัน: bun run reindex:thai-nlp

await oracle_search({ query: "..." })   // ❌ หาไม่เจอ!
```

### ✅ โซลูชัน: Incremental Indexing System

#### Phase 1: File Watcher (Real-time)
```typescript
// ไฟล์ใหม่: src/file-watcher.ts

import { watch } from 'fs';
import { OracleIndexer } from './indexer.js';

export class FileWatcher {
  private watcher: FSWatcher;
  private indexer: OracleIndexer;
  private debounceTimer: NodeJS.Timeout | null = null;
  
  constructor(indexer: OracleIndexer) {
    this.indexer = indexer;
  }
  
  /**
   * Watch ψ/memory/* สำหรับการเปลี่ยนแปลง
   */
  start(memoryRoot: string): void {
    this.watcher = watch(memoryRoot, { recursive: true }, (eventType, filename) => {
      if (!filename || !filename.endsWith('.md')) return;
      
      // Debounce: รอ 2 วินาที หลังจากไฟล์เปลี่ยนแปลง
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      
      this.debounceTimer = setTimeout(async () => {
        console.log(`[FileWatcher] Detected change: ${filename}`);
        await this.indexSingleFile(filename);
      }, 2000);
    });
    
    console.log(`[FileWatcher] Watching ${memoryRoot}`);
  }
  
  /**
   * Index ไฟล์เดียวโดยไม่ต้อง reindex ทั้งหมด
   */
  private async indexSingleFile(filePath: string): Promise<void> {
    try {
      await this.indexer.indexSingleFile(filePath);
      console.log(`[FileWatcher] ✅ Indexed: ${filePath}`);
    } catch (error) {
      console.error(`[FileWatcher] ❌ Failed to index ${filePath}:`, error);
    }
  }
  
  stop(): void {
    if (this.watcher) this.watcher.close();
  }
}
```

#### Phase 2: Modify Indexer (Incremental Mode)
```typescript
// แก้ไข: src/indexer.ts

export class OracleIndexer {
  // ... existing code ...
  
  /**
   * Index ไฟล์เดียว (incremental update)
   */
  async indexSingleFile(filePath: string): Promise<void> {
    const fullPath = path.join(this.config.repoRoot, filePath);
    
    // 1. Parse markdown
    const doc = await this.parseMarkdownFile(fullPath);
    if (!doc) return;
    
    // 2. Update SQLite
    await this.upsertDocument(doc);
    
    // 3. Update FTS5
    await this.updateFTS(doc);
    
    // 4. Update ChromaDB vectors
    await this.updateVectors(doc);
    
    // 5. Invalidate cache
    this.invalidateCache(doc.id);
  }
  
  /**
   * Upsert document (insert or update)
   */
  private async upsertDocument(doc: OracleDocument): Promise<void> {
    const existing = await this.db
      .select()
      .from(oracleDocuments)
      .where(eq(oracleDocuments.id, doc.id))
      .limit(1);
    
    if (existing.length > 0) {
      // Update existing
      await this.db
        .update(oracleDocuments)
        .set({
          ...doc,
          updatedAt: Date.now(),
          indexedAt: Date.now(),
        })
        .where(eq(oracleDocuments.id, doc.id));
    } else {
      // Insert new
      await this.db.insert(oracleDocuments).values(doc);
    }
  }
  
  /**
   * Update FTS5 index
   */
  private async updateFTS(doc: OracleDocument): Promise<void> {
    // Delete old FTS entry
    this.sqlite.run(`DELETE FROM oracle_fts WHERE id = ?`, [doc.id]);
    
    // Insert new FTS entry
    this.sqlite.run(
      `INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)`,
      [doc.id, doc.content, doc.concepts.join(' ')]
    );
  }
  
  /**
   * Update ChromaDB vectors
   */
  private async updateVectors(doc: OracleDocument): Promise<void> {
    if (!this.chromaClient) return;
    
    // Delete old vectors
    await this.chromaClient.delete({ ids: [doc.id] });
    
    // Add new vectors
    const chunks = this.chunker.chunk(doc.content, doc.id);
    await this.chromaClient.add({
      ids: chunks.map(c => c.id),
      documents: chunks.map(c => c.content),
      metadatas: chunks.map(c => c.metadata),
    });
  }
  
  /**
   * Invalidate search cache
   */
  private invalidateCache(docId: string): void {
    // Clear all search cache (simple approach)
    // TODO: เฉพาะ cache ที่เกี่ยวข้องกับ docId
    searchCache.clear();
  }
}
```

#### Phase 3: Integrate with Server
```typescript
// แก้ไข: src/server.ts

import { FileWatcher } from './file-watcher.js';

// Start file watcher
const indexer = new OracleIndexer({ ... });
const watcher = new FileWatcher(indexer);
watcher.start(path.join(config.repoRoot, 'ψ/memory'));

// Graceful shutdown
process.on('SIGTERM', () => {
  watcher.stop();
  process.exit(0);
});
```

### 🧪 การทดสอบ
```bash
# Test 1: Write → Search
curl -X POST http://localhost:47778/api/learn \
  -d '{"pattern": "Test incremental indexing"}' \
  -H "Content-Type: application/json"

sleep 3  # รอ 3 วินาที

curl "http://localhost:47778/api/search?q=incremental+indexing"
# Expected: ควรเจอข้อมูลที่เพิ่งเขียน
```

### 📈 KPI
- **Indexing latency**: < 5 วินาที (จาก manual reindex)
- **Search accuracy**: 100% (ค้นหาเจอข้อมูลที่เพิ่งเรียนรู้)
- **Resource usage**: < 10% CPU overhead

### 🔧 Implementation Steps
1. ✅ สร้าง `src/file-watcher.ts` (2 ชม.)
2. ✅ เพิ่ม `indexSingleFile()` ใน `indexer.ts` (3 ชม.)
3. ✅ Integrate กับ server startup (1 ชม.)
4. ✅ เขียน tests (2 ชม.)
5. ✅ ทดสอบ end-to-end (1 ชม.)

**รวม**: 9 ชั่วโมง

---

## 🔧 Priority 1: Conversation History Management

### 🎯 เป้าหมาย
เก็บ full conversation history ไม่ใช่แค่ summarized episodes

### 📋 ปัญหาปัจจุบัน
```typescript
// src/memory/episodic.ts
// ตอนนี้: เก็บแค่ summary ไม่เก็บ raw messages

await episodicStore.record({
  userId: "user123",
  summary: "User asked about stocks, AI recommended CAN SLIM",
  topics: ["stocks", "can-slim"],
  outcome: "success"
});

// ❌ ไม่เก็บ:
// - Raw user message: "แนะนำหุ้นหน่อย"
// - Raw AI response: "แนะนำ CAN SLIM strategy..."
// - Intermediate reasoning steps
```

### ✅ โซลูชัน: Full Conversation Storage

#### Schema Changes
```typescript
// เพิ่มใน src/db/schema.ts

export const conversationMessages = sqliteTable('conversation_messages', {
  id: text('id').primaryKey(),  // msg_{timestamp}_{random}
  conversationId: text('conversation_id').notNull(),  // conv_{groupId}_{sessionStart}
  userId: text('user_id').notNull(),
  groupId: text('group_id').notNull(),
  role: text('role').notNull(),  // 'user' | 'assistant' | 'system'
  content: text('content').notNull(),
  metadata: text('metadata'),  // JSON: { thinking, tools_used, etc. }
  createdAt: integer('created_at').notNull(),
  indexed: integer('indexed').default(0),  // 0=not indexed, 1=indexed
}, (table) => [
  index('idx_conv_id').on(table.conversationId),
  index('idx_user_id').on(table.userId),
  index('idx_group_id').on(table.groupId),
  index('idx_created_at').on(table.createdAt),
  index('idx_indexed').on(table.indexed),
]);

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  groupId: text('group_id').notNull(),
  title: text('title'),  // Auto-generated from first message
  summary: text('summary'),  // LLM-generated summary
  startedAt: integer('started_at').notNull(),
  lastMessageAt: integer('last_message_at').notNull(),
  messageCount: integer('message_count').default(0),
  isArchived: integer('is_archived').default(0),
}, (table) => [
  index('idx_conv_user').on(table.userId),
  index('idx_conv_group').on(table.groupId),
  index('idx_conv_started').on(table.startedAt),
]);
```

#### API Endpoints
```typescript
// เพิ่มใน src/server/routes/

// GET /api/conversations/:conversationId
// → ดึง full conversation with all messages

// GET /api/conversations?userId=xxx&limit=10
// → List recent conversations

// POST /api/conversations/:id/messages
// → Add message to conversation

// GET /api/conversations/:id/search?q=xxx
// → Search within conversation
```

### 🧪 การทดสอบ
```bash
# Test: Create conversation → Add messages → Search
curl -X POST http://localhost:47778/api/conversations \
  -d '{"userId": "user1", "groupId": "group1"}' \
  -H "Content-Type: application/json"

curl -X POST http://localhost:47778/api/conversations/conv_xxx/messages \
  -d '{"role": "user", "content": "แนะนำหุ้นหน่อย"}' \
  -H "Content-Type: application/json"

curl "http://localhost:47778/api/conversations/conv_xxx/search?q=หุ้น"
# Expected: ควรเจอข้อความที่พูดถึงหุ้น
```

### 📈 KPI
- **Storage**: เก็บ raw messages ทั้งหมด
- **Searchability**: ค้นหา within conversation ได้
- **Retention**: เก็บ 90 วัน (แล้ว archive เป็น summary)

### 🔧 Implementation Steps
1. ✅ เพิ่ม schema (1 ชม.)
2. ✅ Migration script (1 ชม.)
3. ✅ API endpoints (4 ชม.)
4. ✅ Integrate กับ nanoclaw (3 ชม.)
5. ✅ ทดสอบ (2 ชม.)

**รวม**: 11 ชั่วโมง

---

## 🛡️ Priority 2: Single Point of Failure

### 🎯 เป้าหมาย
ลด risk ของ data loss ด้วย automated backup

### 📋 ปัญหาปัจจุบัน
- SQLite: 1 ไฟล์ (`oracle.db`) ถ้าเสีย = เสียหมด
- ChromaDB: 1 volume ถ้าหาย = vector หาย
- ไม่มี automated backup

### ✅ โซลูชัน: Automated Backup System

#### Phase 1: Backup Service
```typescript
// ไฟล์ใหม่: src/backup.ts

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

export class BackupService {
  private config: {
    dbPath: string;
    backupDir: string;
    interval: number;  // ms
    retention: number;  // days
  };
  
  private timer: NodeJS.Timer | null = null;
  
  constructor(config: typeof this.config) {
    this.config = config;
  }
  
  /**
   * Start automated backup
   */
  start(): void {
    console.log(`[Backup] Starting automated backup every ${this.config.interval / 1000}s`);
    
    // Immediate backup on startup
    this.performBackup();
    
    // Scheduled backup
    this.timer = setInterval(() => {
      this.performBackup();
    }, this.config.interval);
  }
  
  /**
   * Perform SQLite backup
   */
  private async performBackup(): Promise<void> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = path.join(
        this.config.backupDir,
        `oracle-${timestamp}.db`
      );
      
      // SQLite backup using .backup command
      await execAsync(`sqlite3 ${this.config.dbPath} ".backup ${backupFile}"`);
      
      console.log(`[Backup] ✅ Created: ${backupFile}`);
      
      // Cleanup old backups
      await this.cleanupOldBackups();
      
    } catch (error) {
      console.error(`[Backup] ❌ Failed:`, error);
    }
  }
  
  /**
   * Delete backups older than retention period
   */
  private async cleanupOldBackups(): Promise<void> {
    const files = await fs.readdir(this.config.backupDir);
    const now = Date.now();
    const retentionMs = this.config.retention * 24 * 60 * 60 * 1000;
    
    for (const file of files) {
      if (!file.startsWith('oracle-') || !file.endsWith('.db')) continue;
      
      const filePath = path.join(this.config.backupDir, file);
      const stat = await fs.stat(filePath);
      
      if (now - stat.mtimeMs > retentionMs) {
        await fs.unlink(filePath);
        console.log(`[Backup] 🗑️  Deleted old backup: ${file}`);
      }
    }
  }
  
  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
```

#### Phase 2: Docker Volume Backup
```yaml
# docker-compose.yml - เพิ่ม backup service

services:
  # ... existing services ...
  
  backup:
    image: alpine:latest
    container_name: jellycore-backup
    restart: unless-stopped
    profiles: ["backup"]
    volumes:
      - oracle-data:/data/oracle:ro
      - chromadb-data:/data/chroma:ro
      - ./backups:/backups
    environment:
      - BACKUP_INTERVAL=${BACKUP_INTERVAL:-3600}  # 1 hour
      - BACKUP_RETENTION=${BACKUP_RETENTION:-7}   # 7 days
    command: |
      sh -c '
        while true; do
          echo "[Backup] Starting backup at $(date)"
          tar -czf /backups/oracle-$(date +%Y%m%d-%H%M%S).tar.gz -C /data/oracle .
          tar -czf /backups/chroma-$(date +%Y%m%d-%H%M%S).tar.gz -C /data/chroma .
          
          # Cleanup old backups
          find /backups -name "*.tar.gz" -mtime +${BACKUP_RETENTION} -delete
          
          echo "[Backup] Sleeping for ${BACKUP_INTERVAL}s"
          sleep ${BACKUP_INTERVAL}
        done
      '
```

#### Phase 3: Restore Script
```bash
#!/bin/bash
# scripts/restore-backup.sh

BACKUP_FILE=$1

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: ./restore-backup.sh <backup-file.tar.gz>"
  exit 1
fi

echo "⚠️  This will REPLACE current data with backup!"
read -p "Continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

# Stop services
docker compose down

# Restore backup
tar -xzf "$BACKUP_FILE" -C /path/to/volume

# Restart services
docker compose up -d

echo "✅ Restore complete!"
```

### 🧪 การทดสอบ
```bash
# Test backup creation
docker compose --profile backup up -d backup
sleep 10
ls -lh ./backups/
# Expected: เห็นไฟล์ backup

# Test restore
./scripts/restore-backup.sh ./backups/oracle-20260115-120000.tar.gz
```

### 📈 KPI
- **Backup frequency**: ทุก 1 ชั่วโมง (configurable)
- **Retention**: เก็บ 7 วัน
- **Recovery time**: < 5 นาที

### 🔧 Implementation Steps
1. ✅ สร้าง `src/backup.ts` (3 ชม.)
2. ✅ เพิ่ม backup service ใน docker-compose (1 ชม.)
3. ✅ สร้าง restore script (2 ชม.)
4. ✅ ทดสอบ backup/restore (2 ชม.)

**รวม**: 8 ชั่วโมง

---

## 📊 Priority 3: Scalability Improvements

### 🎯 เป้าหมาย
เตรียมระบบสำหรับ scale ขึ้น (100K+ documents)

### 📋 ปัญหาปัจจุบัน
- SQLite: เริ่มช้าเมื่อมี documents มาก
- ChromaDB: single instance ไม่ scale
- ไม่มี query optimization

### ✅ โซลูชัน: Query Optimization + Future Migration Path

#### Phase 1: Query Optimization
```typescript
// แก้ไข: src/server/handlers.ts

// เพิ่ม pagination
export async function handleSearch(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const query = url.searchParams.get('q') || '';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0');
  
  // Use LIMIT/OFFSET for pagination
  const results = await db
    .select()
    .from(oracleDocuments)
    .where(sql`...`)
    .limit(limit)
    .offset(offset);
  
  return Response.json({
    results,
    pagination: {
      limit,
      offset,
      hasMore: results.length === limit,
    },
  });
}

// เพิ่ม index hints
await db
  .select()
  .from(oracleDocuments)
  .where(and(
    eq(oracleDocuments.type, 'learning'),
    gt(oracleDocuments.decayScore, 50)
  ))
  // SQLite จะใช้ idx_type และ idx_decay_score
  .orderBy(desc(oracleDocuments.decayScore))
  .limit(10);
```

#### Phase 2: Caching Layer
```typescript
// ไฟล์ใหม่: src/query-cache.ts

import { LRUCache } from 'lru-cache';

export class QueryCache {
  private cache: LRUCache<string, any>;
  
  constructor() {
    this.cache = new LRUCache({
      max: 1000,  // 1000 queries
      ttl: 5 * 60 * 1000,  // 5 minutes
      updateAgeOnGet: true,
    });
  }
  
  get(key: string): any | undefined {
    return this.cache.get(key);
  }
  
  set(key: string, value: any): void {
    this.cache.set(key, value);
  }
  
  invalidate(pattern: string): void {
    // Invalidate all keys matching pattern
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }
}
```

#### Phase 3: Migration Path Documentation
```markdown
# docs/SCALING.md

## Migration Path: SQLite → PostgreSQL + pgvector

เมื่อไหร่ควร migrate:
- Documents > 500K
- Queries > 10K/day
- Need multi-region

ขั้นตอน:
1. Export SQLite → JSON
2. Import JSON → PostgreSQL
3. สร้าง pgvector extension
4. Re-embed vectors
5. Update drizzle config
6. Switch connection string

Estimated downtime: 2-4 hours (depends on data size)
```

### 🧪 การทดสอบ
```bash
# Load test
bun scripts/load-test.ts --queries=1000 --concurrent=10
# Expected: < 100ms avg response time

# Benchmark with 100K docs
bun scripts/benchmark.ts --docs=100000
```

### 📈 KPI
- **Query latency**: < 100ms (95th percentile)
- **Throughput**: > 100 queries/sec
- **Database size**: Support up to 500K documents

### 🔧 Implementation Steps
1. ✅ Pagination (2 ชม.)
2. ✅ Query cache (3 ชม.)
3. ✅ Index optimization (2 ชม.)
4. ✅ Load testing (2 ชม.)
5. ✅ Scaling docs (1 ชม.)

**รวม**: 10 ชั่วโมง

---

## 🕸️ Priority 4: Knowledge Graph Verification

### 🎯 เป้าหมาย
ตรวจสอบว่า "knowledge graph" ใน dashboard เป็น real graph หรือแค่ visualization

### 📋 ต้องตรวจสอบ
1. `frontend/src/pages/Dashboard.tsx` - มี graph visualization อะไร?
2. มี edge/relationship data หรือไม่?
3. มี graph query engine หรือไม่?

### ✅ โซลูชัน (ถ้าไม่มี): Simple Relationship Tracking

```typescript
// เพิ่มใน src/db/schema.ts

export const conceptRelationships = sqliteTable('concept_relationships', {
  id: text('id').primaryKey(),
  fromConcept: text('from_concept').notNull(),
  toConcept: text('to_concept').notNull(),
  relationshipType: text('relationship_type').notNull(),  // 'related_to' | 'part_of' | 'prerequisite'
  strength: integer('strength').default(1),  // จำนวนครั้งที่เจอร่วมกัน
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  index('idx_from').on(table.fromConcept),
  index('idx_to').on(table.toConcept),
  index('idx_type').on(table.relationshipType),
]);

// API: GET /api/graph/concepts/:concept/related
// → ดึง related concepts
```

### 🔧 Implementation Steps
1. ✅ ตรวจสอบ frontend code (1 ชม.)
2. ✅ ถ้าไม่มี: สร้าง relationship schema (2 ชม.)
3. ✅ Auto-extract relationships (4 ชม.)
4. ✅ Graph API endpoints (3 ชม.)

**รวม**: 10 ชั่วโมง (ถ้าต้องสร้างใหม่)

---

## 📝 Priority 5: Other Improvements

### Confidence Scoring (มีแล้ว)
- ✅ มี `confidence` field ใน schema (L41)
- ⚠️ ต้องใช้งานจริงใน search ranking

### Manual Schema / Auto-categorization
- ⚠️ ความสำคัญต่ำ - ปล่อยไว้ทีหลัง
- อาจใช้ LLM classify ได้

### Embedding Model
- ✅ all-MiniLM-L6-v2 ยอมรับได้สำหรับ general use
- 💡 Future: Fine-tune สำหรับ Thai + stock domain

---

## 📅 Timeline Summary

| Phase | Priority | Time | Cumulative |
|-------|----------|------|------------|
| P0: Incremental Indexing | Critical | 9h | 9h |
| P1: Conversation History | High | 11h | 20h |
| P2: Backup System | Medium | 8h | 28h |
| P3: Scalability | Medium | 10h | 38h |
| P4: Knowledge Graph | Medium | 10h | 48h |

**Total**: 48 ชั่วโมง (6 วันทำงาน @ 8h/day)

---

## 🚀 Getting Started

```bash
# 1. Review current code
cd C:\Programing\PersonalAI\jellycore\oracle-v2
bun run server  # ดูว่า server ทำงานปกติหรือไม่

# 2. Start with P0: Incremental Indexing
git checkout -b feature/incremental-indexing
# ... implement according to plan ...

# 3. Test
bun test
bun run index  # ทดสอบว่า indexer ยังทำงานปกติ

# 4. Deploy
docker compose up -d --build oracle
```

---

## 📚 References

- **บทความต้นฉบับ**: จุดอ่อน Oracle-v2 (10 ข้อ)
- **Current codebase**: `C:\Programing\PersonalAI\jellycore\oracle-v2`
- **Docker config**: `docker-compose.yml`
- **Schema**: `src/db/schema.ts`

---

## ✅ Next Steps

1. **Review plan**: ให้ทีมอ่านและ feedback
2. **Prioritize**: ยืนยันลำดับความสำคัญ
3. **Implement P0**: เริ่มจาก Incremental Indexing (ร้ายแรงที่สุด)
4. **Test thoroughly**: แต่ละ phase ต้องมี tests
5. **Document**: อัพเดท README และ docs

---

**Prepared by**: Codex (ฝน 🌧️) | **Date**: 2026-01-15

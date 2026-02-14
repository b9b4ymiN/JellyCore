# 4.11 — Memory Consolidation Service

> แก้จุดอ่อน: W8 (ข้อมูลไม่ถูก consolidate) — Background job จัดระเบียบ knowledge

**Status:** ⬜ Not Started  
**Effort:** Medium  
**Priority:** 🟡 Medium  
**Depends on:** Item 4.7 (Memory System), Item 4.8 (Knowledge Decay)

---

## 📋 ปัญหาเดิม

- Knowledge ถูกเก็บเป็น fragments จากหลาย conversations
- ไม่มีการ merge fragmented knowledge เป็น coherent facts
- Duplicate entries สะสมและกิน storage/search quality

---

## 🎯 เป้าหมาย

1. Daily consolidation: รวม knowledge fragments → coherent entries
2. Pattern extraction: สกัด recurring patterns เป็น procedural memory
3. Dead knowledge cleanup: ลบ/archive ข้อมูลที่ไม่มีคุณค่า

---

## ✅ Checklist

### Consolidation Pipeline

- [ ] สร้าง `src/consolidation/pipeline.ts`:
  ```typescript
  interface ConsolidationConfig {
    duplicateThreshold: number;  // 0.90 — similarity for duplicate detection
    mergeThreshold: number;      // 0.75 — similarity for merge candidates
    decayArchiveThreshold: number; // 0.05 — archive below this decay
    maxProcessPerRun: number;    // 500 — limit per consolidation run
    dryRun: boolean;             // true — preview without writing
  }
  
  const DEFAULT_CONFIG: ConsolidationConfig = {
    duplicateThreshold: 0.90,
    mergeThreshold: 0.75,
    decayArchiveThreshold: 0.05,
    maxProcessPerRun: 500,
    dryRun: false,
  };
  
  interface ConsolidationReport {
    startedAt: string;
    completedAt: string;
    documentsProcessed: number;
    duplicatesRemoved: number;
    fragmentsMerged: number;
    patternsExtracted: number;
    documentsArchived: number;
    errorsEncountered: number;
    details: ConsolidationAction[];
  }
  ```

- [ ] Duplicate detection cluster:
  ```typescript
  async function findDuplicateClusters(
    threshold: number
  ): Promise<DocumentCluster[]> {
    const allDocs = await db.all(`
      SELECT id, title, content, embedding, decay_score
      FROM documents WHERE archived = 0
      ORDER BY created_at DESC
    `);
    
    const clusters: DocumentCluster[] = [];
    const visited = new Set<number>();
    
    for (const doc of allDocs) {
      if (visited.has(doc.id)) continue;
      
      // Find similar documents via ChromaDB
      const similar = await chromadb.query({
        queryEmbeddings: [doc.embedding],
        nResults: 10,
        where: { archived: false },
      });
      
      const cluster = [doc];
      for (const match of similar.results) {
        if (match.distance < (1 - threshold) && !visited.has(match.id)) {
          cluster.push(match);
          visited.add(match.id);
        }
      }
      
      if (cluster.length > 1) {
        clusters.push({
          representative: cluster[0], // newest
          members: cluster.slice(1),
          avgSimilarity: average(similar.distances),
        });
      }
      visited.add(doc.id);
    }
    
    return clusters;
  }
  ```

- [ ] Merge strategy:
  ```typescript
  async function mergeCluster(cluster: DocumentCluster): Promise<void> {
    const representative = cluster.representative;
    
    // Combine unique content from all members
    const allContent = [representative.content, ...cluster.members.map(m => m.content)];
    const mergedContent = deduplicateContent(allContent);
    
    // Combine concepts (union)
    const allConcepts = new Set<string>();
    for (const member of [representative, ...cluster.members]) {
      for (const concept of member.concepts) {
        allConcepts.add(concept);
      }
    }
    
    // Update representative
    await db.run(`
      UPDATE documents 
      SET content = ?, concepts = ?, 
          access_count = ?, last_accessed_at = datetime('now'),
          merged_from = ?
      WHERE id = ?
    `, mergedContent, [...allConcepts].join(','),
       sumAccessCounts(cluster), 
       cluster.members.map(m => m.id).join(','),
       representative.id);
    
    // Re-embed with merged content
    await updateEmbedding(representative.id, mergedContent);
    
    // Archive merged members
    for (const member of cluster.members) {
      await archiveDocument(member.id, `merged_into:${representative.id}`);
    }
  }
  ```

### Pattern Extraction

- [ ] Extract procedural patterns from episodic memory:
  ```typescript
  async function extractPatterns(): Promise<Pattern[]> {
    // Find recurring question types
    const questionPatterns = await db.all(`
      SELECT 
        substr(question, 1, 50) as prefix,
        COUNT(*) as frequency,
        AVG(quality) as avgQuality
      FROM reflections
      GROUP BY prefix
      HAVING COUNT(*) >= 3
      ORDER BY frequency DESC
      LIMIT 20
    `);
    
    const patterns: Pattern[] = [];
    for (const qp of questionPatterns) {
      // Extract what works well for this type of question
      const bestResponses = await db.all(`
        SELECT answer_summary, quality, improvements
        FROM reflections
        WHERE question LIKE ? AND quality > 0.7
        ORDER BY quality DESC LIMIT 3
      `, qp.prefix + '%');
      
      if (bestResponses.length > 0) {
        patterns.push({
          trigger: qp.prefix,
          frequency: qp.frequency,
          recommendedApproach: summarizeApproach(bestResponses),
          avgQuality: qp.avgQuality,
        });
      }
    }
    
    return patterns;
  }
  ```

### Scheduling

- [ ] Cron schedule via Oracle:
  ```typescript
  // Run daily at 3 AM
  function scheduleConsolidation(): void {
    const DAILY_3AM = '0 3 * * *';
    
    cron.schedule(DAILY_3AM, async () => {
      console.log('[Consolidation] Starting daily run...');
      try {
        const report = await runConsolidation(DEFAULT_CONFIG);
        console.log('[Consolidation] Complete:', JSON.stringify(report));
        
        // Store report
        await db.run(`
          INSERT INTO consolidation_reports (report, created_at)
          VALUES (?, datetime('now'))
        `, JSON.stringify(report));
      } catch (error) {
        console.error('[Consolidation] Failed:', error);
      }
    });
  }
  ```

- [ ] Manual trigger endpoint:
  ```typescript
  // POST /api/consolidation/run
  app.post('/api/consolidation/run', async (req, res) => {
    const config = { ...DEFAULT_CONFIG, ...req.body, dryRun: req.body.dryRun ?? true };
    const report = await runConsolidation(config);
    res.json(report);
  });
  
  // GET /api/consolidation/reports
  app.get('/api/consolidation/reports', async (req, res) => {
    const reports = await db.all(`
      SELECT * FROM consolidation_reports 
      ORDER BY created_at DESC LIMIT 10
    `);
    res.json(reports);
  });
  ```

### ทดสอบ

- [ ] 3 documents about same topic → clustered together
- [ ] Merge cluster → representative updated, others archived
- [ ] Daily cron fires → report generated
- [ ] Manual trigger with dryRun=true → returns preview only
- [ ] Pattern extraction → recurring Q&A patterns identified
- [ ] Low-decay documents archived automatically

---

## 🧪 Definition of Done

1. Daily consolidation job runs at 3 AM
2. Duplicate clusters detected and merged
3. Archived documents excluded from search
4. Patterns extracted from reflection history
5. Consolidation reports stored and viewable
6. Manual trigger available for testing

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `src/consolidation/pipeline.ts` | Oracle V2 | **Create** — main pipeline |
| `src/consolidation/clusters.ts` | Oracle V2 | **Create** — duplicate detection |
| `src/consolidation/patterns.ts` | Oracle V2 | **Create** — pattern extraction |
| `src/consolidation/scheduler.ts` | Oracle V2 | **Create** — cron schedule |
| `src/server/handlers.ts` | Oracle V2 | Add consolidation endpoints |

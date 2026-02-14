# 4.8 — Knowledge Decay & Contradiction Detection

> แก้จุดอ่อน: W8 (ข้อมูลเก่าไม่เสื่อมค่า, ข้อมูลขัดแย้งไม่ถูกตรวจจับ)

**Status:** ⬜ Not Started  
**Effort:** Medium  
**Priority:** 🟠 High  
**Depends on:** Item 4.7 (Memory System)

---

## 📋 ปัญหาเดิม

- Knowledge ใน Oracle ถูกเก็บตลอดไปด้วย weight เท่ากัน
- ข้อมูลเก่าที่ล้าสมัยได้ relevance score สูงเท่าข้อมูลใหม่
- เมื่อ learn ข้อมูลที่ขัดแย้งกับข้อมูลเดิม → ทั้งสองถูกเก็บไว้ → AI สับสน

---

## 🎯 เป้าหมาย

1. Temporal decay: ข้อมูลที่ไม่ถูกเข้าถึง → relevance ค่อยๆ ลด
2. Contradiction detection: เมื่อ learn ใหม่ → ตรวจว่าขัดแย้งกับเดิมหรือไม่
3. Knowledge consolidation: รวมข้อมูลที่ซ้ำ, ลบ duplicates

---

## ✅ Checklist

### Temporal Decay System

- [ ] เพิ่ม columns ใน Oracle documents table:
  ```sql
  ALTER TABLE documents ADD COLUMN access_count INTEGER DEFAULT 0;
  ALTER TABLE documents ADD COLUMN last_accessed_at TEXT;
  ALTER TABLE documents ADD COLUMN decay_score REAL DEFAULT 1.0;
  ```

- [ ] สร้าง `src/decay.ts` ใน Oracle V2:
  ```typescript
  // Decay formula: score = base_score * 0.97^(days_since_access)
  // Accessed recently → score stays high
  // Not accessed for 30 days → score ≈ 0.40
  // Not accessed for 90 days → score ≈ 0.06
  
  function calculateDecay(lastAccessedAt: Date, accessCount: number): number {
    const daysSinceAccess = (Date.now() - lastAccessedAt.getTime()) / 86400000;
    const baseDecay = Math.pow(0.97, daysSinceAccess);
    const accessBoost = Math.min(accessCount / 100, 0.3); // max 0.3 boost
    return Math.min(baseDecay + accessBoost, 1.0);
  }
  
  // Track access when document is returned in search results
  async function trackAccess(documentId: number): Promise<void> {
    await db.run(`
      UPDATE documents 
      SET access_count = access_count + 1, 
          last_accessed_at = datetime('now')
      WHERE id = ?
    `, documentId);
  }
  ```

- [ ] Integrate decay into search ranking:
  ```typescript
  // Modify hybrid search to factor in decay
  function adjustedScore(result: SearchResult): number {
    const rawScore = result.score;
    const decay = result.decayScore || 1.0;
    return rawScore * decay;
  }
  ```

### Contradiction Detection

- [ ] สร้าง `src/contradiction.ts` ใน Oracle V2:
  ```typescript
  interface ContradictionCheck {
    hasContradiction: boolean;
    conflictingDocs: Array<{
      id: number;
      title: string;
      content: string;
      similarity: number;
    }>;
    recommendation: 'supersede' | 'keep_both' | 'ask_user';
  }

  async function checkContradiction(
    newContent: string,
    concepts: string[]
  ): Promise<ContradictionCheck> {
    // 1. Search for similar existing documents
    const similar = await hybridSearch(newContent, { limit: 10, mode: 'vector' });
    
    // 2. Filter high-similarity results (>0.80)
    const candidates = similar.filter(r => r.vectorScore > 0.80);
    
    if (candidates.length === 0) {
      return { hasContradiction: false, conflictingDocs: [], recommendation: 'keep_both' };
    }
    
    // 3. Check for semantic contradiction
    // Simple heuristic: same topic + different assertions
    const conflicts = [];
    for (const candidate of candidates) {
      const isContradictory = await detectContradiction(newContent, candidate.content);
      if (isContradictory) {
        conflicts.push({
          id: candidate.id,
          title: candidate.title,
          content: candidate.content,
          similarity: candidate.vectorScore,
        });
      }
    }
    
    if (conflicts.length > 0) {
      return {
        hasContradiction: true,
        conflictingDocs: conflicts,
        recommendation: 'ask_user', // default: ask user
      };
    }
    
    // High similarity but no contradiction → possible duplicate
    if (candidates[0].vectorScore > 0.90) {
      return {
        hasContradiction: false,
        conflictingDocs: candidates.slice(0, 1),
        recommendation: 'supersede', // likely update to existing doc
      };
    }
    
    return { hasContradiction: false, conflictingDocs: [], recommendation: 'keep_both' };
  }
  ```

- [ ] Integrate with learn endpoint:
  ```typescript
  // POST /api/learn — modified
  async function handleLearn(req: Request) {
    const { title, content, concepts } = req.body;
    
    // Check for contradictions first
    const check = await checkContradiction(content, concepts);
    
    if (check.hasContradiction) {
      return {
        status: 'contradiction_detected',
        conflicting: check.conflictingDocs,
        message: `ข้อมูลใหม่ขัดแย้งกับ "${check.conflictingDocs[0].title}" — ต้องการอัปเดตหรือเก็บทั้งสอง?`,
        actions: ['supersede', 'keep_both', 'cancel'],
      };
    }
    
    if (check.recommendation === 'supersede') {
      // Auto-supersede duplicate
      await supersede(check.conflictingDocs[0].id, { title, content, concepts });
      return { status: 'superseded', oldDoc: check.conflictingDocs[0].title };
    }
    
    // Normal learn
    await learn({ title, content, concepts });
    return { status: 'learned' };
  }
  ```

### Knowledge Consolidation (Background Job)

- [ ] สร้าง `src/consolidation.ts`:
  ```typescript
  // Run every 24 hours
  async function consolidateKnowledge(): Promise<ConsolidationReport> {
    const report = {
      duplicatesRemoved: 0,
      decayUpdated: 0,
      contradictionsFound: 0,
      merged: 0,
    };
    
    // 1. Update decay scores for all documents
    const docs = await getAllDocuments();
    for (const doc of docs) {
      const newDecay = calculateDecay(doc.lastAccessedAt, doc.accessCount);
      await updateDecayScore(doc.id, newDecay);
      report.decayUpdated++;
    }
    
    // 2. Find and merge duplicates (similarity > 0.90)
    const clusters = await findDuplicateClusters(0.90);
    for (const cluster of clusters) {
      await mergeCluster(cluster); // Keep newest, merge content
      report.duplicatesRemoved += cluster.length - 1;
      report.merged++;
    }
    
    // 3. Flag contradictions for review
    const contradictions = await findContradictions();
    report.contradictionsFound = contradictions.length;
    
    // 4. Archive low-decay documents (decay < 0.05)
    const archived = await archiveLowDecay(0.05);
    
    return report;
  }
  ```

- [ ] Schedule: Oracle background job หรือ cron ทุก 24 ชม.

### API Endpoints

- [ ] `POST /api/learn` → contradiction detection (modified)
- [ ] `GET /api/knowledge/contradictions` → list flagged contradictions
- [ ] `POST /api/knowledge/resolve` → resolve contradiction (supersede/keep_both)
- [ ] `POST /api/knowledge/consolidate` → trigger manual consolidation
- [ ] `GET /api/knowledge/decay-stats` → decay distribution

### ทดสอบ

- [ ] Learn "Docker ใช้ port 8080" → ไม่มี contradiction
- [ ] Learn "Docker ใช้ port 3000" → contradiction detected กับเดิม
- [ ] Resolve contradiction → supersede → old doc archived
- [ ] Document not accessed 30 days → decay score ≈ 0.40
- [ ] Document accessed daily → decay score ≈ 1.0
- [ ] Consolidation job → duplicates merged, report generated
- [ ] Search results factor in decay score

---

## 🧪 Definition of Done

1. Decay scores calculated and updated for all documents
2. Contradiction detection fires on learn/update
3. User notified of contradictions (via response or dashboard)
4. Consolidation job runs daily (duplicates, decay, merge)
5. Search results weighted by decay score
6. Low-decay documents archived automatically

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `src/decay.ts` | Oracle V2 | **Create** — decay calculation |
| `src/contradiction.ts` | Oracle V2 | **Create** — contradiction detection |
| `src/consolidation.ts` | Oracle V2 | **Create** — background consolidation |
| `src/server/handlers.ts` | Oracle V2 | Modify learn endpoint |
| `src/server/db.ts` | Oracle V2 | Add decay columns |

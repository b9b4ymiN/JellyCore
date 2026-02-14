# 4.6 — Enhanced RAG Pipeline

> แก้จุดอ่อน: W6 (RAG Pipeline ไม่สมบูรณ์) — ทำให้ AI ดึง knowledge ได้แม่นยำและอัจฉริยะขึ้น

**Status:** ⬜ Not Started  
**Effort:** Medium  
**Priority:** 🔴 High — Core Intelligence  
**Depends on:** Item 4.1 (Prompt Builder)

---

## 📋 ปัญหาเดิม

Prompt Builder (4.1) ทำ 3 Oracle queries แบบง่ายๆ:
- ไม่มี document chunking → เอกสารยาว return ทั้ง document ได้ผลลัพธ์ไม่ตรง
- ไม่มี re-ranking → top-5 อาจไม่ relevant ที่สุด
- ไม่มี context budget management → inject มากจนเกิน token limit
- ไม่มี source attribution → user ไม่รู้ว่า knowledge มาจากไหน

---

## 🎯 เป้าหมาย

RAG pipeline ที่ครบวงจร: Query Expansion → Hybrid Search → Re-rank → Context Budget → Source Citation

---

## ✅ Checklist

### Document Chunking (Oracle V2 Side)

- [ ] สร้าง `src/chunker.ts` ใน Oracle V2:
  ```typescript
  interface Chunk {
    id: string;
    documentId: number;
    content: string;
    tokenCount: number;
    chunkIndex: number;
    totalChunks: number;
    overlap: string; // first/last N tokens for continuity
  }

  function chunkDocument(content: string, options: ChunkOptions): Chunk[] {
    // Recursive text splitter
    // Target: 500-1000 tokens per chunk
    // Overlap: 100 tokens between chunks
    // Split on: paragraph → sentence → word boundaries
  }
  ```

- [ ] ปรับ Oracle indexer → chunk documents ก่อน store:
  ```typescript
  async function indexDocument(doc: Document): Promise<void> {
    const chunks = chunkDocument(doc.content, { maxTokens: 800, overlap: 100 });
    
    // Store chunks in SQLite FTS5
    for (const chunk of chunks) {
      await insertChunk(chunk);
    }
    
    // Store chunk embeddings in ChromaDB
    const embeddings = await embedChunks(chunks);
    await chromaClient.upsert({
      ids: chunks.map(c => c.id),
      embeddings,
      metadatas: chunks.map(c => ({
        documentId: c.documentId,
        chunkIndex: c.chunkIndex,
      })),
      documents: chunks.map(c => c.content),
    });
  }
  ```

- [ ] เพิ่ม SQLite table:
  ```sql
  CREATE TABLE document_chunks (
    id TEXT PRIMARY KEY,
    document_id INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    total_chunks INTEGER NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL,
    FOREIGN KEY (document_id) REFERENCES documents(id)
  );
  
  CREATE VIRTUAL TABLE chunks_fts USING fts5(content, content=document_chunks, content_rowid=rowid);
  ```

### Query Expansion

- [ ] สร้าง `src/query-expander.ts` ใน NanoClaw:
  ```typescript
  function expandQuery(query: string): string[] {
    const expansions: string[] = [query];
    
    // 1. Language expansion (Thai ↔ English)
    if (isThai(query)) {
      expansions.push(translateKeyTerms(query, 'en'));
    }
    
    // 2. Synonym expansion
    const keywords = extractKeywords(query);
    for (const kw of keywords) {
      expansions.push(...getSynonyms(kw));
    }
    
    // 3. Concept expansion via Oracle concepts
    const concepts = await oracleClient.getConcepts(keywords);
    expansions.push(...concepts.slice(0, 3));
    
    return [...new Set(expansions)].slice(0, 5); // max 5 queries
  }
  ```

### Hybrid Search + Re-ranking

- [ ] ปรับ Oracle search endpoint ให้รองรับ re-ranking:
  ```typescript
  // GET /api/search?q=...&rerank=true&topK=20
  
  async function hybridSearchWithRerank(query: string, options: SearchOptions) {
    // 1. FTS5 search → top-20
    const ftsResults = await fts5Search(query, { limit: 20 });
    
    // 2. ChromaDB vector search → top-20
    const vectorResults = await chromaSearch(query, { limit: 20 });
    
    // 3. Merge + deduplicate
    const merged = mergeResults(ftsResults, vectorResults);
    
    // 4. Re-rank using cross-score
    const reranked = reRank(merged, query);
    
    // 5. Return top-K
    return reranked.slice(0, options.limit || 5);
  }
  ```

- [ ] Implement re-ranking algorithm:
  ```typescript
  function reRank(results: SearchResult[], query: string): SearchResult[] {
    return results.map(r => ({
      ...r,
      rerankedScore: calculateRelevance(r, query),
    }))
    .sort((a, b) => b.rerankedScore - a.rerankedScore);
  }

  function calculateRelevance(result: SearchResult, query: string): number {
    const keywordScore = result.ftsScore || 0;     // 0-1
    const vectorScore = result.vectorScore || 0;    // 0-1
    const recencyBoost = getRecencyBoost(result.updatedAt); // 0-0.2
    const accessBoost = getAccessBoost(result.accessCount); // 0-0.1
    
    // Weighted combination
    return (keywordScore * 0.3) + (vectorScore * 0.4) + recencyBoost + accessBoost;
  }
  ```

### Context Budget Management

- [ ] สร้าง `src/context-budget.ts`:
  ```typescript
  const MAX_CONTEXT_TOKENS = 4000;

  function buildContextWithBudget(
    results: SearchResult[],
    budget: number = MAX_CONTEXT_TOKENS
  ): ContextPayload {
    let usedTokens = 0;
    const selectedDocs: ContextDoc[] = [];
    
    for (const result of results) {
      const docTokens = countTokens(result.content);
      
      if (usedTokens + docTokens > budget) {
        // Try to summarize if it's too long
        const summarized = summarizeToFit(result.content, budget - usedTokens);
        if (summarized) {
          selectedDocs.push({
            ...result,
            content: summarized,
            truncated: true,
          });
          usedTokens += countTokens(summarized);
        }
        break; // Budget exhausted
      }
      
      selectedDocs.push(result);
      usedTokens += docTokens;
    }
    
    return { docs: selectedDocs, usedTokens, totalBudget: budget };
  }
  ```

### Source Attribution

- [ ] ปรับ system prompt format:
  ```xml
  <oracle_context confidence="0.85" sources="3">
    <source id="1" title="Docker Deployment Guide" relevance="0.92" 
            updated="2026-02-10" type="semantic">
      Docker is a container platform that...
    </source>
    <source id="2" title="Previous Discussion" relevance="0.78"
            updated="2026-02-13" type="episodic">
      We discussed using Docker for...
    </source>
    <source id="3" title="User Preference" relevance="0.71"
            updated="2026-02-01" type="user_model">
      User prefers Docker Compose over manual...
    </source>
    
    <instruction>
      When using information from these sources, cite them naturally.
      Example: "จากที่เราเคยคุยกัน [source:2]..."
    </instruction>
  </oracle_context>
  ```

### ทดสอบ

- [ ] Long document chunked correctly (500-1000 tokens each)
- [ ] Thai query → expanded with English terms
- [ ] Search "Docker" → re-ranked results more relevant than raw
- [ ] Context budget: inject exactly ≤4000 tokens
- [ ] Source attribution visible in response
- [ ] Performance: full RAG pipeline <500ms

---

## 🧪 Definition of Done

1. Documents chunked during indexing (500-1000 tokens)
2. Query expansion supports Thai ↔ English
3. Hybrid search results re-ranked by relevance
4. Context budget enforced (≤4000 tokens)
5. Source attribution in system prompt
6. Full pipeline latency <500ms

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `src/chunker.ts` | Oracle V2 | **Create** — document chunking |
| `src/query-expander.ts` | NanoClaw | **Create** — query expansion |
| `src/context-budget.ts` | NanoClaw | **Create** — context budget |
| `src/server/handlers.ts` | Oracle V2 | Add re-ranking to search |
| `src/prompt-builder.ts` | NanoClaw | Integrate RAG pipeline |
| `src/indexer.ts` | Oracle V2 | Chunk documents on index |

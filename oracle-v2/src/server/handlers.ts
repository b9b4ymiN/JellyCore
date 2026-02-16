/**
 * Oracle v2 Core Request Handlers
 *
 * Partially migrated to Drizzle ORM. FTS5 operations remain as raw SQL
 * since Drizzle doesn't support virtual tables.
 */

import fs from 'fs';
import path from 'path';
import { eq, sql, or, inArray } from 'drizzle-orm';
import { db, sqlite, oracleDocuments, indexingStatus } from '../db/index.js';
import { REPO_ROOT } from './db.js';
import { logSearch, logDocumentAccess, logLearning, logConsult } from './logging.js';
import type { SearchResult, SearchResponse } from './types.js';
import { ChromaHttpClient } from '../chroma-http.js';
import { detectProject } from './project-detect.js';
import { searchCache, SearchCache } from '../cache.js';
import { getThaiNlpClient } from '../thai-nlp-client.js';
import { classifySearchQuery, applyQualityCorrection, type QueryProfile, type WeightedProfile } from '../query-classifier.js';
import { trackAccess, computeConfidence } from '../memory/decay.js';
import { intToFloat, floatToInt, type MemoryLayer } from '../types.js';
import { getUserModelStore } from '../memory/user-model.js';
import { getProceduralStore } from '../memory/procedural.js';
import { getEpisodicStore } from '../memory/episodic.js';

// Singleton ChromaDB HTTP client for vector search
let chromaClient: ChromaHttpClient | null = null;

function getChromaClient(): ChromaHttpClient {
  if (!chromaClient) {
    chromaClient = new ChromaHttpClient(
      'oracle_knowledge',
      process.env.CHROMA_URL || 'http://localhost:8000',
      process.env.CHROMA_AUTH_TOKEN,
    );
  }
  return chromaClient;
}

/**
 * Search Oracle knowledge base with hybrid search (FTS5 + Vector)
 * Uses ChromaDB HTTP client with token authentication
 */
export async function handleSearch(
  query: string,
  type: string = 'all',
  limit: number = 10,
  offset: number = 0,
  mode: 'hybrid' | 'fts' | 'vector' = 'hybrid',
  project?: string,  // If set: project + universal. If null/undefined: universal only
  cwd?: string,      // Auto-detect project from cwd if project not specified
  layerFilter?: string[] // v0.7.0: filter by memory layers (e.g., ['semantic', 'procedural'])
): Promise<SearchResponse & { mode?: string; warning?: string }> {
  // Auto-detect project from cwd if not explicitly specified
  const resolvedProject = project ?? detectProject(cwd);

  // Check cache first (include layer in cache key)
  const layerKey = layerFilter?.join(',') || '';
  const cacheKey = SearchCache.makeKey(query, mode, limit, type, resolvedProject ?? undefined) + (layerKey ? `:layer=${layerKey}` : '');
  const cached = searchCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const startTime = Date.now();

  // Phase 1: Classify query for adaptive search weights
  const queryProfile = classifySearchQuery(query);

  // Thai NLP preprocessing (graceful — falls back if sidecar is down)
  const thaiNlp = getThaiNlpClient();
  const { segmented } = await thaiNlp.preprocessQuery(query);

  // Remove FTS5 special characters: ? * + - ( ) ^ ~ " ' : (colon is column prefix)
  const safeQuery = segmented.replace(/[?*+\-()^~"':]/g, ' ').replace(/\s+/g, ' ').trim();

  let warning: string | undefined;

  // FTS5 search (skip if vector-only mode)
  let ftsResults: SearchResult[] = [];
  let ftsTotal = 0;

  // Project filter: if project specified, include project + universal (NULL)
  // If no project, only return universal (NULL)
  const projectFilter = resolvedProject
    ? '(d.project = ? OR d.project IS NULL)'
    : 'd.project IS NULL';
  const projectParams = resolvedProject ? [resolvedProject] : [];

  // v0.7.0: Layer filter — null treated as 'semantic' for legacy docs
  let layerFilterSql = '';
  let layerParams: string[] = [];
  if (layerFilter && layerFilter.length > 0) {
    const placeholders = layerFilter.map(() => '?').join(',');
    // Include NULL as 'semantic' when semantic is in the filter
    if (layerFilter.includes('semantic')) {
      layerFilterSql = ` AND (d.memory_layer IN (${placeholders}) OR d.memory_layer IS NULL)`;
    } else {
      layerFilterSql = ` AND d.memory_layer IN (${placeholders})`;
    }
    layerParams = [...layerFilter];
  }

  // FTS5 search must use raw SQL (Drizzle doesn't support virtual tables)
  if (mode !== 'vector') {
    if (type === 'all') {
      const countStmt = sqlite.prepare(`
        SELECT COUNT(*) as total
        FROM oracle_fts f
        JOIN oracle_documents d ON f.id = d.id
        WHERE oracle_fts MATCH ? AND ${projectFilter}${layerFilterSql}
      `);
      ftsTotal = (countStmt.get(safeQuery, ...projectParams, ...layerParams) as { total: number }).total;

      const stmt = sqlite.prepare(`
        SELECT f.id, f.content, d.type, d.source_file, d.concepts, d.project, d.created_at, d.memory_layer, rank as score
        FROM oracle_fts f
        JOIN oracle_documents d ON f.id = d.id
        WHERE oracle_fts MATCH ? AND ${projectFilter}${layerFilterSql}
        ORDER BY rank
        LIMIT ?
      `);
      ftsResults = stmt.all(safeQuery, ...projectParams, ...layerParams, limit * queryProfile.ftsCandidateMult).map((row: any) => ({
        id: row.id,
        type: row.type,
        content: row.content,
        source_file: row.source_file,
        concepts: JSON.parse(row.concepts || '[]'),
        project: row.project,
        createdAt: row.created_at || undefined,
        memoryLayer: row.memory_layer || null,
        source: 'fts' as const,
        score: normalizeRank(row.score)
      }));
    } else {
      const countStmt = sqlite.prepare(`
        SELECT COUNT(*) as total
        FROM oracle_fts f
        JOIN oracle_documents d ON f.id = d.id
        WHERE oracle_fts MATCH ? AND d.type = ? AND ${projectFilter}${layerFilterSql}
      `);
      ftsTotal = (countStmt.get(safeQuery, type, ...projectParams, ...layerParams) as { total: number }).total;

      const stmt = sqlite.prepare(`
        SELECT f.id, f.content, d.type, d.source_file, d.concepts, d.project, d.created_at, d.memory_layer, rank as score
        FROM oracle_fts f
        JOIN oracle_documents d ON f.id = d.id
        WHERE oracle_fts MATCH ? AND d.type = ? AND ${projectFilter}${layerFilterSql}
        ORDER BY rank
        LIMIT ?
      `);
      ftsResults = stmt.all(safeQuery, type, ...projectParams, ...layerParams, limit * queryProfile.ftsCandidateMult).map((row: any) => ({
        id: row.id,
        type: row.type,
        content: row.content,
        source_file: row.source_file,
        concepts: JSON.parse(row.concepts || '[]'),
        project: row.project,
        createdAt: row.created_at || undefined,
        memoryLayer: row.memory_layer || null,
        source: 'fts' as const,
        score: normalizeRank(row.score)
      }));
    }
  }

  // Vector search (skip if fts-only mode)
  let vectorResults: SearchResult[] = [];

  if (mode !== 'fts') {
    try {
      console.log(`[Hybrid] Starting vector search for: "${query.substring(0, 30)}..."`);
      const client = getChromaClient();
      const whereFilter = type !== 'all' ? { type } : undefined;
      const chromaResults = await client.query(query, limit * queryProfile.vectorCandidateMult, whereFilter);

      console.log(`[Hybrid] Vector returned ${chromaResults.ids?.length || 0} results`);
      console.log(`[Hybrid] First 3 distances: ${chromaResults.distances?.slice(0, 3)}`);

      if (chromaResults.ids && chromaResults.ids.length > 0) {
        // Get project metadata for vector results using Drizzle
        const rows = db.select({ id: oracleDocuments.id, project: oracleDocuments.project })
          .from(oracleDocuments)
          .where(inArray(oracleDocuments.id, chromaResults.ids))
          .all();
        const projectMap = new Map<string, string | null>();
        rows.forEach(r => projectMap.set(r.id, r.project));

        vectorResults = chromaResults.ids
          .map((id: string, i: number) => {
            // Cosine distance: 0=identical, 1=orthogonal, 2=opposite
            // Convert to similarity: 0.5=orthogonal, 1=identical, 0=opposite
            const distance = chromaResults.distances?.[i] || 1;
            const similarity = Math.max(0, 1 - distance / 2);
            const docProject = projectMap.get(id);
            return {
              id,
              type: chromaResults.metadatas?.[i]?.type || 'unknown',
              content: chromaResults.documents?.[i] || '',
              source_file: chromaResults.metadatas?.[i]?.source_file || '',
              concepts: [],
              project: docProject,
              source: 'vector' as const,
              score: similarity
            };
          })
          // Filter by project: include if project matches OR is universal (null)
          .filter(r => {
            if (!resolvedProject) {
              // No project filter: only return universal
              return r.project === null;
            }
            // With project: return project-specific + universal
            return r.project === resolvedProject || r.project === null;
          });
        console.log(`[Hybrid] Mapped ${vectorResults.length} vector results (after project filter), scores: ${vectorResults.slice(0, 3).map(r => r.score?.toFixed(3))}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[Vector Search Error]', msg);
      warning = `Vector search unavailable: ${msg}. Using FTS5 only.`;
    }
  }

  // Phase 1: Quality-based posterior weight correction
  const ftsScores = ftsResults.map(r => r.score ?? 0);
  const vectorScores = vectorResults.map(r => r.score ?? 0);
  const weightedProfile = applyQualityCorrection(queryProfile, ftsScores, vectorScores, limit);

  // Combine results using weighted hybrid ranking
  const ftsEndTime = Date.now();
  const combined = combineSearchResults(ftsResults, vectorResults, weightedProfile);
  const mergeEndTime = Date.now();
  const total = Math.max(ftsTotal, combined.length);

  // Apply pagination
  const results = combined.slice(offset, offset + limit);

  // Log search
  const searchTime = Date.now() - startTime;
  logSearch(query, type, mode, total, searchTime, results);
  results.forEach(r => logDocumentAccess(r.id, 'search'));

  // Track access for search results (fire-and-forget)
  trackAccess(results.map(r => r.id));

  const response = {
    results,
    total,
    offset,
    limit,
    mode,
    // Phase 1: Search intelligence metadata
    queryProfile: {
      type: weightedProfile.type,
      priorFtsBoost: weightedProfile.ftsBoost,
      priorVectorBoost: weightedProfile.vectorBoost,
      finalFtsWeight: weightedProfile.finalFtsWeight,
      finalVectorWeight: weightedProfile.finalVectorWeight,
      reason: weightedProfile.reason,
    },
    quality: {
      fts: weightedProfile.ftsQuality,
      vector: weightedProfile.vectorQuality,
    },
    candidates: {
      fts: ftsResults.length,
      vector: vectorResults.length,
      merged: combined.length,
    },
    timing: {
      totalMs: searchTime,
    },
    ...(warning && { warning })
  };

  // Cache the response
  searchCache.set(cacheKey, response);

  return response;
}

/**
 * Normalize FTS5 rank score to 0-1 range (higher = better)
 */
function normalizeRank(rank: number): number {
  // FTS5 rank is negative (more negative = better match)
  // Convert to positive 0-1 score
  return Math.min(1, Math.max(0, 1 / (1 + Math.abs(rank))));
}

/**
 * v0.7.0: Layer-based score boost
 *
 * Query type → preferred layers:
 *   exact query       → boost semantic (facts) = 1.0
 *   semantic (how-to) → boost procedural > semantic = 1.2
 *   semantic (recall) → boost episodic > semantic = 1.1
 *   user_model        → low boost (pulled from prompt builder, not search) = 0.5
 */
function getLayerBoost(layer: string | null, queryType?: string): number {
  if (!layer || layer === 'semantic') return 1.0;
  if (layer === 'procedural' && queryType === 'semantic') return 1.2;
  if (layer === 'episodic' && queryType === 'semantic') return 1.1;
  if (layer === 'procedural') return 1.1; // still slight boost for exact queries
  if (layer === 'episodic') return 1.0;
  if (layer === 'user_model') return 0.5; // retrieved via prompt builder, not ranked high in search
  return 1.0;
}

/**
 * Combine FTS and vector results using Reciprocal Rank Fusion (RRF)
 * with a recency boost.
 *
 * RRF formula: score(d) = 1/(k + rank_fts(d)) + 1/(k + rank_vector(d))
 * - k=60 (standard, Cormack et al. 2009)
 * - Documents in both lists naturally score higher
 * - No need to normalize scores across different retrieval systems
 *
 * Recency boost: +0.05 × max(0, 1 - days_old/365)
 * - New docs (<1 year) get a small boost (max 0.05)
 * - Old docs (>1 year) get no boost
 * - Small enough to not override relevance
 */
function combineSearchResults(
  fts: SearchResult[],
  vector: SearchResult[],
  profile?: WeightedProfile,
): SearchResult[] {
  const K = 60; // RRF constant
  const now = Date.now();
  const MS_PER_DAY = 86_400_000;
  const RECENCY_MAX_BOOST = 0.05;
  const RECENCY_WINDOW_DAYS = 365;

  // Use posterior-corrected weights if available, else equal weights
  const ftsWeight = profile?.finalFtsWeight ?? 0.5;
  const vectorWeight = profile?.finalVectorWeight ?? 0.5;

  // Build rank maps (1-indexed position in each result list)
  const ftsRank = new Map<string, number>();
  fts.forEach((r, i) => ftsRank.set(r.id, i + 1));

  const vectorRank = new Map<string, number>();
  vector.forEach((r, i) => vectorRank.set(r.id, i + 1));

  // Collect all unique documents, preferring FTS version (has full metadata)
  const docs = new Map<string, SearchResult>();
  for (const r of fts) docs.set(r.id, r);
  for (const r of vector) {
    if (!docs.has(r.id)) docs.set(r.id, r);
  }

  // Batch-fetch decay scores and memory layers from DB for all candidate docs
  const allIds = Array.from(docs.keys());
  const decayMap = new Map<string, number>();
  const layerMap = new Map<string, string | null>();
  if (allIds.length > 0) {
    try {
      const placeholders = allIds.map(() => '?').join(',');
      const rows = sqlite.prepare(
        `SELECT id, decay_score, memory_layer FROM oracle_documents WHERE id IN (${placeholders})`
      ).all(...allIds) as { id: string; decay_score: number | null; memory_layer: string | null }[];
      for (const row of rows) {
        // decay_score is stored as 0-100 integer, convert to 0.0-1.0
        decayMap.set(row.id, intToFloat(row.decay_score));
        layerMap.set(row.id, row.memory_layer);
      }
    } catch {
      // If fetch fails, all docs get 1.0 (no penalty)
    }
  }

  // Score each document with weighted RRF
  const scored: { result: SearchResult; score: number }[] = [];

  for (const [id, result] of docs) {
    let rrfScore = 0;
    const inFts = ftsRank.has(id);
    const inVector = vectorRank.has(id);

    // Weighted RRF: multiply each source's reciprocal rank by its posterior weight
    if (inFts) rrfScore += ftsWeight * (1 / (K + ftsRank.get(id)!));
    if (inVector) rrfScore += vectorWeight * (1 / (K + vectorRank.get(id)!));

    // Recency boost (only if createdAt is available)
    if (result.createdAt) {
      const daysOld = (now - result.createdAt) / MS_PER_DAY;
      const recency = Math.max(0, 1 - daysOld / RECENCY_WINDOW_DAYS);
      rrfScore += RECENCY_MAX_BOOST * recency;
    }

    // Apply decay factor from memory layer system (v0.7.0)
    // decay_score 1.0 = fresh (no penalty), 0.0 = stale (full penalty)
    const decayFactor = decayMap.get(id) ?? 1.0;
    rrfScore *= decayFactor;

    // v0.7.0: Layer-based score boosting
    const docLayer = layerMap.get(id) || (result as any).memoryLayer || null;
    rrfScore *= getLayerBoost(docLayer, profile?.type);

    // Tag source
    const source = inFts && inVector ? 'hybrid' as const
      : inFts ? 'fts' as const
      : 'vector' as const;

    scored.push({
      result: { ...result, source, score: rrfScore },
      score: rrfScore,
    });
  }

  // Sort by RRF score descending
  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.result);
}

/**
 * Synthesize guidance from principles and patterns
 */
export function synthesizeGuidance(decision: string, principles: any[], patterns: any[]): string {
  let guidance = 'Based on Oracle philosophy:\n\n';

  if (principles.length > 0) {
    guidance += 'Relevant Principles:\n';
    principles.forEach((p: any, i: number) => {
      guidance += `${i + 1}. ${p.content.substring(0, 150)}...\n`;
    });
    guidance += '\n';
  }

  if (patterns.length > 0) {
    guidance += 'Relevant Patterns:\n';
    patterns.forEach((p: any, i: number) => {
      guidance += `${i + 1}. ${p.content.substring(0, 150)}...\n`;
    });
  }

  if (principles.length === 0 && patterns.length === 0) {
    guidance += `No matching principles or patterns for: "${decision}"`;
  } else {
    guidance += '\nRemember: The Oracle Keeps the Human Human.';
  }

  return guidance;
}

/**
 * Get guidance on a decision (always hybrid: FTS + vector)
 */
export async function handleConsult(decision: string, context: string = '') {
  const query = context ? `${decision} ${context}` : decision;

  // Thai NLP preprocessing (graceful — falls back if sidecar is down)
  const thaiNlp = getThaiNlpClient();
  const { segmented } = await thaiNlp.preprocessQuery(query);

  // Remove FTS5 special characters: ? * + - ( ) ^ ~ " ' : (colon is column prefix)
  const safeQuery = segmented.replace(/[?*+\-()^~"':]/g, ' ').replace(/\s+/g, ' ').trim();

  // Run FTS search (must use raw SQL - Drizzle doesn't support FTS5)
  const principleStmt = sqlite.prepare(`
    SELECT f.id, f.content, d.source_file, rank as score
    FROM oracle_fts f
    JOIN oracle_documents d ON f.id = d.id
    WHERE oracle_fts MATCH ? AND d.type = 'principle'
    ORDER BY rank
    LIMIT 5
  `);
  const ftsPrinciples = principleStmt.all(safeQuery).map((row: any) => ({
    ...row,
    score: normalizeRank(row.score),
    source: 'fts' as const
  }));

  const learningStmt = sqlite.prepare(`
    SELECT f.id, f.content, d.source_file, rank as score
    FROM oracle_fts f
    JOIN oracle_documents d ON f.id = d.id
    WHERE oracle_fts MATCH ? AND d.type = 'learning'
    ORDER BY rank
    LIMIT 5
  `);
  const ftsPatterns = learningStmt.all(safeQuery).map((row: any) => ({
    ...row,
    score: normalizeRank(row.score),
    source: 'fts' as const
  }));

  // Run vector search (always, not just fallback)
  let vectorPrinciples: any[] = [];
  let vectorPatterns: any[] = [];

  try {
    const client = getChromaClient();
    console.log('[Consult] Hybrid search for:', query);

    const vectorResults = await client.query(query, 15);
    console.log('[Consult] Vector returned:', vectorResults.ids?.length || 0, 'results');

    if (vectorResults.ids?.length > 0) {
      for (let i = 0; i < vectorResults.ids.length; i++) {
        const docType = vectorResults.metadatas?.[i]?.type;
        const distance = vectorResults.distances?.[i] || 1;
        const similarity = Math.max(0, 1 - distance / 2);

        const doc = {
          id: vectorResults.ids[i],
          content: vectorResults.documents?.[i] || '',
          source_file: vectorResults.metadatas?.[i]?.source_file || '',
          score: similarity,
          source: 'vector' as const
        };

        if (docType === 'principle' && vectorPrinciples.length < 5) {
          vectorPrinciples.push(doc);
        } else if (docType === 'learning' && vectorPatterns.length < 5) {
          vectorPatterns.push(doc);
        }
      }
    }
  } catch (error) {
    console.error('[Consult Vector Search Error]', error);
  }

  // Merge FTS and vector results (dedupe by id, boost score if in both)
  const principlesRaw = mergeConsultResults(ftsPrinciples, vectorPrinciples, 3);
  const patternsRaw = mergeConsultResults(ftsPatterns, vectorPatterns, 3);

  console.log('[Consult] Final:', principlesRaw.length, 'principles,', patternsRaw.length, 'patterns');

  const guidance = synthesizeGuidance(decision, principlesRaw, patternsRaw);

  // Log the consultation with full details
  logConsult(decision, context, principlesRaw.length, patternsRaw.length, guidance, principlesRaw, patternsRaw);

  return {
    decision,
    principles: principlesRaw.map((p: any) => ({
      id: p.id,
      content: p.content.substring(0, 300),
      source_file: p.source_file,
      score: p.score,
      source: p.source
    })),
    patterns: patternsRaw.map((p: any) => ({
      id: p.id,
      content: p.content.substring(0, 300),
      source_file: p.source_file,
      score: p.score,
      source: p.source
    })),
    guidance
  };
}

/**
 * Merge FTS and vector results for consult (dedupe, boost, limit)
 */
function mergeConsultResults(fts: any[], vector: any[], limit: number): any[] {
  const seen = new Map<string, any>();

  // Add FTS results
  for (const r of fts) {
    seen.set(r.id, r);
  }

  // Merge vector results
  for (const r of vector) {
    if (seen.has(r.id)) {
      const existing = seen.get(r.id)!;
      // Boost for appearing in both
      const maxScore = Math.max(existing.score || 0, r.score || 0);
      seen.set(r.id, {
        ...existing,
        score: Math.min(1, maxScore + 0.1),
        source: 'hybrid'
      });
    } else {
      seen.set(r.id, r);
    }
  }

  // Sort by score and limit
  return Array.from(seen.values())
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, limit);
}

/**
 * Get random wisdom
 */
export function handleReflect() {
  // Get random document using Drizzle
  const randomDoc = db.select({
    id: oracleDocuments.id,
    type: oracleDocuments.type,
    sourceFile: oracleDocuments.sourceFile,
    concepts: oracleDocuments.concepts
  })
    .from(oracleDocuments)
    .where(or(
      eq(oracleDocuments.type, 'principle'),
      eq(oracleDocuments.type, 'learning')
    ))
    .orderBy(sql`RANDOM()`)
    .limit(1)
    .get();

  if (!randomDoc) {
    return { error: 'No documents found' };
  }

  // Get content from FTS (must use raw SQL)
  const content = sqlite.prepare(`
    SELECT content FROM oracle_fts WHERE id = ?
  `).get(randomDoc.id) as { content: string };

  return {
    id: randomDoc.id,
    type: randomDoc.type,
    content: content.content,
    source_file: randomDoc.sourceFile,
    concepts: JSON.parse(randomDoc.concepts || '[]')
  };
}

/**
 * List all documents (browse without search)
 * @param groupByFile - if true, dedupe by source_file (show one entry per file)
 *
 * Note: Uses raw SQL for FTS JOIN since Drizzle doesn't support virtual tables.
 * Count queries use Drizzle where possible.
 */
export function handleList(type: string = 'all', limit: number = 10, offset: number = 0, groupByFile: boolean = true): SearchResponse {
  // Validate
  if (limit < 1 || limit > 100) limit = 10;
  if (offset < 0) offset = 0;

  if (groupByFile) {
    // Group by source_file to avoid duplicate entries from same file
    if (type === 'all') {
      // Count distinct files using Drizzle
      const countResult = db.select({ total: sql<number>`count(distinct ${oracleDocuments.sourceFile})` })
        .from(oracleDocuments)
        .get();
      const total = countResult?.total || 0;

      // Need raw SQL for FTS JOIN with GROUP BY
      const stmt = sqlite.prepare(`
        SELECT d.id, d.type, d.source_file, d.concepts, d.project, MAX(d.indexed_at) as indexed_at, f.content
        FROM oracle_documents d
        JOIN oracle_fts f ON d.id = f.id
        GROUP BY d.source_file
        ORDER BY indexed_at DESC
        LIMIT ? OFFSET ?
      `);
      const results = stmt.all(limit, offset).map((row: any) => ({
        id: row.id,
        type: row.type,
        content: row.content || '',
        source_file: row.source_file,
        concepts: row.concepts ? JSON.parse(row.concepts) : [],
        project: row.project,
        indexed_at: row.indexed_at
      }));

      return { results, total, offset, limit };
    } else {
      // Count distinct files for type using Drizzle
      const countResult = db.select({ total: sql<number>`count(distinct ${oracleDocuments.sourceFile})` })
        .from(oracleDocuments)
        .where(eq(oracleDocuments.type, type))
        .get();
      const total = countResult?.total || 0;

      // Need raw SQL for FTS JOIN with GROUP BY
      const stmt = sqlite.prepare(`
        SELECT d.id, d.type, d.source_file, d.concepts, d.project, MAX(d.indexed_at) as indexed_at, f.content
        FROM oracle_documents d
        JOIN oracle_fts f ON d.id = f.id
        WHERE d.type = ?
        GROUP BY d.source_file
        ORDER BY indexed_at DESC
        LIMIT ? OFFSET ?
      `);
      const results = stmt.all(type, limit, offset).map((row: any) => ({
        id: row.id,
        type: row.type,
        content: row.content || '',
        source_file: row.source_file,
        concepts: JSON.parse(row.concepts || '[]'),
        project: row.project,
        indexed_at: row.indexed_at
      }));

      return { results, total, offset, limit };
    }
  }

  // Original behavior without grouping
  if (type === 'all') {
    // Count using Drizzle
    const countResult = db.select({ total: sql<number>`count(*)` })
      .from(oracleDocuments)
      .get();
    const total = countResult?.total || 0;

    // Need raw SQL for FTS JOIN
    const stmt = sqlite.prepare(`
      SELECT d.id, d.type, d.source_file, d.concepts, d.project, d.indexed_at, f.content
      FROM oracle_documents d
      JOIN oracle_fts f ON d.id = f.id
      ORDER BY d.indexed_at DESC
      LIMIT ? OFFSET ?
    `);
    const results = stmt.all(limit, offset).map((row: any) => ({
      id: row.id,
      type: row.type,
      content: row.content || '',
      source_file: row.source_file,
      concepts: row.concepts ? JSON.parse(row.concepts) : [],
      project: row.project,
      indexed_at: row.indexed_at
    }));

    return { results, total, offset, limit };
  } else {
    // Count using Drizzle
    const countResult = db.select({ total: sql<number>`count(*)` })
      .from(oracleDocuments)
      .where(eq(oracleDocuments.type, type))
      .get();
    const total = countResult?.total || 0;

    // Need raw SQL for FTS JOIN
    const stmt = sqlite.prepare(`
      SELECT d.id, d.type, d.source_file, d.concepts, d.project, d.indexed_at, f.content
      FROM oracle_documents d
      JOIN oracle_fts f ON d.id = f.id
      WHERE d.type = ?
      ORDER BY d.indexed_at DESC
      LIMIT ? OFFSET ?
    `);
    const results = stmt.all(type, limit, offset).map((row: any) => ({
      id: row.id,
      type: row.type,
      content: row.content,
      source_file: row.source_file,
      concepts: JSON.parse(row.concepts || '[]'),
      project: row.project,
      indexed_at: row.indexed_at
    }));

    return { results, total, offset, limit };
  }
}

/**
 * Get database statistics
 */
export function handleStats(dbPath: string) {
  // Total documents using Drizzle
  const totalDocsResult = db.select({ count: sql<number>`count(*)` })
    .from(oracleDocuments)
    .get();
  const totalDocs = totalDocsResult?.count || 0;

  // Count by type using Drizzle
  const byTypeResults = db.select({
    type: oracleDocuments.type,
    count: sql<number>`count(*)`
  })
    .from(oracleDocuments)
    .groupBy(oracleDocuments.type)
    .all();

  // Get last indexed timestamp using Drizzle
  const lastIndexedResult = db.select({ lastIndexed: sql<number | null>`max(${oracleDocuments.indexedAt})` })
    .from(oracleDocuments)
    .get();

  const lastIndexedDate = lastIndexedResult?.lastIndexed
    ? new Date(lastIndexedResult.lastIndexed).toISOString()
    : null;

  // Calculate age in hours
  const indexAgeHours = lastIndexedResult?.lastIndexed
    ? (Date.now() - lastIndexedResult.lastIndexed) / (1000 * 60 * 60)
    : null;

  // Get indexing status using Drizzle
  let idxStatus = { is_indexing: false, progress_current: 0, progress_total: 0, completed_at: null as number | null };
  try {
    const status = db.select({
      isIndexing: indexingStatus.isIndexing,
      progressCurrent: indexingStatus.progressCurrent,
      progressTotal: indexingStatus.progressTotal,
      completedAt: indexingStatus.completedAt
    })
      .from(indexingStatus)
      .where(eq(indexingStatus.id, 1))
      .get();

    if (status) {
      idxStatus = {
        is_indexing: status.isIndexing === 1,
        progress_current: status.progressCurrent || 0,
        progress_total: status.progressTotal || 0,
        completed_at: status.completedAt
      };
    }
  } catch (e) {
    // Table doesn't exist yet, use defaults
  }

  return {
    total: totalDocs,
    by_type: byTypeResults.reduce((acc, row) => ({ ...acc, [row.type]: row.count }), {}),
    last_indexed: lastIndexedDate,
    index_age_hours: indexAgeHours ? Math.round(indexAgeHours * 10) / 10 : null,
    is_stale: indexAgeHours ? indexAgeHours > 24 : true,
    is_indexing: idxStatus.is_indexing,
    indexing_progress: idxStatus.is_indexing ? {
      current: idxStatus.progress_current,
      total: idxStatus.progress_total,
      percent: idxStatus.progress_total > 0
        ? Math.round((idxStatus.progress_current / idxStatus.progress_total) * 100)
        : 0
    } : null,
    indexing_completed_at: idxStatus.completed_at,
    database: dbPath
  };
}

/**
 * Get knowledge graph data
 * Limited to principles + sample learnings to avoid O(n²) explosion
 */
export function handleGraph() {
  // Only get principles (always) + sample learnings (limited)
  // This keeps graph manageable: ~163 principles + ~100 learnings = ~263 nodes max

  // Get all principles using Drizzle
  const principles = db.select({
    id: oracleDocuments.id,
    type: oracleDocuments.type,
    sourceFile: oracleDocuments.sourceFile,
    concepts: oracleDocuments.concepts,
    project: oracleDocuments.project
  })
    .from(oracleDocuments)
    .where(eq(oracleDocuments.type, 'principle'))
    .all();

  // Get random learnings using Drizzle
  const learnings = db.select({
    id: oracleDocuments.id,
    type: oracleDocuments.type,
    sourceFile: oracleDocuments.sourceFile,
    concepts: oracleDocuments.concepts,
    project: oracleDocuments.project
  })
    .from(oracleDocuments)
    .where(eq(oracleDocuments.type, 'learning'))
    .orderBy(sql`RANDOM()`)
    .limit(100)
    .all();

  const docs = [...principles, ...learnings];

  // Build nodes
  const nodes = docs.map(doc => ({
    id: doc.id,
    type: doc.type,
    source_file: doc.sourceFile,
    project: doc.project,  // ghq-style path for cross-repo file access
    concepts: JSON.parse(doc.concepts || '[]')
  }));

  // Build links based on shared concepts
  const links: { source: string; target: string; weight: number }[] = [];
  const processed = new Set<string>();

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const nodeA = nodes[i];
      const nodeB = nodes[j];
      const key = `${nodeA.id}-${nodeB.id}`;

      if (processed.has(key)) continue;

      // Count shared concepts
      const conceptsA = new Set(nodeA.concepts);
      const sharedCount = nodeB.concepts.filter((c: string) => conceptsA.has(c)).length;

      if (sharedCount > 0) {
        links.push({
          source: nodeA.id,
          target: nodeB.id,
          weight: sharedCount
        });
        processed.add(key);
      }
    }
  }

  return { nodes, links };
}

/**
 * Add new pattern/learning to knowledge base
 * @param origin - 'mother' | 'arthur' | 'volt' | 'human' (null = universal)
 * @param project - ghq-style project path (null = universal)
 * @param cwd - Auto-detect project from cwd if project not specified
 * @param layer - Memory layer target (null = auto-detect, default semantic)
 */
export async function handleLearn(
  pattern: string,
  source?: string,
  concepts?: string[],
  origin?: string,
  project?: string,
  cwd?: string,
  layer?: MemoryLayer,
) {
  // v0.7.0: Determine memory layer (explicit > auto-detect > default 'semantic')
  const detectedLayer = layer || detectMemoryLayer(pattern, concepts);

  // Route to specialized stores for non-semantic layers
  if (detectedLayer === 'user_model') {
    const store = getUserModelStore();
    try {
      const parsed = JSON.parse(pattern);
      const userId = parsed.userId || 'default';
      delete parsed.userId;
      const model = await store.update(userId, parsed);
      return {
        success: true,
        file: null,
        id: `user_model_${userId}`,
        layer: 'user_model' as const,
        model,
      };
    } catch {
      // If not valid JSON, store as note in user model
      const store = getUserModelStore();
      const model = await store.update('default', { notes: [pattern] });
      return {
        success: true,
        file: null,
        id: 'user_model_default',
        layer: 'user_model' as const,
        model,
      };
    }
  }

  if (detectedLayer === 'procedural') {
    const store = getProceduralStore();
    // Try to parse as procedure
    const lines = pattern.split('\n').map(l => l.trim()).filter(Boolean);
    const trigger = lines[0];
    const procedure = lines.slice(1).map(l => l.replace(/^\d+\.\s*/, '').replace(/^[-*]\s*/, ''));
    const id = await store.learn({
      trigger,
      procedure: procedure.length > 0 ? procedure : [trigger],
      source: (source as 'correction' | 'repeated_pattern' | 'explicit') || 'explicit',
    });
    return {
      success: true,
      file: null,
      id,
      layer: 'procedural' as const,
    };
  }

  if (detectedLayer === 'episodic') {
    const store = getEpisodicStore();
    const id = await store.record({
      userId: origin || 'default',
      groupId: project || 'default',
      summary: pattern,
      topics: concepts || [],
      outcome: 'unknown',
      durationMs: 0,
    });
    return {
      success: true,
      file: null,
      id,
      layer: 'episodic' as const,
    };
  }

  // ================================================================
  // Default: Semantic layer (existing behavior, backward compatible)
  // ================================================================

  // Auto-detect project from cwd if not explicitly specified
  const resolvedProject = project ?? detectProject(cwd);
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD

  // Generate slug from pattern (first 50 chars, alphanumeric + dash)
  const slug = pattern
    .substring(0, 50)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const filename = `${dateStr}_${slug}.md`;
  const filePath = path.join(REPO_ROOT, 'ψ/memory/learnings', filename);

  // Check if file already exists
  if (fs.existsSync(filePath)) {
    throw new Error(`File already exists: ${filename}`);
  }

  // Generate title from pattern
  const title = pattern.split('\n')[0].substring(0, 80);

  // Create frontmatter
  const frontmatter = [
    '---',
    `title: ${title}`,
    concepts && concepts.length > 0 ? `tags: [${concepts.join(', ')}]` : 'tags: []',
    `created: ${dateStr}`,
    `source: ${source || 'Oracle Learn'}`,
    '---',
    '',
    `# ${title}`,
    '',
    pattern,
    '',
    '---',
    '*Added via Oracle Learn*',
    ''
  ].join('\n');

  // Write file
  fs.writeFileSync(filePath, frontmatter, 'utf-8');

  // Re-index the new file
  const content = frontmatter;
  const id = `learning_${dateStr}_${slug}`;
  const conceptsList = concepts || [];

  // Insert into database with provenance using Drizzle
  // v0.7.0: add confidence score + semantic layer
  const confidence = computeConfidence(origin, source);
  db.insert(oracleDocuments).values({
    id,
    type: 'learning',
    sourceFile: `ψ/memory/learnings/${filename}`,
    concepts: JSON.stringify(conceptsList),
    createdAt: now.getTime(),
    updatedAt: now.getTime(),
    indexedAt: now.getTime(),
    origin: origin || null,          // origin: null = universal/mother
    project: resolvedProject || null, // project: null = universal (auto-detected from cwd)
    createdBy: 'oracle_learn',
    memoryLayer: 'semantic',
    confidence: floatToInt(confidence),
    decayScore: 100,                  // starts fresh
  }).run();

  // Thai NLP: normalize + tokenize content for FTS5 (same engine as query time)
  const thaiNlp = getThaiNlpClient();
  const { segmented: segmentedContent } = await thaiNlp.normalizeAndTokenize(content);

  // Insert into FTS (must use raw SQL - Drizzle doesn't support virtual tables)
  // Uses segmented text so FTS5 MATCH works correctly for Thai
  sqlite.prepare(`
    INSERT INTO oracle_fts (id, content, concepts)
    VALUES (?, ?, ?)
  `).run(
    id,
    segmentedContent,
    conceptsList.join(' ')
  );

  // Index into ChromaDB for vector search (FTS5 alone misses semantic matches)
  try {
    const client = getChromaClient();
    await client.addDocuments([{
      id,
      document: content,
      metadata: {
        type: 'learning',
        source_file: `ψ/memory/learnings/${filename}`,
        concepts: conceptsList.join(', '),
      },
    }]);
  } catch (err) {
    // ChromaDB failure should not block learning — FTS5 still works
    console.warn('[oracle_learn] ChromaDB indexing failed (FTS5 still indexed):', err instanceof Error ? err.message : String(err));
  }

  // v0.7.0: Contradiction detection (basic)
  let warning: { type: string; existingId?: string; similarity?: number; message: string } | undefined;
  try {
    const contradiction = await searchForContradictions(pattern);
    if (contradiction) {
      warning = {
        type: 'potential_contradiction',
        existingId: contradiction.id,
        similarity: contradiction.score,
        message: `พบข้อมูลที่อาจขัดแย้ง (similarity=${contradiction.score.toFixed(2)})`,
      };
    }
  } catch {
    // Non-critical — don't fail the learn
  }

  // Log the learning
  logLearning(id, pattern, source || 'Oracle Learn', conceptsList);

  // Invalidate search cache (new content added)
  searchCache.invalidate();

  return {
    success: true,
    file: `ψ/memory/learnings/${filename}`,
    id,
    layer: 'semantic' as const,
    ...(warning && { warning }),
  };
}

/**
 * Auto-detect memory layer from content patterns
 * ถ้าไม่ระบุ layer → ใช้ heuristics เพื่อ route อัตโนมัติ
 */
function detectMemoryLayer(pattern: string, concepts?: string[]): MemoryLayer {
  // Check concepts first
  if (concepts?.some(c => c.startsWith('memory:user_model'))) return 'user_model';
  if (concepts?.some(c => c.startsWith('memory:procedural'))) return 'procedural';
  if (concepts?.some(c => c.startsWith('memory:episodic'))) return 'episodic';

  const lower = pattern.toLowerCase();

  // User Model signals
  if (/(?:user|ผู้ใช้)\s*(?:ชอบ|ไม่ชอบ|prefer|ต้องการ|expertise)/i.test(lower)) {
    return 'user_model';
  }

  // Procedural signals
  if (/(?:เมื่อ|when|ถ้า|if).*(?:→|ให้|then|ทำ|should)/i.test(lower)) {
    return 'procedural';
  }

  // Default
  return 'semantic';
}

/**
 * Search for potentially contradicting existing documents
 * High similarity (>0.85) but different content → potential contradiction
 */
async function searchForContradictions(newContent: string): Promise<{ id: string; score: number } | null> {
  try {
    const client = getChromaClient();
    const results = await client.query(newContent, 3);

    for (let i = 0; i < (results.ids?.length || 0); i++) {
      const distance = results.distances?.[i] || 1;
      const similarity = Math.max(0, 1 - distance / 2);

      // High vector similarity (>0.85) → similar topic
      if (similarity > 0.85) {
        const existingContent = results.documents?.[i] || '';
        // Check if content is actually different (not just similar phrasing)
        const contentSimilarity = computeTextSimilarity(newContent, existingContent);
        if (contentSimilarity < 0.7) {
          return { id: results.ids[i], score: similarity };
        }
      }
    }
  } catch {
    // ChromaDB unavailable — skip contradiction check
  }
  return null;
}

/**
 * Simple text similarity using Jaccard over word sets
 * 0.0 = completely different, 1.0 = identical
 */
function computeTextSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

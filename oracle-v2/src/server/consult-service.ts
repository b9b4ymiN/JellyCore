/**
 * ConsultService - Canonical Consult Implementation
 *
 * Single source of truth for oracle_consult across all entrypoints:
 * - HTTP API (/api/consult, /api/ask)
 * - SSE MCP (mcp-server-factory)
 * - stdio MCP (index.ts)
 *
 * Search scope:
 * - principles = ['principle']
 * - patterns = ['learning', 'pattern']  ← pattern added v0.7.1
 * - retro = excluded (episodic memory, not normative guidance)
 *
 * @version 0.7.2 - Fixed issues from Codex review
 */

import { sqlite } from '../db/index.js';
import { ChromaHttpClient } from '../chroma-http.js';
import { getThaiNlpClient } from '../thai-nlp-client.js';
import { buildFtsQueryPlan, normalizeRank, validateInput } from './handlers.js';

// === Constants ===
const MIN_LIMIT = 1;
const MAX_LIMIT = 10;
const DEFAULT_LIMIT = 3;
const HYBRID_BOOST = 0.1;

// === Types ===
export interface ConsultResult {
  decision: string;
  context?: string;
  principles: ConsultDocument[];
  patterns: ConsultDocument[];
  guidance: string;
}

export interface ConsultDocument {
  id: string;
  type: 'principle' | 'learning' | 'pattern';
  content: string;
  source_file: string;
  score: number;
  source: 'fts' | 'vector' | 'hybrid';
}

export interface ConsultOptions {
  useVectorSearch?: boolean;  // default: true
  useThaiNlp?: boolean;       // default: true
  limit?: number;             // default: 3, clamped to 1-10
}

// === Prepared Statement Cache ===
const preparedStatements = new Map<string, ReturnType<typeof sqlite.prepare>>();

function getCachedStatement(sql: string): ReturnType<typeof sqlite.prepare> {
  if (!preparedStatements.has(sql)) {
    preparedStatements.set(sql, sqlite.prepare(sql));
  }
  return preparedStatements.get(sql)!;
}

// === Singleton ChromaDB client ===
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

// === Utility Functions ===

/**
 * Clamp limit to valid range (prevent DoS via LIMIT -1)
 */
function clampLimit(limit: unknown): number {
  const num = Number(limit);
  if (!Number.isInteger(num) || num < MIN_LIMIT) {
    return DEFAULT_LIMIT;
  }
  return Math.min(num, MAX_LIMIT);
}

/**
 * Sanitize error for logging (remove sensitive data)
 */
function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    // Remove potentially sensitive parts
    return error.message
      .replace(/https?:\/\/[^\s]+/gi, '[URL]')
      .replace(/token[=:]\s*\S+/gi, '[TOKEN]')
      .replace(/password[=:]\s*\S+/gi, '[PASSWORD]');
  }
  return String(error);
}

/**
 * Run FTS search for a specific document type (with error handling)
 */
function runFtsSearch(
  docType: 'principle' | 'learning' | 'pattern',
  matchQuery: string,
  limit: number
): ConsultDocument[] {
  if (!matchQuery) return [];

  const safeLimit = clampLimit(limit);

  try {
    const stmt = getCachedStatement(`
      SELECT f.id, f.content, d.source_file, d.type, rank as score
      FROM oracle_fts f
      JOIN oracle_documents d ON f.id = d.id
      WHERE oracle_fts MATCH ? AND d.type = ?
      ORDER BY rank
      LIMIT ?
    `);

    return stmt.all(matchQuery, docType, safeLimit).map((row: any) => ({
      id: row.id,
      type: row.type,
      content: row.content,
      source_file: row.source_file,
      score: normalizeRank(row.score),
      source: 'fts' as const
    }));
  } catch (error) {
    console.error(`[ConsultService FTS Error] type=${docType}: ${sanitizeError(error)}`);
    return [];
  }
}

/**
 * Merge FTS and vector results (dedupe by id, boost if in both)
 */
function mergeResults(fts: ConsultDocument[], vector: ConsultDocument[], limit: number): ConsultDocument[] {
  const seen = new Map<string, ConsultDocument>();

  // Add FTS results
  for (const r of fts) {
    seen.set(r.id, { ...r, score: Math.min(1, Math.max(0, r.score)) });
  }

  // Merge vector results
  for (const r of vector) {
    const normalizedScore = Math.min(1, Math.max(0, r.score));

    if (seen.has(r.id)) {
      const existing = seen.get(r.id)!;
      // Weighted average for hybrid (60% FTS, 40% vector) + small boost
      const hybridScore = Math.min(1,
        existing.score * 0.6 + normalizedScore * 0.4 + HYBRID_BOOST
      );
      seen.set(r.id, {
        ...existing,
        score: hybridScore,
        source: 'hybrid'
      });
    } else {
      seen.set(r.id, { ...r, score: normalizedScore });
    }
  }

  // Sort by score and limit
  return Array.from(seen.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, clampLimit(limit));
}

/**
 * Synthesize guidance from principles and patterns
 */
function synthesizeGuidance(
  decision: string,
  principles: ConsultDocument[],
  patterns: ConsultDocument[]
): string {
  let guidance = 'Based on Oracle philosophy:\n\n';

  if (principles.length > 0) {
    guidance += 'Relevant Principles:\n';
    principles.forEach((p, i) => {
      const preview = p.content.length > 150 ? p.content.substring(0, 150) + '...' : p.content;
      guidance += `${i + 1}. ${preview}\n`;
    });
    guidance += '\n';
  }

  if (patterns.length > 0) {
    guidance += 'Relevant Patterns:\n';
    patterns.forEach((p, i) => {
      const preview = p.content.length > 150 ? p.content.substring(0, 150) + '...' : p.content;
      guidance += `${i + 1}. ${preview}\n`;
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
 * Main consult function - canonical implementation
 */
export async function consult(
  decision: string,
  context: string = '',
  options: ConsultOptions = {}
): Promise<ConsultResult> {
  const {
    useVectorSearch = true,
    useThaiNlp = true,
    limit: rawLimit
  } = options;

  // Validate and sanitize inputs
  const safeDecision = validateInput(decision);
  if (!safeDecision) {
    return {
      decision: '',
      context: undefined,
      principles: [],
      patterns: [],
      guidance: 'Invalid or empty decision provided.'
    };
  }

  const safeContext = validateInput(context);

  // Clamp limit to prevent DoS
  const limit = clampLimit(rawLimit);

  const query = safeContext ? `${safeDecision} ${safeContext}` : safeDecision;

  // Thai NLP preprocessing (graceful fallback with logging)
  let segmented = query;
  if (useThaiNlp) {
    try {
      const thaiNlp = getThaiNlpClient();
      const result = await thaiNlp.preprocessQuery(query);
      segmented = result.segmented;
    } catch (error) {
      // Log degradation but continue
      console.warn(`[ConsultService ThaiNLP] Degraded mode: ${sanitizeError(error)}`);
    }
  }

  const ftsPlan = buildFtsQueryPlan(segmented);

  // === FTS Search ===
  let ftsPrinciples = runFtsSearch('principle', ftsPlan.strictQuery, limit);
  let ftsLearnings = runFtsSearch('learning', ftsPlan.strictQuery, limit);
  let ftsPatterns = runFtsSearch('pattern', ftsPlan.strictQuery, limit);

  // OR fallback - fill up to limit if strict didn't get enough (with dedupe)
  if (ftsPlan.orQuery) {
    if (ftsPrinciples.length < limit) {
      const existingIds = new Set(ftsPrinciples.map(p => p.id));
      const more = runFtsSearch('principle', ftsPlan.orQuery, limit - ftsPrinciples.length)
        .filter(p => !existingIds.has(p.id));
      ftsPrinciples = [...ftsPrinciples, ...more];
    }
    if (ftsLearnings.length < limit) {
      const existingIds = new Set(ftsLearnings.map(l => l.id));
      const more = runFtsSearch('learning', ftsPlan.orQuery, limit - ftsLearnings.length)
        .filter(l => !existingIds.has(l.id));
      ftsLearnings = [...ftsLearnings, ...more];
    }
    if (ftsPatterns.length < limit) {
      const existingIds = new Set(ftsPatterns.map(p => p.id));
      const more = runFtsSearch('pattern', ftsPlan.orQuery, limit - ftsPatterns.length)
        .filter(p => !existingIds.has(p.id));
      ftsPatterns = [...ftsPatterns, ...more];
    }
  }

  // Combine learning + pattern into patterns bucket
  const allFtsPatterns = [...ftsLearnings, ...ftsPatterns];

  // === Vector Search ===
  let vectorPrinciples: ConsultDocument[] = [];
  let vectorPatterns: ConsultDocument[] = [];

  if (useVectorSearch) {
    try {
      const client = getChromaClient();
      const vectorResults = await client.query(query, 15);

      if (vectorResults.ids?.length > 0) {
        for (let i = 0; i < vectorResults.ids.length; i++) {
          const docType = vectorResults.metadatas?.[i]?.type;
          // Use ?? instead of || to handle distance=0 correctly
          const distance = vectorResults.distances?.[i] ?? 1;
          const similarity = Math.max(0, Math.min(1, 1 - distance / 2));

          const doc: ConsultDocument = {
            id: vectorResults.ids[i],
            type: docType,
            content: vectorResults.documents?.[i] ?? '',
            source_file: vectorResults.metadatas?.[i]?.source_file ?? '',
            score: similarity,
            source: 'vector'
          };

          if (docType === 'principle' && vectorPrinciples.length < limit) {
            vectorPrinciples.push(doc);
          } else if ((docType === 'learning' || docType === 'pattern') && vectorPatterns.length < limit * 2) {
            vectorPatterns.push(doc);
          }
        }
      }
    } catch (error) {
      console.error(`[ConsultService Vector Error]: ${sanitizeError(error)}`);
    }
  }

  // === Merge Results ===
  const principlesRaw = mergeResults(ftsPrinciples, vectorPrinciples, limit);
  const patternsRaw = mergeResults(allFtsPatterns, vectorPatterns, limit);

  // Synthesize guidance (use safe/sanitized inputs)
  const guidance = synthesizeGuidance(safeDecision, principlesRaw, patternsRaw);

  console.log(
    `[ConsultService] principles=${principlesRaw.length}, patterns=${patternsRaw.length}, limit=${limit}`
  );

  return {
    decision: safeDecision,
    context: safeContext || undefined,
    principles: principlesRaw,
    patterns: patternsRaw,
    guidance
  };
}

/**
 * Convert to MCP response format
 */
export function toMcpResponse(result: ConsultResult) {
  return {
    decision: result.decision,
    context: result.context,
    relevant_docs: [
      ...result.principles.map(p => ({
        id: p.id,
        type: p.type,
        content: p.content.length > 300 ? p.content.substring(0, 300) : p.content,
        source_file: p.source_file
      })),
      ...result.patterns.map(p => ({
        id: p.id,
        type: p.type,
        content: p.content.length > 300 ? p.content.substring(0, 300) : p.content,
        source_file: p.source_file
      }))
    ],
    guidance: result.guidance
  };
}

/**
 * Simple FTS-only consult for lightweight use cases
 */
export function consultFtsOnly(
  sqlite: any,
  decision: string,
  context?: string
): any {
  const query = context ? `${decision} ${context}` : decision;
  const safeQuery = query.replace(/[?*+\-()^~"':.\/ ]/g, ' ').replace(/\s+/g, ' ').trim() || query;

  const ftsQuery = sqlite.prepare(`
    SELECT f.id, d.type, f.content, d.source_file
    FROM oracle_fts f
    JOIN oracle_documents d ON f.id = d.id
    WHERE oracle_fts MATCH ?
    AND d.type IN ('principle', 'learning', 'pattern')
    ORDER BY rank
    LIMIT 10
  `);

  let relevant: any[] = [];
  try {
    relevant = ftsQuery.all(safeQuery);
  } catch (error) {
    console.error(`[consultFtsOnly Error]: ${sanitizeError(error)}`);
  }

  const principles = relevant.filter(r => r.type === 'principle');
  const patterns = relevant.filter(r => r.type === 'learning' || r.type === 'pattern');

  return {
    decision,
    context,
    relevant_docs: relevant.map((r: any) => ({
      id: r.id,
      type: r.type,
      content: r.content?.substring(0, 300) ?? '',
      source: r.source_file,
    })),
    principles: principles.map((r: any) => ({
      id: r.id,
      content: r.content?.substring(0, 300) ?? '',
      source_file: r.source_file,
    })),
    patterns: patterns.map((r: any) => ({
      id: r.id,
      content: r.content?.substring(0, 300) ?? '',
      source_file: r.source_file,
    })),
    guidance: relevant.length > 0
      ? `Based on ${relevant.length} relevant documents, consider the principles and patterns above.`
      : 'No specific guidance found. Consider adding relevant principles to the knowledge base.',
  };
}

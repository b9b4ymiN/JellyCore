/**
 * Query Classifier — Adaptive Hybrid Search (v0.6.0 Part A)
 *
 * Classifies search queries into types (exact/semantic/mixed) and returns
 * prior weights for FTS vs Vector search. These are "prior" weights —
 * they get corrected by posterior quality analysis after results come back.
 *
 * Design: Rule-based, zero-cost, deterministic (<0.1ms).
 * No LLM calls — uses regex pattern matching.
 *
 * Also provides:
 *   - Adaptive candidate multipliers per retrieval source
 *   - Quality-based posterior weight correction
 */

// ── Types ──

export type QueryType = 'exact' | 'semantic' | 'mixed';

export interface QueryProfile {
  type: QueryType;
  ftsBoost: number;       // Prior FTS weight (0.0 - 1.0)
  vectorBoost: number;    // Prior Vector weight (0.0 - 1.0)
  ftsCandidateMult: number;   // Candidate multiplier for FTS (3-6)
  vectorCandidateMult: number; // Candidate multiplier for Vector (3-6)
  reason: string;
}

export interface ResultQuality {
  coherence: number;  // How consistent are top scores (0-1, high = good)
  gap: number;        // Score gap between top-1 and top-2 (0-1, high = clear winner)
  coverage: number;   // Ratio of results returned vs requested (0-1)
  relevance: number;  // Average score level of top results (0-1, high = relevant)
}

export interface WeightedProfile extends QueryProfile {
  // Posterior-corrected final weights
  finalFtsWeight: number;
  finalVectorWeight: number;
  ftsQuality: ResultQuality;
  vectorQuality: ResultQuality;
}

// ── Detection Patterns ──

const EXACT_SIGNALS = [
  /`[^`]+`/,                             // backticks `code`
  /[a-z][A-Z]/,                           // camelCase (handleWebhook)
  /\b[A-Z_]{3,}\b/,                      // ALL_CAPS (ECONNREFUSED, PORT)
  /\b(?:E[A-Z]{2,}|0x[0-9a-f]+)\b/i,     // error codes (ECONNREFUSED, 0x1A)
  /["'][^"']{2,}["']/,                    // quoted strings ("exact phrase")
  /\b\d+\.\d+\.\d+\b/,                   // version numbers (1.2.3)
  /\b(?:port|PORT)\s*[:=]\s*\d+/,         // PORT=47778
  /\b\w+\.(ts|js|py|md|yml|yaml|json|toml)\b/, // filenames (config.ts)
  /\b(?:npm|bun|pip|docker|git)\s+\w+/i,  // CLI commands
];

const SEMANTIC_SIGNALS = [
  /(อะไร|ทำไม|อย่างไร|ยังไง|เพราะอะไร|คืออะไร)/,  // Thai questions (no \b — Thai chars are \W)
  /\b(what|why|how|when|where|which)\b/i,           // English questions
  /(วิธี|แนะนำ|ช่วย|อธิบาย|บอก|เล่า|สอน)/,         // Thai request words
  /\b(explain|suggest|recommend|help|describe|tell)\b/i, // English request words
  /(ทำ(?:อะไร|ไง)|ทำได้(?:อย่างไร|ยังไง))/,          // Thai compound questions
  /(ข้อดี|ข้อเสีย|ประโยชน์|ปัญหา|แนวทาง)/,           // Thai analytical words
];

// ── Classifier ──

/**
 * Classify a search query and return prior weights + candidate multipliers.
 *
 * Returns a QueryProfile with:
 *   - type: 'exact' | 'semantic' | 'mixed'
 *   - ftsBoost / vectorBoost: prior weights for RRF
 *   - ftsCandidateMult / vectorCandidateMult: how many candidates to pull per source
 */
export function classifySearchQuery(query: string): QueryProfile {
  const exactScore = countSignals(query, EXACT_SIGNALS);
  const semanticScore = countSignals(query, SEMANTIC_SIGNALS);

  // Long text without code markers leans semantic
  const isLong = query.length > 30;
  const wordCount = query.split(/\s+/).length;
  const isMultiWord = wordCount > 5;

  // Both signals present → mixed
  if (exactScore > 0 && semanticScore > 0) {
    return {
      type: 'mixed',
      ftsBoost: 0.5,
      vectorBoost: 0.5,
      ftsCandidateMult: 5,
      vectorCandidateMult: 5,
      reason: 'mixed-signals',
    };
  }

  // Strong exact signals
  if (exactScore >= 2) {
    return {
      type: 'exact',
      ftsBoost: 0.85,
      vectorBoost: 0.15,
      ftsCandidateMult: 6,
      vectorCandidateMult: 3,
      reason: 'strong-exact',
    };
  }

  if (exactScore === 1) {
    return {
      type: 'exact',
      ftsBoost: 0.75,
      vectorBoost: 0.25,
      ftsCandidateMult: 6,
      vectorCandidateMult: 4,
      reason: 'exact-signal',
    };
  }

  // Strong semantic signals
  if (semanticScore >= 2 || (semanticScore === 1 && isMultiWord)) {
    return {
      type: 'semantic',
      ftsBoost: 0.25,
      vectorBoost: 0.75,
      ftsCandidateMult: 4,
      vectorCandidateMult: 6,
      reason: 'strong-semantic',
    };
  }

  if (semanticScore === 1) {
    return {
      type: 'semantic',
      ftsBoost: 0.3,
      vectorBoost: 0.7,
      ftsCandidateMult: 4,
      vectorCandidateMult: 6,
      reason: 'semantic-signal',
    };
  }

  // No clear signals — use length as tiebreaker
  if (isLong && isMultiWord) {
    return {
      type: 'semantic',
      ftsBoost: 0.35,
      vectorBoost: 0.65,
      ftsCandidateMult: 4,
      vectorCandidateMult: 5,
      reason: 'long-query',
    };
  }

  // Default: slight vector preference (semantic search is generally better for recall)
  return {
    type: 'mixed',
    ftsBoost: 0.4,
    vectorBoost: 0.6,
    ftsCandidateMult: 4,
    vectorCandidateMult: 4,
    reason: 'default',
  };
}

// ── Quality-Based Posterior Weight Correction ──

/**
 * Measure the quality of a result set by analyzing score distribution.
 *
 * Metrics:
 *   coherence — Are top scores tightly clustered? (high = consistent results)
 *   gap       — Is there a clear winner? (high = top-1 stands out)
 *   coverage  — Did we get enough results? (high = lots of matches)
 */
export function measureResultQuality(
  scores: number[],
  requestedCount: number,
): ResultQuality {
  if (scores.length === 0) {
    return { coherence: 0, gap: 0, coverage: 0, relevance: 0 };
  }

  // Sort descending (best first)
  const sorted = [...scores].sort((a, b) => b - a);
  const top = sorted.slice(0, Math.min(5, sorted.length));

  // Coherence: low standard deviation among top scores = high coherence
  // Meaning: many results agree on quality → reliable signal
  const mean = top.reduce((s, v) => s + v, 0) / top.length;
  const variance = top.reduce((s, v) => s + (v - mean) ** 2, 0) / top.length;
  const stdDev = Math.sqrt(variance);
  // Normalize: stdDev near 0 = coherence near 1
  const coherence = Math.max(0, 1 - stdDev * 5); // scale factor 5 tuned for 0-1 scores

  // Relevance: average score level of top results (absolute quality)
  // Distinguishes "all high" from "all low" — coherence alone can't tell
  const relevance = Math.min(1, mean);

  // Gap: difference between top-1 and top-2
  // Large gap = clear top result → high confidence
  const gap = sorted.length >= 2
    ? Math.min(1, (sorted[0] - sorted[1]) * 10) // scale factor 10
    : sorted[0] > 0.3 ? 0.5 : 0; // single result: moderate confidence if decent score

  // Coverage: how many results vs what we asked for
  const coverage = Math.min(1, scores.length / Math.max(1, requestedCount));

  return { coherence, gap, coverage, relevance };
}

/**
 * Compute composite quality score from individual metrics.
 * Weights: relevance is most important (absolute score level),
 * coverage second (having results matters), gap and coherence
 * provide distribution signals.
 */
function compositeQuality(q: ResultQuality): number {
  return q.relevance * 0.35 + q.coverage * 0.25 + q.gap * 0.25 + q.coherence * 0.15;
}

/**
 * Apply posterior weight correction based on actual result quality.
 *
 * The prior weights from the classifier are "educated guesses" based on
 * query text patterns. After actually retrieving results, we measure
 * quality of each side and correct the weights accordingly.
 *
 * This is the key insight: if the classifier says "exact" but vector
 * results are much higher quality, the system self-corrects by boosting
 * vector weight.
 *
 * Formula:
 *   raw_fts  = prior_fts  × quality_fts
 *   raw_vec  = prior_vec  × quality_vec
 *   final    = normalize(raw_fts, raw_vec) to sum to 1.0
 *
 * @param profile   Prior classification from classifySearchQuery()
 * @param ftsScores Raw scores from FTS5 results (normalized 0-1)
 * @param vectorScores Raw scores from vector results (similarity 0-1)
 * @param requestedLimit How many results were requested
 */
export function applyQualityCorrection(
  profile: QueryProfile,
  ftsScores: number[],
  vectorScores: number[],
  requestedLimit: number,
): WeightedProfile {
  const ftsQuality = measureResultQuality(ftsScores, requestedLimit);
  const vectorQuality = measureResultQuality(vectorScores, requestedLimit);

  const ftsQ = compositeQuality(ftsQuality);
  const vecQ = compositeQuality(vectorQuality);

  // Multiply dampened prior by quality
  // Using prior^0.4 to reduce prior dominance and allow quality to correct mistakes.
  // Without dampening, a 0.75/0.25 prior can never be overturned by quality.
  let rawFts = Math.pow(profile.ftsBoost, 0.4) * Math.max(0.1, ftsQ);
  let rawVec = Math.pow(profile.vectorBoost, 0.4) * Math.max(0.1, vecQ);

  // Normalize to sum to 1.0
  const total = rawFts + rawVec;
  const finalFtsWeight = total > 0 ? rawFts / total : 0.5;
  const finalVectorWeight = total > 0 ? rawVec / total : 0.5;

  return {
    ...profile,
    finalFtsWeight,
    finalVectorWeight,
    ftsQuality,
    vectorQuality,
  };
}

// ── Helpers ──

function countSignals(text: string, patterns: RegExp[]): number {
  let count = 0;
  for (const pattern of patterns) {
    if (pattern.test(text)) count++;
  }
  return count;
}

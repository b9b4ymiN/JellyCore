/**
 * Tests for Query Classifier + Quality-Based Weight Correction
 */

import { describe, it, expect } from 'vitest';
import {
  classifySearchQuery,
  measureResultQuality,
  applyQualityCorrection,
} from './query-classifier.js';

describe('classifySearchQuery', () => {
  // ── Exact Match Queries ──

  it('detects camelCase as exact', () => {
    const p = classifySearchQuery('handleWebhook');
    expect(p.type).toBe('exact');
    expect(p.ftsBoost).toBeGreaterThan(0.7);
  });

  it('detects ALL_CAPS as exact', () => {
    const p = classifySearchQuery('ECONNREFUSED');
    expect(p.type).toBe('exact');
    expect(p.ftsCandidateMult).toBeGreaterThanOrEqual(6);
  });

  it('detects backticks as exact', () => {
    const p = classifySearchQuery('`docker compose up`');
    expect(p.type).toBe('exact');
  });

  it('detects error codes as exact', () => {
    const p = classifySearchQuery('ENOENT');
    expect(p.type).toBe('exact');
  });

  it('detects version numbers as exact', () => {
    const p = classifySearchQuery('version 0.5.0');
    expect(p.type).toBe('exact');
  });

  it('detects PORT=47778 as exact', () => {
    const p = classifySearchQuery('PORT=47778');
    expect(p.type).toBe('exact');
  });

  it('detects filenames as exact', () => {
    const p = classifySearchQuery('config.ts');
    expect(p.type).toBe('exact');
  });

  // ── Semantic Queries ──

  it('detects Thai questions as semantic', () => {
    const p = classifySearchQuery('ทำไม container ช้า');
    expect(p.type).toBe('semantic');
    expect(p.vectorBoost).toBeGreaterThan(0.6);
  });

  it('detects English questions as semantic', () => {
    const p = classifySearchQuery('how to deploy Docker');
    expect(p.type).toBe('semantic');
    expect(p.vectorCandidateMult).toBeGreaterThanOrEqual(5);
  });

  it('detects Thai request words as semantic', () => {
    const p = classifySearchQuery('อธิบายวิธีการทำงานของ Oracle');
    expect(p.type).toBe('semantic');
  });

  it('detects long queries without code as semantic', () => {
    const p = classifySearchQuery('ช่วยบอกหน่อยว่าระบบทำงานยังไงเวลามีข้อความเข้ามา');
    expect(p.type).toBe('semantic');
  });

  // ── Mixed Queries ──

  it('detects mixed signals (code + question)', () => {
    const p = classifySearchQuery('ทำไม ECONNREFUSED เกิดขึ้น');
    expect(p.type).toBe('mixed');
    expect(p.ftsBoost).toBe(0.5);
    expect(p.vectorBoost).toBe(0.5);
  });

  // ── Default ──

  it('returns default for short ambiguous queries', () => {
    const p = classifySearchQuery('trust');
    expect(p.type).toBe('mixed');
    expect(p.reason).toBe('default');
  });

  // ── Adaptive Candidate Multiplier ──

  it('exact queries pull more FTS candidates', () => {
    const p = classifySearchQuery('handleWebhook');
    expect(p.ftsCandidateMult).toBeGreaterThan(p.vectorCandidateMult);
  });

  it('semantic queries pull more vector candidates', () => {
    const p = classifySearchQuery('วิธี deploy Docker คืออะไร');
    expect(p.vectorCandidateMult).toBeGreaterThan(p.ftsCandidateMult);
  });
});

describe('measureResultQuality', () => {
  it('returns zero for empty results', () => {
    const q = measureResultQuality([], 10);
    expect(q.coherence).toBe(0);
    expect(q.gap).toBe(0);
    expect(q.coverage).toBe(0);
    expect(q.relevance).toBe(0);
  });

  it('high coherence for tightly clustered scores', () => {
    const q = measureResultQuality([0.9, 0.88, 0.87, 0.86, 0.85], 5);
    expect(q.coherence).toBeGreaterThan(0.7); // Very consistent
    expect(q.coverage).toBe(1); // Got all requested
  });

  it('low coherence for widely spread scores', () => {
    const q = measureResultQuality([0.95, 0.1, 0.05, 0.02, 0.01], 5);
    expect(q.coherence).toBeLessThan(0.5); // Very inconsistent
  });

  it('high gap when top-1 stands out', () => {
    const q = measureResultQuality([0.95, 0.3, 0.2, 0.1], 10);
    expect(q.gap).toBeGreaterThan(0.5); // Clear winner
  });

  it('low coverage when few results returned', () => {
    const q = measureResultQuality([0.9], 10);
    expect(q.coverage).toBe(0.1); // Only got 1 of 10
  });
});

describe('applyQualityCorrection', () => {
  it('corrects classifier mistake: exact query but vector results better', () => {
    const profile = classifySearchQuery('handleWebhook'); // classified as exact
    expect(profile.ftsBoost).toBeGreaterThan(0.7); // Prior says FTS is best

    // But vector results are actually much better quality
    const ftsScores = [0.05, 0.02]; // Very poor FTS results (low relevance)
    const vectorScores = [0.95, 0.9, 0.88, 0.85, 0.82]; // Excellent vector results

    const corrected = applyQualityCorrection(profile, ftsScores, vectorScores, 5);

    // Posterior should correct toward vector
    expect(corrected.finalVectorWeight).toBeGreaterThan(corrected.finalFtsWeight);
  });

  it('reinforces correct classification: exact query with good FTS results', () => {
    const profile = classifySearchQuery('ECONNREFUSED');

    // FTS results are excellent (as expected for exact match)
    const ftsScores = [0.95, 0.9, 0.85, 0.8, 0.75];
    const vectorScores = [0.3, 0.2, 0.1]; // Mediocre vector results

    const corrected = applyQualityCorrection(profile, ftsScores, vectorScores, 5);

    // Posterior should reinforce FTS preference
    expect(corrected.finalFtsWeight).toBeGreaterThan(corrected.finalVectorWeight);
  });

  it('handles both sides empty gracefully', () => {
    const profile = classifySearchQuery('test');
    const corrected = applyQualityCorrection(profile, [], [], 10);

    // Should not crash, weights should be roughly equal
    expect(corrected.finalFtsWeight + corrected.finalVectorWeight).toBeCloseTo(1);
  });

  it('includes quality metrics in output', () => {
    const profile = classifySearchQuery('test');
    const corrected = applyQualityCorrection(profile, [0.5, 0.4], [0.6, 0.5, 0.4], 5);

    expect(corrected.ftsQuality).toBeDefined();
    expect(corrected.vectorQuality).toBeDefined();
    expect(corrected.ftsQuality.coherence).toBeGreaterThanOrEqual(0);
    expect(corrected.ftsQuality.coverage).toBeGreaterThanOrEqual(0);
  });
});

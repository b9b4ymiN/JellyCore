/**
 * Part D — Decay System Tests
 *
 * Tests for: computeDecayScore(), trackAccess(), computeConfidence(),
 *            refreshAllDecayScores()
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { computeDecayScore, computeConfidence } from '../memory/decay.js';
import { floatToInt, intToFloat } from '../types.js';

const MS_PER_DAY = 86_400_000;

describe('Part D — Decay System', () => {
  // ============================================================
  // computeDecayScore()
  // ============================================================
  describe('computeDecayScore()', () => {
    const NOW = Date.now();

    it('fresh doc with zero access → score ~50%', () => {
      const score = computeDecayScore({
        updatedAt: NOW,
        accessCount: 0,
        memoryLayer: 'semantic',
        now: NOW,
      });
      // recency=1.0, access=0.5 → 0.5 → 50
      expect(score).toBe(50);
    });

    it('fresh doc with 10 accesses → score 100%', () => {
      const score = computeDecayScore({
        updatedAt: NOW,
        accessCount: 10,
        memoryLayer: 'semantic',
        now: NOW,
      });
      // recency=1.0, access=1.0 → 1.0 → 100
      expect(score).toBe(100);
    });

    it('doc aged 69 days (~half-life) with zero access → score ~25%', () => {
      const score = computeDecayScore({
        updatedAt: NOW - 69 * MS_PER_DAY,
        accessCount: 0,
        memoryLayer: 'semantic',
        now: NOW,
      });
      // e^(-0.01 × 69) ≈ 0.502 × 0.5 ≈ 0.251 → 25
      expect(score).toBeGreaterThanOrEqual(24);
      expect(score).toBeLessThanOrEqual(26);
    });

    it('doc aged 69 days with 10 accesses → score ~50%', () => {
      const score = computeDecayScore({
        updatedAt: NOW - 69 * MS_PER_DAY,
        accessCount: 10,
        memoryLayer: 'semantic',
        now: NOW,
      });
      // e^(-0.01 × 69) ≈ 0.502 × 1.0 ≈ 0.502 → 50
      expect(score).toBeGreaterThanOrEqual(49);
      expect(score).toBeLessThanOrEqual(51);
    });

    it('very old doc (365 days) with zero access → near zero', () => {
      const score = computeDecayScore({
        updatedAt: NOW - 365 * MS_PER_DAY,
        accessCount: 0,
        memoryLayer: 'semantic',
        now: NOW,
      });
      // e^(-0.01 × 365) ≈ 0.026 × 0.5 ≈ 0.013 → 1
      expect(score).toBeLessThanOrEqual(3);
    });

    // user_model never decays
    it('user_model → always 100 regardless of age/access', () => {
      const score = computeDecayScore({
        updatedAt: NOW - 365 * MS_PER_DAY,
        accessCount: 0,
        memoryLayer: 'user_model',
        now: NOW,
      });
      expect(score).toBe(100);
    });

    // procedural decays slower (λ=0.005, half-life ~139 days)
    it('procedural at 69 days → decays slower than semantic', () => {
      const semanticScore = computeDecayScore({
        updatedAt: NOW - 69 * MS_PER_DAY,
        accessCount: 5,
        memoryLayer: 'semantic',
        now: NOW,
      });
      const proceduralScore = computeDecayScore({
        updatedAt: NOW - 69 * MS_PER_DAY,
        accessCount: 5,
        memoryLayer: 'procedural',
        now: NOW,
      });
      expect(proceduralScore).toBeGreaterThan(semanticScore);
    });

    it('procedural at 139 days (~half-life) → score ~50% with max access', () => {
      const score = computeDecayScore({
        updatedAt: NOW - 139 * MS_PER_DAY,
        accessCount: 10,
        memoryLayer: 'procedural',
        now: NOW,
      });
      // e^(-0.005 × 139) ≈ 0.499 × 1.0 ≈ 0.499 → 50
      expect(score).toBeGreaterThanOrEqual(48);
      expect(score).toBeLessThanOrEqual(52);
    });

    // null layer treated as default (semantic-like)
    it('null layer uses default λ', () => {
      const scoreNull = computeDecayScore({
        updatedAt: NOW - 69 * MS_PER_DAY,
        accessCount: 5,
        memoryLayer: null,
        now: NOW,
      });
      const scoreSemantic = computeDecayScore({
        updatedAt: NOW - 69 * MS_PER_DAY,
        accessCount: 5,
        memoryLayer: 'semantic',
        now: NOW,
      });
      expect(scoreNull).toBe(scoreSemantic);
    });

    // null updatedAt → treat as now (fresh)
    it('null updatedAt → fresh', () => {
      const score = computeDecayScore({
        updatedAt: null,
        accessCount: 10,
        now: NOW,
      });
      expect(score).toBe(100);
    });

    // null accessCount → 0
    it('null accessCount → treated as 0', () => {
      const score = computeDecayScore({
        updatedAt: NOW,
        accessCount: null,
        now: NOW,
      });
      expect(score).toBe(50);
    });

    // Access factor intermediate values
    it('5 accesses → accessFactor = 0.75', () => {
      const score = computeDecayScore({
        updatedAt: NOW,
        accessCount: 5,
        memoryLayer: 'semantic',
        now: NOW,
      });
      // recency=1.0 × access=0.75 → 75
      expect(score).toBe(75);
    });

    it('20 accesses → accessFactor capped at 1.0', () => {
      const score = computeDecayScore({
        updatedAt: NOW,
        accessCount: 20,
        memoryLayer: 'semantic',
        now: NOW,
      });
      // recency=1.0 × access=1.0 → 100
      expect(score).toBe(100);
    });
  });

  // ============================================================
  // computeConfidence()
  // ============================================================
  describe('computeConfidence()', () => {
    it('human origin → 0.95', () => {
      expect(computeConfidence('human')).toBe(0.95);
    });

    it('mother origin → 0.90', () => {
      expect(computeConfidence('mother')).toBe(0.90);
    });

    it('source with URL → 0.80', () => {
      expect(computeConfidence(null, 'https://example.com/doc')).toBe(0.80);
    });

    it('source with correction → 0.85', () => {
      expect(computeConfidence(null, 'แก้จาก user')).toBe(0.85);
    });

    it('source with "fix" → 0.85', () => {
      expect(computeConfidence(null, 'fix: corrected output')).toBe(0.85);
    });

    it('no origin, no source → 0.60', () => {
      expect(computeConfidence()).toBe(0.60);
    });

    it('null origin, null source → 0.60', () => {
      expect(computeConfidence(null, null)).toBe(0.60);
    });

    it('origin takes precedence over source', () => {
      // human origin should be 0.95 even if source has URL
      expect(computeConfidence('human', 'https://example.com')).toBe(0.95);
    });
  });

  // ============================================================
  // intToFloat / floatToInt consistency
  // ============================================================
  describe('Decay score DB round-trip', () => {
    it('floatToInt(0.5) → 50 → intToFloat back → 0.5', () => {
      const stored = floatToInt(0.5);
      expect(stored).toBe(50);
      expect(intToFloat(stored)).toBe(0.5);
    });

    it('floatToInt(0.75) → 75 → intToFloat back → 0.75', () => {
      const stored = floatToInt(0.75);
      expect(stored).toBe(75);
      expect(intToFloat(stored)).toBe(0.75);
    });

    it('computeDecayScore result round-trips through intToFloat', () => {
      const score = computeDecayScore({
        updatedAt: Date.now(),
        accessCount: 5,
        memoryLayer: 'semantic',
        now: Date.now(),
      });
      const float = intToFloat(score);
      expect(float).toBeGreaterThan(0);
      expect(float).toBeLessThanOrEqual(1);
      expect(floatToInt(float)).toBe(score);
    });
  });
});

/**
 * Part D â€” Decay System Tests
 *
 * Tests for: computeDecayScore(), trackAccess(), computeConfidence(),
 *            refreshAllDecayScores()
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { computeDecayScore, computeConfidence } from '../memory/decay.js';
import { floatToInt, intToFloat } from '../types.js';

const MS_PER_DAY = 86_400_000;

describe('Part D â€” Decay System', () => {
  // ============================================================
  // computeDecayScore()
  // ============================================================
  describe('computeDecayScore()', () => {
    const NOW = Date.now();

    it('fresh doc with zero access â†’ score ~50%', () => {
      const score = computeDecayScore({
        updatedAt: NOW,
        accessCount: 0,
        memoryLayer: 'semantic',
        now: NOW,
      });
      // recency=1.0, access=0.5 â†’ 0.5 â†’ 50
      expect(score).toBe(50);
    });

    it('fresh doc with 10 accesses â†’ score 100%', () => {
      const score = computeDecayScore({
        updatedAt: NOW,
        accessCount: 10,
        memoryLayer: 'semantic',
        now: NOW,
      });
      // recency=1.0, access=1.0 â†’ 1.0 â†’ 100
      expect(score).toBe(100);
    });

    it('doc aged 69 days (~half-life) with zero access â†’ score ~25%', () => {
      const score = computeDecayScore({
        updatedAt: NOW - 69 * MS_PER_DAY,
        accessCount: 0,
        memoryLayer: 'semantic',
        now: NOW,
      });
      // e^(-0.01 Ã— 69) â‰ˆ 0.502 Ã— 0.5 â‰ˆ 0.251 â†’ 25
      expect(score).toBeGreaterThanOrEqual(24);
      expect(score).toBeLessThanOrEqual(26);
    });

    it('doc aged 69 days with 10 accesses â†’ score ~50%', () => {
      const score = computeDecayScore({
        updatedAt: NOW - 69 * MS_PER_DAY,
        accessCount: 10,
        memoryLayer: 'semantic',
        now: NOW,
      });
      // e^(-0.01 Ã— 69) â‰ˆ 0.502 Ã— 1.0 â‰ˆ 0.502 â†’ 50
      expect(score).toBeGreaterThanOrEqual(49);
      expect(score).toBeLessThanOrEqual(51);
    });

    it('very old doc (365 days) with zero access â†’ near zero', () => {
      const score = computeDecayScore({
        updatedAt: NOW - 365 * MS_PER_DAY,
        accessCount: 0,
        memoryLayer: 'semantic',
        now: NOW,
      });
      // e^(-0.01 Ã— 365) â‰ˆ 0.026 Ã— 0.5 â‰ˆ 0.013 â†’ 1
      expect(score).toBeLessThanOrEqual(3);
    });
    it('extreme dormancy reaches zero boundary', () => {
      const score = computeDecayScore({
        updatedAt: NOW - 3650 * MS_PER_DAY,
        accessCount: 0,
        memoryLayer: 'semantic',
        now: NOW,
      });
      expect(score).toBe(0);
    });

    it('reinforcement after long dormancy improves score but remains recency-bounded', () => {
      const dormant = computeDecayScore({
        updatedAt: NOW - 365 * MS_PER_DAY,
        accessCount: 0,
        memoryLayer: 'semantic',
        now: NOW,
      });
      const reinforced = computeDecayScore({
        updatedAt: NOW - 365 * MS_PER_DAY,
        accessCount: 50,
        memoryLayer: 'semantic',
        now: NOW,
      });
      expect(reinforced).toBeGreaterThan(dormant);
      expect(reinforced).toBeLessThanOrEqual(5);
    });

    // user_model never decays
    it('user_model â†’ always 100 regardless of age/access', () => {
      const score = computeDecayScore({
        updatedAt: NOW - 365 * MS_PER_DAY,
        accessCount: 0,
        memoryLayer: 'user_model',
        now: NOW,
      });
      expect(score).toBe(100);
    });

    // procedural decays slower (Î»=0.005, half-life ~139 days)
    it('procedural at 69 days â†’ decays slower than semantic', () => {
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

    it('procedural at 139 days (~half-life) â†’ score ~50% with max access', () => {
      const score = computeDecayScore({
        updatedAt: NOW - 139 * MS_PER_DAY,
        accessCount: 10,
        memoryLayer: 'procedural',
        now: NOW,
      });
      // e^(-0.005 Ã— 139) â‰ˆ 0.499 Ã— 1.0 â‰ˆ 0.499 â†’ 50
      expect(score).toBeGreaterThanOrEqual(48);
      expect(score).toBeLessThanOrEqual(52);
    });

    // null layer treated as default (semantic-like)
    it('null layer uses default Î»', () => {
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

    // null updatedAt â†’ treat as now (fresh)
    it('null updatedAt â†’ fresh', () => {
      const score = computeDecayScore({
        updatedAt: null,
        accessCount: 10,
        now: NOW,
      });
      expect(score).toBe(100);
    });

    // null accessCount â†’ 0
    it('null accessCount â†’ treated as 0', () => {
      const score = computeDecayScore({
        updatedAt: NOW,
        accessCount: null,
        now: NOW,
      });
      expect(score).toBe(50);
    });

    // Access factor intermediate values
    it('5 accesses â†’ accessFactor = 0.75', () => {
      const score = computeDecayScore({
        updatedAt: NOW,
        accessCount: 5,
        memoryLayer: 'semantic',
        now: NOW,
      });
      // recency=1.0 Ã— access=0.75 â†’ 75
      expect(score).toBe(75);
    });

    it('20 accesses â†’ accessFactor capped at 1.0', () => {
      const score = computeDecayScore({
        updatedAt: NOW,
        accessCount: 20,
        memoryLayer: 'semantic',
        now: NOW,
      });
      // recency=1.0 Ã— access=1.0 â†’ 100
      expect(score).toBe(100);
    });

    it('rapid access boosts saturate at 10 accesses', () => {
      const score10 = computeDecayScore({
        updatedAt: NOW,
        accessCount: 10,
        memoryLayer: 'semantic',
        now: NOW,
      });
      const score100 = computeDecayScore({
        updatedAt: NOW,
        accessCount: 100,
        memoryLayer: 'semantic',
        now: NOW,
      });
      expect(score10).toBe(100);
      expect(score100).toBe(score10);
    });
  });

  // ============================================================
  // computeConfidence()
  // ============================================================
  describe('computeConfidence()', () => {
    it('human origin â†’ 0.95', () => {
      expect(computeConfidence('human')).toBe(0.95);
    });

    it('mother origin â†’ 0.90', () => {
      expect(computeConfidence('mother')).toBe(0.90);
    });

    it('source with URL â†’ 0.80', () => {
      expect(computeConfidence(null, 'https://example.com/doc')).toBe(0.80);
    });

    it('source with correction â†’ 0.85', () => {
      expect(computeConfidence(null, 'corrected by user')).toBe(0.85);
    });

    it('source with "fix" â†’ 0.85', () => {
      expect(computeConfidence(null, 'fix: corrected output')).toBe(0.85);
    });

    it('no origin, no source â†’ 0.60', () => {
      expect(computeConfidence()).toBe(0.60);
    });

    it('null origin, null source â†’ 0.60', () => {
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
    it('floatToInt(0.5) â†’ 50 â†’ intToFloat back â†’ 0.5', () => {
      const stored = floatToInt(0.5);
      expect(stored).toBe(50);
      expect(intToFloat(stored)).toBe(0.5);
    });

    it('floatToInt(0.75) â†’ 75 â†’ intToFloat back â†’ 0.75', () => {
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


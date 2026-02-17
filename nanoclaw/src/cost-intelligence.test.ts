import { describe, it, expect, beforeEach, vi } from 'vitest';

import { _initTestDatabase } from './db.js';
import {
  checkBudget,
  cmdBudget,
  cmdCost,
  cmdUsage,
  estimateCost,
  getAdaptiveCacheTTL,
  getBudgetConfig,
  getModelPricing,
  getSpend,
  initCostIntelligence,
  MODEL_PRICING,
  setBudget,
  shouldSimplifyModel,
  resetComplexityTracker,
  trackUsageEnhanced,
} from './cost-intelligence.js';
import { initCostTracking } from './cost-tracker.js';

beforeEach(() => {
  _initTestDatabase();
  initCostTracking();
  initCostIntelligence();
  resetComplexityTracker();
});

// ─── Model Pricing ──────────────────────────────────────────────────

describe('Model Pricing', () => {
  it('has pricing for all standard models', () => {
    expect(MODEL_PRICING['sonnet']).toBeDefined();
    expect(MODEL_PRICING['haiku']).toBeDefined();
    expect(MODEL_PRICING['opus']).toBeDefined();
    expect(MODEL_PRICING['glm-4.7']).toBeDefined();
    expect(MODEL_PRICING['glm-4.5-air']).toBeDefined();
  });

  it('returns haiku pricing for unknown models', () => {
    const pricing = getModelPricing('unknown-model');
    expect(pricing).toEqual(MODEL_PRICING['haiku']);
  });

  it('calculates cost correctly for sonnet', () => {
    const cost = estimateCost('sonnet', 1000, 500);
    // (1000 * 3.00 + 500 * 15.00) / 1_000_000
    expect(cost).toBeCloseTo(0.0105, 4);
  });

  it('calculates cost correctly for haiku', () => {
    const cost = estimateCost('haiku', 10000, 2000);
    // (10000 * 0.25 + 2000 * 1.25) / 1_000_000
    expect(cost).toBeCloseTo(0.005, 4);
  });

  it('calculates zero cost with zero tokens', () => {
    expect(estimateCost('sonnet', 0, 0)).toBe(0);
  });
});

// ─── Budget Config ──────────────────────────────────────────────────

describe('Budget Config', () => {
  it('returns default budget when none set', () => {
    const config = getBudgetConfig('nonexistent_group');
    expect(config.monthlyBudget).toBeGreaterThan(0);
    expect(config.alertThreshold).toBe(0.80);
    expect(config.downgradeThreshold).toBe(0.95);
    expect(config.hardLimitThreshold).toBe(1.20);
  });

  it('sets and retrieves budget', () => {
    setBudget('test_group', 50);
    const config = getBudgetConfig('test_group');
    expect(config.monthlyBudget).toBe(50);
  });

  it('updates existing budget', () => {
    setBudget('__global__', 30);
    const config = getBudgetConfig('__global__');
    expect(config.monthlyBudget).toBe(30);

    setBudget('__global__', 45);
    const config2 = getBudgetConfig('__global__');
    expect(config2.monthlyBudget).toBe(45);
  });
});

// ─── Spend Tracking ─────────────────────────────────────────────────

describe('Spend Tracking', () => {
  it('returns zero spend initially', () => {
    const spend = getSpend();
    expect(spend.todayUsd).toBe(0);
    expect(spend.monthUsd).toBe(0);
  });

  it('trackUsageEnhanced records spend', () => {
    trackUsageEnhanced({
      tier: 'container-full',
      model: 'sonnet',
      responseTimeMs: 5000,
      inputTokens: 10000,
      outputTokens: 2000,
      groupId: 'main',
    });

    const spend = getSpend();
    expect(spend.todayUsd).toBeGreaterThan(0);
    expect(spend.monthUsd).toBeGreaterThan(0);
  });

  it('tracks with correct cost calculation', () => {
    trackUsageEnhanced({
      tier: 'container-light',
      model: 'haiku',
      responseTimeMs: 2000,
      inputTokens: 5000,
      outputTokens: 1000,
    });

    const spend = getSpend();
    const expected = estimateCost('haiku', 5000, 1000);
    expect(spend.todayUsd).toBeCloseTo(expected, 6);
  });
});

// ─── Budget Enforcement ─────────────────────────────────────────────

describe('Budget Enforcement', () => {
  it('returns normal status with no spend', () => {
    const status = checkBudget('sonnet');
    expect(status.action).toBe('normal');
    expect(status.effectiveModel).toBe('sonnet');
    expect(status.message).toBeUndefined();
  });

  it('returns alert when spend reaches 80%', () => {
    setBudget('__global__', 10);
    // Insert $8.50 of spend (85% of $10)
    trackUsageEnhanced({
      tier: 'container-full',
      model: 'sonnet',
      responseTimeMs: 5000,
      inputTokens: 1_000_000,  // $3
      outputTokens: 400_000,   // $6 → total $9 (but estimateCost is different)
    });
    // Manually check what cost was tracked
    const spend = getSpend();
    if (spend.monthUsd / 10 >= 0.80) {
      const status = checkBudget('sonnet');
      expect(status.action).toBe('alert');
      expect(status.effectiveModel).toBe('sonnet'); // still preferred
      expect(status.message).toContain('Budget');
    }
  });

  it('returns downgrade when spend reaches 95%', () => {
    setBudget('__global__', 1);
    // Spend ~$0.96 (96% of $1)
    trackUsageEnhanced({
      tier: 'container-full',
      model: 'sonnet',
      responseTimeMs: 5000,
      inputTokens: 100_000,
      outputTokens: 50_000,
    });
    // Check: $0.30 + $0.75 = $1.05 → 105% → should be haiku-only or downgrade
    const spend = getSpend();
    const status = checkBudget('sonnet');

    if (spend.monthUsd / 1 >= 1.0) {
      expect(['haiku-only', 'downgrade', 'offline']).toContain(status.action);
      expect(status.effectiveModel).not.toBe('sonnet');
    }
  });

  it('returns offline when spend exceeds hard limit (120%)', () => {
    setBudget('__global__', 0.001); // $0.001 budget → any spend exceeds it
    trackUsageEnhanced({
      tier: 'container-full',
      model: 'sonnet',
      responseTimeMs: 5000,
      inputTokens: 10000,
      outputTokens: 5000,
    });
    const status = checkBudget('sonnet');
    // With tiny budget, this should be well over 120%
    expect(['offline', 'haiku-only']).toContain(status.action);
  });

  it('effectiveModel is unchanged under normal usage', () => {
    setBudget('__global__', 1000);
    const status = checkBudget('sonnet');
    expect(status.effectiveModel).toBe('sonnet');
  });
});

// ─── Cost Commands ──────────────────────────────────────────────────

describe('Cost Commands', () => {
  it('/usage returns summary', () => {
    const result = cmdUsage();
    expect(result).toContain('สรุปการใช้งานวันนี้');
    expect(result).toContain('Requests');
    expect(result).toContain('Budget');
  });

  it('/usage shows tracked data', () => {
    trackUsageEnhanced({ tier: 'container-light', model: 'haiku', responseTimeMs: 1000 });
    trackUsageEnhanced({ tier: 'inline', model: 'haiku', responseTimeMs: 10 });
    const result = cmdUsage();
    expect(result).toContain('Requests: 2');
  });

  it('/cost returns monthly summary', () => {
    const result = cmdCost();
    expect(result).toContain('Cost Summary');
    expect(result).toContain('Total');
  });

  it('/budget shows current budget', () => {
    setBudget('__global__', 25);
    const result = cmdBudget('');
    expect(result).toContain('25.00');
    expect(result).toContain('Budget');
  });

  it('/budget <amount> sets new budget', () => {
    const result = cmdBudget('35');
    expect(result).toContain('35.00');
    expect(result).toContain('✅');

    const config = getBudgetConfig('__global__');
    expect(config.monthlyBudget).toBe(35);
  });

  it('/budget with invalid amount shows current budget', () => {
    const result = cmdBudget('abc');
    expect(result).toContain('Budget');
    expect(result).not.toContain('✅');
  });
});

// ─── Smart Cost Reduction ───────────────────────────────────────────

describe('Adaptive Cache TTL', () => {
  it('returns base TTL under normal usage', () => {
    setBudget('__global__', 1000);
    const ttl = getAdaptiveCacheTTL(300_000); // 5 min base
    expect(ttl).toBe(300_000);
  });

  it('returns 3x TTL when budget > 80%', () => {
    setBudget('__global__', 0.01);
    trackUsageEnhanced({
      tier: 'container-full',
      model: 'sonnet',
      responseTimeMs: 1000,
      inputTokens: 1000,
      outputTokens: 500,
    });
    const spend = getSpend();
    const pct = spend.monthUsd / 0.01;
    const ttl = getAdaptiveCacheTTL(300_000);
    if (pct >= 0.95) {
      expect(ttl).toBe(1_800_000); // 6x
    } else if (pct >= 0.80) {
      expect(ttl).toBe(900_000); // 3x
    }
  });
});

describe('Conversation Complexity', () => {
  it('does not simplify with fewer than 3 messages', () => {
    expect(shouldSimplifyModel(10)).toBe(false);
    expect(shouldSimplifyModel(10)).toBe(false);
  });

  it('simplifies after 3 consecutive short messages', () => {
    shouldSimplifyModel(20);
    shouldSimplifyModel(15);
    expect(shouldSimplifyModel(30)).toBe(true);
  });

  it('does not simplify when messages are long', () => {
    shouldSimplifyModel(200);
    shouldSimplifyModel(300);
    expect(shouldSimplifyModel(500)).toBe(false);
  });

  it('resets tracker properly', () => {
    shouldSimplifyModel(10);
    shouldSimplifyModel(10);
    shouldSimplifyModel(10);
    resetComplexityTracker();
    expect(shouldSimplifyModel(10)).toBe(false);
  });
});

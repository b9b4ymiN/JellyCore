/**
 * Cost Tracker — Track API usage and costs per tier
 *
 * Logs usage to SQLite for monitoring and budget alerts.
 */

import { getDb } from './db.js';
import type { QueryTier } from './query-router.js';

// Ensure table exists
export function initCostTracking(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      user_id TEXT NOT NULL DEFAULT 'system',
      tier TEXT NOT NULL,
      model TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      estimated_cost_usd REAL DEFAULT 0,
      response_time_ms INTEGER DEFAULT 0
    )
  `);
}

// Cost per 1M tokens (approximate, z.ai GLM subscription pricing)
// Internal aliases: sonnet→GLM-4.7, haiku→GLM-4.7-Flash, opus→GLM-4.7
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  haiku:  { input: 0.10, output: 0.40 },  // → GLM-4.7-Flash
  sonnet: { input: 0.50, output: 2.00 },  // → GLM-4.7
  opus:   { input: 0.50, output: 2.00 },  // → GLM-4.7
};

export function trackUsage(
  tier: QueryTier,
  model: string,
  responseTimeMs: number,
  inputTokens: number = 0,
  outputTokens: number = 0,
  userId: string = 'system',
): void {
  const costs = MODEL_COSTS[model] || { input: 0, output: 0 };
  const estimatedCost = (inputTokens * costs.input + outputTokens * costs.output) / 1_000_000;

  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO usage_tracking (user_id, tier, model, input_tokens, output_tokens, estimated_cost_usd, response_time_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, tier, model, inputTokens, outputTokens, estimatedCost, responseTimeMs);
  } catch {
    // Don't let tracking failures break message flow
  }
}

export function getCostSummary(): {
  today: { requests: number; cost: number };
  thisMonth: { requests: number; cost: number };
} {
  try {
    const db = getDb();

    const today = db.prepare(`
      SELECT COUNT(*) as requests, COALESCE(SUM(estimated_cost_usd), 0) as cost
      FROM usage_tracking
      WHERE date(timestamp) = date('now')
    `).get() as { requests: number; cost: number };

    const thisMonth = db.prepare(`
      SELECT COUNT(*) as requests, COALESCE(SUM(estimated_cost_usd), 0) as cost
      FROM usage_tracking
      WHERE strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')
    `).get() as { requests: number; cost: number };

    return {
      today: { requests: today?.requests || 0, cost: today?.cost || 0 },
      thisMonth: { requests: thisMonth?.requests || 0, cost: thisMonth?.cost || 0 },
    };
  } catch {
    return {
      today: { requests: 0, cost: 0 },
      thisMonth: { requests: 0, cost: 0 },
    };
  }
}

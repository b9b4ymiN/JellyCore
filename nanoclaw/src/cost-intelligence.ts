/**
 * Cost Intelligence — Budget enforcement, model pricing, auto-downgrade
 *
 * Extends the basic cost-tracker with:
 *  - Configurable model pricing (Claude + GLM models)
 *  - Per-group monthly/daily budgets with thresholds
 *  - Auto-downgrade when approaching budget limits
 *  - Cost chat commands (/usage, /cost, /budget)
 *  - Smart cost reduction (aggressive caching near budget)
 *
 * Phase 5 Part C — v0.8.0
 */

import { getDb } from './db.js';
import { logger } from './logger.js';
import type { QueryTier } from './query-router.js';

// ─── Model Pricing ──────────────────────────────────────────────────

export interface ModelPricing {
  inputPer1M: number;   // USD per 1M input tokens
  outputPer1M: number;  // USD per 1M output tokens
  contextWindow: number;
}

/** Configurable model pricing — supports Claude + GLM models */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'sonnet':          { inputPer1M: 3.00,  outputPer1M: 15.00, contextWindow: 200_000 },
  'haiku':           { inputPer1M: 0.25,  outputPer1M: 1.25,  contextWindow: 200_000 },
  'opus':            { inputPer1M: 15.00, outputPer1M: 75.00, contextWindow: 200_000 },
  'claude-sonnet-4': { inputPer1M: 3.00,  outputPer1M: 15.00, contextWindow: 200_000 },
  'claude-haiku-3.5':{ inputPer1M: 0.25,  outputPer1M: 1.25,  contextWindow: 200_000 },
  'glm-4.7':         { inputPer1M: 0.50,  outputPer1M: 2.00,  contextWindow: 128_000 },
  'glm-4.5-air':     { inputPer1M: 0.10,  outputPer1M: 0.50,  contextWindow: 128_000 },
};

export function getModelPricing(model: string): ModelPricing {
  return MODEL_PRICING[model] || MODEL_PRICING['haiku'];
}

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = getModelPricing(model);
  return (inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000;
}

// ─── Budget Thresholds ──────────────────────────────────────────────

export interface BudgetConfig {
  monthlyBudget: number;      // USD/month
  dailyBudget: number;        // USD/day (0 = unlimited)
  alertThreshold: number;     // fraction (0.8 = 80%)
  downgradeThreshold: number; // fraction (0.95 = 95%)
  hardLimitThreshold: number; // fraction (1.2 = 120%)
  preferredModel: string;
  downgradeModel: string;
}

const DEFAULT_BUDGET: BudgetConfig = {
  monthlyBudget: parseFloat(process.env.MONTHLY_BUDGET || '20'),
  dailyBudget: parseFloat(process.env.DAILY_BUDGET || '0'),
  alertThreshold: 0.80,
  downgradeThreshold: 0.95,
  hardLimitThreshold: 1.20,
  preferredModel: 'sonnet',
  downgradeModel: 'haiku',
};

export type BudgetAction = 'normal' | 'alert' | 'downgrade' | 'haiku-only' | 'offline';

export interface BudgetStatus {
  action: BudgetAction;
  spendToday: number;
  spendMonth: number;
  budgetMonth: number;
  usagePct: number;        // 0–1+
  effectiveModel: string;  // model to actually use
  message?: string;        // alert message for user
}

// ─── Schema ─────────────────────────────────────────────────────────

export function initCostIntelligence(): void {
  const db = getDb();

  // Extend existing usage_tracking with new columns (safe migrations)
  const migrations = [
    'ALTER TABLE usage_tracking ADD COLUMN group_id TEXT DEFAULT \'main\'',
    'ALTER TABLE usage_tracking ADD COLUMN trace_id TEXT',
    'ALTER TABLE usage_tracking ADD COLUMN cache_hit INTEGER DEFAULT 0',
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch { /* column already exists */ }
  }

  // Budget configuration table
  db.exec(`
    CREATE TABLE IF NOT EXISTS cost_budgets (
      group_id TEXT PRIMARY KEY,
      monthly_budget REAL NOT NULL DEFAULT 20,
      daily_budget REAL NOT NULL DEFAULT 0,
      alert_threshold REAL NOT NULL DEFAULT 0.80,
      downgrade_threshold REAL NOT NULL DEFAULT 0.95,
      hard_limit_threshold REAL NOT NULL DEFAULT 1.20,
      preferred_model TEXT NOT NULL DEFAULT 'sonnet',
      downgrade_model TEXT NOT NULL DEFAULT 'haiku',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Alert log table
  db.exec(`
    CREATE TABLE IF NOT EXISTS cost_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      threshold_pct REAL NOT NULL,
      current_spend REAL NOT NULL,
      budget_limit REAL NOT NULL,
      action_taken TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Ensure default budget exists
  db.prepare(`
    INSERT OR IGNORE INTO cost_budgets (group_id) VALUES ('__global__')
  `).run();
}

// ─── Budget CRUD ────────────────────────────────────────────────────

export function getBudgetConfig(groupId: string = '__global__'): BudgetConfig {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM cost_budgets WHERE group_id = ?',
  ).get(groupId) as Record<string, unknown> | undefined;

  if (!row) return DEFAULT_BUDGET;

  return {
    monthlyBudget: (row.monthly_budget as number) || DEFAULT_BUDGET.monthlyBudget,
    dailyBudget: (row.daily_budget as number) || DEFAULT_BUDGET.dailyBudget,
    alertThreshold: (row.alert_threshold as number) || DEFAULT_BUDGET.alertThreshold,
    downgradeThreshold: (row.downgrade_threshold as number) || DEFAULT_BUDGET.downgradeThreshold,
    hardLimitThreshold: (row.hard_limit_threshold as number) || DEFAULT_BUDGET.hardLimitThreshold,
    preferredModel: (row.preferred_model as string) || DEFAULT_BUDGET.preferredModel,
    downgradeModel: (row.downgrade_model as string) || DEFAULT_BUDGET.downgradeModel,
  };
}

export function setBudget(groupId: string, monthlyBudget: number): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO cost_budgets (group_id, monthly_budget, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(group_id) DO UPDATE SET
      monthly_budget = excluded.monthly_budget,
      updated_at = datetime('now')
  `).run(groupId, monthlyBudget);
}

// ─── Spend Tracking ─────────────────────────────────────────────────

/** Spend cache — avoid querying DB every request */
let spendCache: { todayUsd: number; monthUsd: number; cachedAt: number } | null = null;
const SPEND_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function invalidateSpendCache(): void {
  spendCache = null;
}

export function getSpend(): { todayUsd: number; monthUsd: number } {
  if (spendCache && Date.now() - spendCache.cachedAt < SPEND_CACHE_TTL) {
    return { todayUsd: spendCache.todayUsd, monthUsd: spendCache.monthUsd };
  }

  try {
    const db = getDb();

    const today = db.prepare(`
      SELECT COALESCE(SUM(estimated_cost_usd), 0) as cost
      FROM usage_tracking
      WHERE date(timestamp) = date('now')
    `).get() as { cost: number };

    const month = db.prepare(`
      SELECT COALESCE(SUM(estimated_cost_usd), 0) as cost
      FROM usage_tracking
      WHERE strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')
    `).get() as { cost: number };

    const result = { todayUsd: today.cost, monthUsd: month.cost };
    spendCache = { ...result, cachedAt: Date.now() };
    return result;
  } catch {
    return { todayUsd: 0, monthUsd: 0 };
  }
}

// ─── Budget Enforcement ─────────────────────────────────────────────

/**
 * Check budget status and determine what action to take.
 * Called before every LLM request.
 *
 * Returns the effective model to use and any alert to show.
 */
export function checkBudget(requestedModel: string = 'sonnet', groupId: string = '__global__'): BudgetStatus {
  const config = getBudgetConfig(groupId);
  const spend = getSpend();
  const pct = config.monthlyBudget > 0 ? spend.monthUsd / config.monthlyBudget : 0;

  // Daily budget check (if configured)
  if (config.dailyBudget > 0 && spend.todayUsd >= config.dailyBudget) {
    return {
      action: 'haiku-only',
      spendToday: spend.todayUsd,
      spendMonth: spend.monthUsd,
      budgetMonth: config.monthlyBudget,
      usagePct: pct,
      effectiveModel: config.downgradeModel,
      message: `⚠️ Daily budget reached ($${spend.todayUsd.toFixed(2)}/$${config.dailyBudget.toFixed(2)}) — using ${config.downgradeModel}`,
    };
  }

  // > 120% hard limit
  if (pct >= config.hardLimitThreshold) {
    logAlert(groupId, 'budget_exceeded', pct, spend.monthUsd, config.monthlyBudget, 'offline');
    return {
      action: 'offline',
      spendToday: spend.todayUsd,
      spendMonth: spend.monthUsd,
      budgetMonth: config.monthlyBudget,
      usagePct: pct,
      effectiveModel: 'none',
      message: `⛔ Budget เดือนนี้เกินแล้ว ($${spend.monthUsd.toFixed(2)}/$${config.monthlyBudget.toFixed(2)}) — ขออภัย ใช้งาน inline เท่านั้นค่ะ`,
    };
  }

  // 100-120% haiku only
  if (pct >= 1.0) {
    logAlert(groupId, 'budget_exceeded', pct, spend.monthUsd, config.monthlyBudget, 'haiku-only');
    return {
      action: 'haiku-only',
      spendToday: spend.todayUsd,
      spendMonth: spend.monthUsd,
      budgetMonth: config.monthlyBudget,
      usagePct: pct,
      effectiveModel: config.downgradeModel,
      message: `🔴 Budget เกิน ($${spend.monthUsd.toFixed(2)}/$${config.monthlyBudget.toFixed(2)}) — ใช้ ${config.downgradeModel} อย่างเดียวค่ะ`,
    };
  }

  // 95-100% auto-downgrade
  if (pct >= config.downgradeThreshold) {
    const effective = config.downgradeModel;
    if (requestedModel !== effective) {
      logAlert(groupId, 'budget_downgrade', pct, spend.monthUsd, config.monthlyBudget, `downgrade:${requestedModel}→${effective}`);
    }
    return {
      action: 'downgrade',
      spendToday: spend.todayUsd,
      spendMonth: spend.monthUsd,
      budgetMonth: config.monthlyBudget,
      usagePct: pct,
      effectiveModel: effective,
      message: `🔶 Budget ${Math.round(pct * 100)}% — auto-downgrade เป็น ${effective} เพื่อประหยัดค่ะ`,
    };
  }

  // 80-95% alert (still use preferred model)
  if (pct >= config.alertThreshold) {
    logAlert(groupId, 'budget_warn', pct, spend.monthUsd, config.monthlyBudget, 'warn');
    return {
      action: 'alert',
      spendToday: spend.todayUsd,
      spendMonth: spend.monthUsd,
      budgetMonth: config.monthlyBudget,
      usagePct: pct,
      effectiveModel: requestedModel,
      message: `⚠️ Budget ${Math.round(pct * 100)}% ($${spend.monthUsd.toFixed(2)}/$${config.monthlyBudget.toFixed(2)})`,
    };
  }

  // < 80% normal
  return {
    action: 'normal',
    spendToday: spend.todayUsd,
    spendMonth: spend.monthUsd,
    budgetMonth: config.monthlyBudget,
    usagePct: pct,
    effectiveModel: requestedModel,
  };
}

/**
 * Enhanced usage tracking — replaces basic trackUsage().
 * Adds group_id, trace_id, cache_hit columns.
 */
export function trackUsageEnhanced(params: {
  tier: QueryTier;
  model: string;
  responseTimeMs: number;
  inputTokens?: number;
  outputTokens?: number;
  userId?: string;
  groupId?: string;
  traceId?: string;
  cacheHit?: boolean;
}): void {
  const cost = estimateCost(params.model, params.inputTokens || 0, params.outputTokens || 0);

  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO usage_tracking (user_id, tier, model, input_tokens, output_tokens, estimated_cost_usd, response_time_ms, group_id, trace_id, cache_hit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.userId || 'system',
      params.tier,
      params.model,
      params.inputTokens || 0,
      params.outputTokens || 0,
      cost,
      params.responseTimeMs,
      params.groupId || 'main',
      params.traceId || null,
      params.cacheHit ? 1 : 0,
    );

    // Invalidate spend cache after new tracking entry
    invalidateSpendCache();
  } catch (err) {
    logger.warn({ err }, 'Failed to track usage');
  }
}

// ─── Alert Logging ──────────────────────────────────────────────────

/** Rate-limit alerts: max 1 per type per hour */
const alertCooldowns = new Map<string, number>();
const ALERT_COOLDOWN = 60 * 60 * 1000; // 1 hour

function logAlert(
  groupId: string,
  alertType: string,
  pct: number,
  spend: number,
  budget: number,
  action: string,
): void {
  const key = `${groupId}:${alertType}`;
  const now = Date.now();
  const last = alertCooldowns.get(key) || 0;
  if (now - last < ALERT_COOLDOWN) return;

  alertCooldowns.set(key, now);

  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO cost_alerts (group_id, alert_type, threshold_pct, current_spend, budget_limit, action_taken)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(groupId, alertType, pct, spend, budget, action);

    logger.warn(
      { groupId, alertType, pct: Math.round(pct * 100), spend: spend.toFixed(2), budget },
      'Budget alert triggered',
    );
  } catch (err) {
    logger.warn({ err }, 'Failed to log cost alert');
  }
}

// ─── Cost Commands ──────────────────────────────────────────────────

/** /usage — Today's usage summary */
export function cmdUsage(): string {
  try {
    const db = getDb();
    const spend = getSpend();
    const config = getBudgetConfig();
    const pct = config.monthlyBudget > 0 ? Math.round((spend.monthUsd / config.monthlyBudget) * 100) : 0;

    // Tier breakdown for today
    const tiers = db.prepare(`
      SELECT tier, COUNT(*) as count, COALESCE(SUM(estimated_cost_usd), 0) as cost
      FROM usage_tracking
      WHERE date(timestamp) = date('now')
      GROUP BY tier
    `).all() as Array<{ tier: string; count: number; cost: number }>;

    const totalRequests = tiers.reduce((sum, t) => sum + t.count, 0);

    const lines = [
      '📊 *สรุปการใช้งานวันนี้*',
      '',
      `Requests: ${totalRequests}`,
    ];

    if (tiers.length > 0) {
      const tierStr = tiers.map(t => `${t.tier}: ${t.count}`).join(', ');
      lines.push(`  (${tierStr})`);
    }

    lines.push(
      `Cost: $${spend.todayUsd.toFixed(2)}`,
      `Budget: $${config.monthlyBudget}/month — ใช้ไป ${pct}% ($${spend.monthUsd.toFixed(2)})`,
    );

    // Top 3 costly requests today
    const top = db.prepare(`
      SELECT tier, model, estimated_cost_usd, response_time_ms
      FROM usage_tracking
      WHERE date(timestamp) = date('now') AND estimated_cost_usd > 0
      ORDER BY estimated_cost_usd DESC
      LIMIT 3
    `).all() as Array<{ tier: string; model: string; estimated_cost_usd: number; response_time_ms: number }>;

    if (top.length > 0) {
      lines.push('', '*Top costs:*');
      top.forEach((r, i) => {
        lines.push(`${i + 1}. ${r.tier} (${r.model}) — $${r.estimated_cost_usd.toFixed(3)} (${(r.response_time_ms / 1000).toFixed(1)}s)`);
      });
    }

    return lines.join('\n');
  } catch {
    return '❌ ไม่สามารถดึงข้อมูลการใช้งานได้ค่ะ';
  }
}

/** /cost — Monthly cost summary with trend */
export function cmdCost(): string {
  try {
    const db = getDb();
    const spend = getSpend();
    const config = getBudgetConfig();
    const pct = config.monthlyBudget > 0 ? Math.round((spend.monthUsd / config.monthlyBudget) * 100) : 0;

    // Weekly breakdown for current month
    const weeks = db.prepare(`
      SELECT
        CAST((strftime('%d', timestamp) - 1) / 7 + 1 AS INTEGER) as week_num,
        COUNT(*) as requests,
        COALESCE(SUM(estimated_cost_usd), 0) as cost
      FROM usage_tracking
      WHERE strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')
      GROUP BY week_num
      ORDER BY week_num
    `).all() as Array<{ week_num: number; requests: number; cost: number }>;

    // Model breakdown
    const models = db.prepare(`
      SELECT model, COUNT(*) as count, COALESCE(SUM(estimated_cost_usd), 0) as cost
      FROM usage_tracking
      WHERE strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')
      GROUP BY model
      ORDER BY cost DESC
    `).all() as Array<{ model: string; count: number; cost: number }>;

    const lines = [
      `💰 *Cost Summary — ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}*`,
      '',
    ];

    if (weeks.length > 0) {
      for (const w of weeks) {
        const days = Math.min(7, w.week_num === weeks.length ? new Date().getDate() - (w.week_num - 1) * 7 : 7);
        const avg = days > 0 ? (w.cost / days).toFixed(2) : '0.00';
        lines.push(`Week ${w.week_num}: $${w.cost.toFixed(2)} (avg $${avg}/day, ${w.requests} requests)`);
      }
    }

    lines.push(
      '',
      `Total: $${spend.monthUsd.toFixed(2)} / $${config.monthlyBudget.toFixed(2)} budget (${pct}%)`,
    );

    if (models.length > 0) {
      lines.push('', '*By Model:*');
      for (const m of models) {
        const modelPct = spend.monthUsd > 0 ? Math.round((m.cost / spend.monthUsd) * 100) : 0;
        lines.push(`- ${m.model || 'unknown'}: $${m.cost.toFixed(2)} (${modelPct}%, ${m.count} req)`);
      }
    }

    return lines.join('\n');
  } catch {
    return '❌ ไม่สามารถดึงข้อมูล cost ได้ค่ะ';
  }
}

/** /budget [amount] — View or set budget */
export function cmdBudget(args: string): string {
  const amount = parseFloat(args.trim());

  if (!isNaN(amount) && amount > 0) {
    setBudget('__global__', amount);
    invalidateSpendCache();
    return `Budget เดือนนี้ตั้งเป็น $${amount.toFixed(2)} แล้ว ✅`;
  }

  const config = getBudgetConfig();
  const spend = getSpend();
  const pct = config.monthlyBudget > 0 ? Math.round((spend.monthUsd / config.monthlyBudget) * 100) : 0;

  return [
    `💰 *Budget*`,
    '',
    `Monthly: $${config.monthlyBudget.toFixed(2)}`,
    `Used: $${spend.monthUsd.toFixed(2)} (${pct}%)`,
    `Today: $${spend.todayUsd.toFixed(2)}`,
    '',
    `ตั้ง Budget ใหม่: \`/budget <amount>\``,
    `เช่น: \`/budget 30\``,
  ].join('\n');
}

// ─── Smart Cost Reduction ───────────────────────────────────────────

/**
 * Get recommended Oracle cache TTL based on budget pressure.
 * Higher budget usage → longer cache TTL to reduce Oracle calls.
 */
export function getAdaptiveCacheTTL(baseTTL: number = 5 * 60 * 1000): number {
  const config = getBudgetConfig();
  const spend = getSpend();
  const pct = config.monthlyBudget > 0 ? spend.monthUsd / config.monthlyBudget : 0;

  if (pct >= 0.95) return baseTTL * 6; // 30 min
  if (pct >= 0.80) return baseTTL * 3; // 15 min
  return baseTTL;                       // 5 min (default)
}

/**
 * Check if a request should be downgraded based on conversation complexity.
 * 3+ consecutive short messages without tool calls → use cheaper model.
 */
const recentMessageLengths: number[] = [];
const MAX_TRACKED = 5;

export function shouldSimplifyModel(messageLength: number): boolean {
  recentMessageLengths.push(messageLength);
  if (recentMessageLengths.length > MAX_TRACKED) recentMessageLengths.shift();

  // Need at least 3 consecutive short messages
  if (recentMessageLengths.length < 3) return false;

  const last3 = recentMessageLengths.slice(-3);
  return last3.every(len => len < 50);
}

export function resetComplexityTracker(): void {
  recentMessageLengths.length = 0;
}

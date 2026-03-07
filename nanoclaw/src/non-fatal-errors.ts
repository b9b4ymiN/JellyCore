import { logger } from './logger.js';

const MAX_RECENT_NON_FATAL = 100;

interface NonFatalEntry {
  timestamp: string;
  category: string;
  message: string;
  context?: Record<string, unknown>;
}

const nonFatalCounts = new Map<string, number>();
const recentNonFatal: NonFatalEntry[] = [];

function normalizeMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  return String(err);
}

function increment(category: string): void {
  const safe = category.trim() || 'unknown';
  nonFatalCounts.set(safe, (nonFatalCounts.get(safe) || 0) + 1);
}

function addRecent(
  category: string,
  message: string,
  context?: Record<string, unknown>,
): void {
  recentNonFatal.push({
    timestamp: new Date().toISOString(),
    category,
    message: message.slice(0, 500),
    context,
  });
  if (recentNonFatal.length > MAX_RECENT_NON_FATAL) {
    recentNonFatal.shift();
  }
}

export function recordNonFatalError(
  category: string,
  err: unknown,
  context: Record<string, unknown> = {},
  logLevel: 'debug' | 'warn' = 'warn',
): void {
  const safeCategory = category.trim() || 'unknown';
  const message = normalizeMessage(err);
  increment(safeCategory);
  addRecent(safeCategory, message, Object.keys(context).length > 0 ? context : undefined);

  const payload = { category: safeCategory, ...context, err };
  if (logLevel === 'debug') {
    logger.debug(payload, 'Non-fatal error');
  } else {
    logger.warn(payload, 'Non-fatal error');
  }
}

export function recordNonFatalNote(
  category: string,
  message: string,
  context: Record<string, unknown> = {},
  logLevel: 'debug' | 'warn' = 'debug',
): void {
  const safeCategory = category.trim() || 'unknown';
  const safeMessage = message || 'non-fatal note';
  increment(safeCategory);
  addRecent(safeCategory, safeMessage, Object.keys(context).length > 0 ? context : undefined);

  const payload = { category: safeCategory, ...context };
  if (logLevel === 'debug') {
    logger.debug(payload, safeMessage);
  } else {
    logger.warn(payload, safeMessage);
  }
}

export function getNonFatalErrorStats(): {
  total: number;
  byCategory: Record<string, number>;
  recent: NonFatalEntry[];
} {
  const byCategory = Object.fromEntries(
    [...nonFatalCounts.entries()].sort((a, b) => b[1] - a[1]),
  );
  const total = Object.values(byCategory).reduce((sum, count) => sum + count, 0);
  return {
    total,
    byCategory,
    recent: recentNonFatal.slice(-20),
  };
}

export function resetNonFatalErrorStatsForTest(): void {
  nonFatalCounts.clear();
  recentNonFatal.length = 0;
}

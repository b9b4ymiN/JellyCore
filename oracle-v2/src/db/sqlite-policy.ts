import type { Database } from 'bun:sqlite';

export const SQLITE_PRAGMA_POLICY = {
  journalMode: 'WAL',
  busyTimeoutMs: 30000,
  synchronous: 'NORMAL',
  cacheSize: -20000,
} as const;

export interface SqlitePragmaSnapshot {
  journalMode: string;
  busyTimeoutMs: number;
  synchronous: string;
  cacheSize: number;
}

function getFirstValue(row: Record<string, unknown> | null | undefined): unknown {
  if (!row) return undefined;
  const values = Object.values(row);
  return values.length > 0 ? values[0] : undefined;
}

function readTextPragma(sqlite: Database, pragma: string): string {
  const row = sqlite.prepare(`PRAGMA ${pragma}`).get() as Record<string, unknown> | undefined;
  const value = getFirstValue(row);
  return String(value ?? '').toUpperCase();
}

function readNumberPragma(sqlite: Database, pragma: string): number {
  const row = sqlite.prepare(`PRAGMA ${pragma}`).get() as Record<string, unknown> | undefined;
  const value = getFirstValue(row);
  return Number(value ?? 0);
}

function normalizeSynchronous(value: number): string {
  if (value === 0) return 'OFF';
  if (value === 1) return 'NORMAL';
  if (value === 2) return 'FULL';
  if (value === 3) return 'EXTRA';
  return String(value);
}

export function applySqlitePragmaPolicy(
  sqlite: Database,
  label: string,
): SqlitePragmaSnapshot {
  sqlite.exec(`PRAGMA journal_mode = ${SQLITE_PRAGMA_POLICY.journalMode}`);
  sqlite.exec(`PRAGMA busy_timeout = ${SQLITE_PRAGMA_POLICY.busyTimeoutMs}`);
  sqlite.exec(`PRAGMA synchronous = ${SQLITE_PRAGMA_POLICY.synchronous}`);
  sqlite.exec(`PRAGMA cache_size = ${SQLITE_PRAGMA_POLICY.cacheSize}`);

  const snapshot: SqlitePragmaSnapshot = {
    journalMode: readTextPragma(sqlite, 'journal_mode'),
    busyTimeoutMs: readNumberPragma(sqlite, 'busy_timeout'),
    synchronous: normalizeSynchronous(readNumberPragma(sqlite, 'synchronous')),
    cacheSize: readNumberPragma(sqlite, 'cache_size'),
  };

  console.error(
    `[SQLitePolicy][${label}] journal_mode=${snapshot.journalMode} busy_timeout=${snapshot.busyTimeoutMs} synchronous=${snapshot.synchronous} cache_size=${snapshot.cacheSize}`,
  );

  return snapshot;
}

/**
 * Oracle v2 Drizzle Database Client
 */

import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import path from 'path';
import * as schema from './schema.js';

// Configuration - central location: ~/.oracle-v2/
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '/tmp';
const ORACLE_DATA_DIR = process.env.ORACLE_DATA_DIR || path.join(HOME_DIR, '.oracle-v2');
export const DB_PATH = process.env.ORACLE_DB_PATH || path.join(ORACLE_DATA_DIR, 'oracle.db');

// Create bun:sqlite connection
const sqlite = new Database(DB_PATH);

// Create Drizzle ORM instance
export const db = drizzle(sqlite, { schema });

// Export schema for use in queries
export * from './schema.js';

// Raw SQLite connection for FTS5 operations
export { sqlite };

/**
 * Initialize FTS5 virtual table (must use raw SQL)
 * Called separately since Drizzle doesn't manage FTS5
 */
export function initFts5() {
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS oracle_fts USING fts5(
      id UNINDEXED,
      content,
      concepts,
      tokenize='porter unicode61'
    )
  `);
}

/**
 * Ensure schema columns exist (Drizzle push doesn't auto-migrate)
 * Adds any missing columns that were added to schema.ts after initial creation.
 */
export function ensureSchema() {
  const columns = sqlite.prepare("PRAGMA table_info('oracle_documents')").all() as { name: string }[];
  const existing = new Set(columns.map(c => c.name));

  const migrations: [string, string][] = [
    ['is_private', 'ALTER TABLE oracle_documents ADD COLUMN is_private INTEGER DEFAULT 0'],
    // Embedding versioning (v0.5.0)
    ['embedding_model', "ALTER TABLE oracle_documents ADD COLUMN embedding_model TEXT DEFAULT 'all-MiniLM-L6-v2'"],
    ['embedding_version', 'ALTER TABLE oracle_documents ADD COLUMN embedding_version INTEGER DEFAULT 1'],
    ['embedding_hash', 'ALTER TABLE oracle_documents ADD COLUMN embedding_hash TEXT'],
    // v0.6.0: Chunking metadata
    ['chunk_index', 'ALTER TABLE oracle_documents ADD COLUMN chunk_index INTEGER'],
    ['total_chunks', 'ALTER TABLE oracle_documents ADD COLUMN total_chunks INTEGER'],
    ['parent_id', 'ALTER TABLE oracle_documents ADD COLUMN parent_id TEXT'],
  ];

  for (const [col, ddl] of migrations) {
    if (!existing.has(col)) {
      sqlite.exec(ddl);
      console.log(`[Schema] Added missing column: ${col}`);
    }
  }

  // Ensure indexes for embedding versioning
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_embedding_model ON oracle_documents(embedding_model)');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_parent_id ON oracle_documents(parent_id)');

  // Ensure search_log has results column
  const searchLogCols = sqlite.prepare("PRAGMA table_info('search_log')").all() as { name: string }[];
  const searchLogExisting = new Set(searchLogCols.map(c => c.name));
  if (!searchLogExisting.has('results')) {
    try {
      sqlite.exec('ALTER TABLE search_log ADD COLUMN results TEXT');
      console.log('[Schema] Added missing column: search_log.results');
    } catch { /* table might not exist yet */ }
  }
}

/**
 * Rebuild FTS5 table with Porter stemmer
 * Required when upgrading from non-stemmed to stemmed FTS
 */
export function rebuildFts5WithStemmer() {
  console.log('[FTS5] Starting rebuild with Porter stemmer...');

  // Backup existing data
  const existingData = sqlite.prepare('SELECT id, content, concepts FROM oracle_fts').all() as {
    id: string;
    content: string;
    concepts: string;
  }[];
  console.log(`[FTS5] Backed up ${existingData.length} documents`);

  // Drop old table
  sqlite.exec('DROP TABLE IF EXISTS oracle_fts');

  // Create new table with Porter stemmer
  sqlite.exec(`
    CREATE VIRTUAL TABLE oracle_fts USING fts5(
      id UNINDEXED,
      content,
      concepts,
      tokenize='porter unicode61'
    )
  `);
  console.log('[FTS5] Created new table with Porter stemmer');

  // Re-insert data
  const insertStmt = sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)');
  for (const row of existingData) {
    insertStmt.run(row.id, row.content, row.concepts);
  }
  console.log(`[FTS5] Re-inserted ${existingData.length} documents`);

  return existingData.length;
}

/**
 * Close database connection
 */
export function closeDb() {
  sqlite.close();
}

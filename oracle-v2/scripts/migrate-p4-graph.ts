#!/usr/bin/env bun
/**
 * Database Migration: Add Concept Relationships Table (P4)
 * 
 * Creates concept_relationships table for knowledge graph features.
 * Safe to run multiple times (uses IF NOT EXISTS).
 */

import { Database } from 'bun:sqlite';
import path from 'path';

const DB_PATH = process.env.ORACLE_DB_PATH || path.join(process.env.HOME || process.env.USERPROFILE || '', '.oracle-v2', 'oracle.db');

console.log(`[Migration] Database: ${DB_PATH}`);

const db = new Database(DB_PATH);

try {
  console.log('[Migration] Creating concept_relationships table...');
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS concept_relationships (
      id TEXT PRIMARY KEY,
      from_concept TEXT NOT NULL,
      to_concept TEXT NOT NULL,
      relationship_type TEXT NOT NULL,
      strength INTEGER DEFAULT 1,
      last_seen INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      metadata TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_rel_from ON concept_relationships(from_concept);
    CREATE INDEX IF NOT EXISTS idx_rel_to ON concept_relationships(to_concept);
    CREATE INDEX IF NOT EXISTS idx_rel_type ON concept_relationships(relationship_type);
    CREATE INDEX IF NOT EXISTS idx_rel_strength ON concept_relationships(strength);
  `);

  console.log('[Migration] ✅ concept_relationships table created');

  // Check counts
  const relCount = db.query('SELECT COUNT(*) as count FROM concept_relationships').get() as { count: number };

  console.log(`\n[Migration] 📊 Current data:`);
  console.log(`  Concept Relationships: ${relCount.count}`);

  console.log(`\n✅ Migration complete!`);
  console.log(`\nNext steps:`);
  console.log(`  1. Start server: bun run server`);
  console.log(`  2. Discover relationships: curl -X POST http://localhost:47778/api/graph/discover`);
} catch (error) {
  console.error('❌ Migration failed:', error);
  process.exit(1);
} finally {
  db.close();
}

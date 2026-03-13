#!/usr/bin/env bun
/**
 * Database Migration: Add Conversation Tables (P1)
 * 
 * Creates conversations and conversation_messages tables for full chat history.
 * Safe to run multiple times (uses IF NOT EXISTS).
 */

import { Database } from 'bun:sqlite';
import path from 'path';

const DB_PATH = process.env.ORACLE_DB_PATH || path.join(process.env.HOME || process.env.USERPROFILE || '', '.oracle-v2', 'oracle.db');

console.log(`[Migration] Database: ${DB_PATH}`);

const db = new Database(DB_PATH);

try {
  console.log('[Migration] Creating conversations table...');
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      title TEXT,
      summary TEXT,
      started_at INTEGER NOT NULL,
      last_message_at INTEGER NOT NULL,
      message_count INTEGER DEFAULT 0,
      is_archived INTEGER DEFAULT 0,
      tags TEXT,
      metadata TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_conv_group ON conversations(group_id);
    CREATE INDEX IF NOT EXISTS idx_conv_started ON conversations(started_at);
    CREATE INDEX IF NOT EXISTS idx_conv_last_message ON conversations(last_message_at);
    CREATE INDEX IF NOT EXISTS idx_conv_archived ON conversations(is_archived);
  `);

  console.log('[Migration] ✅ conversations table created');

  console.log('[Migration] Creating conversation_messages table...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      indexed INTEGER DEFAULT 0,
      tokens INTEGER,
      parent_message_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_msg_conv ON conversation_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_msg_user ON conversation_messages(user_id);
    CREATE INDEX IF NOT EXISTS idx_msg_group ON conversation_messages(group_id);
    CREATE INDEX IF NOT EXISTS idx_msg_created ON conversation_messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_msg_indexed ON conversation_messages(indexed);
    CREATE INDEX IF NOT EXISTS idx_msg_role ON conversation_messages(role);
  `);

  console.log('[Migration] ✅ conversation_messages table created');

  // Check counts
  const convCount = db.query('SELECT COUNT(*) as count FROM conversations').get() as { count: number };
  const msgCount = db.query('SELECT COUNT(*) as count FROM conversation_messages').get() as { count: number };

  console.log(`\n[Migration] 📊 Current data:`);
  console.log(`  Conversations: ${convCount.count}`);
  console.log(`  Messages: ${msgCount.count}`);

  console.log(`\n✅ Migration complete!`);
} catch (error) {
  console.error('❌ Migration failed:', error);
  process.exit(1);
} finally {
  db.close();
}

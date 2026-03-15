import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { ensureRuntimeSchema } from '../db/runtime-schema.js';

const TEST_DB_PATH = join(homedir(), '.oracle-v2', 'test-runtime-schema.db');

let sqlite: Database;

function columnNames(database: Database, table: string): string[] {
  return (database.query(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>)
    .map((row) => row.name);
}

function indexNames(database: Database, table: string): string[] {
  return (database.query(`PRAGMA index_list('${table}')`).all() as Array<{ name: string }>)
    .map((row) => row.name);
}

async function removeFileWithRetry(filePath: string, attempts = 10, delayMs = 50): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (existsSync(filePath)) {
        rmSync(filePath);
      }
      return;
    } catch (error) {
      if (attempt === attempts - 1) throw error;
      await Bun.sleep(delayMs);
    }
  }
}

describe('Runtime schema compatibility', () => {
  beforeAll(() => {
    const dir = join(homedir(), '.oracle-v2');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (existsSync(TEST_DB_PATH)) {
      rmSync(TEST_DB_PATH);
    }

    sqlite = new Database(TEST_DB_PATH);

    sqlite.exec(`
      CREATE TABLE oracle_documents (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        source_file TEXT NOT NULL,
        concepts TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL
      )
    `);

    sqlite.exec(`
      CREATE TABLE search_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    sqlite.exec(`
      CREATE TABLE forum_threads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        created_by TEXT DEFAULT 'human',
        status TEXT DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    sqlite.exec(`
      CREATE TABLE forum_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    sqlite.exec(`
      CREATE TABLE trace_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trace_id TEXT UNIQUE NOT NULL,
        query TEXT NOT NULL,
        query_type TEXT DEFAULT 'general',
        found_files TEXT,
        found_commits TEXT,
        found_issues TEXT,
        status TEXT DEFAULT 'raw',
        project TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    ensureRuntimeSchema(sqlite);
  });

  afterAll(async () => {
    sqlite.close();
    await Bun.sleep(50);
    await removeFileWithRetry(TEST_DB_PATH);
  });

  test('adds forum and trace columns required by MCP handlers', () => {
    expect(columnNames(sqlite, 'forum_threads')).toContain('issue_url');
    expect(columnNames(sqlite, 'forum_threads')).toContain('issue_number');
    expect(columnNames(sqlite, 'forum_threads')).toContain('synced_at');

    expect(columnNames(sqlite, 'forum_messages')).toContain('author');
    expect(columnNames(sqlite, 'forum_messages')).toContain('principles_found');
    expect(columnNames(sqlite, 'forum_messages')).toContain('patterns_found');
    expect(columnNames(sqlite, 'forum_messages')).toContain('search_query');
    expect(columnNames(sqlite, 'forum_messages')).toContain('comment_id');

    expect(columnNames(sqlite, 'trace_log')).toContain('found_retrospectives');
    expect(columnNames(sqlite, 'trace_log')).toContain('found_learnings');
    expect(columnNames(sqlite, 'trace_log')).toContain('found_resonance');
    expect(columnNames(sqlite, 'trace_log')).toContain('prev_trace_id');
    expect(columnNames(sqlite, 'trace_log')).toContain('next_trace_id');
    expect(columnNames(sqlite, 'trace_log')).toContain('child_trace_ids');
  });

  test('creates supersede_log, graph tables, and logging columns for legacy databases', () => {
    const supersedeExists = sqlite.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='supersede_log'"
    ).get();
    const graphExists = sqlite.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='concept_relationships'"
    ).get();

    expect(supersedeExists).toBeTruthy();
    expect(graphExists).toBeTruthy();
    expect(columnNames(sqlite, 'search_log')).toContain('project');
    expect(columnNames(sqlite, 'search_log')).toContain('results');
    expect(columnNames(sqlite, 'oracle_documents')).toContain('memory_layer');
    expect(columnNames(sqlite, 'oracle_documents')).toContain('embedding_model');
    expect(columnNames(sqlite, 'concept_relationships')).toEqual([
      'id',
      'from_concept',
      'to_concept',
      'relationship_type',
      'strength',
      'last_seen',
      'created_at',
      'metadata',
    ]);
    expect(indexNames(sqlite, 'concept_relationships')).toEqual(
      expect.arrayContaining(['idx_rel_from', 'idx_rel_to', 'idx_rel_type', 'idx_rel_strength']),
    );
  });

  test('upgraded schema accepts new MCP writes', () => {
    const now = Date.now();

    sqlite.exec(`
      INSERT INTO forum_threads (
        title, created_by, status, issue_url, issue_number, project, created_at, updated_at, synced_at
      ) VALUES (
        'Docker upgrade thread', 'tester', 'active', 'https://example.com/1', 1, 'github.com/test/project', ${now}, ${now}, ${now}
      )
    `);

    sqlite.exec(`
      INSERT INTO trace_log (
        trace_id, query, query_type, found_files, found_commits, found_issues,
        found_retrospectives, found_learnings, found_resonance,
        file_count, commit_count, issue_count, depth, parent_trace_id, child_trace_ids,
        prev_trace_id, next_trace_id, project, session_id, agent_count, duration_ms,
        status, awakening, distilled_to_id, distilled_at, created_at, updated_at
      ) VALUES (
        'trace-upgrade-test', 'upgrade trace', 'general', '[]', '[]', '[]',
        '[]', '[]', '[]',
        0, 0, 0, 0, NULL, '[]',
        NULL, NULL, 'github.com/test/project', 'session-1', 1, 10,
        'raw', NULL, NULL, NULL, ${now}, ${now}
      )
    `);

    sqlite.exec(`
      INSERT INTO supersede_log (
        old_path, old_id, old_title, old_type,
        new_path, new_id, new_title, reason,
        superseded_at, superseded_by, project
      ) VALUES (
        'ψ/memory/learnings/old.md', 'old-1', 'Old', 'learning',
        'ψ/memory/learnings/new.md', 'new-1', 'New', 'merged',
        ${now}, 'tester', 'github.com/test/project'
      )
    `);

    const threadRow = sqlite.query('SELECT issue_url, issue_number, synced_at FROM forum_threads WHERE title = ?')
      .get('Docker upgrade thread') as { issue_url: string; issue_number: number; synced_at: number } | null;
    const traceRow = sqlite.query('SELECT found_retrospectives, prev_trace_id, next_trace_id FROM trace_log WHERE trace_id = ?')
      .get('trace-upgrade-test') as { found_retrospectives: string; prev_trace_id: string | null; next_trace_id: string | null } | null;
    const supersedeRow = sqlite.query('SELECT reason FROM supersede_log WHERE old_id = ?')
      .get('old-1') as { reason: string } | null;

    expect(threadRow?.issue_url).toBe('https://example.com/1');
    expect(threadRow?.issue_number).toBe(1);
    expect(threadRow?.synced_at).toBe(now);
    expect(traceRow?.found_retrospectives).toBe('[]');
    expect(traceRow?.prev_trace_id).toBeNull();
    expect(traceRow?.next_trace_id).toBeNull();
    expect(supersedeRow?.reason).toBe('merged');
  });
});

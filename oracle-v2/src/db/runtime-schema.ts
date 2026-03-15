import type { Database } from 'bun:sqlite';

type ColumnMigration = [column: string, ddl: string];

function getColumns(database: Database, table: string): Set<string> {
  const rows = database.query(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function ensureColumns(database: Database, table: string, migrations: ColumnMigration[]): void {
  const existing = getColumns(database, table);
  for (const [column, ddl] of migrations) {
    if (!existing.has(column)) {
      database.exec(ddl);
      console.log(`[Schema] Added missing column: ${table}.${column}`);
    }
  }
}

export function ensureRuntimeSchema(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS oracle_documents (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      source_file TEXT NOT NULL,
      concepts TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL,
      superseded_by TEXT,
      superseded_at INTEGER,
      superseded_reason TEXT,
      origin TEXT,
      project TEXT,
      created_by TEXT,
      is_private INTEGER DEFAULT 0,
      embedding_model TEXT DEFAULT 'all-MiniLM-L6-v2',
      embedding_version INTEGER DEFAULT 1,
      embedding_hash TEXT,
      chunk_index INTEGER,
      total_chunks INTEGER,
      parent_id TEXT,
      memory_layer TEXT,
      confidence INTEGER,
      access_count INTEGER DEFAULT 0,
      last_accessed_at INTEGER,
      decay_score INTEGER DEFAULT 100,
      expires_at INTEGER
    )
  `);

  database.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS oracle_fts USING fts5(
      id UNINDEXED,
      content,
      concepts,
      tokenize='porter unicode61'
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS indexing_status (
      id INTEGER PRIMARY KEY,
      is_indexing INTEGER NOT NULL DEFAULT 0,
      progress_current INTEGER DEFAULT 0,
      progress_total INTEGER DEFAULT 0,
      started_at INTEGER,
      completed_at INTEGER,
      error TEXT,
      repo_root TEXT
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS search_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      type TEXT,
      mode TEXT,
      results_count INTEGER,
      search_time_ms INTEGER,
      created_at INTEGER NOT NULL,
      project TEXT,
      results TEXT
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS learn_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id TEXT NOT NULL,
      pattern_preview TEXT,
      source TEXT,
      concepts TEXT,
      created_at INTEGER NOT NULL,
      project TEXT
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS document_access (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id TEXT NOT NULL,
      access_type TEXT,
      created_at INTEGER NOT NULL,
      project TEXT
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS consult_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      decision TEXT NOT NULL,
      context TEXT,
      principles_found INTEGER,
      patterns_found INTEGER,
      guidance TEXT,
      created_at INTEGER NOT NULL,
      project TEXT
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS forum_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      created_by TEXT DEFAULT 'human',
      status TEXT DEFAULT 'active',
      issue_url TEXT,
      issue_number INTEGER,
      project TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      synced_at INTEGER
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS forum_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      author TEXT,
      principles_found INTEGER,
      patterns_found INTEGER,
      search_query TEXT,
      comment_id INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES forum_threads(id)
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      context TEXT,
      options TEXT,
      decision TEXT,
      rationale TEXT,
      project TEXT,
      tags TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      decided_at INTEGER,
      decided_by TEXT
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS trace_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id TEXT UNIQUE NOT NULL,
      query TEXT NOT NULL,
      query_type TEXT DEFAULT 'general',
      found_files TEXT,
      found_commits TEXT,
      found_issues TEXT,
      found_retrospectives TEXT,
      found_learnings TEXT,
      found_resonance TEXT,
      file_count INTEGER DEFAULT 0,
      commit_count INTEGER DEFAULT 0,
      issue_count INTEGER DEFAULT 0,
      depth INTEGER DEFAULT 0,
      parent_trace_id TEXT,
      child_trace_ids TEXT DEFAULT '[]',
      prev_trace_id TEXT,
      next_trace_id TEXT,
      project TEXT,
      session_id TEXT,
      agent_count INTEGER DEFAULT 1,
      duration_ms INTEGER,
      status TEXT DEFAULT 'raw',
      awakening TEXT,
      distilled_to_id TEXT,
      distilled_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS concept_relationships (
      id TEXT PRIMARY KEY,
      from_concept TEXT NOT NULL,
      to_concept TEXT NOT NULL,
      relationship_type TEXT NOT NULL,
      strength INTEGER DEFAULT 1,
      last_seen INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      metadata TEXT
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS supersede_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      old_path TEXT NOT NULL,
      old_id TEXT,
      old_title TEXT,
      old_type TEXT,
      new_path TEXT,
      new_id TEXT,
      new_title TEXT,
      reason TEXT,
      superseded_at INTEGER NOT NULL,
      superseded_by TEXT,
      project TEXT
    )
  `);

  ensureColumns(database, 'oracle_documents', [
    ['superseded_by', 'ALTER TABLE oracle_documents ADD COLUMN superseded_by TEXT'],
    ['superseded_at', 'ALTER TABLE oracle_documents ADD COLUMN superseded_at INTEGER'],
    ['superseded_reason', 'ALTER TABLE oracle_documents ADD COLUMN superseded_reason TEXT'],
    ['origin', 'ALTER TABLE oracle_documents ADD COLUMN origin TEXT'],
    ['project', 'ALTER TABLE oracle_documents ADD COLUMN project TEXT'],
    ['created_by', 'ALTER TABLE oracle_documents ADD COLUMN created_by TEXT'],
    ['is_private', 'ALTER TABLE oracle_documents ADD COLUMN is_private INTEGER DEFAULT 0'],
    ['embedding_model', "ALTER TABLE oracle_documents ADD COLUMN embedding_model TEXT DEFAULT 'all-MiniLM-L6-v2'"],
    ['embedding_version', 'ALTER TABLE oracle_documents ADD COLUMN embedding_version INTEGER DEFAULT 1'],
    ['embedding_hash', 'ALTER TABLE oracle_documents ADD COLUMN embedding_hash TEXT'],
    ['chunk_index', 'ALTER TABLE oracle_documents ADD COLUMN chunk_index INTEGER'],
    ['total_chunks', 'ALTER TABLE oracle_documents ADD COLUMN total_chunks INTEGER'],
    ['parent_id', 'ALTER TABLE oracle_documents ADD COLUMN parent_id TEXT'],
    ['memory_layer', 'ALTER TABLE oracle_documents ADD COLUMN memory_layer TEXT'],
    ['confidence', 'ALTER TABLE oracle_documents ADD COLUMN confidence INTEGER'],
    ['access_count', 'ALTER TABLE oracle_documents ADD COLUMN access_count INTEGER DEFAULT 0'],
    ['last_accessed_at', 'ALTER TABLE oracle_documents ADD COLUMN last_accessed_at INTEGER'],
    ['decay_score', 'ALTER TABLE oracle_documents ADD COLUMN decay_score INTEGER DEFAULT 100'],
    ['expires_at', 'ALTER TABLE oracle_documents ADD COLUMN expires_at INTEGER'],
  ]);

  ensureColumns(database, 'indexing_status', [
    ['repo_root', 'ALTER TABLE indexing_status ADD COLUMN repo_root TEXT'],
  ]);

  ensureColumns(database, 'search_log', [
    ['project', 'ALTER TABLE search_log ADD COLUMN project TEXT'],
    ['results', 'ALTER TABLE search_log ADD COLUMN results TEXT'],
  ]);

  ensureColumns(database, 'learn_log', [
    ['project', 'ALTER TABLE learn_log ADD COLUMN project TEXT'],
  ]);

  ensureColumns(database, 'document_access', [
    ['project', 'ALTER TABLE document_access ADD COLUMN project TEXT'],
  ]);

  ensureColumns(database, 'consult_log', [
    ['project', 'ALTER TABLE consult_log ADD COLUMN project TEXT'],
  ]);

  ensureColumns(database, 'forum_threads', [
    ['issue_url', 'ALTER TABLE forum_threads ADD COLUMN issue_url TEXT'],
    ['issue_number', 'ALTER TABLE forum_threads ADD COLUMN issue_number INTEGER'],
    ['project', 'ALTER TABLE forum_threads ADD COLUMN project TEXT'],
    ['synced_at', 'ALTER TABLE forum_threads ADD COLUMN synced_at INTEGER'],
  ]);

  ensureColumns(database, 'forum_messages', [
    ['author', 'ALTER TABLE forum_messages ADD COLUMN author TEXT'],
    ['principles_found', 'ALTER TABLE forum_messages ADD COLUMN principles_found INTEGER'],
    ['patterns_found', 'ALTER TABLE forum_messages ADD COLUMN patterns_found INTEGER'],
    ['search_query', 'ALTER TABLE forum_messages ADD COLUMN search_query TEXT'],
    ['comment_id', 'ALTER TABLE forum_messages ADD COLUMN comment_id INTEGER'],
  ]);

  ensureColumns(database, 'trace_log', [
    ['found_retrospectives', 'ALTER TABLE trace_log ADD COLUMN found_retrospectives TEXT'],
    ['found_learnings', 'ALTER TABLE trace_log ADD COLUMN found_learnings TEXT'],
    ['found_resonance', 'ALTER TABLE trace_log ADD COLUMN found_resonance TEXT'],
    ['file_count', 'ALTER TABLE trace_log ADD COLUMN file_count INTEGER DEFAULT 0'],
    ['commit_count', 'ALTER TABLE trace_log ADD COLUMN commit_count INTEGER DEFAULT 0'],
    ['issue_count', 'ALTER TABLE trace_log ADD COLUMN issue_count INTEGER DEFAULT 0'],
    ['depth', 'ALTER TABLE trace_log ADD COLUMN depth INTEGER DEFAULT 0'],
    ['parent_trace_id', 'ALTER TABLE trace_log ADD COLUMN parent_trace_id TEXT'],
    ['child_trace_ids', "ALTER TABLE trace_log ADD COLUMN child_trace_ids TEXT DEFAULT '[]'"],
    ['prev_trace_id', 'ALTER TABLE trace_log ADD COLUMN prev_trace_id TEXT'],
    ['next_trace_id', 'ALTER TABLE trace_log ADD COLUMN next_trace_id TEXT'],
    ['project', 'ALTER TABLE trace_log ADD COLUMN project TEXT'],
    ['session_id', 'ALTER TABLE trace_log ADD COLUMN session_id TEXT'],
    ['agent_count', 'ALTER TABLE trace_log ADD COLUMN agent_count INTEGER DEFAULT 1'],
    ['duration_ms', 'ALTER TABLE trace_log ADD COLUMN duration_ms INTEGER'],
    ['status', "ALTER TABLE trace_log ADD COLUMN status TEXT DEFAULT 'raw'"],
    ['awakening', 'ALTER TABLE trace_log ADD COLUMN awakening TEXT'],
    ['distilled_to_id', 'ALTER TABLE trace_log ADD COLUMN distilled_to_id TEXT'],
    ['distilled_at', 'ALTER TABLE trace_log ADD COLUMN distilled_at INTEGER'],
  ]);

  database.exec('CREATE INDEX IF NOT EXISTS idx_source ON oracle_documents(source_file)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_type ON oracle_documents(type)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_superseded ON oracle_documents(superseded_by)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_origin ON oracle_documents(origin)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_project ON oracle_documents(project)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_embedding_model ON oracle_documents(embedding_model)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_parent_id ON oracle_documents(parent_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_memory_layer ON oracle_documents(memory_layer)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_decay_score ON oracle_documents(decay_score)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_expires_at ON oracle_documents(expires_at)');

  database.exec('CREATE INDEX IF NOT EXISTS idx_search_created ON search_log(created_at)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_search_project ON search_log(project)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_learn_created ON learn_log(created_at)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_learn_project ON learn_log(project)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_access_doc ON document_access(document_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_access_created ON document_access(created_at)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_access_project ON document_access(project)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_consult_created ON consult_log(created_at)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_consult_project ON consult_log(project)');

  database.exec('CREATE INDEX IF NOT EXISTS idx_thread_status ON forum_threads(status)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_thread_project ON forum_threads(project)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_thread_created ON forum_threads(created_at)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_message_thread ON forum_messages(thread_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_message_role ON forum_messages(role)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_message_created ON forum_messages(created_at)');

  database.exec('CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_decisions_created ON decisions(created_at)');

  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS trace_log_trace_id_unique ON trace_log(trace_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_trace_query ON trace_log(query)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_trace_project ON trace_log(project)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_trace_status ON trace_log(status)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_trace_parent ON trace_log(parent_trace_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_trace_prev ON trace_log(prev_trace_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_trace_next ON trace_log(next_trace_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_trace_created ON trace_log(created_at)');

  database.exec('CREATE INDEX IF NOT EXISTS idx_rel_from ON concept_relationships(from_concept)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_rel_to ON concept_relationships(to_concept)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_rel_type ON concept_relationships(relationship_type)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_rel_strength ON concept_relationships(strength)');

  database.exec('CREATE INDEX IF NOT EXISTS idx_supersede_old_path ON supersede_log(old_path)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_supersede_new_path ON supersede_log(new_path)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_supersede_created ON supersede_log(superseded_at)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_supersede_project ON supersede_log(project)');
}

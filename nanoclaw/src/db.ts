import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { DATA_DIR, STORE_DIR } from './config.js';
import {
  DeadLetterMessage,
  HeartbeatJob,
  HeartbeatJobLog,
  LaneType,
  MessageAttachment,
  MessageAttempt,
  MessageReceipt,
  MessageStatus,
  NewMessage,
  RegisteredGroup,
  ScheduledTask,
  TaskRunLog,
  TraceContext,
} from './types.js';

let db: Database.Database;

function createSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      last_message_time TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT,
      chat_jid TEXT,
      sender TEXT,
      sender_name TEXT,
      content TEXT,
      timestamp TEXT,
      timestamp_epoch INTEGER,
      is_from_me INTEGER,
      PRIMARY KEY (id, chat_jid),
      FOREIGN KEY (chat_jid) REFERENCES chats(jid)
    );
    CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);
    CREATE TABLE IF NOT EXISTS message_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      attachment_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      mime_type TEXT,
      file_name TEXT,
      file_size INTEGER,
      telegram_file_id TEXT,
      telegram_file_unique_id TEXT,
      caption TEXT,
      width INTEGER,
      height INTEGER,
      duration_sec INTEGER,
      local_path TEXT,
      checksum TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_attachments_message
      ON message_attachments(message_id, chat_jid);

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      group_folder TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      next_run TEXT,
      last_run TEXT,
      last_result TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run);
    CREATE INDEX IF NOT EXISTS idx_status ON scheduled_tasks(status);

    CREATE TABLE IF NOT EXISTS task_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      run_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_run_logs ON task_run_logs(task_id, run_at);

    CREATE TABLE IF NOT EXISTS router_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      group_folder TEXT PRIMARY KEY,
      session_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS registered_groups (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folder TEXT NOT NULL UNIQUE,
      trigger_pattern TEXT NOT NULL,
      added_at TEXT NOT NULL,
      container_config TEXT,
      requires_trigger INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS message_receipts (
      trace_id TEXT PRIMARY KEY,
      external_message_id TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      lane TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_detail TEXT,
      received_at TEXT NOT NULL,
      queued_at TEXT,
      started_at TEXT,
      replied_at TEXT,
      timeout_at TEXT,
      dead_lettered_at TEXT,
      UNIQUE (external_message_id, chat_jid)
    );
    CREATE INDEX IF NOT EXISTS idx_receipts_chat_status ON message_receipts(chat_jid, status);
    CREATE INDEX IF NOT EXISTS idx_receipts_received_at ON message_receipts(received_at);

    CREATE TABLE IF NOT EXISTS message_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id TEXT NOT NULL,
      attempt_no INTEGER NOT NULL,
      container_name TEXT,
      spawn_started_at TEXT,
      spawn_failed_at TEXT,
      run_started_at TEXT,
      run_ended_at TEXT,
      exit_code INTEGER,
      timeout_hit INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_attempts_trace ON message_attempts(trace_id, attempt_no);

    CREATE TABLE IF NOT EXISTS dead_letter_messages (
      trace_id TEXT PRIMARY KEY,
      chat_jid TEXT NOT NULL,
      external_message_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      final_error TEXT,
      retryable INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      retried_at TEXT,
      retried_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_dlq_status_created ON dead_letter_messages(status, created_at);

    CREATE TABLE IF NOT EXISTS chat_user_identity (
      chat_jid TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_user_identity_user_id ON chat_user_identity(user_id);
  `);

  // Add context_mode column if it doesn't exist (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE scheduled_tasks ADD COLUMN context_mode TEXT DEFAULT 'isolated'`,
    );
  } catch {
    /* column already exists */
  }

  // Add session_started_at column for session rotation (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE sessions ADD COLUMN session_started_at TEXT DEFAULT ''`,
    );
  } catch {
    /* column already exists */
  }

  // Add timestamp_epoch for robust ordering/replay handling
  try {
    database.exec(
      `ALTER TABLE messages ADD COLUMN timestamp_epoch INTEGER`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    if (!msg.includes('duplicate column name')) throw err;
  }

  // Ensure migration really exists (legacy DBs can skip CREATE TABLE IF NOT EXISTS path).
  const hasTimestampEpoch = database
    .prepare(`SELECT 1 as ok FROM pragma_table_info('messages') WHERE name = 'timestamp_epoch'`)
    .get() as { ok: number } | undefined;
  if (!hasTimestampEpoch) {
    throw new Error('Schema migration failed: messages.timestamp_epoch is missing');
  }

  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_messages_timestamp_epoch ON messages(timestamp_epoch)`,
  );

  try {
    database.exec(`
      UPDATE messages
      SET timestamp_epoch = CAST(strftime('%s', timestamp) AS INTEGER) * 1000
      WHERE timestamp_epoch IS NULL
    `);
  } catch {
    /* best-effort backfill */
  }

  // --- Phase 6 migrations: retry, timeout, label ---
  const phase6Migrations: [string, string][] = [
    [`ALTER TABLE scheduled_tasks ADD COLUMN retry_count INTEGER DEFAULT 0`, 'retry_count'],
    [`ALTER TABLE scheduled_tasks ADD COLUMN max_retries INTEGER DEFAULT 0`, 'max_retries'],
    [`ALTER TABLE scheduled_tasks ADD COLUMN retry_delay_ms INTEGER DEFAULT 300000`, 'retry_delay_ms'],
    [`ALTER TABLE scheduled_tasks ADD COLUMN task_timeout_ms INTEGER`, 'task_timeout_ms'],
    [`ALTER TABLE scheduled_tasks ADD COLUMN label TEXT`, 'label'],
  ];
  for (const [sql] of phase6Migrations) {
    try { database.exec(sql); } catch { /* column already exists */ }
  }

  // --- Heartbeat Jobs table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS heartbeat_jobs (
      id TEXT PRIMARY KEY,
      chat_jid TEXT NOT NULL,
      label TEXT NOT NULL,
      prompt TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'custom',
      status TEXT NOT NULL DEFAULT 'active',
      interval_ms INTEGER,
      last_run TEXT,
      last_result TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT 'main'
    );
    CREATE INDEX IF NOT EXISTS idx_hb_jobs_status ON heartbeat_jobs(status);
  `);

  // --- Heartbeat Job Log table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS heartbeat_job_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      run_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ok',
      result TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_hb_log_job_id ON heartbeat_job_log(job_id);
    CREATE INDEX IF NOT EXISTS idx_hb_log_run_at ON heartbeat_job_log(run_at);
  `);
}

export function initDatabase(): void {
  const dbPath = path.join(STORE_DIR, 'messages.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);

  // Performance: WAL mode + busy timeout for concurrent access
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 30000');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -20000'); // 20MB cache

  createSchema(db);

  // Migrate from JSON files if they exist
  migrateJsonState();
}

/** @internal - for tests only. Creates a fresh in-memory database. */
export function _initTestDatabase(): void {
  db = new Database(':memory:');
  createSchema(db);
}

/** Returns the shared database instance. Must call initDatabase() first. */
export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized — call initDatabase() first');
  return db;
}

function toEpochMs(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : Math.floor(Date.now());
}

function buildTraceId(chatJid: string, externalMessageId: string): string {
  return crypto
    .createHash('sha1')
    .update(`${chatJid}:${externalMessageId}`)
    .digest('hex');
}

function buildStableUserId(chatJid: string): string {
  const digest = crypto
    .createHash('sha1')
    .update(`chat:${chatJid}`)
    .digest('hex')
    .slice(0, 16);
  return `u_${digest}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function getStableUserId(chatJid: string): string {
  const existing = db
    .prepare(`SELECT user_id FROM chat_user_identity WHERE chat_jid = ?`)
    .get(chatJid) as { user_id?: string } | undefined;
  if (existing?.user_id) return existing.user_id;

  const userId = buildStableUserId(chatJid);
  const now = nowIso();
  db.prepare(
    `INSERT OR IGNORE INTO chat_user_identity (chat_jid, user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).run(chatJid, userId, now, now);

  const row = db
    .prepare(`SELECT user_id FROM chat_user_identity WHERE chat_jid = ?`)
    .get(chatJid) as { user_id?: string } | undefined;
  return row?.user_id || userId;
}

export function ensureMessageReceipt(
  chatJid: string,
  externalMessageId: string,
  lane: LaneType = 'user',
  receivedAt: string = nowIso(),
): TraceContext {
  getStableUserId(chatJid);
  const traceId = buildTraceId(chatJid, externalMessageId);
  db.prepare(
    `INSERT OR IGNORE INTO message_receipts (
      trace_id, external_message_id, chat_jid, lane, status, received_at
    ) VALUES (?, ?, ?, ?, 'RECEIVED', ?)`,
  ).run(traceId, externalMessageId, chatJid, lane, receivedAt);

  return {
    trace_id: traceId,
    chat_jid: chatJid,
    external_message_id: externalMessageId,
    lane,
  };
}

export function getMessageReceipt(traceId: string): MessageReceipt | undefined {
  return db.prepare(`SELECT * FROM message_receipts WHERE trace_id = ?`).get(traceId) as
    | MessageReceipt
    | undefined;
}

export function getMessageReceiptByExternal(
  chatJid: string,
  externalMessageId: string,
): MessageReceipt | undefined {
  return db
    .prepare(
      `SELECT * FROM message_receipts WHERE chat_jid = ? AND external_message_id = ?`,
    )
    .get(chatJid, externalMessageId) as MessageReceipt | undefined;
}

export function getMessageAttempts(traceId: string): MessageAttempt[] {
  return db
    .prepare(
      `SELECT * FROM message_attempts WHERE trace_id = ? ORDER BY attempt_no ASC, id ASC`,
    )
    .all(traceId) as MessageAttempt[];
}

export function getOpenDeadLetters(): DeadLetterMessage[] {
  return db
    .prepare(
      `SELECT * FROM dead_letter_messages WHERE status = 'open' ORDER BY created_at DESC`,
    )
    .all() as DeadLetterMessage[];
}

export function getDeadLettersByStatus(
  status: 'open' | 'retrying' | 'resolved',
): DeadLetterMessage[] {
  return db
    .prepare(
      `SELECT * FROM dead_letter_messages WHERE status = ? ORDER BY created_at DESC`,
    )
    .all(status) as DeadLetterMessage[];
}

export function getDeadLetterByTrace(traceId: string): DeadLetterMessage | undefined {
  return db
    .prepare(`SELECT * FROM dead_letter_messages WHERE trace_id = ?`)
    .get(traceId) as DeadLetterMessage | undefined;
}

export function getDlqCounts(): { open24h: number; open1h: number; retrying: number } {
  const now = Date.now();
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  const open1h =
    (db
      .prepare(
        `SELECT COUNT(*) as c FROM dead_letter_messages WHERE status = 'open' AND created_at >= ?`,
      )
      .get(oneHourAgo) as { c: number }).c || 0;

  const open24h =
    (db
      .prepare(
        `SELECT COUNT(*) as c FROM dead_letter_messages WHERE status = 'open' AND created_at >= ?`,
      )
      .get(dayAgo) as { c: number }).c || 0;

  const retrying =
    (db
      .prepare(
        `SELECT COUNT(*) as c FROM dead_letter_messages WHERE status = 'retrying'`,
      )
      .get() as { c: number }).c || 0;

  return { open24h, open1h, retrying };
}

export function markDeadLetterRetrying(traceId: string, retriedBy: string): boolean {
  const now = nowIso();
  const tx = db.transaction(() => {
    const receiptUpdated = db.prepare(
      `UPDATE message_receipts
       SET status = 'RETRYING', error_code = NULL, error_detail = NULL
       WHERE trace_id = ?`,
    ).run(traceId);

    const dlqUpdated = db.prepare(
      `UPDATE dead_letter_messages
       SET status = 'retrying', retried_at = ?, retried_by = ?
       WHERE trace_id = ?`,
    ).run(now, retriedBy, traceId);

    return receiptUpdated.changes > 0 && dlqUpdated.changes > 0;
  });
  return tx();
}

export function resolveDeadLetter(traceId: string): void {
  db.prepare(
    `UPDATE dead_letter_messages SET status = 'resolved' WHERE trace_id = ?`,
  ).run(traceId);
}

export function transitionMessageStatus(
  traceId: string,
  status: MessageStatus,
  options?: {
    attemptIncrement?: boolean;
    containerName?: string | null;
    errorCode?: string | null;
    errorDetail?: string | null;
    timeoutHit?: boolean;
    exitCode?: number | null;
  },
): void {
  const now = nowIso();
  const tx = db.transaction(() => {
    const setParts = ['status = ?'];
    const values: unknown[] = [status];

    if (status === 'QUEUED') {
      setParts.push('queued_at = COALESCE(queued_at, ?)');
      values.push(now);
    }
    if (status === 'RUNNING') {
      setParts.push('started_at = ?');
      values.push(now);
    }
    if (status === 'REPLIED') {
      setParts.push('replied_at = ?');
      values.push(now);
      setParts.push('error_code = NULL');
      setParts.push('error_detail = NULL');
    }
    if (status === 'TIMEOUT') {
      setParts.push('timeout_at = ?');
      values.push(now);
    }
    if (status === 'DEAD_LETTERED') {
      setParts.push('dead_lettered_at = ?');
      values.push(now);
    }
    if (options?.errorCode !== undefined) {
      setParts.push('error_code = ?');
      values.push(options.errorCode);
    }
    if (options?.errorDetail !== undefined) {
      setParts.push('error_detail = ?');
      values.push(options.errorDetail);
    }
    if (options?.attemptIncrement) {
      setParts.push('attempt_count = attempt_count + 1');
    }

    values.push(traceId);
    db.prepare(
      `UPDATE message_receipts SET ${setParts.join(', ')} WHERE trace_id = ?`,
    ).run(...values);

    if (options?.attemptIncrement) {
      const attempt = db.prepare(
        `SELECT attempt_count FROM message_receipts WHERE trace_id = ?`,
      ).get(traceId) as { attempt_count?: number } | undefined;
      const attemptNo = attempt?.attempt_count ?? 1;
      db.prepare(
        `INSERT INTO message_attempts (
          trace_id, attempt_no, container_name, run_started_at
        ) VALUES (?, ?, ?, ?)`,
      ).run(traceId, attemptNo, options.containerName || null, now);
    }

    if (status === 'TIMEOUT' || status === 'FAILED' || status === 'DEAD_LETTERED') {
      db.prepare(
        `UPDATE message_attempts
         SET run_ended_at = COALESCE(run_ended_at, ?),
             timeout_hit = CASE WHEN ? THEN 1 ELSE timeout_hit END,
             exit_code = COALESCE(exit_code, ?)
         WHERE id = (
           SELECT id FROM message_attempts
           WHERE trace_id = ?
           ORDER BY attempt_no DESC, id DESC
           LIMIT 1
         )`,
      ).run(now, options?.timeoutHit ? 1 : 0, options?.exitCode ?? null, traceId);
    }

    if (status === 'REPLIED') {
      db.prepare(
        `UPDATE message_attempts
         SET run_ended_at = COALESCE(run_ended_at, ?)
         WHERE id = (
           SELECT id FROM message_attempts
           WHERE trace_id = ?
           ORDER BY attempt_no DESC, id DESC
           LIMIT 1
         )`,
      ).run(now, traceId);
    }
  });

  tx();
}

export function moveToDeadLetter(
  traceId: string,
  reason: string,
  finalError: string,
  retryable = true,
): void {
  const receipt = getMessageReceipt(traceId);
  if (!receipt) return;

  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT OR REPLACE INTO dead_letter_messages (
        trace_id, chat_jid, external_message_id, reason, final_error, retryable, status, created_at, retried_at, retried_by
      ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, NULL, NULL)`,
    ).run(
      traceId,
      receipt.chat_jid,
      receipt.external_message_id,
      reason,
      finalError,
      retryable ? 1 : 0,
      now,
    );

    db.prepare(
      `UPDATE message_receipts
       SET status = 'DEAD_LETTERED',
           error_code = ?,
           error_detail = ?,
           dead_lettered_at = ?
       WHERE trace_id = ?`,
    ).run(reason, finalError, now, traceId);
  });

  tx();
}

export function getRetryingMessages(chatJid: string, botPrefix: string): NewMessage[] {
  const sql = `
    SELECT m.id, m.chat_jid, m.sender, m.sender_name, m.content, m.timestamp
    FROM message_receipts r
    JOIN messages m
      ON m.chat_jid = r.chat_jid AND m.id = r.external_message_id
    WHERE r.chat_jid = ?
      AND r.status = 'RETRYING'
      AND m.content NOT LIKE ?
    ORDER BY COALESCE(m.timestamp_epoch, CAST(strftime('%s', m.timestamp) AS INTEGER) * 1000)
    LIMIT 50
  `;

  return db.prepare(sql).all(chatJid, `${botPrefix}:%`) as NewMessage[];
}

export interface RecoverableReceipt {
  trace_id: string;
  chat_jid: string;
  external_message_id: string;
  status: MessageStatus;
  content: string;
  timestamp: string;
}

export function getRecoverableReceipts(): RecoverableReceipt[] {
  return db
    .prepare(
      `
      SELECT
        r.trace_id,
        r.chat_jid,
        r.external_message_id,
        r.status,
        m.content,
        m.timestamp
      FROM message_receipts r
      JOIN messages m
        ON m.chat_jid = r.chat_jid AND m.id = r.external_message_id
      WHERE r.status IN ('RECEIVED', 'QUEUED', 'RUNNING')
      ORDER BY COALESCE(m.timestamp_epoch, CAST(strftime('%s', m.timestamp) AS INTEGER) * 1000), m.id
    `,
    )
    .all() as RecoverableReceipt[];
}

/**
 * Store chat metadata only (no message content).
 * Used for all chats to enable group discovery without storing sensitive content.
 */
export function storeChatMetadata(
  chatJid: string,
  timestamp: string,
  name?: string,
): void {
  if (name) {
    // Update with name, preserving existing timestamp if newer
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        name = excluded.name,
        last_message_time = MAX(last_message_time, excluded.last_message_time)
    `,
    ).run(chatJid, name, timestamp);
  } else {
    // Update timestamp only, preserve existing name if any
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        last_message_time = MAX(last_message_time, excluded.last_message_time)
    `,
    ).run(chatJid, chatJid, timestamp);
  }
}

/**
 * Update chat name without changing timestamp for existing chats.
 * New chats get the current time as their initial timestamp.
 * Used during group metadata sync.
 */
export function updateChatName(chatJid: string, name: string): void {
  db.prepare(
    `
    INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET name = excluded.name
  `,
  ).run(chatJid, name, new Date().toISOString());
}

export interface ChatInfo {
  jid: string;
  name: string;
  last_message_time: string;
}

/**
 * Get all known chats, ordered by most recent activity.
 */
export function getAllChats(): ChatInfo[] {
  return db
    .prepare(
      `
    SELECT jid, name, last_message_time
    FROM chats
    ORDER BY last_message_time DESC
  `,
    )
    .all() as ChatInfo[];
}

/**
 * Get timestamp of last group metadata sync.
 */
export function getLastGroupSync(): string | null {
  // Store sync time in a special chat entry
  const row = db
    .prepare(`SELECT last_message_time FROM chats WHERE jid = '__group_sync__'`)
    .get() as { last_message_time: string } | undefined;
  return row?.last_message_time || null;
}

/**
 * Record that group metadata was synced.
 */
export function setLastGroupSync(): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES ('__group_sync__', '__group_sync__', ?)`,
  ).run(now);
}

/**
 * Store a message with full content.
 * Only call this for registered groups where message history is needed.
 */
export function storeMessage(msg: NewMessage): void {
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, timestamp_epoch, is_from_me) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      msg.id,
      msg.chat_jid,
      msg.sender,
      msg.sender_name,
      msg.content,
      msg.timestamp,
      toEpochMs(msg.timestamp),
      msg.is_from_me ? 1 : 0,
    );
    storeMessageAttachments(msg.id, msg.chat_jid, msg.attachments || []);
  });
  tx();
}

/**
 * Store a message directly (for non-WhatsApp channels that don't use Baileys proto).
 */
export function storeMessageDirect(msg: {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
  attachments?: MessageAttachment[];
}): void {
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, timestamp_epoch, is_from_me) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      msg.id,
      msg.chat_jid,
      msg.sender,
      msg.sender_name,
      msg.content,
      msg.timestamp,
      toEpochMs(msg.timestamp),
      msg.is_from_me ? 1 : 0,
    );
    storeMessageAttachments(msg.id, msg.chat_jid, msg.attachments || []);
  });
  tx();
}

export function storeMessageAttachments(
  messageId: string,
  chatJid: string,
  attachments: MessageAttachment[],
): void {
  db.prepare(
    `DELETE FROM message_attachments WHERE message_id = ? AND chat_jid = ?`,
  ).run(messageId, chatJid);

  if (!attachments || attachments.length === 0) return;

  const insert = db.prepare(
    `INSERT INTO message_attachments (
      message_id, chat_jid, attachment_id, kind, mime_type, file_name, file_size,
      telegram_file_id, telegram_file_unique_id, caption, width, height, duration_sec,
      local_path, checksum, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const now = new Date().toISOString();
  for (const a of attachments) {
    insert.run(
      messageId,
      chatJid,
      a.id,
      a.kind,
      a.mimeType ?? null,
      a.fileName ?? null,
      a.fileSize ?? null,
      a.telegramFileId ?? null,
      a.telegramFileUniqueId ?? null,
      a.caption ?? null,
      a.width ?? null,
      a.height ?? null,
      a.durationSec ?? null,
      a.localPath ?? null,
      a.checksum ?? null,
      now,
    );
  }
}

export function getMessageAttachments(
  messageId: string,
  chatJid: string,
): MessageAttachment[] {
  const rows = db.prepare(
    `SELECT
      attachment_id, kind, mime_type, file_name, file_size,
      telegram_file_id, telegram_file_unique_id, caption, width, height,
      duration_sec, local_path, checksum
     FROM message_attachments
     WHERE message_id = ? AND chat_jid = ?
     ORDER BY id ASC`,
  ).all(messageId, chatJid) as Array<{
    attachment_id: string;
    kind: MessageAttachment['kind'];
    mime_type: string | null;
    file_name: string | null;
    file_size: number | null;
    telegram_file_id: string | null;
    telegram_file_unique_id: string | null;
    caption: string | null;
    width: number | null;
    height: number | null;
    duration_sec: number | null;
    local_path: string | null;
    checksum: string | null;
  }>;

  return rows.map((r) => ({
    id: r.attachment_id,
    kind: r.kind,
    mimeType: r.mime_type,
    fileName: r.file_name,
    fileSize: r.file_size,
    telegramFileId: r.telegram_file_id,
    telegramFileUniqueId: r.telegram_file_unique_id,
    caption: r.caption,
    width: r.width,
    height: r.height,
    durationSec: r.duration_sec,
    localPath: r.local_path,
    checksum: r.checksum,
  }));
}

export function getNewMessages(
  jids: string[],
  lastTimestamp: string,
  botPrefix: string,
): { messages: NewMessage[]; newTimestamp: string } {
  if (jids.length === 0) return { messages: [], newTimestamp: lastTimestamp };

  const placeholders = jids.map(() => '?').join(',');
  const lastEpoch = lastTimestamp ? toEpochMs(lastTimestamp) : 0;
  // Filter out bot's own messages by checking content prefix (not is_from_me, since user shares the account)
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp
    FROM messages
    WHERE COALESCE(timestamp_epoch, CAST(strftime('%s', timestamp) AS INTEGER) * 1000) > ?
      AND chat_jid IN (${placeholders})
      AND content NOT LIKE ?
    ORDER BY COALESCE(timestamp_epoch, CAST(strftime('%s', timestamp) AS INTEGER) * 1000), id
    LIMIT 200
  `;

  const rows = db
    .prepare(sql)
    .all(lastEpoch, ...jids, `${botPrefix}:%`) as NewMessage[];

  let newTimestamp = lastTimestamp;
  for (const row of rows) {
    if (row.timestamp > newTimestamp) newTimestamp = row.timestamp;
  }

  return { messages: rows, newTimestamp };
}

export function getMessagesSince(
  chatJid: string,
  sinceTimestamp: string,
  botPrefix: string,
  limit = 50,
): NewMessage[] {
  const sinceEpoch = sinceTimestamp ? toEpochMs(sinceTimestamp) : 0;
  // Filter out bot's own messages by checking content prefix
  // Use subquery to get the MOST RECENT N messages, then re-order ascending
  const sql = `
    SELECT * FROM (
      SELECT id, chat_jid, sender, sender_name, content, timestamp, COALESCE(timestamp_epoch, CAST(strftime('%s', timestamp) AS INTEGER) * 1000) AS ts_epoch
      FROM messages
      WHERE chat_jid = ?
        AND COALESCE(timestamp_epoch, CAST(strftime('%s', timestamp) AS INTEGER) * 1000) > ?
        AND content NOT LIKE ?
      ORDER BY COALESCE(timestamp_epoch, CAST(strftime('%s', timestamp) AS INTEGER) * 1000) DESC, id DESC
      LIMIT ?
    ) sub ORDER BY ts_epoch ASC, id ASC
  `;
  return db
    .prepare(sql)
    .all(chatJid, sinceEpoch, `${botPrefix}:%`, limit) as NewMessage[];
}

export function createTask(
  task: Omit<ScheduledTask, 'last_run' | 'last_result'>,
): void {
  db.prepare(
    `
    INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, next_run, status, created_at,
      retry_count, max_retries, retry_delay_ms, task_timeout_ms, label)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?)
  `,
  ).run(
    task.id,
    task.group_folder,
    task.chat_jid,
    task.prompt,
    task.schedule_type,
    task.schedule_value,
    task.context_mode || 'isolated',
    task.next_run,
    task.status,
    task.created_at,
    task.retry_count ?? 0,
    task.max_retries ?? 0,
    task.retry_delay_ms ?? 300000,
    task.task_timeout_ms ?? null,
    task.label ?? null,
  );
}

export function getTaskById(id: string): ScheduledTask | undefined {
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as
    | ScheduledTask
    | undefined;
}

export function getTasksForGroup(groupFolder: string): ScheduledTask[] {
  return db
    .prepare(
      'SELECT * FROM scheduled_tasks WHERE group_folder = ? ORDER BY created_at DESC',
    )
    .all(groupFolder) as ScheduledTask[];
}

export function getAllTasks(): ScheduledTask[] {
  return db
    .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
    .all() as ScheduledTask[];
}

export function updateTask(
  id: string,
  updates: Partial<
    Pick<
      ScheduledTask,
      | 'prompt'
      | 'schedule_type'
      | 'schedule_value'
      | 'next_run'
      | 'status'
      | 'label'
      | 'max_retries'
      | 'retry_delay_ms'
      | 'task_timeout_ms'
    >
  >,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.prompt !== undefined) {
    fields.push('prompt = ?');
    values.push(updates.prompt);
  }
  if (updates.schedule_type !== undefined) {
    fields.push('schedule_type = ?');
    values.push(updates.schedule_type);
  }
  if (updates.schedule_value !== undefined) {
    fields.push('schedule_value = ?');
    values.push(updates.schedule_value);
  }
  if (updates.next_run !== undefined) {
    fields.push('next_run = ?');
    values.push(updates.next_run);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.label !== undefined) {
    fields.push('label = ?');
    values.push(updates.label);
  }
  if (updates.max_retries !== undefined) {
    fields.push('max_retries = ?');
    values.push(updates.max_retries);
  }
  if (updates.retry_delay_ms !== undefined) {
    fields.push('retry_delay_ms = ?');
    values.push(updates.retry_delay_ms);
  }
  if (updates.task_timeout_ms !== undefined) {
    fields.push('task_timeout_ms = ?');
    values.push(updates.task_timeout_ms);
  }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(
    `UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`,
  ).run(...values);
}

export function cancelTask(id: string): void {
  // Soft-delete: audit trail preserved, task will be hidden from agent snapshots
  db.prepare(`UPDATE scheduled_tasks SET status = 'cancelled' WHERE id = ?`).run(id);
}

export function deleteTask(id: string): void {
  // Delete child records first (FK constraint)
  db.prepare('DELETE FROM task_run_logs WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
}

export function getDueTasks(): ScheduledTask[] {
  const now = new Date().toISOString();
  return db
    .prepare(
      `
    SELECT * FROM scheduled_tasks
    WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
    ORDER BY next_run
  `,
    )
    .all(now) as ScheduledTask[];
}

/**
 * Sentinel value used to "claim" a task — prevents getDueTasks() from
 * returning it again while it's running or queued.
 */
const CLAIM_SENTINEL = '9999-12-31T23:59:59.999Z';

/**
 * Atomically claim a due task by advancing its next_run to a far-future
 * sentinel.  Returns true if the claim succeeded (row was still active with
 * a past next_run).  This is an optimistic lock: only one poll cycle can
 * claim a given task because the UPDATE is atomic in SQLite.
 */
export function claimTask(id: string): boolean {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE scheduled_tasks
       SET next_run = ?
       WHERE id = ? AND status = 'active' AND next_run IS NOT NULL AND next_run <= ?`,
    )
    .run(CLAIM_SENTINEL, id, now);
  return result.changes > 0;
}

/**
 * Crash recovery: reset any tasks that were claimed (sentinel next_run)
 * but never completed — e.g. because the process crashed mid-execution.
 * For cron/interval tasks we set next_run = NOW so they run on the next
 * poll cycle; for once tasks we also set next_run = NOW.
 */
export function recoverStaleClaims(): number {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE scheduled_tasks
       SET next_run = ?
       WHERE status = 'active' AND next_run = ?`,
    )
    .run(now, CLAIM_SENTINEL);
  return result.changes;
}

/**
 * Check if a semantically identical task already exists (duplicate guard).
 * Compares group_folder + schedule_value + first 200 chars of prompt.
 */
export function findDuplicateTask(
  groupFolder: string,
  scheduleValue: string,
  promptPrefix: string,
): ScheduledTask | undefined {
  return db
    .prepare(
      `SELECT * FROM scheduled_tasks
       WHERE group_folder = ?
         AND schedule_value = ?
         AND substr(prompt, 1, 200) = substr(?, 1, 200)
         AND status IN ('active', 'paused')
       LIMIT 1`,
    )
    .get(groupFolder, scheduleValue, promptPrefix) as ScheduledTask | undefined;
}

/** Increment retry_count after a failure and schedule the next retry time. */
export function scheduleRetry(id: string, retryDelayMs: number): void {
  const retryAt = new Date(Date.now() + retryDelayMs).toISOString();
  db.prepare(
    `UPDATE scheduled_tasks
     SET retry_count = retry_count + 1, next_run = ?
     WHERE id = ?`,
  ).run(retryAt, id);
}

/** Reset retry_count to 0 after a successful run. */
export function resetRetryCount(id: string): void {
  db.prepare(`UPDATE scheduled_tasks SET retry_count = 0 WHERE id = ?`).run(id);
}

/** Get recent run logs for a task. */
export function getTaskRunLogs(
  taskId: string,
  limit = 20,
): TaskRunLog[] {
  return db
    .prepare(
      `SELECT * FROM task_run_logs WHERE task_id = ? ORDER BY run_at DESC LIMIT ?`,
    )
    .all(taskId, limit) as TaskRunLog[];
}

export function updateTaskAfterRun(
  id: string,
  nextRun: string | null,
  lastResult: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE scheduled_tasks
    SET next_run = ?, last_run = ?, last_result = ?, status = CASE WHEN ? IS NULL THEN 'completed' ELSE status END
    WHERE id = ?
  `,
  ).run(nextRun, now, lastResult, nextRun, id);
}

export function logTaskRun(log: TaskRunLog): void {
  db.prepare(
    `
    INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(
    log.task_id,
    log.run_at,
    log.duration_ms,
    log.status,
    log.result,
    log.error,
  );
}

// --- Router state accessors ---

export function getRouterState(key: string): string | undefined {
  const row = db
    .prepare('SELECT value FROM router_state WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setRouterState(key: string, value: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO router_state (key, value) VALUES (?, ?)',
  ).run(key, value);
}

// --- Session accessors ---

export function getSession(groupFolder: string): string | undefined {
  const row = db
    .prepare('SELECT session_id FROM sessions WHERE group_folder = ?')
    .get(groupFolder) as { session_id: string } | undefined;
  return row?.session_id;
}

export function setSession(groupFolder: string, sessionId: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO sessions (group_folder, session_id, session_started_at) VALUES (?, ?, COALESCE((SELECT session_started_at FROM sessions WHERE group_folder = ? AND session_id = ?), ?))',
  ).run(groupFolder, sessionId, groupFolder, sessionId, new Date().toISOString());
}

export function clearSession(groupFolder: string): void {
  db.prepare('DELETE FROM sessions WHERE group_folder = ?').run(groupFolder);
}

export function getSessionAge(groupFolder: string): number | null {
  const row = db
    .prepare('SELECT session_started_at FROM sessions WHERE group_folder = ?')
    .get(groupFolder) as { session_started_at: string } | undefined;
  if (!row?.session_started_at) return null;
  return Date.now() - new Date(row.session_started_at).getTime();
}

export function getAllSessions(): Record<string, string> {
  const rows = db
    .prepare('SELECT group_folder, session_id FROM sessions')
    .all() as Array<{ group_folder: string; session_id: string }>;
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.group_folder] = row.session_id;
  }
  return result;
}

// --- Registered group accessors ---

export function getRegisteredGroup(
  jid: string,
): (RegisteredGroup & { jid: string }) | undefined {
  const row = db
    .prepare('SELECT * FROM registered_groups WHERE jid = ?')
    .get(jid) as
    | {
        jid: string;
        name: string;
        folder: string;
        trigger_pattern: string;
        added_at: string;
        container_config: string | null;
        requires_trigger: number | null;
      }
    | undefined;
  if (!row) return undefined;
  return {
    jid: row.jid,
    name: row.name,
    folder: row.folder,
    trigger: row.trigger_pattern,
    added_at: row.added_at,
    containerConfig: row.container_config
      ? JSON.parse(row.container_config)
      : undefined,
    requiresTrigger: row.requires_trigger === null ? undefined : row.requires_trigger === 1,
  };
}

export function setRegisteredGroup(
  jid: string,
  group: RegisteredGroup,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO registered_groups (jid, name, folder, trigger_pattern, added_at, container_config, requires_trigger)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    jid,
    group.name,
    group.folder,
    group.trigger,
    group.added_at,
    group.containerConfig ? JSON.stringify(group.containerConfig) : null,
    group.requiresTrigger === undefined ? 1 : group.requiresTrigger ? 1 : 0,
  );
}

export function getAllRegisteredGroups(): Record<string, RegisteredGroup> {
  const rows = db
    .prepare('SELECT * FROM registered_groups')
    .all() as Array<{
    jid: string;
    name: string;
    folder: string;
    trigger_pattern: string;
    added_at: string;
    container_config: string | null;
    requires_trigger: number | null;
  }>;
  const result: Record<string, RegisteredGroup> = {};
  for (const row of rows) {
    result[row.jid] = {
      name: row.name,
      folder: row.folder,
      trigger: row.trigger_pattern,
      added_at: row.added_at,
      containerConfig: row.container_config
        ? JSON.parse(row.container_config)
        : undefined,
      requiresTrigger: row.requires_trigger === null ? undefined : row.requires_trigger === 1,
    };
  }
  return result;
}

// --- JSON migration ---

function migrateJsonState(): void {
  const migrateFile = (filename: string) => {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      fs.renameSync(filePath, `${filePath}.migrated`);
      return data;
    } catch {
      return null;
    }
  };

  // Migrate router_state.json
  const routerState = migrateFile('router_state.json') as {
    last_timestamp?: string;
    last_agent_timestamp?: Record<string, string>;
  } | null;
  if (routerState) {
    if (routerState.last_timestamp) {
      setRouterState('last_timestamp', routerState.last_timestamp);
    }
    if (routerState.last_agent_timestamp) {
      setRouterState(
        'last_agent_timestamp',
        JSON.stringify(routerState.last_agent_timestamp),
      );
    }
  }

  // Migrate sessions.json
  const sessions = migrateFile('sessions.json') as Record<
    string,
    string
  > | null;
  if (sessions) {
    for (const [folder, sessionId] of Object.entries(sessions)) {
      setSession(folder, sessionId);
    }
  }

  // Migrate registered_groups.json
  const groups = migrateFile('registered_groups.json') as Record<
    string,
    RegisteredGroup
  > | null;
  if (groups) {
    for (const [jid, group] of Object.entries(groups)) {
      setRegisteredGroup(jid, group);
    }
  }
}

// --- Heartbeat Jobs CRUD ---

export function createHeartbeatJob(job: HeartbeatJob): void {
  db.prepare(
    `INSERT INTO heartbeat_jobs (id, chat_jid, label, prompt, category, status, interval_ms, last_run, last_result, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    job.id,
    job.chat_jid,
    job.label,
    job.prompt,
    job.category,
    job.status,
    job.interval_ms,
    job.last_run,
    job.last_result,
    job.created_at,
    job.created_by,
  );
}

export function getHeartbeatJob(id: string): HeartbeatJob | undefined {
  return db.prepare('SELECT * FROM heartbeat_jobs WHERE id = ?').get(id) as HeartbeatJob | undefined;
}

export function getActiveHeartbeatJobs(): HeartbeatJob[] {
  return db
    .prepare(`SELECT * FROM heartbeat_jobs WHERE status = 'active' ORDER BY created_at`)
    .all() as HeartbeatJob[];
}

export function getAllHeartbeatJobs(): HeartbeatJob[] {
  return db
    .prepare('SELECT * FROM heartbeat_jobs ORDER BY created_at DESC')
    .all() as HeartbeatJob[];
}

export function getDueHeartbeatJobs(defaultIntervalMs: number): HeartbeatJob[] {
  const now = Date.now();
  return getActiveHeartbeatJobs().filter((job) => {
    if (!job.last_run) return true; // Never run → due now
    const interval = job.interval_ms ?? defaultIntervalMs;
    const elapsed = now - new Date(job.last_run).getTime();
    return elapsed >= interval;
  });
}

export function updateHeartbeatJob(
  id: string,
  updates: Partial<Pick<HeartbeatJob, 'label' | 'prompt' | 'category' | 'status' | 'interval_ms'>>,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.label !== undefined) { fields.push('label = ?'); values.push(updates.label); }
  if (updates.prompt !== undefined) { fields.push('prompt = ?'); values.push(updates.prompt); }
  if (updates.category !== undefined) { fields.push('category = ?'); values.push(updates.category); }
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.interval_ms !== undefined) { fields.push('interval_ms = ?'); values.push(updates.interval_ms); }

  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE heartbeat_jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function updateHeartbeatJobResult(id: string, result: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE heartbeat_jobs SET last_run = ?, last_result = ? WHERE id = ?`,
  ).run(now, result, id);
}

/**
 * Reset jobs stuck in __RUNNING__ state (written before execution starts).
 * Called on startup to clean up stale state from a previous crash or restart.
 * Returns the number of jobs recovered.
 */
export function recoverStaleHeartbeatJobs(): number {
  const result = db
    .prepare(
      `UPDATE heartbeat_jobs
       SET last_result = 'Error: process interrupted (recovered on restart)'
       WHERE last_result = '__RUNNING__'`,
    )
    .run();
  return result.changes;
}

export function deleteHeartbeatJob(id: string): void {
  db.prepare('DELETE FROM heartbeat_jobs WHERE id = ?').run(id);
}

// --- Heartbeat Job Log CRUD ---

/** Record a completed (or failed) heartbeat job run. */
export function createHeartbeatJobLog(
  entry: Omit<HeartbeatJobLog, 'id' | 'run_at'>,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO heartbeat_job_log (job_id, run_at, status, result, duration_ms, error)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.job_id,
    now,
    entry.status,
    entry.result ?? null,
    entry.duration_ms,
    entry.error ?? null,
  );
}

/**
 * Get run logs for a specific heartbeat job, most recent first.
 * @param limit Maximum number of entries to return (default 10).
 */
export function getHeartbeatJobLogs(
  jobId: string,
  limit: number = 10,
): HeartbeatJobLog[] {
  return db
    .prepare(
      `SELECT * FROM heartbeat_job_log WHERE job_id = ?
       ORDER BY run_at DESC LIMIT ?`,
    )
    .all(jobId, limit) as HeartbeatJobLog[];
}

/**
 * Get recent job logs across all jobs, most recent first.
 */
export function getRecentHeartbeatJobLogs(
  limit: number = 20,
): HeartbeatJobLog[] {
  return db
    .prepare(
      `SELECT * FROM heartbeat_job_log ORDER BY run_at DESC LIMIT ?`,
    )
    .all(limit) as HeartbeatJobLog[];
}

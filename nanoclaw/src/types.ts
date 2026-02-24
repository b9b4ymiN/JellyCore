export interface AdditionalMount {
  hostPath: string; // Absolute path on host (supports ~ for home)
  containerPath?: string; // Optional — defaults to basename of hostPath. Mounted at /workspace/extra/{value}
  readonly?: boolean; // Default: true for safety
}

/**
 * Mount Allowlist - Security configuration for additional mounts
 * This file should be stored at ~/.config/nanoclaw/mount-allowlist.json
 * and is NOT mounted into any container, making it tamper-proof from agents.
 */
export interface MountAllowlist {
  // Directories that can be mounted into containers
  allowedRoots: AllowedRoot[];
  // Glob patterns for paths that should never be mounted (e.g., ".ssh", ".gnupg")
  blockedPatterns: string[];
  // If true, non-main groups can only mount read-only regardless of config
  nonMainReadOnly: boolean;
}

export interface AllowedRoot {
  // Absolute path or ~ for home (e.g., "~/projects", "/var/repos")
  path: string;
  // Whether read-write mounts are allowed under this root
  allowReadWrite: boolean;
  // Optional description for documentation
  description?: string;
}

export interface ContainerConfig {
  additionalMounts?: AdditionalMount[];
  timeout?: number; // Default: 300000 (5 minutes)
}

export interface RegisteredGroup {
  name: string;
  folder: string;
  trigger: string;
  added_at: string;
  containerConfig?: ContainerConfig;
  requiresTrigger?: boolean; // Default: true for groups, false for solo chats
}

export interface NewMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
}

export type LaneType = 'user' | 'scheduler' | 'heartbeat';

export type MessageStatus =
  | 'RECEIVED'
  | 'QUEUED'
  | 'RUNNING'
  | 'REPLIED'
  | 'RETRYING'
  | 'TIMEOUT'
  | 'FAILED'
  | 'DEAD_LETTERED';

export interface TraceContext {
  trace_id: string;
  chat_jid: string;
  external_message_id: string;
  lane: LaneType;
}

export interface MessageReceipt extends TraceContext {
  status: MessageStatus;
  attempt_count: number;
  error_code: string | null;
  error_detail: string | null;
  received_at: string;
  queued_at: string | null;
  started_at: string | null;
  replied_at: string | null;
  timeout_at: string | null;
  dead_lettered_at: string | null;
}

export interface MessageAttempt {
  id: number;
  trace_id: string;
  attempt_no: number;
  container_name: string | null;
  spawn_started_at: string | null;
  spawn_failed_at: string | null;
  run_started_at: string | null;
  run_ended_at: string | null;
  exit_code: number | null;
  timeout_hit: number;
}

export interface DeadLetterMessage {
  trace_id: string;
  chat_jid: string;
  external_message_id: string;
  reason: string;
  final_error: string | null;
  retryable: number;
  status: 'open' | 'retrying' | 'resolved';
  created_at: string;
  retried_at: string | null;
  retried_by: string | null;
}

export interface ScheduledTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  context_mode: 'group' | 'isolated';
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  /** active → running normally; paused → suspended by user; completed → once task done; cancelled → soft-deleted */
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  created_at: string;
  // --- retry ---
  /** Consecutive failure count. Reset to 0 on success. */
  retry_count?: number;
  /** Maximum retries before marking permanently failed. 0 = never retry. */
  max_retries?: number;
  /** Milliseconds to wait between retries. */
  retry_delay_ms?: number;
  // --- timeout ---
  /** Per-task hard timeout in ms. Null = use TASK_DEFAULT_TIMEOUT_MS. */
  task_timeout_ms?: number | null;
  // --- label ---
  /** Optional human-readable label shown in heartbeat/UI. */
  label?: string | null;
}

/** Enriched view of a ScheduledTask including human-readable next_run in host timezone. */
export type ScheduledTaskView = ScheduledTask & {
  next_run_local: string | null;
  timezone: string;
};

export interface TaskRunLog {
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: 'success' | 'error';
  result: string | null;
  error: string | null;
}

// --- Heartbeat Jobs ---

/** A user-configurable job that runs every heartbeat cycle. */
export interface HeartbeatJob {
  id: string;
  /** Which group chat should receive the heartbeat results */
  chat_jid: string;
  /** Short human-readable label (e.g. "Monitor NVDA", "Health check") */
  label: string;
  /** Full prompt given to the AI agent when this job runs */
  prompt: string;
  /** Category for grouping in reports: learning, monitor, health, custom */
  category: 'learning' | 'monitor' | 'health' | 'custom';
  /** active | paused */
  status: 'active' | 'paused';
  /** Override interval for THIS job in ms. NULL = use global heartbeat interval (default 1h) */
  interval_ms: number | null;
  /** ISO timestamp of last execution */
  last_run: string | null;
  /** Summary of last execution result */
  last_result: string | null;
  /** ISO timestamp of creation */
  created_at: string;
  /** Who created it (group folder) */
  created_by: string;
}

/** Per-run log entry for a HeartbeatJob execution. */
export interface HeartbeatJobLog {
  id: number;
  job_id: string;
  /** ISO timestamp of the run */
  run_at: string;
  /** 'ok' | 'error' */
  status: string;
  /** Truncated result string, or null on error */
  result: string | null;
  /** Wall-clock duration in ms */
  duration_ms: number;
  /** Error message, or null on success */
  error: string | null;
}

// --- Channel abstraction ---

export interface Channel {
  name: string;
  connect(): Promise<void>;
  sendMessage(jid: string, text: string): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
  disconnect(): Promise<void>;
  // Optional: typing indicator. Channels that support it implement it.
  setTyping?(jid: string, isTyping: boolean): Promise<void>;
  // Whether to prefix outbound messages with the assistant name.
  // Telegram bots already display their name, so they return false.
  // WhatsApp returns true. Default true if not implemented.
  prefixAssistantName?: boolean;
}

// Callback type that channels use to deliver inbound messages
export type OnInboundMessage = (chatJid: string, message: NewMessage) => void;

// Callback for chat metadata discovery.
// name is optional — channels that deliver names inline (Telegram) pass it here;
// channels that sync names separately (WhatsApp syncGroupMetadata) omit it.
export type OnChatMetadata = (chatJid: string, timestamp: string, name?: string) => void;

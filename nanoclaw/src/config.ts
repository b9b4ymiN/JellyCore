import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'Andy';
export const POLL_INTERVAL = 30000; // Fallback only — event-driven via MessageBus
export const SCHEDULER_POLL_INTERVAL = parseInt(
  process.env.SCHEDULER_POLL_INTERVAL || '10000',
  10,
); // 10s default — ±10s drift (was 60s)

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || '/Users/user';

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanoclaw',
  'mount-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'main';

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'nanoclaw-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '720000',
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default

// Context budget: limits for prompt construction to prevent "Prompt is too long" errors
export const MAX_PROMPT_MESSAGES = parseInt(
  process.env.MAX_PROMPT_MESSAGES || '50',
  10,
); // Max messages fetched from DB per group
export const MAX_PROMPT_CHARS = parseInt(
  process.env.MAX_PROMPT_CHARS || '30000',
  10,
); // Max chars in formatted message XML (~10K tokens)
export const SESSION_MAX_AGE_MS = parseInt(
  process.env.SESSION_MAX_AGE_HOURS || '24',
  10,
) * 60 * 60 * 1000; // Session rotation age (default 24h)
export const IPC_POLL_INTERVAL = 1000;
export const IDLE_TIMEOUT = parseInt(
  process.env.IDLE_TIMEOUT || '240000',
  10,
); // 4min default - how long to keep container alive after last result

// Maximum time to show typing indicator per request (safety net)
// Even if the container is still running, stop sending typing after this
export const TYPING_MAX_TTL = parseInt(
  process.env.TYPING_MAX_TTL || '300000',
  10,
); // 5 min default
export const MAX_CONCURRENT_CONTAINERS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_CONTAINERS || '5', 10) || 5,
);
export const MAX_QUEUE_SIZE = Math.max(
  5,
  parseInt(process.env.MAX_QUEUE_SIZE || '20', 10) || 20,
);

// Container Warm Pool
export const POOL_ENABLED =
  (process.env.POOL_ENABLED || 'false').toLowerCase() === 'true';
export const POOL_MIN_SIZE = Math.max(0, parseInt(process.env.POOL_MIN_SIZE || '1', 10) || 1);
export const POOL_MAX_SIZE = Math.max(1, parseInt(process.env.POOL_MAX_SIZE || '5', 10) || 3);
export const POOL_IDLE_TIMEOUT = parseInt(process.env.POOL_IDLE_TIMEOUT || '300000', 10); // 5 min
export const POOL_WARMUP_INTERVAL = parseInt(process.env.POOL_WARMUP_INTERVAL || '30000', 10); // 30s
export const POOL_MAX_REUSE = Math.max(1, parseInt(process.env.POOL_MAX_REUSE || '10', 10) || 10);

// User message retry policy (soft guarantee)
export const USER_MESSAGE_RETRY_SCHEDULE_MS = (
  process.env.USER_MESSAGE_RETRY_SCHEDULE_MS || '5000,30000'
)
  .split(',')
  .map((v) => parseInt(v.trim(), 10))
  .filter((v) => Number.isFinite(v) && v > 0);
export const USER_MESSAGE_RETRY_JITTER_PCT = Math.max(
  0,
  Math.min(100, parseInt(process.env.USER_MESSAGE_RETRY_JITTER_PCT || '20', 10) || 20),
);

// User-facing status timings
export const USER_ACK_TARGET_MS = parseInt(
  process.env.USER_ACK_TARGET_MS || '5000',
  10,
);
export const USER_PROGRESS_INTERVALS_MS = (
  process.env.USER_PROGRESS_INTERVALS_MS || '20000,120000,300000'
)
  .split(',')
  .map((v) => parseInt(v.trim(), 10))
  .filter((v) => Number.isFinite(v) && v > 0);

// Spawn circuit breaker + docker runtime watchdog
export const SPAWN_CIRCUIT_THRESHOLD = Math.max(
  1,
  parseInt(process.env.SPAWN_CIRCUIT_THRESHOLD || '3', 10) || 3,
);
export const SPAWN_CIRCUIT_WINDOW_MS = parseInt(
  process.env.SPAWN_CIRCUIT_WINDOW_MS || '120000',
  10,
);
export const SPAWN_CIRCUIT_COOLDOWN_MS = parseInt(
  process.env.SPAWN_CIRCUIT_COOLDOWN_MS || '60000',
  10,
);
export const DOCKER_HEALTH_PROBE_INTERVAL_MS = parseInt(
  process.env.DOCKER_HEALTH_PROBE_INTERVAL_MS || '30000',
  10,
);
export const ORPHAN_SWEEP_INTERVAL_MS = parseInt(
  process.env.ORPHAN_SWEEP_INTERVAL_MS || '120000',
  10,
);

// Runtime capability smoke checks
export const CAPABILITY_PROBE_INTERVAL_MS = parseInt(
  process.env.CAPABILITY_PROBE_INTERVAL_MS || '300000',
  10,
); // 5 min
export const CAPABILITY_PROBE_TIMEOUT_MS = parseInt(
  process.env.CAPABILITY_PROBE_TIMEOUT_MS || '5000',
  10,
); // 5s
export const CAPABILITY_AGENT_BROWSER_CHECK_INTERVAL_MS = parseInt(
  process.env.CAPABILITY_AGENT_BROWSER_CHECK_INTERVAL_MS || '1800000',
  10,
); // 30 min

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TRIGGER_PATTERN = new RegExp(
  `^@${escapeRegex(ASSISTANT_NAME)}\\b`,
  'i',
);

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// --- Oracle integration ---
export const ORACLE_BASE_URL = process.env.ORACLE_BASE_URL || 'http://oracle-v2:47778';

// --- Heartbeat ---
export const HEARTBEAT_ENABLED =
  (process.env.HEARTBEAT_ENABLED || 'true').toLowerCase() !== 'false';
export const HEARTBEAT_INTERVAL_MS = parseInt(
  process.env.HEARTBEAT_INTERVAL_HOURS || '6',
  10,
) * 60 * 60 * 1000; // hours → ms (default 6h)
export const HEARTBEAT_SILENCE_THRESHOLD_MS = parseInt(
  process.env.HEARTBEAT_SILENCE_THRESHOLD_HOURS || '2',
  10,
) * 60 * 60 * 1000; // hours → ms (default 2h)
/** Default interval for smart heartbeat jobs (default 1 hour) */
export const HEARTBEAT_JOB_DEFAULT_INTERVAL_MS = parseInt(
  process.env.HEARTBEAT_JOB_INTERVAL_MINUTES || '60',
  10,
) * 60 * 1000; // minutes → ms (default 60 min)
/** How often the job runner polls for due jobs (default 30 seconds) */
export const HEARTBEAT_JOB_POLL_INTERVAL_MS = parseInt(
  process.env.HEARTBEAT_JOB_POLL_INTERVAL_MS || '30000',
  10,
);
/** Hard timeout for a single heartbeat job execution (default 10 minutes) */
export const HEARTBEAT_JOB_TIMEOUT_MS = parseInt(
  process.env.HEARTBEAT_JOB_TIMEOUT_MINUTES || '10',
  10,
) * 60 * 1000;

// --- Task defaults ---
// Hard cap per scheduled task run (prevents hung containers)
export const TASK_DEFAULT_TIMEOUT_MS = parseInt(
  process.env.TASK_DEFAULT_TIMEOUT_MS || '600000',
  10,
); // 10 min default
// Max consecutive retries before giving up
export const TASK_DEFAULT_MAX_RETRIES = parseInt(
  process.env.TASK_DEFAULT_MAX_RETRIES || '2',
  10,
);
export const TASK_DEFAULT_RETRY_DELAY_MS = parseInt(
  process.env.TASK_DEFAULT_RETRY_DELAY_MS || '300000',
  10,
); // 5 min between retries

// WhatsApp auth encryption passphrase (required for encrypted auth at rest)
export const AUTH_PASSPHRASE = process.env.JELLYCORE_AUTH_PASSPHRASE;

// Telegram bot token (optional — if not set, Telegram channel is disabled)
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

// Enabled channels: comma-separated list of channels to activate
// Values: "telegram", "whatsapp" (case-insensitive)
// Default: "telegram" (WhatsApp disabled by default)
// Examples: ENABLED_CHANNELS=telegram  |  ENABLED_CHANNELS=telegram,whatsapp
export const ENABLED_CHANNELS: Set<string> = new Set(
  (process.env.ENABLED_CHANNELS || 'telegram')
    .toLowerCase()
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
);

// IPC integrity signing secret (auto-generated if not provided)
export const IPC_SECRET = (() => {
  if (process.env.JELLYCORE_IPC_SECRET) return process.env.JELLYCORE_IPC_SECRET;
  const secretFile = path.join(STORE_DIR, '.ipc-secret');
  try {
    if (fs.existsSync(secretFile)) {
      return fs.readFileSync(secretFile, 'utf-8').trim();
    }
  } catch { /* fall through to generate */ }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  return secret;
})();


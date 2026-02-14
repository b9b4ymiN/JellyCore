import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'Andy';
export const POLL_INTERVAL = 30000; // Fallback only — event-driven via MessageBus
export const SCHEDULER_POLL_INTERVAL = 60000;

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
  process.env.CONTAINER_TIMEOUT || '1800000',
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const IPC_POLL_INTERVAL = 1000;
export const IDLE_TIMEOUT = parseInt(
  process.env.IDLE_TIMEOUT || '1800000',
  10,
); // 30min default — how long to keep container alive after last result
export const MAX_CONCURRENT_CONTAINERS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_CONTAINERS || '5', 10) || 5,
);
export const MAX_QUEUE_SIZE = Math.max(
  5,
  parseInt(process.env.MAX_QUEUE_SIZE || '20', 10) || 20,
);

// Container Warm Pool
export const POOL_MIN_SIZE = Math.max(0, parseInt(process.env.POOL_MIN_SIZE || '1', 10) || 1);
export const POOL_MAX_SIZE = Math.max(1, parseInt(process.env.POOL_MAX_SIZE || '3', 10) || 3);
export const POOL_IDLE_TIMEOUT = parseInt(process.env.POOL_IDLE_TIMEOUT || '300000', 10); // 5 min
export const POOL_WARMUP_INTERVAL = parseInt(process.env.POOL_WARMUP_INTERVAL || '30000', 10); // 30s
export const POOL_MAX_REUSE = Math.max(1, parseInt(process.env.POOL_MAX_REUSE || '10', 10) || 10);

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

// WhatsApp auth encryption passphrase (required for encrypted auth at rest)
export const AUTH_PASSPHRASE = process.env.JELLYCORE_AUTH_PASSPHRASE;

// Telegram bot token (optional — if not set, Telegram channel is disabled)
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

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

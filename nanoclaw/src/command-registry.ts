/**
 * Central command registry for Telegram/inline slash commands.
 *
 * Single source of truth:
 * - Telegram menu commands
 * - Query router command detection
 * - Inline handler dispatch typing
 */

export type CommandCategory = 'general' | 'session' | 'cost' | 'admin';

export interface CommandDefinition {
  command: string; // without leading slash
  description: string;
  category: CommandCategory;
  helpDescription?: string;
}

export const COMMAND_DEFINITIONS = [
  { command: 'start', description: 'เริ่มต้นใช้งาน', category: 'general' },
  { command: 'help', description: 'คำสั่งที่ใช้ได้', category: 'general' },
  { command: 'ping', description: 'ทดสอบว่าบอทตอบ', category: 'general' },
  { command: 'me', description: 'ข้อมูลที่ AI รู้เกี่ยวกับคุณ', category: 'general' },
  { command: 'soul', description: 'ดูบุคลิกของ AI', category: 'general' },

  { command: 'session', description: 'ดูข้อมูล session & context', category: 'session' },
  { command: 'clear', description: 'ล้าง session (แก้ Prompt too long)', category: 'session' },
  { command: 'reset', description: 'ล้างข้อมูลผู้ใช้ (USER.md)', category: 'session' },
  { command: 'model', description: 'ดู model & tier ปัจจุบัน', category: 'session' },

  { command: 'usage', description: 'สรุปการใช้งานวันนี้', category: 'cost' },
  { command: 'cost', description: 'ค่าใช้จ่ายเดือนนี้', category: 'cost' },
  {
    command: 'budget',
    description: 'ดู/ตั้ง budget',
    helpDescription: 'ดู/ตั้ง budget',
    category: 'cost',
  },

  { command: 'status', description: 'สถานะระบบ', category: 'admin' },
  { command: 'health', description: 'Health check ละเอียด', category: 'admin' },
  { command: 'containers', description: 'ดู Docker containers ทั้งหมด', category: 'admin' },
  { command: 'queue', description: 'ดูคิวงาน', category: 'admin' },
  { command: 'errors', description: 'ดู errors ล่าสุด', category: 'admin' },
  {
    command: 'heartbeat',
    description: 'Manage heartbeat runtime',
    helpDescription: 'Manage heartbeat runtime (use: /heartbeat help)',
    category: 'admin',
  },
  {
    command: 'hbjob',
    description: 'Manage heartbeat jobs',
    helpDescription: 'Manage heartbeat jobs (use: /hbjob help)',
    category: 'admin',
  },
  {
    command: 'kill',
    description: 'หยุด container',
    helpDescription: 'หยุด container (ใช้: /kill ชื่อ)',
    category: 'admin',
  },
  { command: 'restart', description: 'Restart container ของ group นี้', category: 'admin' },
  { command: 'docker', description: 'ดู Docker resource usage', category: 'admin' },
] as const satisfies readonly CommandDefinition[];

export type CommandName = (typeof COMMAND_DEFINITIONS)[number]['command'];

export const TELEGRAM_COMMANDS: Array<{ command: string; description: string }> =
  COMMAND_DEFINITIONS.map(({ command, description }) => ({ command, description }));

const COMMAND_NAME_SET = new Set<string>(COMMAND_DEFINITIONS.map((c) => c.command));

export const ANY_SLASH_COMMAND_REGEX = /^\/[a-z0-9_]{1,32}(?:@[a-z0-9_]{3,})?\b/i;

export function isKnownCommandName(name: string): name is CommandName {
  return COMMAND_NAME_SET.has(name);
}

export function parseSlashCommand(
  message: string,
): { command: string; args: string } | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith('/')) return null;
  const firstToken = trimmed.split(/\s+/, 1)[0];
  if (!firstToken) return null;

  const rawName = firstToken.slice(1).split('@')[0].toLowerCase();
  if (!rawName) return null;
  const args = trimmed.slice(firstToken.length).trim();
  return { command: rawName, args };
}

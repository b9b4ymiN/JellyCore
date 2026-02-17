/**
 * Inline Handler — Template responses for trivial messages & slash commands
 *
 * No container spawn, no API call. <50ms response time.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { ASSISTANT_NAME, GROUPS_DIR, MAX_PROMPT_MESSAGES, MAX_PROMPT_CHARS, SESSION_MAX_AGE_MS } from './config.js';
import { cmdUsage, cmdCost, cmdBudget } from './cost-intelligence.js';
import { getSessionAge, getDb } from './db.js';

// ─── Result Type ─────────────────────────────────────────────────────

export type InlineAction = 'clear-session';

export interface InlineResult {
  reply: string;
  action?: InlineAction;
}

// ─── Telegram Slash Commands ─────────────────────────────────────────

/** Commands registered with Telegram's autocomplete menu */
export const TELEGRAM_COMMANDS = [
  { command: 'start', description: 'เริ่มต้นใช้งาน' },
  { command: 'help', description: 'คำสั่งที่ใช้ได้' },
  { command: 'status', description: 'สถานะระบบ' },
  { command: 'session', description: 'ดูข้อมูล session & context' },
  { command: 'clear', description: 'ล้าง session (แก้ Prompt too long)' },
  { command: 'usage', description: 'สรุปการใช้งานวันนี้' },
  { command: 'cost', description: 'ค่าใช้จ่ายเดือนนี้' },
  { command: 'budget', description: 'ดู/ตั้ง budget' },
  { command: 'model', description: 'ดู model & tier ปัจจุบัน' },
  { command: 'ping', description: 'ทดสอบว่าบอทตอบ' },
  { command: 'soul', description: 'ดูบุคลิกของ AI' },
  { command: 'me', description: 'ข้อมูลที่ AI รู้เกี่ยวกับคุณ' },
  { command: 'reset', description: 'ล้างข้อมูลผู้ใช้ (USER.md)' },
];

// ─── Inline Responses ────────────────────────────────────────────────

const responses: Record<string, string[]> = {
  greeting: [
    'หวัดดี! 👋',
    'สวัสดีค่ะ',
    'Hey! 🌧️',
  ],
  thanks: [
    'ยินดีค่ะ 😊',
    'ไม่เป็นไรค่ะ',
    '💙',
  ],
  ack: [
    'รับทราบค่ะ ✅',
    '👍',
    'โอเคค่ะ',
  ],
  'admin-cmd': [], // handled by handleCommand()
};

function randomPick(arr: string[]): string {
  if (arr.length === 0) return '✅';
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Command Handlers ────────────────────────────────────────────────

function cmdStart(): string {
  return [
    `สวัสดีค่ะ! ฝนเป็น AI ส่วนตัวของคุณ 🌧️`,
    '',
    'พิมพ์อะไรก็ได้เลย ฝนพร้อมช่วยค่ะ',
    'ดูคำสั่งทั้งหมด → /help',
  ].join('\n');
}

function cmdHelp(): string {
  const lines = TELEGRAM_COMMANDS.map(c => `/${c.command} — ${c.description}`);
  return [
    '*คำสั่ง*',
    '',
    ...lines,
    '',
    'หรือพิมพ์อะไรก็ได้ ฝนจะตอบให้ค่ะ',
  ].join('\n');
}

function cmdStatus(): string {
  // Count running agent containers
  let containerCount = 0;
  try {
    const output = execSync(
      'docker ps --filter name=nanoclaw- --format {{.Names}} 2>/dev/null',
      { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    containerCount = output.trim().split('\n').filter(Boolean).length;
  } catch { /* docker not accessible or no containers */ }

  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const mins = Math.floor((uptime % 3600) / 60);
  const uptimeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  return [
    '🟢 *ระบบทำงานปกติ*',
    '',
    `⏱ Uptime: ${uptimeStr}`,
    `📦 Agent containers: ${containerCount}`,
    `💾 Memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
  ].join('\n');
}

function cmdSoul(): string {
  const soulPath = path.join(GROUPS_DIR, 'global', 'SOUL.md');
  try {
    const content = fs.readFileSync(soulPath, 'utf-8');
    // Extract just the "Who You Are" section for a concise view
    const nameMatch = content.match(/- Name:\s*(.+)/);
    const personalityMatch = content.match(/- Personality:\s*(.+)/);
    const toneMatch = content.match(/- Tone:\s*(.+)/);
    const emojiMatch = content.match(/- Emoji:\s*(.+)/);

    const lines: string[] = ['🌧️ *SOUL*', ''];
    if (nameMatch) lines.push(`ชื่อ: ${nameMatch[1].trim()}`);
    if (personalityMatch) lines.push(`บุคลิก: ${personalityMatch[1].trim()}`);
    if (toneMatch) lines.push(`Tone: ${toneMatch[1].trim()}`);
    if (emojiMatch) lines.push(`Emoji: ${emojiMatch[1].trim()}`);
    lines.push('', 'แก้ไขได้ที่ `/workspace/global/SOUL.md`');
    return lines.join('\n');
  } catch {
    return 'ยังไม่มี SOUL.md — ฝนยังไม่มีตัวตนที่กำหนดค่ะ';
  }
}

function cmdMe(chatJid: string, groupFolder?: string): string {
  const folder = groupFolder || 'main';
  const userPath = path.join(GROUPS_DIR, folder, 'USER.md');
  try {
    const content = fs.readFileSync(userPath, 'utf-8');
    // Check if it's still the template (no real data)
    if (content.includes('(เรียนรู้จากการสนทนา)') && !content.match(/- Name:\s*.+[^\s(]/)) {
      return 'ฝนยังไม่รู้จักคุณเลย — ลองคุยกันก่อนนะคะ แล้วฝนจะจดจำเองค่ะ';
    }
    // Extract key info
    const nameMatch = content.match(/- Name:\s*(.+)/);
    const nickMatch = content.match(/- Nickname:\s*(.+)/);

    const lines: string[] = ['👤 *ข้อมูลของคุณ*', ''];
    if (nameMatch && !nameMatch[1].includes('เรียนรู้จากการสนทนา')) {
      lines.push(`ชื่อ: ${nameMatch[1].trim()}`);
    }
    if (nickMatch && nickMatch[1].trim()) {
      lines.push(`ชื่อเล่น: ${nickMatch[1].trim()}`);
    }

    // Extract preferences (non-empty lines under ## Preferences)
    const prefsMatch = content.match(/## Preferences\n([\s\S]*?)(?=\n## |\n*$)/);
    if (prefsMatch) {
      const prefs = prefsMatch[1].trim().split('\n').filter(l => l.trim() && !l.includes('สะสมจากการสนทนา'));
      if (prefs.length > 0) {
        lines.push('', '*ความชอบ:*');
        prefs.slice(0, 5).forEach(p => lines.push(p));
      }
    }

    lines.push('', 'ล้างข้อมูล → /reset');
    return lines.join('\n');
  } catch {
    return 'ยังไม่มีข้อมูลของคุณค่ะ — ลองคุยกันก่อนนะคะ';
  }
}

function cmdPing(): string {
  return 'pong 🏓';
}

function cmdSession(groupFolder?: string): string {
  const folder = groupFolder || 'main';

  // Session age
  const ageMs = getSessionAge(folder);
  let ageStr = 'ไม่มี session';
  if (ageMs !== null) {
    const hours = Math.floor(ageMs / 3600000);
    const mins = Math.floor((ageMs % 3600000) / 60000);
    ageStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  }

  // Message count in current window (today's messages for this group)
  let msgCount = 0;
  let totalChars = 0;
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(LENGTH(content)), 0) as chars
      FROM messages
      WHERE chat_jid IN (
        SELECT jid FROM registered_groups WHERE folder = ?
      )
      AND date(timestamp) = date('now')
    `).get(folder) as { count: number; chars: number } | undefined;
    msgCount = row?.count || 0;
    totalChars = row?.chars || 0;
  } catch { /* DB not ready */ }

  const maxAge = SESSION_MAX_AGE_MS / 3600000;
  const lines = [
    '📋 *Session Info*',
    '',
    `⏱ Session age: ${ageStr} (max ${maxAge}h)`,
    `💬 Messages today: ${msgCount}`,
    `📏 Total chars: ${totalChars.toLocaleString()} / ${MAX_PROMPT_CHARS.toLocaleString()} limit`,
    `📦 Max messages/prompt: ${MAX_PROMPT_MESSAGES}`,
    '',
  ];

  // Context health indicator
  const charPct = MAX_PROMPT_CHARS > 0 ? totalChars / MAX_PROMPT_CHARS : 0;
  if (charPct > 0.9) {
    lines.push('🔴 Context เกือบเต็ม — แนะนำ /clear');
  } else if (charPct > 0.7) {
    lines.push('🟡 Context ค่อนข้างมาก');
  } else {
    lines.push('🟢 Context ปกติ');
  }

  lines.push('', 'ล้าง session → /clear');
  return lines.join('\n');
}

function cmdClear(groupFolder?: string): InlineResult {
  return {
    reply: [
      '🗑️ *ล้าง Session สำเร็จ*',
      '',
      'ล้างแล้ว:',
      '• Session (Claude Code SDK)',
      '• Message cursor (ตัวชี้ข้อความ)',
      '',
      'ข้อความเก่าจะไม่ถูกส่งไปยัง AI อีก',
      'พิมพ์อะไรก็ได้เพื่อเริ่มบทสนทนาใหม่ค่ะ',
    ].join('\n'),
    action: 'clear-session',
  };
}

function cmdModel(): string {
  const sonnetModel = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'GLM-4.7';
  const haikuModel = process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || 'GLM-4.7-Flash';
  const opusModel = process.env.ANTHROPIC_DEFAULT_OPUS_MODEL || 'GLM-4.7';
  const baseUrl = process.env.ANTHROPIC_BASE_URL || '(default)';

  return [
    '🤖 *Model Configuration*',
    '',
    '*z.ai GLM Mapping:*',
    `• sonnet → ${sonnetModel}`,
    `• haiku → ${haikuModel}`,
    `• opus → ${opusModel}`,
    '',
    '*Query Routing:*',
    '• inline — greetings/commands (no AI)',
    '• oracle — memory/search (API only)',
    '• container-light → haiku',
    '• container-full → sonnet',
    '',
    `API: ${baseUrl}`,
  ].join('\n');
}

function cmdReset(groupFolder?: string): string {
  const folder = groupFolder || 'main';
  const userPath = path.join(GROUPS_DIR, folder, 'USER.md');

  const template = `# User

ข้อมูลเกี่ยวกับผู้ใช้ — ฝนอัปเดตไฟล์นี้เองเมื่อเรียนรู้สิ่งใหม่

## Basic Info

- Name: (เรียนรู้จากการสนทนา)
- Nickname: (ชื่อเล่นที่ชอบให้เรียก)
- Language: ไทย (mix English ได้)
- Timezone: Asia/Bangkok (UTC+7)

## Preferences

(สะสมจากการสนทนา — สิ่งที่ชอบ, ไม่ชอบ, style การทำงาน)

## Projects

(โปรเจคที่กำลังทำอยู่ — อัปเดตเมื่อมีข้อมูลใหม่)

## Notes

(บันทึกอื่นๆ ที่เป็นประโยชน์)
`;

  try {
    fs.writeFileSync(userPath, template, 'utf-8');
    return 'ล้างข้อมูลแล้วค่ะ 🗑️ เริ่มต้นใหม่สะอาดเลย';
  } catch {
    return 'ไม่สามารถล้างข้อมูลได้ค่ะ';
  }
}

// ─── Main Handler ────────────────────────────────────────────────────

export function handleInline(
  reason: string,
  message: string,
  chatJid?: string,
  groupFolder?: string,
): string | InlineResult {
  if (reason === 'admin-cmd') {
    const cmd = message.trim().split(/\s+/)[0].toLowerCase();
    switch (cmd) {
      case '/start': return cmdStart();
      case '/help': return cmdHelp();
      case '/status': return cmdStatus();
      case '/session': return cmdSession(groupFolder);
      case '/clear': return cmdClear(groupFolder);
      case '/ping': return cmdPing();
      case '/model': return cmdModel();
      case '/soul': return cmdSoul();
      case '/me': return cmdMe(chatJid || '', groupFolder);
      case '/reset': return cmdReset(groupFolder);
      case '/usage': return cmdUsage();
      case '/cost': return cmdCost();
      case '/budget': return cmdBudget(message.trim().replace(/^\/budget\s*/i, ''));
      default: return `ไม่รู้จักคำสั่ง ${cmd} — ลอง /help ดูนะคะ`;
    }
  }

  return randomPick(responses[reason] || responses.ack);
}

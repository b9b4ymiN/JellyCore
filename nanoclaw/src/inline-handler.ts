/**
 * Inline Handler — Template responses for trivial messages & slash commands
 *
 * No container spawn, no API call. <50ms response time.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { GROUPS_DIR, MAX_PROMPT_MESSAGES, MAX_PROMPT_CHARS, SESSION_MAX_AGE_MS } from './config.js';
import {
  COMMAND_DEFINITIONS,
  CommandName,
  CommandCategory,
  isKnownCommandName,
  parseSlashCommand,
  TELEGRAM_COMMANDS,
} from './command-registry.js';
import { cmdUsage, cmdCost, cmdBudget } from './cost-intelligence.js';
import { getSessionAge, getDb } from './db.js';
import { recentErrors } from './health-server.js';
import { logger } from './logger.js';
import { resourceMonitor } from './resource-monitor.js';

export { TELEGRAM_COMMANDS };

// ─── Result Type ─────────────────────────────────────────────────────

export type InlineAction = 'clear-session';

export interface InlineResult {
  reply: string;
  action?: InlineAction;
}

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
    `สวัสดีค่ะ! เป็น AI ส่วนตัวของคุณ 🌧️`,
    '',
    'พิมพ์อะไรก็ได้เลย พร้อมช่วยค่ะ',
    'ดูคำสั่งทั้งหมด → /help',
  ].join('\n');
}

function cmdHelp(): string {
  const titleByCategory: Record<CommandCategory, string> = {
    general: '*ทั่วไป:*',
    session: '*Session:*',
    cost: '*ค่าใช้จ่าย:*',
    admin: '*🔧 Admin:*',
  };
  const orderedCategories: CommandCategory[] = ['general', 'session', 'cost', 'admin'];

  const lines: string[] = ['*คำสั่งทั้งหมด*', ''];
  for (const category of orderedCategories) {
    const defs = COMMAND_DEFINITIONS.filter((d) => d.category === category);
    if (defs.length === 0) continue;
    lines.push(titleByCategory[category]);
    for (const def of defs) {
      const helpDescription = 'helpDescription' in def ? def.helpDescription : undefined;
      lines.push(`/${def.command} — ${helpDescription || def.description}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

function cmdStatus(): string {
  // Count running agent containers
  let containerCount = 0;
  let containerNames: string[] = [];
  try {
    const output = execSync(
      'docker ps --filter name=nanoclaw- --format "{{.Names}}" 2>/dev/null',
      { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    containerNames = output.trim().split('\n').filter(Boolean);
    containerCount = containerNames.length;
  } catch { /* docker not accessible or no containers */ }

  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const mins = Math.floor((uptime % 3600) / 60);
  const uptimeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  const stats = resourceMonitor.stats;

  const lines = [
    '🟢 *ระบบทำงานปกติ*',
    '',
    `⏱ Uptime: ${uptimeStr}`,
    `📦 Containers: ${containerCount} active`,
    `💻 CPU: ${stats.cpuUsage} | RAM free: ${stats.memoryFree}`,
    `💾 NanoClaw: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
  ];

  if (containerCount > 0) {
    lines.push('', '*Running:*');
    containerNames.forEach(n => {
      lines.push(`• ${n.replace('nanoclaw-', '')}`);
    });
  }

  lines.push('', 'ดูเพิ่ม → /health | /containers | /errors');
  return lines.join('\n');
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

    const lines: string[] = [' *SOUL*', ''];
    if (nameMatch) lines.push(`ชื่อ: ${nameMatch[1].trim()}`);
    if (personalityMatch) lines.push(`บุคลิก: ${personalityMatch[1].trim()}`);
    if (toneMatch) lines.push(`Tone: ${toneMatch[1].trim()}`);
    if (emojiMatch) lines.push(`Emoji: ${emojiMatch[1].trim()}`);
    lines.push('', 'แก้ไขได้ที่ `/workspace/global/SOUL.md`');
    return lines.join('\n');
  } catch {
    return 'ยังไม่มี SOUL.md — ยังไม่มีตัวตนที่กำหนดค่ะ';
  }
}

function cmdMe(chatJid: string, groupFolder?: string): string {
  const folder = groupFolder || 'main';
  const userPath = path.join(GROUPS_DIR, folder, 'USER.md');
  try {
    const content = fs.readFileSync(userPath, 'utf-8');
    // Check if it's still the template (no real data)
    if (content.includes('(เรียนรู้จากการสนทนา)') && !content.match(/- Name:\s*.+[^\s(]/)) {
      return 'ยังไม่รู้จักคุณเลย — ลองคุยกันก่อนนะคะ แล้วจะจดจำเองค่ะ';
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

// ─── Docker / Admin Commands ─────────────────────────────────────────

function cmdContainers(): string {
  try {
    const output = execSync(
      'docker ps --filter name=nanoclaw- --format "{{.Names}}|{{.Status}}|{{.RunningFor}}" 2>/dev/null',
      { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const lines = output.trim().split('\n').filter(Boolean);
    if (lines.length === 0) {
      return '📦 *Containers*\n\nไม่มี container ที่กำลังทำงานค่ะ';
    }
    const formatted = lines.map((line) => {
      const [name, status, running] = line.split('|');
      const shortName = name.replace('nanoclaw-', '').replace(/-\d+$/, '');
      return `• \`${shortName}\` — ${status} (${running})`;
    });
    return ['📦 *Active Containers*', '', ...formatted, '', `Total: ${lines.length}`, '', 'หยุด container → /kill ชื่อ'].join('\n');
  } catch {
    return '📦 ไม่สามารถดู containers ได้ (Docker ไม่พร้อม)';
  }
}

function cmdKill(args: string): string {
  const target = args.trim();
  if (!target) {
    return '❌ กรุณาระบุชื่อ container\nตัวอย่าง: /kill main\n\nดูรายชื่อ → /containers';
  }

  // Find matching container
  try {
    const output = execSync(
      'docker ps --filter name=nanoclaw- --format "{{.Names}}"',
      { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const containers = output.trim().split('\n').filter(Boolean);
    const match = containers.find(c =>
      c.toLowerCase().includes(target.toLowerCase())
    );
    if (!match) {
      return `❌ ไม่พบ container ที่ชื่อ "${target}"\n\nดูรายชื่อ → /containers`;
    }
    execSync(`docker stop ${match}`, { timeout: 15000, stdio: 'pipe' });
    return `✅ หยุด \`${match}\` แล้วค่ะ`;
  } catch (err: any) {
    return `❌ ไม่สามารถหยุด container: ${err.message?.slice(0, 100)}`;
  }
}

function cmdErrors(): string {
  if (!recentErrors || recentErrors.length === 0) {
    return '✅ *ไม่มี errors ล่าสุด*\n\nระบบทำงานปกติค่ะ';
  }
  const last10 = recentErrors.slice(-10);
  const lines = last10.map((e) => {
    const time = new Date(e.timestamp).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    return `• ${time} ${e.group ? `[${e.group}]` : ''} ${e.message.slice(0, 80)}`;
  });
  return [
    `⚠️ *Errors ล่าสุด* (${recentErrors.length} total)`,
    '',
    ...lines,
  ].join('\n');
}

function cmdHealth(): string {
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const mins = Math.floor((uptime % 3600) / 60);
  const uptimeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  // Resource stats
  const stats = resourceMonitor.stats;

  // Oracle check
  let oracleStatus = '❓';
  try {
    const oracleUrl = process.env.ORACLE_API_URL || 'http://oracle:47778';
    execSync(`curl -sf ${oracleUrl}/api/health -o /dev/null -w "%{http_code}"`, {
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    oracleStatus = '🟢 Online';
  } catch {
    oracleStatus = '🔴 Unreachable';
  }

  // Container count
  let containerCount = 0;
  try {
    const output = execSync(
      'docker ps --filter name=nanoclaw- --format "{{.Names}}" 2>/dev/null',
      { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    containerCount = output.trim().split('\n').filter(Boolean).length;
  } catch { /* ignore */ }

  return [
    '🏥 *Health Check*',
    '',
    `*NanoClaw:* 🟢 Running (${uptimeStr})`,
    `*Oracle:* ${oracleStatus}`,
    `*Containers:* ${containerCount} active`,
    '',
    '*Resources:*',
    `• CPU: ${stats.cpuUsage}`,
    `• RAM free: ${stats.memoryFree}`,
    `• Max concurrent: ${stats.currentMax}/${stats.baseMax}`,
    `• Memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB used`,
  ].join('\n');
}

function cmdQueue(): string {
  // We need info from the queue — use the exported getQueueInfo
  let containerCount = 0;
  try {
    const output = execSync(
      'docker ps --filter name=nanoclaw- --format "{{.Names}}" 2>/dev/null',
      { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    containerCount = output.trim().split('\n').filter(Boolean).length;
  } catch { /* ignore */ }

  const stats = resourceMonitor.stats;

  return [
    '📋 *Queue Status*',
    '',
    `*Active containers:* ${containerCount}`,
    `*Max concurrent:* ${stats.currentMax}/${stats.baseMax}`,
    `*CPU:* ${stats.cpuUsage}`,
    `*RAM free:* ${stats.memoryFree}`,
    '',
    'ล้างคิว/retry → /restart',
  ].join('\n');
}

function cmdRestart(groupFolder?: string): InlineResult {
  const folder = groupFolder || 'main';

  // Kill any running container for this group
  try {
    const output = execSync(
      `docker ps --filter name=nanoclaw-${folder} --format "{{.Names}}"`,
      { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const containers = output.trim().split('\n').filter(Boolean);
    for (const name of containers) {
      try {
        execSync(`docker stop ${name}`, { timeout: 15000, stdio: 'pipe' });
      } catch { /* already stopped */ }
    }
    if (containers.length > 0) {
      return {
        reply: `🔄 *Restart*\n\nหยุด ${containers.length} container(s) แล้ว\nSession ยังอยู่ — ข้อความถัดไปจะเริ่ม container ใหม่ค่ะ`,
        action: 'clear-session',
      };
    }
  } catch { /* ignore */ }

  return {
    reply: '🔄 *Restart*\n\nไม่มี container ที่ต้องหยุด\nล้าง session แล้ว — พิมพ์อะไรก็ได้เพื่อเริ่มใหม่ค่ะ',
    action: 'clear-session',
  };
}

function cmdDocker(): string {
  const lines: string[] = ['🐳 *Docker Resources*', ''];

  // System info
  try {
    const info = execSync(
      'docker system df --format "{{.Type}}|{{.Size}}|{{.Reclaimable}}" 2>/dev/null',
      { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    info.trim().split('\n').filter(Boolean).forEach((line) => {
      const [type, size, reclaim] = line.split('|');
      lines.push(`*${type}:* ${size} (reclaim: ${reclaim})`);
    });
  } catch {
    lines.push('ไม่สามารถดู Docker resources ได้');
  }

  // Image info
  lines.push('');
  try {
    const images = execSync(
      'docker images nanoclaw-agent --format "{{.Tag}}|{{.Size}}|{{.CreatedSince}}" 2>/dev/null',
      { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    if (images.trim()) {
      lines.push('*Agent Image:*');
      images.trim().split('\n').forEach((line) => {
        const [tag, size, created] = line.split('|');
        lines.push(`• ${tag}: ${size} (${created})`);
      });
    }
  } catch { /* ignore */ }

  lines.push('', 'ล้าง unused → `docker system prune`');
  return lines.join('\n');
}

function cmdReset(groupFolder?: string): string {
  const folder = groupFolder || 'main';
  const userPath = path.join(GROUPS_DIR, folder, 'USER.md');

  const template = `# User

ข้อมูลเกี่ยวกับผู้ใช้ — อัปเดตไฟล์นี้เองเมื่อเรียนรู้สิ่งใหม่

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

interface CommandHandlerContext {
  args: string;
  chatJid?: string;
  groupFolder?: string;
}

const COMMAND_HANDLERS: Record<
  CommandName,
  (ctx: CommandHandlerContext) => string | InlineResult
> = {
  start: () => cmdStart(),
  help: () => cmdHelp(),
  status: () => cmdStatus(),
  session: ({ groupFolder }) => cmdSession(groupFolder),
  clear: ({ groupFolder }) => cmdClear(groupFolder),
  ping: () => cmdPing(),
  model: () => cmdModel(),
  soul: () => cmdSoul(),
  me: ({ chatJid, groupFolder }) => cmdMe(chatJid || '', groupFolder),
  reset: ({ groupFolder }) => cmdReset(groupFolder),
  usage: () => cmdUsage(),
  cost: () => cmdCost(),
  budget: ({ args }) => cmdBudget(args),
  containers: () => cmdContainers(),
  kill: ({ args }) => cmdKill(args),
  errors: () => cmdErrors(),
  health: () => cmdHealth(),
  queue: () => cmdQueue(),
  restart: ({ groupFolder }) => cmdRestart(groupFolder),
  docker: () => cmdDocker(),
};

function unknownCommandReply(rawCommand: string): string {
  const suggestions = COMMAND_DEFINITIONS
    .filter((def) => def.command.startsWith(rawCommand.slice(0, 2)))
    .slice(0, 3)
    .map((def) => `/${def.command}`);
  const suggestionText = suggestions.length > 0
    ? `\n\nลองใช้: ${suggestions.join(', ')}`
    : '';
  return `ไม่รู้จักคำสั่ง /${rawCommand} — ลอง /help ดูนะคะ${suggestionText}`;
}

export function handleInline(
  reason: string,
  message: string,
  chatJid?: string,
  groupFolder?: string,
): string | InlineResult {
  if (reason === 'admin-cmd') {
    const parsed = parseSlashCommand(message);
    if (!parsed) {
      return 'ไม่พบคำสั่งที่ถูกต้อง — ลอง /help ดูนะคะ';
    }

    const { command, args } = parsed;
    if (!isKnownCommandName(command)) {
      return unknownCommandReply(command);
    }

    const handler = COMMAND_HANDLERS[command];
    try {
      return handler({ args, chatJid, groupFolder });
    } catch (err) {
      logger.error({ err, command, chatJid, groupFolder }, 'Inline command failed');
      return [
        `⚠️ คำสั่ง /${command} เกิดข้อผิดพลาดชั่วคราว`,
        '',
        'ระบบพยายามคืนสภาพให้อัตโนมัติแล้ว',
        'ลองรันซ้ำอีกครั้ง หรือใช้ /help เพื่อเลือกคำสั่งอื่น',
      ].join('\n');
    }
  }

  return randomPick(responses[reason] || responses.ack);
}

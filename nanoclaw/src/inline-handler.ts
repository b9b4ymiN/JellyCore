/**
 * Inline Handler — Template responses for trivial messages & slash commands
 *
 * No container spawn, no API call. <50ms response time.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { GROUPS_DIR, MAIN_GROUP_FOLDER, MAX_PROMPT_MESSAGES, MAX_PROMPT_CHARS, SESSION_MAX_AGE_MS } from './config.js';
import {
  COMMAND_DEFINITIONS,
  CommandName,
  CommandCategory,
  isKnownCommandName,
  parseSlashCommand,
  TELEGRAM_COMMANDS,
} from './command-registry.js';
import { cmdUsage, cmdCost, cmdBudget } from './cost-intelligence.js';
import {
  createHeartbeatJob,
  deleteHeartbeatJob,
  getAllHeartbeatJobs,
  getDb,
  getHeartbeatJob,
  getSessionAge,
  updateHeartbeatJob,
} from './db.js';
import { getHeartbeatConfig, patchHeartbeatConfig } from './heartbeat.js';
import { recentErrors } from './health-server.js';
import { writeHeartbeatJobsSnapshot } from './ipc.js';
import { logger } from './logger.js';
import { resourceMonitor } from './resource-monitor.js';
import { getTelegramMediaConfig, patchTelegramMediaConfig } from './telegram-media-config.js';
import { cleanupTelegramMediaFiles } from './telegram-media.js';
import type { TelegramMediaKind } from './telegram-media.js';
import type { HeartbeatJob } from './types.js';
import type { HeartbeatRuntimeConfig } from './heartbeat.js';

export { TELEGRAM_COMMANDS };

// ─── Result Type ─────────────────────────────────────────────────────

export type InlineAction =
  | 'clear-session'
  | {
      type: 'send-telegram-media';
      kind: TelegramMediaKind;
      relativePath: string;
      caption?: string;
      groupFolder?: string;
    };

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

function tgMediaHelpText(): string {
  return [
    'Telegram media commands',
    '/tgmedia status',
    '/tgmedia enable | disable',
    '/tgmedia download on | off',
    '/tgmedia clean [days]',
    '/tgsendfile <relative_path> [caption]',
    '/tgsendphoto <relative_path> [caption]',
    'AI directive: <tg-media>{"kind":"document","path":"notes/report.md"}</tg-media>',
  ].join('\n');
}

function formatTgMediaStatus(): string {
  const cfg = getTelegramMediaConfig();
  return [
    'Telegram media status',
    `- enabled: ${cfg.enabled}`,
    `- download_enabled: ${cfg.downloadEnabled}`,
    `- max_download_bytes: ${cfg.maxDownloadBytes}`,
    `- max_send_bytes: ${cfg.maxSendBytes}`,
    `- media_dir: ${cfg.mediaDir}`,
  ].join('\n');
}

function cmdTgMedia(args: string): string {
  const trimmed = args.trim();
  const [rawAction, ...restTokens] = trimmed.split(/\s+/).filter(Boolean);
  const action = (rawAction || 'status').toLowerCase();

  if (action === 'help' || action === '?') {
    return `${tgMediaHelpText()}\n\n${formatTgMediaStatus()}`;
  }
  if (action === 'status') {
    return formatTgMediaStatus();
  }
  if (action === 'enable') {
    patchTelegramMediaConfig({ enabled: true });
    return `Telegram media enabled\n\n${formatTgMediaStatus()}`;
  }
  if (action === 'disable') {
    patchTelegramMediaConfig({ enabled: false });
    return `Telegram media disabled\n\n${formatTgMediaStatus()}`;
  }
  if (action === 'download') {
    const mode = (restTokens[0] || '').toLowerCase();
    if (!['on', 'off'].includes(mode)) {
      return 'Usage: /tgmedia download <on|off>';
    }
    patchTelegramMediaConfig({ downloadEnabled: mode === 'on' });
    return `Telegram media download ${mode}\n\n${formatTgMediaStatus()}`;
  }
  if (action === 'clean') {
    const days = Number(restTokens[0] || '7');
    if (!Number.isFinite(days) || days < 0) {
      return 'Usage: /tgmedia clean [days]';
    }
    const result = cleanupTelegramMediaFiles(days);
    return [
      'Telegram media cleanup done',
      `- dir: ${result.dir}`,
      `- deleted: ${result.deleted}`,
      `- kept: ${result.kept}`,
      `- freed_bytes: ${result.bytesFreed}`,
    ].join('\n');
  }

  return `Unknown tgmedia action: ${action}\n\n${tgMediaHelpText()}`;
}

function cmdTgSend(
  kind: TelegramMediaKind,
  args: string,
  groupFolder?: string,
): string | InlineResult {
  const trimmed = args.trim();
  if (!trimmed) {
    const usage = kind === 'photo'
      ? '/tgsendphoto <relative_path> [caption]'
      : '/tgsendfile <relative_path> [caption]';
    return `Usage: ${usage}`;
  }

  const firstSpace = trimmed.indexOf(' ');
  const relPath = (firstSpace < 0 ? trimmed : trimmed.slice(0, firstSpace)).trim();
  const caption = (firstSpace < 0 ? '' : trimmed.slice(firstSpace + 1)).trim();
  if (!relPath) {
    const usage = kind === 'photo'
      ? '/tgsendphoto <relative_path> [caption]'
      : '/tgsendfile <relative_path> [caption]';
    return `Usage: ${usage}`;
  }

  return {
    reply: kind === 'photo'
      ? `Preparing photo: ${relPath}`
      : `Preparing file: ${relPath}`,
    action: {
      type: 'send-telegram-media',
      kind,
      relativePath: relPath,
      caption: caption || undefined,
      groupFolder,
    },
  };
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

const HEARTBEAT_JOB_CATEGORIES = new Set<HeartbeatJob['category']>([
  'learning',
  'monitor',
  'health',
  'custom',
]);

function normalizeGroupFolder(groupFolder?: string): string {
  return groupFolder || MAIN_GROUP_FOLDER;
}

function isMainGroup(groupFolder?: string): boolean {
  return normalizeGroupFolder(groupFolder) === MAIN_GROUP_FOLDER;
}

function parseOnOff(input?: string): boolean | null {
  if (!input) return null;
  const v = input.trim().toLowerCase();
  if (['on', 'true', '1', 'yes'].includes(v)) return true;
  if (['off', 'false', '0', 'no'].includes(v)) return false;
  return null;
}

function formatHeartbeatConfigSummary(): string {
  const cfg = getHeartbeatConfig();
  return [
    'Heartbeat status',
    `- enabled: ${cfg.enabled}`,
    `- muted: ${cfg.deliveryMuted}`,
    `- interval_hours: ${(cfg.intervalMs / 3_600_000).toFixed(2)}`,
    `- silence_hours: ${(cfg.silenceThresholdMs / 3_600_000).toFixed(2)}`,
    `- show_ok: ${cfg.showOk}`,
    `- show_alerts: ${cfg.showAlerts}`,
    `- indicator: ${cfg.useIndicator}`,
    `- alert_cooldown_min: ${Math.round(cfg.alertRepeatCooldownMs / 60_000)}`,
    `- ack_max_chars: ${cfg.ackMaxChars}`,
  ].join('\n');
}

function heartbeatHelpText(): string {
  return [
    'Heartbeat commands',
    '/heartbeat status',
    '/heartbeat on | off',
    '/heartbeat mute | unmute',
    '/heartbeat interval <hours>',
    '/heartbeat silence <hours>',
    '/heartbeat showok <on|off>',
    '/heartbeat showalerts <on|off>',
    '/heartbeat indicator <on|off>',
    '/heartbeat cooldown <minutes>',
    '/heartbeat ackmax <chars>',
    '/heartbeat prompt <text>',
  ].join('\n');
}

function cmdHeartbeat(args: string, groupFolder?: string): string {
  const trimmed = args.trim();
  const [rawAction, ...restTokens] = trimmed.split(/\s+/).filter(Boolean);
  const action = (rawAction || 'status').toLowerCase();
  const tail = trimmed.slice(rawAction ? rawAction.length : 0).trim();

  if (action === 'help' || action === '?') {
    return `${heartbeatHelpText()}\n\n${formatHeartbeatConfigSummary()}`;
  }

  if (action === 'status') {
    return formatHeartbeatConfigSummary();
  }

  if (!isMainGroup(groupFolder)) {
    return 'Only main group can change heartbeat settings. Use /heartbeat status to view.';
  }

  const patch: Partial<HeartbeatRuntimeConfig> = {};
  switch (action) {
    case 'on':
      patch.enabled = true;
      break;
    case 'off':
      patch.enabled = false;
      break;
    case 'mute':
      patch.deliveryMuted = true;
      break;
    case 'unmute':
      patch.deliveryMuted = false;
      break;
    case 'interval': {
      const hours = Number(restTokens[0]);
      if (!Number.isFinite(hours) || hours <= 0) return 'Usage: /heartbeat interval <hours>';
      patch.intervalMs = Math.round(hours * 3_600_000);
      break;
    }
    case 'silence': {
      const hours = Number(restTokens[0]);
      if (!Number.isFinite(hours) || hours <= 0) return 'Usage: /heartbeat silence <hours>';
      patch.silenceThresholdMs = Math.round(hours * 3_600_000);
      break;
    }
    case 'showok': {
      const v = parseOnOff(restTokens[0]);
      if (v === null) return 'Usage: /heartbeat showok <on|off>';
      patch.showOk = v;
      break;
    }
    case 'showalerts': {
      const v = parseOnOff(restTokens[0]);
      if (v === null) return 'Usage: /heartbeat showalerts <on|off>';
      patch.showAlerts = v;
      break;
    }
    case 'indicator': {
      const v = parseOnOff(restTokens[0]);
      if (v === null) return 'Usage: /heartbeat indicator <on|off>';
      patch.useIndicator = v;
      break;
    }
    case 'cooldown': {
      const minutes = Number(restTokens[0]);
      if (!Number.isFinite(minutes) || minutes < 0) return 'Usage: /heartbeat cooldown <minutes>';
      patch.alertRepeatCooldownMs = Math.round(minutes * 60_000);
      break;
    }
    case 'ackmax': {
      const chars = Number(restTokens[0]);
      if (!Number.isInteger(chars) || chars <= 0) return 'Usage: /heartbeat ackmax <chars>';
      patch.ackMaxChars = chars;
      break;
    }
    case 'prompt': {
      if (!tail) return 'Usage: /heartbeat prompt <text>';
      patch.heartbeatPrompt = tail;
      break;
    }
    default:
      return `Unknown heartbeat action: ${action}\n\n${heartbeatHelpText()}`;
  }

  patchHeartbeatConfig(patch);
  return `Heartbeat updated\n\n${formatHeartbeatConfigSummary()}`;
}

function getScopedHeartbeatJobs(groupFolder?: string): HeartbeatJob[] {
  const folder = normalizeGroupFolder(groupFolder);
  const all = getAllHeartbeatJobs();
  if (folder === MAIN_GROUP_FOLDER) return all;
  return all.filter((job) => job.created_by === folder);
}

function resolveHeartbeatJobRef(
  jobRef: string,
  groupFolder?: string,
): { ok: true; job: HeartbeatJob } | { ok: false; error: string } {
  const trimmed = jobRef.trim();
  if (!trimmed) return { ok: false, error: 'Job ID is required.' };

  const folder = normalizeGroupFolder(groupFolder);
  const allowAll = folder === MAIN_GROUP_FOLDER;
  const exact = getHeartbeatJob(trimmed);
  if (exact) {
    if (allowAll || exact.created_by === folder) return { ok: true, job: exact };
    return { ok: false, error: 'Permission denied for this job.' };
  }

  const scoped = getScopedHeartbeatJobs(folder);
  const partial = scoped.find((j) => j.id.startsWith(trimmed));
  if (!partial) return { ok: false, error: `Heartbeat job not found: ${trimmed}` };
  return { ok: true, job: partial };
}

function formatHeartbeatJobs(groupFolder?: string): string {
  const jobs = getScopedHeartbeatJobs(groupFolder);
  if (jobs.length === 0) {
    return 'No heartbeat jobs configured.\nUse /hbjob add <label>|<category>|<interval_min>|<prompt>';
  }

  const lines: string[] = ['Heartbeat jobs'];
  for (const j of jobs) {
    const intervalMin = j.interval_ms ? Math.round(j.interval_ms / 60_000) : 'default';
    const last = j.last_run ? new Date(j.last_run).toLocaleString('th-TH') : 'never';
    lines.push(
      `- [${j.id.slice(0, 8)}] ${j.label} | ${j.category} | ${j.status} | every ${intervalMin}m | last ${last}`,
    );
  }
  return lines.join('\n');
}

function hbJobHelpText(): string {
  return [
    'Heartbeat job commands',
    '/hbjob list',
    '/hbjob add <label>|<category>|<interval_min>|<prompt>',
    '/hbjob pause <job_id>',
    '/hbjob resume <job_id>',
    '/hbjob remove <job_id>',
    '/hbjob label <job_id> <new_label>',
    '/hbjob prompt <job_id> <new_prompt>',
    '/hbjob interval <job_id> <minutes|default>',
    '/hbjob category <job_id> <learning|monitor|health|custom>',
  ].join('\n');
}

function cmdHbJob(args: string, chatJid?: string, groupFolder?: string): string {
  const trimmed = args.trim();
  const [rawAction, ...restTokens] = trimmed.split(/\s+/).filter(Boolean);
  const action = (rawAction || 'list').toLowerCase();
  const tail = trimmed.slice(rawAction ? rawAction.length : 0).trim();
  const folder = normalizeGroupFolder(groupFolder);

  if (action === 'help' || action === '?') {
    return `${hbJobHelpText()}\n\n${formatHeartbeatJobs(folder)}`;
  }

  if (action === 'list') {
    return formatHeartbeatJobs(folder);
  }

  if (action === 'add') {
    if (!chatJid) return 'Cannot create heartbeat job: missing chat context.';
    const parts = tail.split('|').map((p) => p.trim());
    if (parts.length < 4) {
      return 'Usage: /hbjob add <label>|<category>|<interval_min>|<prompt>';
    }

    const [label, categoryRaw, intervalRaw, ...promptParts] = parts;
    const prompt = promptParts.join('|').trim();
    if (!label || !prompt) {
      return 'Usage: /hbjob add <label>|<category>|<interval_min>|<prompt>';
    }

    const category = categoryRaw as HeartbeatJob['category'];
    if (!HEARTBEAT_JOB_CATEGORIES.has(category)) {
      return 'Invalid category. Use learning|monitor|health|custom.';
    }

    let intervalMs: number | null = null;
    const raw = intervalRaw.toLowerCase();
    if (raw && raw !== 'default' && raw !== '-') {
      const intervalMin = Number(raw);
      if (!Number.isFinite(intervalMin) || intervalMin <= 0) {
        return 'Invalid interval. Use positive minutes or "default".';
      }
      intervalMs = Math.round(intervalMin * 60_000);
    }

    const duplicates = getScopedHeartbeatJobs(folder).filter(
      (j) => j.status === 'active' && j.label.toLowerCase() === label.toLowerCase(),
    );
    if (duplicates.length > 0) {
      return `Duplicate label detected. Existing job: ${duplicates[0].id.slice(0, 8)}`;
    }

    const jobId = `hb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    createHeartbeatJob({
      id: jobId,
      chat_jid: chatJid,
      label,
      prompt,
      category,
      status: 'active',
      interval_ms: intervalMs,
      last_run: null,
      last_result: null,
      created_at: new Date().toISOString(),
      created_by: folder,
    });
    writeHeartbeatJobsSnapshot();
    return `Heartbeat job created: ${jobId.slice(0, 8)} (${label})`;
  }

  const jobRef = restTokens[0] || '';
  const resolved = resolveHeartbeatJobRef(jobRef, folder);
  if (!resolved.ok) return resolved.error;
  const job = resolved.job;

  if (action === 'pause' || action === 'off') {
    updateHeartbeatJob(job.id, { status: 'paused' });
    writeHeartbeatJobsSnapshot();
    return `Heartbeat job paused: ${job.id.slice(0, 8)} (${job.label})`;
  }

  if (action === 'resume' || action === 'on') {
    updateHeartbeatJob(job.id, { status: 'active' });
    writeHeartbeatJobsSnapshot();
    return `Heartbeat job resumed: ${job.id.slice(0, 8)} (${job.label})`;
  }

  if (action === 'remove' || action === 'delete' || action === 'cancel') {
    deleteHeartbeatJob(job.id);
    writeHeartbeatJobsSnapshot();
    return `Heartbeat job removed: ${job.id.slice(0, 8)} (${job.label})`;
  }

  if (action === 'label') {
    const newLabel = tail.slice(jobRef.length).trim();
    if (!newLabel) return 'Usage: /hbjob label <job_id> <new_label>';
    updateHeartbeatJob(job.id, { label: newLabel });
    writeHeartbeatJobsSnapshot();
    return `Heartbeat job label updated: ${job.id.slice(0, 8)} -> ${newLabel}`;
  }

  if (action === 'prompt') {
    const newPrompt = tail.slice(jobRef.length).trim();
    if (!newPrompt) return 'Usage: /hbjob prompt <job_id> <new_prompt>';
    updateHeartbeatJob(job.id, { prompt: newPrompt });
    writeHeartbeatJobsSnapshot();
    return `Heartbeat job prompt updated: ${job.id.slice(0, 8)}`;
  }

  if (action === 'interval') {
    const raw = tail.slice(jobRef.length).trim().toLowerCase();
    if (!raw) return 'Usage: /hbjob interval <job_id> <minutes|default>';
    if (raw === 'default' || raw === '-') {
      updateHeartbeatJob(job.id, { interval_ms: null });
      writeHeartbeatJobsSnapshot();
      return `Heartbeat job interval reset to default: ${job.id.slice(0, 8)}`;
    }
    const minutes = Number(raw);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return 'Invalid interval minutes.';
    }
    updateHeartbeatJob(job.id, { interval_ms: Math.round(minutes * 60_000) });
    writeHeartbeatJobsSnapshot();
    return `Heartbeat job interval updated: ${job.id.slice(0, 8)} -> ${minutes}m`;
  }

  if (action === 'category') {
    const newCategoryRaw = tail.slice(jobRef.length).trim().toLowerCase();
    const newCategory = newCategoryRaw as HeartbeatJob['category'];
    if (!HEARTBEAT_JOB_CATEGORIES.has(newCategory)) {
      return 'Invalid category. Use learning|monitor|health|custom.';
    }
    updateHeartbeatJob(job.id, { category: newCategory });
    writeHeartbeatJobsSnapshot();
    return `Heartbeat job category updated: ${job.id.slice(0, 8)} -> ${newCategory}`;
  }

  return `Unknown hbjob action: ${action}\n\n${hbJobHelpText()}`;
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
  heartbeat: ({ args, groupFolder }) => cmdHeartbeat(args, groupFolder),
  hbjob: ({ args, chatJid, groupFolder }) => cmdHbJob(args, chatJid, groupFolder),
  tgmedia: ({ args }) => cmdTgMedia(args),
  tgsendfile: ({ args, groupFolder }) => cmdTgSend('document', args, groupFolder),
  tgsendphoto: ({ args, groupFolder }) => cmdTgSend('photo', args, groupFolder),
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

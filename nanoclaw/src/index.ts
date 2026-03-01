import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  ASSISTANT_NAME,
  DATA_DIR,
  ENABLED_CHANNELS,
  IDLE_TIMEOUT,
  MAIN_GROUP_FOLDER,
  POLL_INTERVAL,
  POOL_ENABLED,
  SESSION_MAX_AGE_MS,
  TELEGRAM_BOT_TOKEN,
  TIMEZONE,
  TRIGGER_PATTERN,
  TYPING_MAX_TTL,
  USER_PROGRESS_INTERVALS_MS,
} from './config.js';
import { messageBus } from './message-bus.js';
import { WhatsAppChannel } from './channels/whatsapp.js';
import { TelegramChannel } from './channels/telegram.js';
import {
  ContainerOutput,
  runContainerAgent,
  initContainerPool,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import { containerPool } from './container-pool.js';
import { classifyQuery } from './query-router.js';
import { handleInline } from './inline-handler.js';
import type { InlineAction } from './inline-handler.js';
import { handleOracleOnly } from './oracle-handler.js';
import { getPromptBuilder } from './prompt-builder.js';
import { initCostTracking, trackUsage } from './cost-tracker.js';
import { initCostIntelligence, checkBudget, trackUsageEnhanced } from './cost-intelligence.js';
import {
  getAllChats,
  getDlqCounts,
  getDeadLetterByTrace,
  getDeadLettersByStatus,
  getAllRegisteredGroups,
  getAllSessions,
  getStableUserId,
  getAllTasks,
  getMessageAttempts,
  getMessageReceipt,
  getMessagesSince,
  getNewMessages,
  getRecoverableReceipts,
  getRetryingMessages,
  getRouterState,
  getSessionAge,
  markDeadLetterRetrying,
  ensureMessageReceipt,
  moveToDeadLetter,
  resolveDeadLetter,
  transitionMessageStatus,
  clearSession,
  initDatabase,
  setRegisteredGroup,
  setRouterState,
  setSession,
  storeChatMetadata,
  storeMessage,
  updateTask,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { startIpcWatcher, writeHeartbeatJobsSnapshot } from './ipc.js';
import { findChannel, formatMessages, formatOutbound, routeOutbound, routeOutboundPayload } from './router.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { Channel, LaneType, NewMessage, OutboundPayload, RegisteredGroup } from './types.js';
import { logger } from './logger.js';
import { startHealthServer, setOpsProvider, setStatusProvider, setHeartbeatProvider, setToolsProvider, recordError } from './health-server.js';
import { resourceMonitor } from './resource-monitor.js';
import { startHeartbeat, startHeartbeatJobRunner, patchHeartbeatConfig, recordActivity } from './heartbeat.js';
import { dockerResilience } from './docker-resilience.js';
import { capabilityProbe } from './capability-probe.js';
import {
  buildTelegramOutboundPayloadFromGroupFile,
  parseTelegramMediaDirectives,
} from './telegram-media.js';

// Re-export for backwards compatibility during refactor
export { escapeXml, formatMessages } from './router.js';

let lastTimestamp = '';
let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let messageLoopRunning = false;

const channels: Channel[] = [];
const queue = new GroupQueue();
const latestFailedTracesByGroup = new Map<string, string[]>();
const latestRejectedTracesByGroup = new Map<string, string[]>();

// Global registry of active typing intervals â€” cleared on shutdown
const activeTypingIntervals = new Set<ReturnType<typeof setInterval>>();

interface ExternalMcpConfig {
  name: string;
  description?: string;
  command?: string;
  args?: string[];
  requiredEnv?: string[];
  env?: Record<string, string>;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function readFileUtf8Safe(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function extractMatches(content: string, pattern: RegExp): string[] {
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    if (match[1]) matches.push(match[1]);
  }
  return uniqueSorted(matches);
}

function parseSimpleFrontmatter(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return out;
  for (const line of fm[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

function discoverSkillInventory(projectRoot: string): Array<{
  name: string;
  directory: string;
  description: string | null;
}> {
  const skillsDir = path.join(projectRoot, 'container', 'skills');
  if (!fs.existsSync(skillsDir)) return [];

  const items: Array<{ name: string; directory: string; description: string | null }> = [];
  for (const entry of fs.readdirSync(skillsDir)) {
    const fullDir = path.join(skillsDir, entry);
    if (!fs.statSync(fullDir).isDirectory()) continue;
    const skillMdPath = path.join(fullDir, 'SKILL.md');
    const skillContent = readFileUtf8Safe(skillMdPath);
    const meta = skillContent ? parseSimpleFrontmatter(skillContent) : {};
    items.push({
      name: meta.name || entry,
      directory: entry,
      description: meta.description || null,
    });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

function discoverNanoclawMcpTools(projectRoot: string): string[] {
  const p = path.join(projectRoot, 'container', 'agent-runner', 'src', 'ipc-mcp-stdio.ts');
  const content = readFileUtf8Safe(p);
  if (!content) return [];
  return extractMatches(content, /server\.tool\(\s*'([^']+)'/g);
}

function discoverOracleMcpTools(projectRoot: string): string[] {
  const p = path.join(projectRoot, 'container', 'agent-runner', 'src', 'oracle-mcp-http.ts');
  const content = readFileUtf8Safe(p);
  if (!content) return [];
  return extractMatches(content, /name:\s*'(oracle_[^']+)'/g);
}

function discoverAgentAllowedTools(projectRoot: string): string[] {
  const p = path.join(projectRoot, 'container', 'agent-runner', 'src', 'index.ts');
  const content = readFileUtf8Safe(p);
  if (!content) return [];

  const blockMatch = content.match(/allowedTools:\s*\[([\s\S]*?)\],\s*env:/m);
  if (!blockMatch) return [];
  return extractMatches(blockMatch[1], /'([^']+)'/g);
}

function loadExternalMcpConfigs(projectRoot: string): ExternalMcpConfig[] {
  const p = path.join(projectRoot, 'container', 'config', 'mcps.json');
  const raw = readFileUtf8Safe(p);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { servers?: ExternalMcpConfig[] };
    return Array.isArray(parsed.servers) ? parsed.servers : [];
  } catch {
    return [];
  }
}

function buildRuntimeToolsInventory(channelNames: string[]): Record<string, unknown> {
  const projectRoot = process.cwd();
  const skills = discoverSkillInventory(projectRoot);
  const nanoclawTools = discoverNanoclawMcpTools(projectRoot);
  const oracleTools = discoverOracleMcpTools(projectRoot);
  const allowedTools = discoverAgentAllowedTools(projectRoot);
  const externalConfigs = loadExternalMcpConfigs(projectRoot);

  const externalServers = externalConfigs.map((server) => {
    const requiredEnv = Array.isArray(server.requiredEnv) ? server.requiredEnv : [];
    const missingEnv = requiredEnv.filter((key) => !process.env[key]);
    const enabled = missingEnv.length === 0;
    return {
      name: server.name,
      description: server.description || null,
      command: server.command || null,
      args: Array.isArray(server.args) ? server.args : [],
      requiredEnv,
      missingEnv,
      enabled,
      reason: enabled ? 'ready' : `missing required env: ${missingEnv.join(', ')}`,
    };
  });

  return {
    timestamp: new Date().toISOString(),
    runtime: {
      channels: uniqueSorted(channelNames),
      timezone: TIMEZONE,
      projectRoot,
    },
    sdk: {
      allowedToolsCount: allowedTools.length,
      allowedTools,
    },
    skills: {
      count: skills.length,
      items: skills,
    },
    mcp: {
      nanoclaw: {
        configured: true,
        toolCount: nanoclawTools.length,
        tools: nanoclawTools,
        source: 'container/agent-runner/src/ipc-mcp-stdio.ts',
      },
      oracle: {
        configured: true,
        apiUrl: process.env.ORACLE_API_URL || 'http://oracle:47778',
        authConfigured: Boolean(process.env.ORACLE_AUTH_TOKEN),
        toolCount: oracleTools.length,
        tools: oracleTools,
        source: 'container/agent-runner/src/oracle-mcp-http.ts',
      },
      external: {
        configuredCount: externalServers.length,
        activeCount: externalServers.filter((s) => s.enabled).length,
        servers: externalServers,
        source: 'container/config/mcps.json',
      },
    },
  };
}

function traceMessages(
  messages: NewMessage[],
  lane: LaneType = 'user',
): Array<{ message: NewMessage; traceId: string }> {
  return messages.map((message) => {
    const trace = ensureMessageReceipt(
      message.chat_jid,
      message.id,
      lane,
      new Date().toISOString(),
    );
    return { message, traceId: trace.trace_id };
  });
}

function markTraceStatus(
  traces: string[],
  status: import('./types.js').MessageStatus,
  options?: {
    attemptIncrement?: boolean;
    containerName?: string | null;
    errorCode?: string | null;
    errorDetail?: string | null;
    timeoutHit?: boolean;
    exitCode?: number | null;
  },
): void {
  for (const traceId of traces) {
    transitionMessageStatus(traceId, status, options);
  }
}

/** Find the channel that owns a JID, or throw */
function channelFor(jid: string): Channel {
  const ch = findChannel(channels, jid);
  if (!ch) throw new Error(`No channel owns JID: ${jid}`);
  return ch;
}

/** Send a message to the right channel for this JID */
async function sendToChannel(jid: string, text: string): Promise<void> {
  await routeOutbound(channels, jid, text);
}

async function sendPayloadToChannel(
  jid: string,
  payload: OutboundPayload,
): Promise<void> {
  await routeOutboundPayload(channels, jid, payload);
}

async function executeInlineAction(
  action: InlineAction,
  context: { chatJid: string; group: RegisteredGroup; channel: Channel },
): Promise<void> {
  if (action === 'clear-session') return;
  if (action.type !== 'send-telegram-media') return;

  const groupFolder = action.groupFolder || context.group.folder;
  const payloadResult = buildTelegramOutboundPayloadFromGroupFile(
    groupFolder,
    action.kind,
    action.relativePath,
    action.caption,
  );
  if (!payloadResult.ok) {
    await sendToChannel(
      context.chatJid,
      formatOutbound(context.channel, `Cannot send media: ${payloadResult.error}`),
    );
    return;
  }

  try {
    await sendPayloadToChannel(context.chatJid, payloadResult.payload);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await sendToChannel(
      context.chatJid,
      formatOutbound(context.channel, `Media send failed: ${reason}`),
    );
  }
}

/** Set typing indicator on the right channel (safe â€” never throws) */
async function setTypingOnChannel(jid: string, isTyping: boolean): Promise<void> {
  try {
    const ch = findChannel(channels, jid);
    if (ch?.setTyping) await ch.setTyping(jid, isTyping);
  } catch (err) {
    logger.debug({ jid, isTyping, err }, 'setTypingOnChannel failed (non-fatal)');
  }
}

function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn('Corrupted last_agent_timestamp in DB, resetting');
    lastAgentTimestamp = {};
  }
  sessions = getAllSessions();
  registeredGroups = getAllRegisteredGroups();
  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

function saveState(): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState(
    'last_agent_timestamp',
    JSON.stringify(lastAgentTimestamp),
  );
}

function registerGroup(jid: string, group: RegisteredGroup): void {
  registeredGroups[jid] = group;
  setRegisteredGroup(jid, group);

  // Create group folder
  const groupDir = path.join(DATA_DIR, '..', 'groups', group.folder);
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

/**
 * Get available groups list for the agent.
 * Returns groups ordered by most recent activity.
 */
export function getAvailableGroups(): import('./container-runner.js').AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && c.jid.endsWith('@g.us'))
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

/** @internal - exported for testing */
export function _setRegisteredGroups(groups: Record<string, RegisteredGroup>): void {
  registeredGroups = groups;
}

/**
 * Process all pending messages for a group.
 * Called by the GroupQueue when it's this group's turn.
 * retryCount: 0 = first attempt, 1+ = automatic retry (silent â€” don't spam user)
 */
async function processGroupMessages(chatJid: string, retryCount: number = 0): Promise<boolean> {
  const group = registeredGroups[chatJid];
  if (!group) return true;

  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const missedMessages = getMessagesSince(
    chatJid,
    sinceTimestamp,
    ASSISTANT_NAME,
  );
  const retryingMessages = getRetryingMessages(chatJid, ASSISTANT_NAME);
  const mergedMessages = [...missedMessages];
  const existingIds = new Set(missedMessages.map((m) => m.id));
  for (const m of retryingMessages) {
    if (!existingIds.has(m.id)) mergedMessages.push(m);
  }
  mergedMessages.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  if (mergedMessages.length === 0) return true;
  const tracedMessages = traceMessages(mergedMessages, 'user');
  const traceIds = tracedMessages.map((t) => t.traceId);
  markTraceStatus(traceIds, 'QUEUED');

  // For non-main groups, check if trigger is required and present
  if (!isMainGroup && group.requiresTrigger !== false) {
    const hasTrigger = mergedMessages.some((m) =>
      TRIGGER_PATTERN.test(m.content.trim()),
    );
    if (!hasTrigger && retryingMessages.length === 0) return true;
  }

  // --- Smart Query Router: classify the latest message ---
  const lastMsg = mergedMessages[mergedMessages.length - 1];
  const classification = classifyQuery(lastMsg.content);
  const startTime = Date.now();

  logger.info(
    { group: group.name, tier: classification.tier, reason: classification.reason, messageCount: mergedMessages.length, retryingCount: retryingMessages.length },
    'Query classified',
  );

  // Tier 1: Inline â€” template response, no container/API
  if (classification.tier === 'inline') {
    const result = handleInline(classification.reason, lastMsg.content, chatJid, group.name);
    const reply = typeof result === 'string' ? result : result.reply;
    const action = typeof result === 'string' ? undefined : result.action;

    const ch = channelFor(chatJid);
    await sendToChannel(chatJid, formatOutbound(ch, reply));
    markTraceStatus(traceIds, 'REPLIED');
    for (const traceId of traceIds) resolveDeadLetter(traceId);
    lastAgentTimestamp[chatJid] = lastMsg.timestamp;
    saveState();

    // Handle side-effects from commands
    if (action === 'clear-session') {
      clearSession(group.folder);
      delete sessions[group.folder];
      delete lastAgentTimestamp[chatJid];
      saveState();
      logger.info({ group: group.name }, 'Session cleared via /clear command');
    } else if (action) {
      await executeInlineAction(action, { chatJid, group, channel: ch });
    }

    trackUsage(classification.tier, classification.model, Date.now() - startTime);
    logger.info({ group: group.name, tier: 'inline', ms: Date.now() - startTime }, 'Inline response sent');
    return true;
  }

  // Tier 2: Oracle-only â€” direct Oracle API call, no container
  if (classification.tier === 'oracle-only') {
    const reply = await handleOracleOnly(classification.reason, lastMsg.content);
    if (reply) {
      const ch = channelFor(chatJid);
      await sendToChannel(chatJid, formatOutbound(ch, reply));
      markTraceStatus(traceIds, 'REPLIED');
      for (const traceId of traceIds) resolveDeadLetter(traceId);
      lastAgentTimestamp[chatJid] = lastMsg.timestamp;
      saveState();
      trackUsage(classification.tier, classification.model, Date.now() - startTime);
      logger.info({ group: group.name, tier: 'oracle-only', ms: Date.now() - startTime }, 'Oracle response sent');
      return true;
    }
    // Empty reply means Oracle failed â€” fall through to container
    logger.warn({ group: group.name }, 'Oracle handler returned empty, falling through to container');
  }

  // Tier 3 & 4: Container-light / Container-full â€” spawn container
  // Budget enforcement: check before spawning container
  const budget = checkBudget(classification.model, group.folder);
  if (budget.action === 'offline') {
    try {
      const ch = channelFor(chatJid);
      await sendToChannel(
        chatJid,
        formatOutbound(ch, budget.message || 'ขออภัย งบประมาณเดือนนี้หมดแล้วค่ะ'),
      );
    } catch (sendErr) {
      // R6 fix: advance cursor regardless â€” prevents message being re-processed indefinitely
      logger.warn({ group: group.name, err: sendErr }, 'Failed to send budget-offline message (advancing cursor anyway)');
    }
    markTraceStatus(traceIds, 'REPLIED');
    for (const traceId of traceIds) resolveDeadLetter(traceId);
    lastAgentTimestamp[chatJid] = lastMsg.timestamp;
    saveState();
    trackUsage(classification.tier, classification.model, Date.now() - startTime);
    return true;
  }
  // Apply effective model (may be downgraded)
  const effectiveModel = budget.effectiveModel;
  if (effectiveModel !== classification.model) {
    logger.info(
      { group: group.name, from: classification.model, to: effectiveModel, reason: budget.action },
      'Model auto-downgraded by budget',
    );
    classification.model = effectiveModel as 'haiku' | 'sonnet' | 'opus';
  }

  // --- Context Injection: prepend Oracle context to prompt ---
  let oracleContext = '';
  try {
    const pb = getPromptBuilder();
    const stableUserId = getStableUserId(chatJid);
    const ctx = await pb.buildCompactContext(
      lastMsg.content,
      group.folder,
      stableUserId,
    );
    oracleContext = pb.formatCompact(ctx);
    if (oracleContext) {
      logger.info(
        {
          group: group.name,
          userId: stableUserId,
          tokens: ctx.tokenEstimate,
          cached: ctx.fromCache,
        },
        'Oracle context injected',
      );
    }
  } catch (err) {
    logger.warn({ group: group.name, err }, 'Oracle context injection failed, continuing without');
  }

  const rawPrompt = formatMessages(mergedMessages);
  const timeHeader = `[Current time: ${new Date().toLocaleString('th-TH', { timeZone: TIMEZONE, dateStyle: 'short', timeStyle: 'medium' })} (${TIMEZONE})]`;
  const prompt = oracleContext
    ? `${oracleContext}\n\n${timeHeader}\n\n${rawPrompt}`
    : `${timeHeader}\n\n${rawPrompt}`;

  // Advance cursor so the piping path in startMessageLoop won't re-fetch
  // these messages. Save the old cursor so we can roll back on error.
  const previousCursor = lastAgentTimestamp[chatJid] || '';
  lastAgentTimestamp[chatJid] =
    mergedMessages[mergedMessages.length - 1].timestamp;
  saveState();

  logger.info(
    { group: group.name, tier: classification.tier, model: classification.model, messageCount: mergedMessages.length },
    'Processing via container',
  );
  markTraceStatus(traceIds, 'RUNNING', { attemptIncrement: true });

  // Track idle timer for closing stdin when agent is idle
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug({ group: group.name }, 'Idle timeout, closing container stdin');
      queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);
  };

  await setTypingOnChannel(chatJid, true);
  let hadError = false;
  let outputSentToUser = false;

  // Keep typing indicator alive (Telegram expires after 5s)
  // Auto-expires after TYPING_MAX_TTL to prevent permanent typing indicators
  const typingStartTime = Date.now();
  let ttlNoticeSent = false;
  const typingInterval = setInterval(() => {
    if (Date.now() - typingStartTime > TYPING_MAX_TTL) {
      clearInterval(typingInterval);
      activeTypingIntervals.delete(typingInterval);
      logger.info({ group: group.name, chatJid, ttlMs: TYPING_MAX_TTL }, 'Typing indicator TTL expired, auto-stopped');
      // Notify user we are still working â€” prevents silent-looking stall
      if (!outputSentToUser && !ttlNoticeSent) {
        ttlNoticeSent = true;
        sendToChannel(chatJid, '⏳ ยังทำงานอยู่นะครับ งานนี้ใช้เวลานานหน่อย กรุณารอสักครู่...')
          .catch(() => {});
      }
      return;
    }
    setTypingOnChannel(chatJid, true).catch(() => {});
  }, 4000);
  activeTypingIntervals.add(typingInterval);

  // Escalating progress messages so the user knows we're still working
  const progressTimers: ReturnType<typeof setTimeout>[] = [];
  const scheduleProgress = (delayMs: number, msg: string) => {
    progressTimers.push(setTimeout(async () => {
      if (!outputSentToUser) {
        try { await sendToChannel(chatJid, msg); } catch { /* ignore */ }
      }
    }, delayMs));
  };
  const [p1, p2, p3] = USER_PROGRESS_INTERVALS_MS;
  if (p1) scheduleProgress(p1, '⏳ กำลังคิดอยู่นะคะ รอสักครู่นะคะ...');
  if (p2) scheduleProgress(p2, '⏳ ยังประมวลผลอยู่นะครับ...');
  if (p3) scheduleProgress(p3, '⏳ งานนี้ใช้เวลานานกว่าปกติเล็กน้อยนะครับ...');

  let ch: Channel;
  try {
    ch = channelFor(chatJid);
  } catch (err) {
    // Channel disconnected before we could start â€” clean up timers and bail
    clearInterval(typingInterval);
    activeTypingIntervals.delete(typingInterval);
    progressTimers.forEach(clearTimeout);
    if (idleTimer) clearTimeout(idleTimer);
    logger.warn({ chatJid, err }, 'Channel unavailable, aborting message processing');
    return false;
  }

  let output: 'success' | 'error';
  try {
    output = await runAgent(group, prompt, chatJid, async (result) => {
      // Streaming output callback â€” called for each agent result
      try {
        if (result.result) {
          const raw = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
          // Strip <internal>...</internal> blocks before user-visible delivery.
          const stripped = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
          const mediaDirective = parseTelegramMediaDirectives(stripped);
          const text = mediaDirective.cleanText;
          logger.info({ group: group.name }, `Agent output: ${raw.slice(0, 200)}`);
          if (text) {
            await sendToChannel(chatJid, formatOutbound(ch, text));
            outputSentToUser = true;
            // Cancel all progress messages once we have real output
            progressTimers.forEach(clearTimeout);
          }
          for (const directive of mediaDirective.directives) {
            const payloadResult = buildTelegramOutboundPayloadFromGroupFile(
              group.folder,
              directive.kind,
              directive.path,
              directive.caption,
            );
            if (!payloadResult.ok) {
              await sendToChannel(
                chatJid,
                formatOutbound(ch, `Cannot send media: ${payloadResult.error}`),
              );
              outputSentToUser = true;
              continue;
            }
            try {
              await sendPayloadToChannel(chatJid, payloadResult.payload);
              outputSentToUser = true;
            } catch (mediaErr) {
              const reason = mediaErr instanceof Error ? mediaErr.message : String(mediaErr);
              await sendToChannel(
                chatJid,
                formatOutbound(ch, `Media send failed: ${reason}`),
              );
              outputSentToUser = true;
            }
          }
          for (const errText of mediaDirective.errors) {
            await sendToChannel(
              chatJid,
              formatOutbound(ch, `Telegram media directive error: ${errText}`),
            );
            outputSentToUser = true;
          }
          // Only reset idle timer on actual results, not session-update markers (result: null)
          resetIdleTimer();
        }

        if (result.status === 'error') {
          hadError = true;
        }

        // R14: Container completed with status=success but result is null and nothing was sent
        // This means the agent ran but produced no output â€” send a fallback so user isn't left in silence
        if (result.status === 'success' && result.result === null && !outputSentToUser) {
          logger.warn({ group: group.name }, 'Container completed with null result and no prior output â€” sending fallback');
          try {
            await sendToChannel(
              chatJid,
              formatOutbound(ch, '✅ ดำเนินการเสร็จสิ้นครับ (ไม่มีข้อความตอบกลับ)'),
            );
            outputSentToUser = true;
          } catch (fbErr) {
            logger.warn({ group: group.name, err: fbErr }, 'Failed to send null-result fallback');
          }
        }
      } catch (cbErr) {
        logger.warn({ group: group.name, err: cbErr }, 'Streaming callback error (non-fatal)');
        hadError = true;
      }
    });
  } finally {
    // ALWAYS clean up timers â€” even if runAgent() throws
    clearInterval(typingInterval);
    activeTypingIntervals.delete(typingInterval);
    progressTimers.forEach(clearTimeout);
    if (idleTimer) clearTimeout(idleTimer);
    await setTypingOnChannel(chatJid, false);
  }

  if (output === 'error' || hadError) {
    // If we already sent output to the user, don't roll back the cursor â€”
    // the user got their response and re-processing would send duplicates.
    if (outputSentToUser) {
      logger.warn({ group: group.name }, 'Agent error after output was sent, skipping cursor rollback to prevent duplicates');
      markTraceStatus(traceIds, 'REPLIED');
      for (const traceId of traceIds) resolveDeadLetter(traceId);
      trackUsage(classification.tier, classification.model, Date.now() - startTime);
      return true;
    }
    latestFailedTracesByGroup.set(chatJid, traceIds);
    markTraceStatus(traceIds, 'RETRYING', {
      errorCode: 'AGENT_ERROR',
      errorDetail: 'Container execution failed, retrying',
    });
    recordError(`Agent error for group ${group.name}`, group.name);
    // Only notify the user on the FIRST failure â€” retries (retryCount > 0) are silent.
    // This prevents spam like 5x "system is having issues" for one failed message.
    if (retryCount === 0) {
      try {
        await sendToChannel(
          chatJid,
          formatOutbound(ch, '⚠️ ขอโทษครับ ระบบมีปัญหาชั่วคราว กำลังลองใหม่อัตโนมัติ...'),
        );
      } catch (notifyErr) {
        logger.warn({ group: group.name, err: notifyErr }, 'Failed to send error notification');
      }
    } else {
      logger.info({ group: group.name, retryCount }, 'Agent error on retry â€” silent (no user notification)');
    }
    // Roll back cursor so retries can re-process these messages
    lastAgentTimestamp[chatJid] = previousCursor;
    saveState();
    logger.warn({ group: group.name, retryCount }, 'Agent error, rolled back message cursor for retry');
    return false;
  }

  // Guard against silent "success with no output" runs.
  // Without this, the cursor advances and the user gets no reply.
  if (!outputSentToUser) {
    latestFailedTracesByGroup.set(chatJid, traceIds);
    markTraceStatus(traceIds, 'RETRYING', {
      errorCode: 'NO_OUTPUT',
      errorDetail: 'Container completed without user-visible output',
    });
    recordError(`Agent produced no output for group ${group.name}`, group.name);
    if (retryCount === 0) {
      try {
        await sendToChannel(
          chatJid,
          formatOutbound(ch, '⚠️ ขอโทษครับ ไม่ได้รับข้อความตอบกลับ กำลังลองใหม่อัตโนมัติ...'),
        );
      } catch (notifyErr) {
        logger.warn({ group: group.name, err: notifyErr }, 'Failed to send no-output notification');
      }
    } else {
      logger.info({ group: group.name, retryCount }, 'No output on retry â€” silent');
    }
    lastAgentTimestamp[chatJid] = previousCursor;
    saveState();
    logger.warn({ group: group.name, retryCount }, 'Agent completed with no output, rolled back message cursor for retry');
    return false;
  }

  markTraceStatus(traceIds, 'REPLIED');
  for (const traceId of traceIds) resolveDeadLetter(traceId);
  latestFailedTracesByGroup.delete(chatJid);
  trackUsage(classification.tier, classification.model, Date.now() - startTime);
  return true;
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<'success' | 'error'> {
  const isMain = group.folder === MAIN_GROUP_FOLDER;
  let sessionId: string | undefined = sessions[group.folder];

  // Session rotation: if session is too old, start fresh to prevent
  // unbounded context accumulation from SDK session resume
  if (sessionId) {
    const age = getSessionAge(group.folder);
    if (age !== null && age > SESSION_MAX_AGE_MS) {
      logger.info(
        { group: group.name, ageHours: Math.round(age / 3600000) },
        'Session expired, rotating to fresh session',
      );
      clearSession(group.folder);
      delete sessions[group.folder];
      sessionId = undefined;
    }
  }

  // Update tasks snapshot for container to read (filtered by group)
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  // Update available groups snapshot (main group only can see all groups)
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  // Wrap onOutput to track session ID from streamed results
  const wrappedOnOutput = onOutput
    ? async (output: ContainerOutput) => {
        if (output.newSessionId) {
          sessions[group.folder] = output.newSessionId;
          setSession(group.folder, output.newSessionId);
        }
        await onOutput(output);
      }
    : undefined;

  try {
    const output = await runContainerAgent(
      group,
      {
        prompt,
        sessionId,
        groupFolder: group.folder,
        chatJid,
        isMain,
        lane: 'user',
      },
      (proc, containerName) => queue.registerProcess(chatJid, proc, containerName, group.folder),
      wrappedOnOutput,
    );

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      setSession(group.folder, output.newSessionId);
    }

    if (output.status === 'error') {
      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      return 'error';
    }

    return 'success';
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return 'error';
  }
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  messageLoopRunning = true;

  logger.info(`NanoClaw running (trigger: @${ASSISTANT_NAME})`);

  // Event-driven: process immediately when WhatsApp emits a message
  const pendingGroups = new Set<string>();
  let processScheduled = false;

  const processEvents = async () => {
    processScheduled = false;
    const groups = [...pendingGroups];
    pendingGroups.clear();
    if (groups.length === 0) return;
    try {
      await checkAndProcessMessages();
    } catch (err) {
      logger.error({ err }, 'Error processing event-driven messages');
    }
  };

  messageBus.onMessage((msg) => {
    pendingGroups.add(msg.chatJid);
    if (!processScheduled) {
      processScheduled = true;
      // Debounce 100ms to batch rapid messages
      setTimeout(processEvents, 100);
    }
  });

  // Fallback poll loop (30s) for catching any missed events
  while (true) {
    try {
      await checkAndProcessMessages();
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

/** Shared message check logic used by both event-driven and fallback poll */
async function checkAndProcessMessages(): Promise<void> {
  const jids = Object.keys(registeredGroups);
  const { messages, newTimestamp } = getNewMessages(
    jids,
    lastTimestamp,
    ASSISTANT_NAME,
  );

  if (messages.length > 0) {
    logger.info({ count: messages.length }, 'New messages');

    // Advance the "seen" cursor for all messages immediately
    lastTimestamp = newTimestamp;
    saveState();

    // Deduplicate by group
    const messagesByGroup = new Map<string, NewMessage[]>();
    for (const msg of messages) {
      const existing = messagesByGroup.get(msg.chat_jid);
      if (existing) {
        existing.push(msg);
      } else {
        messagesByGroup.set(msg.chat_jid, [msg]);
      }
    }

    for (const [chatJid, groupMessages] of messagesByGroup) {
      const group = registeredGroups[chatJid];
      if (!group) continue;
      const traced = traceMessages(groupMessages, 'user');
      const traceIds = traced.map((t) => t.traceId);

      const isMainGroup = group.folder === MAIN_GROUP_FOLDER;
      const needsTrigger = !isMainGroup && group.requiresTrigger !== false;

      if (needsTrigger) {
        const hasTrigger = groupMessages.some((m) =>
          TRIGGER_PATTERN.test(m.content.trim()),
        );
        if (!hasTrigger) continue;
      }

      const allPending = getMessagesSince(
        chatJid,
        lastAgentTimestamp[chatJid] || '',
        ASSISTANT_NAME,
      );
      const messagesToSend =
        allPending.length > 0 ? allPending : groupMessages;
      const formatted = formatMessages(messagesToSend);

      if (queue.sendMessage(chatJid, formatted)) {
        logger.debug(
          { chatJid, count: messagesToSend.length },
          'Piped messages to active container',
        );
        latestRejectedTracesByGroup.delete(chatJid);
        markTraceStatus(traceIds, 'RUNNING');
        lastAgentTimestamp[chatJid] =
          messagesToSend[messagesToSend.length - 1].timestamp;
        saveState();
      } else {
        const accepted = queue.enqueueMessageCheck(chatJid);
        if (accepted) {
          latestRejectedTracesByGroup.delete(chatJid);
          markTraceStatus(traceIds, 'QUEUED');
          try {
            await sendToChannel(chatJid, '📥 รับข้อความแล้ว กำลังจัดคิวประมวลผลให้นะครับ');
          } catch (err) {
            logger.debug({ chatJid, err }, 'Soft ACK send failed (non-fatal)');
          }
        } else {
          latestRejectedTracesByGroup.set(chatJid, traceIds);
          markTraceStatus(traceIds, 'FAILED', {
            errorCode: 'FAILED_QUEUE_FULL',
            errorDetail: 'Queue rejected due to capacity limit',
          });
          for (const traceId of traceIds) {
            moveToDeadLetter(
              traceId,
              'FAILED_QUEUE_FULL',
              'Queue full while attempting to enqueue message',
              true,
            );
          }
          const traceHint = traceIds[0] ? traceIds[0].slice(0, 10) : 'n/a';
          try {
            await sendToChannel(
              chatJid,
              `⏳ ระบบงานเต็มชั่วคราว กรุณาลองใหม่อีกครั้ง (trace: ${traceHint})`,
            );
          } catch (err) {
            logger.warn({ chatJid, err }, 'Failed to send queue-full DLQ notification');
          }
        }
      }
    }
  }
}

/**
 * Startup recovery: check for unprocessed messages in registered groups.
 * Handles crash between advancing lastTimestamp and processing messages.
 */
function recoverPendingMessages(): void {
  for (const [chatJid, group] of Object.entries(registeredGroups)) {
    const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
    const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
    if (pending.length > 0) {
      logger.info(
        { group: group.name, pendingCount: pending.length },
        'Recovery: found unprocessed messages',
      );
      queue.enqueueMessageCheck(chatJid);
    }
  }
}

function reconcileUnfinishedReceipts(): void {
  const recoverable = getRecoverableReceipts();
  if (recoverable.length === 0) return;

  const queuedGroups = new Set<string>();
  let reconciled = 0;

  for (const item of recoverable) {
    const group = registeredGroups[item.chat_jid];
    if (!group) continue;

    // Keep non-trigger chatter in RECEIVED for groups that require explicit mention.
    if (item.status === 'RECEIVED' && group.requiresTrigger !== false && group.folder !== MAIN_GROUP_FOLDER) {
      if (!TRIGGER_PATTERN.test(item.content.trim())) continue;
    }

    transitionMessageStatus(item.trace_id, 'RETRYING', {
      errorCode: 'RECOVERED_AFTER_RESTART',
      errorDetail: `Recovered unfinished state ${item.status}`,
    });
    queuedGroups.add(item.chat_jid);
    reconciled += 1;
  }

  for (const jid of queuedGroups) {
    queue.enqueueMessageCheck(jid);
  }

  if (reconciled > 0) {
    logger.warn(
      { reconciled, groups: queuedGroups.size },
      'Recovered unfinished message receipts after restart',
    );
  }
}

function ensureDockerRunning(): void {
  try {
    execSync('docker info', { stdio: 'pipe', timeout: 10000 });
    logger.debug('Docker daemon is running');
  } catch {
    logger.error('Docker daemon is not running');
    console.error(
      '\nâ•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—',
    );
    console.error(
      'â•‘  FATAL: Docker is not running                                  â•‘',
    );
    console.error(
      'â•‘                                                                â•‘',
    );
    console.error(
      'â•‘  Agents cannot run without Docker. To fix:                     â•‘',
    );
    console.error(
      'â•‘  Windows: Start Docker Desktop                                 â•‘',
    );
    console.error(
      'â•‘  macOS:   Start Docker Desktop                                 â•‘',
    );
    console.error(
      'â•‘  Linux:   sudo systemctl start docker                          â•‘',
    );
    console.error(
      'â•‘                                                                â•‘',
    );
    console.error(
      'â•‘  Install from: https://docker.com/products/docker-desktop      â•‘',
    );
    console.error(
      'â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n',
    );
    throw new Error('Docker is required but not running');
  }

  // Check if agent image exists. If missing, try to auto-build from mounted container/ dir.
  // This is NON-FATAL: NanoClaw starts regardless so inline/oracle commands still work.
  // Only container-tier requests (tier 3/4) will fail if the image is truly missing.
  const agentImage = process.env.CONTAINER_IMAGE || 'nanoclaw-agent:latest';
  try {
    const imageId = execSync(`docker images -q ${agentImage}`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();

    if (!imageId) {
      // Image doesn't exist â€” try auto-build if build context is available
      const containerBuildDir = path.join(process.cwd(), 'container');
      if (fs.existsSync(path.join(containerBuildDir, 'Dockerfile'))) {
        logger.info(
          { image: agentImage, buildDir: containerBuildDir },
          'Agent image not found â€” building automatically (first-time setup)...',
        );
        console.log(`\n⏳  Building agent image '${agentImage}' (this takes ~2-5 minutes on first run)...\n`);
        execSync(`docker build -t ${agentImage} ${containerBuildDir}`, {
          stdio: 'inherit',  // stream build output to console
          timeout: 600_000,  // 10 min build timeout
        });
        logger.info({ image: agentImage }, 'Agent image built successfully');
        console.log(`\n✅  Agent image '${agentImage}' ready.\n`);
      } else {
        // No build context available â€” warn loudly but DON'T crash.
        // Inline (/start, /help, /clear) and oracle-only commands will still work.
        logger.error(
          { image: agentImage, buildDir: containerBuildDir },
          '⚠️  Agent image missing! Container-tier messages will fail. ' +
          'Build it manually: docker build -t nanoclaw-agent:latest -f nanoclaw/container/Dockerfile nanoclaw/container/',
        );
        console.error(`\n⚠️  WARNING: Agent image '${agentImage}' not found!`);
        console.error(`   Inline commands (/start, /help, /clear) will work.`);
        console.error(`   But AI responses (container tier) will fail until you build it:`);
        console.error(`   docker build -t ${agentImage} -f nanoclaw/container/Dockerfile nanoclaw/container/\n`);
      }
    } else {
      logger.debug({ image: agentImage, imageId }, 'Agent image verified');
    }
  } catch (err) {
    // Build failed â€” warn but don't crash
    logger.warn({ image: agentImage, err }, 'Agent image check/build failed â€” container-tier messages may fail');
  }

  // Kill running orphans + prune exited NanoClaw containers from previous runs.
  // Running orphans: stop them first (blocks), then let --rm remove them.
  // Exited orphans: directly remove (handles transition from pre-â€“rm builds and Docker-crash leftovers).
  try {
    // 1. Stop any still-running agent containers
    const runningOut = execSync('docker ps --filter name=nanoclaw- --format "{{.Names}}"', {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    const running = runningOut.trim().split('\n').filter(Boolean);
    for (const name of running) {
      try {
        execSync(`docker stop ${name}`, { stdio: 'pipe', timeout: 15000 });
        execSync(`docker rm -f ${name}`, { stdio: 'pipe', timeout: 10000 });
      } catch { /* already stopped/removed */ }
    }

    // 2. Prune leftover Exited containers (e.g. from builds without --rm, or Docker-daemon crashes)
    const exitedOut = execSync(
      'docker ps -a --filter name=nanoclaw- --filter status=exited --format "{{.Names}}"',
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' },
    );
    const exited = exitedOut.trim().split('\n').filter(Boolean);
    if (exited.length > 0) {
      try {
        execSync(`docker rm -f ${exited.join(' ')}`, { stdio: 'pipe', timeout: 30000 });
      } catch { /* best effort */ }
      logger.info({ count: exited.length }, 'Pruned exited orphan containers');
    }

    const total = running.length + exited.length;
    if (total > 0) {
      logger.info({ running: running.length, exited: exited.length }, 'Orphan container cleanup complete');
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to clean up orphaned containers');
  }
}

async function main(): Promise<void> {
  ensureDockerRunning();
  initDatabase();
  initCostTracking();
  initCostIntelligence();
  initContainerPool();
  logger.info('Database initialized');
  loadState();
  reconcileUnfinishedReceipts();
  dockerResilience.init(() => queue.getActiveContainerNames());
  capabilityProbe.start();

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');

    // 1. Stop ALL typing indicators immediately
    for (const interval of activeTypingIntervals) {
      clearInterval(interval);
    }
    activeTypingIntervals.clear();

    // 2. Shutdown container pool and queue
    await containerPool.shutdown();
    await queue.shutdown(10000);
    capabilityProbe.stop();
    dockerResilience.stop();

    // 3. Kill ALL orphan nanoclaw-* agent containers so Docker network can be freed
    try {
      const { execSync } = await import('child_process');
      const output = execSync('docker ps --filter name=nanoclaw- --format "{{.Names}}"', {
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
        timeout: 10000,
      });
      const orphans = output.trim().split('\n').filter(Boolean);
      if (orphans.length > 0) {
        logger.info({ count: orphans.length, names: orphans }, 'Stopping orphan agent containers...');
        // Stop all in parallel for speed
        execSync(`docker stop ${orphans.join(' ')}`, { stdio: 'pipe', timeout: 30000 });
        execSync(`docker rm -f ${orphans.join(' ')}`, { stdio: 'pipe', timeout: 15000 });
        logger.info('Orphan agent containers cleaned up');
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to clean up orphan containers during shutdown');
    }

    // 4. Disconnect channels
    for (const ch of channels) {
      try { await ch.disconnect(); } catch {}
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Shared callbacks for all channels
  const appStartTime = Date.now();
  const channelCallbacks = {
    onMessage: (chatJid: string, msg: NewMessage) => {
      storeMessage(msg);
      const trace = ensureMessageReceipt(chatJid, msg.id, 'user', new Date().toISOString());
      transitionMessageStatus(trace.trace_id, 'RECEIVED');
      recordActivity(); // track for silence heartbeat
    },
    onChatMetadata: (chatJid: string, timestamp: string, name?: string) => storeChatMetadata(chatJid, timestamp, name),
    registeredGroups: () => registeredGroups,
  };

  // Create Telegram channel (if token is set)
  let telegram: TelegramChannel | undefined;
  if (TELEGRAM_BOT_TOKEN) {
    telegram = new TelegramChannel({
      token: TELEGRAM_BOT_TOKEN,
      ...channelCallbacks,
      onAutoRegister: (jid, chatName) => {
        // Auto-register Telegram DM/group as "main" if no groups registered,
        // or as a uniquely-named group otherwise.
        const existing = Object.keys(registeredGroups);
        const isFirst = existing.length === 0;
        const folder = isFirst ? MAIN_GROUP_FOLDER : `tg-${jid.replace('tg:', '')}`;
        registerGroup(jid, {
          name: chatName,
          folder,
          trigger: ASSISTANT_NAME,
          added_at: new Date().toISOString(),
          requiresTrigger: false, // DM chats don't need @trigger
        });
        logger.info({ jid, chatName, folder, isMain: isFirst }, 'Telegram chat auto-registered');
      },
    });
    channels.push(telegram);
    await telegram.connect();
    logger.info('Telegram channel enabled');
  } else {
    logger.info('No TELEGRAM_BOT_TOKEN â€” Telegram disabled');
  }

  // Create WhatsApp channel (only if enabled)
  let whatsapp: WhatsAppChannel | undefined;
  if (ENABLED_CHANNELS.has('whatsapp')) {
    whatsapp = new WhatsAppChannel(channelCallbacks);
    channels.push(whatsapp);
    try {
      await whatsapp.connect();
      logger.info('WhatsApp channel enabled');
    } catch (err) {
      logger.warn({ err }, 'WhatsApp connection failed â€” continuing without WhatsApp');
    }
  } else {
    logger.info('WhatsApp disabled via ENABLED_CHANNELS');
  }

  logger.info({ channels: channels.map(c => c.name) }, 'Active channels');

  // Start subsystems (independently of connection handler)
  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder) => queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage: async (jid, rawText) => {
      const ch = findChannel(channels, jid);
      if (!ch) { logger.warn({ jid }, 'No channel for scheduled message'); return; }
      const text = formatOutbound(ch, rawText);
      if (text) await ch.sendMessage(jid, text);
    },
  });
  startIpcWatcher({
    sendMessage: (jid, text) => sendToChannel(jid, text),
    registeredGroups: () => registeredGroups,
    registerGroup,
    syncGroupMetadata: (force) => whatsapp?.syncGroupMetadata(force) ?? Promise.resolve(),
    getAvailableGroups,
    writeGroupsSnapshot: (gf, im, ag, rj) => writeGroupsSnapshot(gf, im, ag, rj),
    patchHeartbeatConfig: (patch) => patchHeartbeatConfig(patch as Parameters<typeof patchHeartbeatConfig>[0]),
    runTaskNow: (taskId) => updateTask(taskId, { next_run: new Date().toISOString() }),
  });
  queue.setProcessMessagesFn((jid, retryCount) => processGroupMessages(jid, retryCount));

  // Wire queue feedback callbacks to notify users
  queue.onRejected((groupJid) => {
    // User-path queue-full responses are sent at ingress (checkAndProcessMessages)
    // where we have exact trace IDs and can write DLQ before notifying.
    logger.warn({ groupJid }, 'Queue rejected by policy');
  });

  queue.onMaxRetriesExceeded(async (groupJid) => {
    const traces = latestFailedTracesByGroup.get(groupJid) || [];
    for (const traceId of traces) {
      moveToDeadLetter(
        traceId,
        'MAX_RETRIES_EXCEEDED',
        'Message processing retries exhausted',
        true,
      );
    }
    const traceHint = traces[0] ? traces[0].slice(0, 10) : 'n/a';
    try {
      await sendToChannel(groupJid, `❌ งานนี้ล้มเหลวหลัง retry อัตโนมัติแล้ว กรุณาลองใหม่ (trace: ${traceHint})`);
    } catch (err) {
      logger.warn({ groupJid, err }, 'Failed to send max-retries notification');
    }
    latestFailedTracesByGroup.delete(groupJid);
  });

  queue.onQueued(async (groupJid, position) => {
    // Skip virtual JIDs used by the scheduler — no user to notify
    if (groupJid.startsWith('_sched_') || groupJid.startsWith('_hb_')) return;
    try {
      await sendToChannel(groupJid, `📥 รับข้อความแล้ว กำลังเข้าคิว (#${position})`);
    } catch (err) {
      logger.warn({ groupJid, err }, 'Failed to send queue-position notification');
    }
  });

  recoverPendingMessages();

  // Pre-warm pool containers for the main group
  const mainJid = Object.entries(registeredGroups).find(([, g]) => g.folder === MAIN_GROUP_FOLDER);
  if (POOL_ENABLED && mainJid) {
    containerPool.warmForGroup(mainJid[1], true).catch((err) => {
      logger.warn({ err }, 'Failed to pre-warm main group container');
    });
  }

  // Start health/status HTTP server (port 47779)
  const heartbeatStatusProvider = {
    getStatus: () => ({
      activeContainers: queue.getActiveCount(),
      queueDepth: queue.getQueueDepth(),
      registeredGroups: Object.values(registeredGroups).map(g => g.name),
      uptimeMs: Date.now() - appStartTime,
    }),
    sendMessage: (jid: string, text: string) => sendToChannel(jid, text),
  };

  setStatusProvider({
    getActiveContainers: () => queue.getActiveCount(),
    getQueueDepth: () => queue.getQueueDepth(),
    getLaneStats: () => queue.getLaneStats(),
    getRegisteredGroups: () => Object.values(registeredGroups).map(g => g.name),
    getResourceStats: () => {
      const stats = resourceMonitor.stats;
      return { currentMax: stats.currentMax, cpuUsage: stats.cpuUsage, memoryFree: stats.memoryFree };
    },
    getDockerResilience: () => dockerResilience.getState(),
    getDlqStats: () => getDlqCounts(),
    getCapabilityHealth: () => capabilityProbe.getState(),
    getUptimeMs: () => Date.now() - appStartTime,
  });
  setOpsProvider({
    getMessageTrace: (traceId: string) => ({
      receipt: getMessageReceipt(traceId) ?? null,
      attempts: getMessageAttempts(traceId),
      deadLetter: getDeadLetterByTrace(traceId) ?? null,
    }),
    listDeadLetters: (status: 'open' | 'retrying' | 'resolved') =>
      getDeadLettersByStatus(status),
    retryDeadLetter: (traceId: string, retriedBy: string) => {
      const deadLetter = getDeadLetterByTrace(traceId);
      if (!deadLetter) return false;
      const updated = markDeadLetterRetrying(traceId, retriedBy || 'ops');
      if (!updated) return false;
      const accepted = queue.enqueueMessageCheck(deadLetter.chat_jid);
      if (!accepted) {
        moveToDeadLetter(
          traceId,
          'FAILED_QUEUE_FULL',
          'Queue full while retrying dead-letter message',
          true,
        );
        return false;
      }
      return true;
    },
    retryDeadLetterBatch: (limit: number, retriedBy: string) => {
      const targets = getDeadLettersByStatus('open').slice(0, Math.max(1, limit || 10));
      let retried = 0;
      for (const item of targets) {
        const ok = markDeadLetterRetrying(item.trace_id, retriedBy || 'ops');
        if (!ok) continue;
        const accepted = queue.enqueueMessageCheck(item.chat_jid);
        if (!accepted) {
          moveToDeadLetter(
            item.trace_id,
            'FAILED_QUEUE_FULL',
            'Queue full while batch-retrying dead-letter message',
            true,
          );
          continue;
        }
        retried += 1;
      }
      return { retried, requested: targets.length };
    },
  });
  setToolsProvider({
    getToolsInventory: () => buildRuntimeToolsInventory(channels.map((c) => c.name)),
  });
  setHeartbeatProvider(heartbeatStatusProvider);
  startHealthServer();

  // Set heartbeat main chat JID = first registered main group
  const mainEntry = Object.entries(registeredGroups).find(([, g]) => g.folder === MAIN_GROUP_FOLDER);
  if (mainEntry) {
    patchHeartbeatConfig({ mainChatJid: mainEntry[0] });
  }

  // Start heartbeat system
  const stopHeartbeat = startHeartbeat(heartbeatStatusProvider);
  process.once('beforeExit', stopHeartbeat);

  // Write initial heartbeat jobs snapshot for containers
  writeHeartbeatJobsSnapshot();

  // Start smart heartbeat job runner
  const stopJobRunner = startHeartbeatJobRunner({
    executeJobPrompt: async (job) => {
      // Find the group for this job (default to main group)
      const group = Object.values(registeredGroups).find(
        (g) => g.folder === (job.created_by || MAIN_GROUP_FOLDER),
      ) ?? Object.values(registeredGroups).find(
        (g) => g.folder === MAIN_GROUP_FOLDER,
      );

      if (!group) {
        throw new Error(`No group found for heartbeat job ${job.id}`);
      }

      const isMain = group.folder === MAIN_GROUP_FOLDER;
      const targetJid = job.chat_jid || mainEntry?.[0] || '';
      const taskId = `hbjob-${job.id}-${Date.now()}`;
      const virtualJid = `_hb_${job.id}`;

      return await new Promise<string>((resolve, reject) => {
        const accepted = queue.enqueueTask(
          virtualJid,
          taskId,
          async () => {
            try {
              const output = await runContainerAgent(
                group,
                {
                  prompt: `[Heartbeat Job: ${job.label}]\n\n${job.prompt}\n\nRespond with a concise summary of your findings/actions. Keep it brief and actionable.`,
                  groupFolder: group.folder,
                  chatJid: targetJid,
                  isMain,
                  isScheduledTask: true,
                  lane: 'heartbeat',
                },
                (proc, containerName) => queue.registerProcess(virtualJid, proc, containerName, group.folder),
              );

              if (output.status === 'error') {
                reject(new Error(output.error || 'Container agent failed'));
                return;
              }
              resolve(output.result || 'Completed (no output)');
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          },
          'heartbeat',
        );

        if (!accepted) {
          reject(new Error('Heartbeat task rejected by queue policy'));
        }
      });
    },
    sendMessage: (jid, text) => sendToChannel(jid, text),
  });
  process.once('beforeExit', stopJobRunner);

  startMessageLoop();
}

// Guard: only run when executed directly, not when imported by tests
const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start NanoClaw');
    process.exit(1);
  });
}

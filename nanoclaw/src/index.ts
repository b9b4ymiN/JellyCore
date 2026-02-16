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
  TELEGRAM_BOT_TOKEN,
  TRIGGER_PATTERN,
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
import { handleOracleOnly } from './oracle-handler.js';
import { initCostTracking, trackUsage } from './cost-tracker.js';
import {
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  getMessagesSince,
  getNewMessages,
  getRouterState,
  initDatabase,
  setRegisteredGroup,
  setRouterState,
  setSession,
  storeChatMetadata,
  storeMessage,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { startIpcWatcher } from './ipc.js';
import { findChannel, formatMessages, formatOutbound, routeOutbound } from './router.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { Channel, NewMessage, RegisteredGroup } from './types.js';
import { logger } from './logger.js';

// Re-export for backwards compatibility during refactor
export { escapeXml, formatMessages } from './router.js';

let lastTimestamp = '';
let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let messageLoopRunning = false;

const channels: Channel[] = [];
const queue = new GroupQueue();

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

/** Set typing indicator on the right channel */
async function setTypingOnChannel(jid: string, isTyping: boolean): Promise<void> {
  const ch = findChannel(channels, jid);
  if (ch?.setTyping) await ch.setTyping(jid, isTyping);
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
 */
async function processGroupMessages(chatJid: string): Promise<boolean> {
  const group = registeredGroups[chatJid];
  if (!group) return true;

  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const missedMessages = getMessagesSince(
    chatJid,
    sinceTimestamp,
    ASSISTANT_NAME,
  );

  if (missedMessages.length === 0) return true;

  // For non-main groups, check if trigger is required and present
  if (!isMainGroup && group.requiresTrigger !== false) {
    const hasTrigger = missedMessages.some((m) =>
      TRIGGER_PATTERN.test(m.content.trim()),
    );
    if (!hasTrigger) return true;
  }

  // --- Smart Query Router: classify the latest message ---
  const lastMsg = missedMessages[missedMessages.length - 1];
  const classification = classifyQuery(lastMsg.content);
  const startTime = Date.now();

  logger.info(
    { group: group.name, tier: classification.tier, reason: classification.reason, messageCount: missedMessages.length },
    'Query classified',
  );

  // Tier 1: Inline — template response, no container/API
  if (classification.tier === 'inline') {
    const reply = handleInline(classification.reason, lastMsg.content, chatJid, group.name);
    const ch = channelFor(chatJid);
    await sendToChannel(chatJid, formatOutbound(ch, reply));
    lastAgentTimestamp[chatJid] = lastMsg.timestamp;
    saveState();
    trackUsage(classification.tier, classification.model, Date.now() - startTime);
    logger.info({ group: group.name, tier: 'inline', ms: Date.now() - startTime }, 'Inline response sent');
    return true;
  }

  // Tier 2: Oracle-only — direct Oracle API call, no container
  if (classification.tier === 'oracle-only') {
    const reply = await handleOracleOnly(classification.reason, lastMsg.content);
    if (reply) {
      const ch = channelFor(chatJid);
      await sendToChannel(chatJid, formatOutbound(ch, reply));
      lastAgentTimestamp[chatJid] = lastMsg.timestamp;
      saveState();
      trackUsage(classification.tier, classification.model, Date.now() - startTime);
      logger.info({ group: group.name, tier: 'oracle-only', ms: Date.now() - startTime }, 'Oracle response sent');
      return true;
    }
    // Empty reply means Oracle failed — fall through to container
    logger.warn({ group: group.name }, 'Oracle handler returned empty, falling through to container');
  }

  // Tier 3 & 4: Container-light / Container-full — spawn container
  const prompt = formatMessages(missedMessages);

  // Advance cursor so the piping path in startMessageLoop won't re-fetch
  // these messages. Save the old cursor so we can roll back on error.
  const previousCursor = lastAgentTimestamp[chatJid] || '';
  lastAgentTimestamp[chatJid] =
    missedMessages[missedMessages.length - 1].timestamp;
  saveState();

  logger.info(
    { group: group.name, tier: classification.tier, model: classification.model, messageCount: missedMessages.length },
    'Processing via container',
  );

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

  const ch = channelFor(chatJid);

  const output = await runAgent(group, prompt, chatJid, async (result) => {
    // Streaming output callback — called for each agent result
    if (result.result) {
      const raw = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
      // Strip <internal>...</internal> blocks — agent uses these for internal reasoning
      const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
      logger.info({ group: group.name }, `Agent output: ${raw.slice(0, 200)}`);
      if (text) {
        await sendToChannel(chatJid, formatOutbound(ch, text));
        outputSentToUser = true;
      }
      // Only reset idle timer on actual results, not session-update markers (result: null)
      resetIdleTimer();
    }

    if (result.status === 'error') {
      hadError = true;
    }
  });

  await setTypingOnChannel(chatJid, false);
  if (idleTimer) clearTimeout(idleTimer);

  if (output === 'error' || hadError) {
    // If we already sent output to the user, don't roll back the cursor —
    // the user got their response and re-processing would send duplicates.
    if (outputSentToUser) {
      logger.warn({ group: group.name }, 'Agent error after output was sent, skipping cursor rollback to prevent duplicates');
      trackUsage(classification.tier, classification.model, Date.now() - startTime);
      return true;
    }
    // Roll back cursor so retries can re-process these messages
    lastAgentTimestamp[chatJid] = previousCursor;
    saveState();
    logger.warn({ group: group.name }, 'Agent error, rolled back message cursor for retry');
    return false;
  }

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
  const sessionId = sessions[group.folder];

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
        lastAgentTimestamp[chatJid] =
          messagesToSend[messagesToSend.length - 1].timestamp;
        saveState();
      } else {
        queue.enqueueMessageCheck(chatJid);
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

function ensureDockerRunning(): void {
  try {
    execSync('docker info', { stdio: 'pipe', timeout: 10000 });
    logger.debug('Docker daemon is running');
  } catch {
    logger.error('Docker daemon is not running');
    console.error(
      '\n╔════════════════════════════════════════════════════════════════╗',
    );
    console.error(
      '║  FATAL: Docker is not running                                  ║',
    );
    console.error(
      '║                                                                ║',
    );
    console.error(
      '║  Agents cannot run without Docker. To fix:                     ║',
    );
    console.error(
      '║  Windows: Start Docker Desktop                                 ║',
    );
    console.error(
      '║  macOS:   Start Docker Desktop                                 ║',
    );
    console.error(
      '║  Linux:   sudo systemctl start docker                          ║',
    );
    console.error(
      '║                                                                ║',
    );
    console.error(
      '║  Install from: https://docker.com/products/docker-desktop      ║',
    );
    console.error(
      '╚════════════════════════════════════════════════════════════════╝\n',
    );
    throw new Error('Docker is required but not running');
  }

  // Kill and clean up orphaned NanoClaw containers from previous runs
  try {
    const output = execSync('docker ps --filter name=nanoclaw- --format {{.Names}}', {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    const orphans = output.trim().split('\n').filter(Boolean);
    for (const name of orphans) {
      try {
        execSync(`docker stop ${name}`, { stdio: 'pipe', timeout: 15000 });
        execSync(`docker rm ${name}`, { stdio: 'pipe', timeout: 10000 });
      } catch { /* already stopped/removed */ }
    }
    if (orphans.length > 0) {
      logger.info({ count: orphans.length, names: orphans }, 'Stopped orphaned containers');
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to clean up orphaned containers');
  }
}

async function main(): Promise<void> {
  ensureDockerRunning();
  initDatabase();
  initCostTracking();
  initContainerPool();
  logger.info('Database initialized');
  loadState();

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    await containerPool.shutdown();
    await queue.shutdown(10000);
    for (const ch of channels) {
      try { await ch.disconnect(); } catch {}
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Shared callbacks for all channels
  const channelCallbacks = {
    onMessage: (chatJid: string, msg: NewMessage) => storeMessage(msg),
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
    logger.info('No TELEGRAM_BOT_TOKEN — Telegram disabled');
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
      logger.warn({ err }, 'WhatsApp connection failed — continuing without WhatsApp');
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
  });
  queue.setProcessMessagesFn(processGroupMessages);
  recoverPendingMessages();

  // Pre-warm pool containers for the main group
  const mainJid = Object.entries(registeredGroups).find(([, g]) => g.folder === MAIN_GROUP_FOLDER);
  if (mainJid) {
    containerPool.warmForGroup(mainJid[1], true).catch((err) => {
      logger.warn({ err }, 'Failed to pre-warm main group container');
    });
  }

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

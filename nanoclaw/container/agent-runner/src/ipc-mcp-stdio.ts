/**
 * Stdio MCP Server for NanoClaw
 * Standalone process that agent teams subagents can inherit.
 * Reads context from environment variables, writes IPC files for the host.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { CronExpressionParser } from 'cron-parser';
import { runCodexPrompt } from './codex-runner.js';

const IPC_DIR = '/workspace/ipc';
const MESSAGES_DIR = path.join(IPC_DIR, 'messages');
const TASKS_DIR = path.join(IPC_DIR, 'tasks');

// IPC integrity signing secret (passed from host via container env)
const IPC_SECRET = process.env.JELLYCORE_IPC_SECRET || '';

// Context from environment variables (set by the agent runner)
const chatJid = process.env.NANOCLAW_CHAT_JID!;
const groupFolder = process.env.NANOCLAW_GROUP_FOLDER!;
const isMain = process.env.NANOCLAW_IS_MAIN === '1';
const AGENT_MODES_FILE = path.join(IPC_DIR, 'agent_modes.json');
const CODEX_AUTH_FILE = '/home/node/.codex/auth.json';

/**
 * Sign an IPC payload with HMAC-SHA256.
 */
function signPayload(payload: object): string {
  const canonical = JSON.stringify(payload, null, 2);
  const hmac = crypto.createHmac('sha256', IPC_SECRET).update(canonical).digest('hex');
  return JSON.stringify({ ...payload, _hmac: hmac }, null, 2);
}

function writeIpcFile(dir: string, data: object): string {
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(dir, filename);

  // Atomic write: temp file then rename (with HMAC signature)
  const tempPath = `${filepath}.tmp`;
  fs.writeFileSync(tempPath, signPayload(data));
  fs.renameSync(tempPath, filepath);

  return filename;
}

type AgentMode = 'off' | 'swarm' | 'codex';

interface AgentModeSnapshot {
  default: AgentMode;
  overrides: Record<string, AgentMode>;
}

interface LocalCodexAuthStatus {
  ready: boolean;
  reason?: 'missing_auth_file' | 'invalid_json' | 'missing_tokens_fields';
}

function parseAgentMode(mode: string | undefined): AgentMode | null {
  if (!mode) return null;
  const v = mode.trim().toLowerCase();
  if (v === 'off' || v === 'swarm' || v === 'codex') return v;
  return null;
}

function getCodexAuthStatusLocal(): LocalCodexAuthStatus {
  if (!fs.existsSync(CODEX_AUTH_FILE)) {
    return { ready: false, reason: 'missing_auth_file' };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(CODEX_AUTH_FILE, 'utf-8')) as {
      tokens?: {
        access_token?: string;
        refresh_token?: string;
        id_token?: string;
        account_id?: string;
      };
    };
    const t = parsed.tokens;
    if (
      !t
      || typeof t.access_token !== 'string'
      || typeof t.refresh_token !== 'string'
      || typeof t.id_token !== 'string'
      || typeof t.account_id !== 'string'
      || !t.access_token.trim()
      || !t.refresh_token.trim()
      || !t.id_token.trim()
      || !t.account_id.trim()
    ) {
      return { ready: false, reason: 'missing_tokens_fields' };
    }
    return { ready: true };
  } catch {
    return { ready: false, reason: 'invalid_json' };
  }
}

function readAgentModeSnapshot(): AgentModeSnapshot {
  const fallback: AgentModeSnapshot = { default: 'off', overrides: {} };
  try {
    if (!fs.existsSync(AGENT_MODES_FILE)) return fallback;
    const raw = JSON.parse(fs.readFileSync(AGENT_MODES_FILE, 'utf-8')) as Partial<AgentModeSnapshot>;
    const normalizedDefault = parseAgentMode(raw.default) || 'off';
    const overrides: Record<string, AgentMode> = {};
    if (raw.overrides && typeof raw.overrides === 'object') {
      for (const [folder, mode] of Object.entries(raw.overrides)) {
        const normalized = parseAgentMode(mode);
        if (normalized && folder.trim().length > 0) {
          overrides[folder] = normalized;
        }
      }
    }
    return { default: normalizedDefault, overrides };
  } catch {
    return fallback;
  }
}

function resolveEffectiveMode(snapshot: AgentModeSnapshot, folder: string): AgentMode {
  return snapshot.overrides[folder] || snapshot.default;
}

const server = new McpServer({
  name: 'nanoclaw',
  version: '1.0.0',
});

server.tool(
  'send_message',
  "Send a message to the user or group immediately while you're still running. Use this for progress updates or to send multiple messages. You can call this multiple times. Note: when running as a scheduled task, your final output is NOT sent to the user — use this tool if you need to communicate with the user or group.",
  {
    text: z.string().describe('The message text to send'),
    sender: z.string().optional().describe('Your role/identity name (e.g. "Researcher"). When set, messages appear from a dedicated bot in Telegram.'),
  },
  async (args) => {
    const data: Record<string, string | undefined> = {
      type: 'message',
      chatJid,
      text: args.text,
      sender: args.sender || undefined,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(MESSAGES_DIR, data);

    return { content: [{ type: 'text' as const, text: 'Message sent.' }] };
  },
);

server.tool(
  'get_agent_mode',
  'Read current agent mode state (effective mode for current/target group, global default, and local Codex auth readiness).',
  {
    target_group_folder: z.string().optional().describe('Optional group folder to inspect. Defaults to current group.'),
  },
  async (args) => {
    const targetGroup = args.target_group_folder?.trim() || groupFolder;
    const snapshot = readAgentModeSnapshot();
    const auth = getCodexAuthStatusLocal();
    const effective = resolveEffectiveMode(snapshot, targetGroup);
    const override = snapshot.overrides[targetGroup] || null;

    const payload = {
      source_group: groupFolder,
      target_group: targetGroup,
      effective_mode: effective,
      global_default: snapshot.default,
      group_override: override,
      codex_auth_ready: auth.ready,
      codex_auth_reason: auth.reason || null,
      overrides_count: Object.keys(snapshot.overrides).length,
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    };
  },
);

server.tool(
  'set_agent_mode',
  'Set/clear agent mode via host IPC. Supports global default and per-group override.',
  {
    mode: z.enum(['off', 'swarm', 'codex', 'inherit']).describe('inherit clears group override; valid only for scope=group'),
    scope: z.enum(['group', 'default']).default('group').describe('group=override a group, default=set global default'),
    target_group_folder: z.string().optional().describe('When scope=group, target folder. Defaults to current group.'),
  },
  async (args) => {
    if (args.scope === 'default' && args.mode === 'inherit') {
      return {
        content: [{ type: 'text' as const, text: 'Invalid request: mode=inherit is not valid for scope=default.' }],
        isError: true,
      };
    }

    if (args.mode === 'swarm' || args.mode === 'codex') {
      const auth = getCodexAuthStatusLocal();
      if (!auth.ready) {
        return {
          content: [{ type: 'text' as const, text: `Cannot enable ${args.mode}: codex_auth_blocked:${auth.reason || 'unknown'}` }],
          isError: true,
        };
      }
    }

    const targetGroup = args.target_group_folder?.trim() || groupFolder;
    const payload: Record<string, unknown> = {
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    if (args.scope === 'default') {
      payload.type = 'agent_mode_set_default';
      payload.mode = args.mode;
    } else if (args.mode === 'inherit') {
      payload.type = 'agent_mode_clear';
      payload.target_group_folder = targetGroup;
    } else {
      payload.type = 'agent_mode_set';
      payload.mode = args.mode;
      payload.target_group_folder = targetGroup;
    }

    const filename = writeIpcFile(TASKS_DIR, payload);
    return {
      content: [{ type: 'text' as const, text: `Agent mode request queued (${filename}).` }],
    };
  },
);

server.tool(
  'delegate_to_codex',
  'Delegate a complex coding/research sub-task to Codex CLI and return its result.',
  {
    task: z.string().describe('Task for Codex to execute.'),
    context: z.string().optional().describe('Optional supporting context/instructions.'),
    model: z.string().optional().describe('Optional Codex model override.'),
    timeout_ms: z.number().int().positive().max(1_200_000).optional().describe('Optional timeout in milliseconds (max 20 minutes).'),
  },
  async (args) => {
    const model = args.model?.trim() || process.env.CODEX_MODEL || 'gpt-5.3-codex';
    const timeoutMs = args.timeout_ms ?? Number.parseInt(process.env.CODEX_EXEC_TIMEOUT_MS || '600000', 10);
    const prompt = [
      'You are delegated by Fon to complete this sub-task.',
      '',
      'Task:',
      args.task.trim(),
      args.context?.trim() ? `\nContext:\n${args.context.trim()}` : '',
      '',
      'Return a concise, actionable result.',
    ].join('\n');

    const result = await runCodexPrompt(prompt, {
      model,
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 600000,
      cwd: '/workspace/group',
    });

    if (result.status === 'error') {
      return {
        content: [{ type: 'text' as const, text: `Codex delegation failed: ${result.error || 'unknown_error'}` }],
        isError: true,
      };
    }

    return {
      content: [{ type: 'text' as const, text: result.result || '(no output)' }],
    };
  },
);

server.tool(
  'schedule_task',
  `Schedule a recurring or one-time task. The task will run as a full agent with access to all tools.

CONTEXT MODE - Choose based on task type:
\u2022 "group": Task runs in the group's conversation context, with access to chat history. Use for tasks that need context about ongoing discussions, user preferences, or recent interactions.
\u2022 "isolated": Task runs in a fresh session with no conversation history. Use for independent tasks that don't need prior context. When using isolated mode, include all necessary context in the prompt itself.

If unsure which mode to use, you can ask the user. Examples:
- "Remind me about our discussion" \u2192 group (needs conversation context)
- "Check the weather every morning" \u2192 isolated (self-contained task)
- "Follow up on my request" \u2192 group (needs to know what was requested)
- "Generate a daily report" \u2192 isolated (just needs instructions in prompt)

MESSAGING BEHAVIOR - The task agent's output is sent to the user or group. It can also use send_message for immediate delivery, or wrap output in <internal> tags to suppress it. Include guidance in the prompt about whether the agent should:
\u2022 Always send a message (e.g., reminders, daily briefings)
\u2022 Only send a message when there's something to report (e.g., "notify me if...")
\u2022 Never send a message (background maintenance tasks)

SCHEDULE VALUE FORMAT (all times are LOCAL timezone):
\u2022 cron: Standard cron expression (e.g., "*/5 * * * *" for every 5 minutes, "0 9 * * *" for daily at 9am LOCAL time)
\u2022 interval: Milliseconds between runs (e.g., "300000" for 5 minutes, "3600000" for 1 hour)
\u2022 once: Local time WITHOUT "Z" suffix (e.g., "2026-02-01T15:30:00"). Do NOT use UTC/Z suffix.`,
  {
    prompt: z.string().describe('What the agent should do when the task runs. For isolated mode, include all necessary context here.'),
    schedule_type: z.enum(['cron', 'interval', 'once']).describe('cron=recurring at specific times, interval=recurring every N ms, once=run once at specific time'),
    schedule_value: z.string().describe('cron: "*/5 * * * *" | interval: milliseconds like "300000" | once: local timestamp like "2026-02-01T15:30:00" (no Z suffix!)'),
    context_mode: z.enum(['group', 'isolated']).default('group').describe('group=runs with chat history and memory, isolated=fresh session (include context in prompt)'),
    target_group_jid: z.string().optional().describe('(Main group only) JID of the group to schedule the task for. Defaults to the current group.'),
  },
  async (args) => {
    // Validate schedule_value before writing IPC
    if (args.schedule_type === 'cron') {
      try {
        CronExpressionParser.parse(args.schedule_value);
      } catch {
        return {
          content: [{ type: 'text' as const, text: `Invalid cron: "${args.schedule_value}". Use format like "0 9 * * *" (daily 9am) or "*/5 * * * *" (every 5 min).` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'interval') {
      const ms = parseInt(args.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        return {
          content: [{ type: 'text' as const, text: `Invalid interval: "${args.schedule_value}". Must be positive milliseconds (e.g., "300000" for 5 min).` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'once') {
      // Enforce local time contract: timestamp must not include timezone suffix.
      // Example accepted: 2026-02-01T15:30:00
      // Examples rejected: 2026-02-01T15:30:00Z, 2026-02-01T15:30:00+07:00
      if (/(Z|[+-]\d{2}:\d{2})$/i.test(args.schedule_value)) {
        return {
          content: [{
            type: 'text' as const,
            text: `Invalid timestamp: "${args.schedule_value}". Use LOCAL time without timezone suffix, e.g. "2026-02-01T15:30:00".`,
          }],
          isError: true,
        };
      }

      // Strict local ISO-like format to avoid ambiguous parsing.
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?$/.test(args.schedule_value)) {
        return {
          content: [{
            type: 'text' as const,
            text: `Invalid timestamp: "${args.schedule_value}". Use format "YYYY-MM-DDTHH:mm:ss" (local time, no Z).`,
          }],
          isError: true,
        };
      }

      const date = new Date(args.schedule_value);
      if (isNaN(date.getTime())) {
        return {
          content: [{
            type: 'text' as const,
            text: `Invalid timestamp: "${args.schedule_value}". Use a valid local timestamp like "2026-02-01T15:30:00" (no Z).`,
          }],
          isError: true,
        };
      }
    }

    // Non-main groups can only schedule for themselves
    const targetJid = isMain && args.target_group_jid ? args.target_group_jid : chatJid;

    const data = {
      type: 'schedule_task',
      prompt: args.prompt,
      schedule_type: args.schedule_type,
      schedule_value: args.schedule_value,
      context_mode: args.context_mode || 'group',
      targetJid,
      groupFolder,
      createdBy: groupFolder,
      timestamp: new Date().toISOString(),
    };

    const filename = writeIpcFile(TASKS_DIR, data);

    return {
      content: [{ type: 'text' as const, text: `Task scheduled (${filename}): ${args.schedule_type} - ${args.schedule_value}` }],
    };
  },
);

server.tool(
  'list_tasks',
  "List all scheduled tasks. From main: shows all tasks. From other groups: shows only that group's tasks.",
  {},
  async () => {
    const tasksFile = path.join(IPC_DIR, 'current_tasks.json');

    try {
      if (!fs.existsSync(tasksFile)) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
      }

      const allTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));

      const tasks = isMain
        ? allTasks
        : allTasks.filter((t: { groupFolder: string }) => t.groupFolder === groupFolder);

      if (tasks.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
      }

      const formatted = tasks
        .map(
          (t: { id: string; prompt: string; schedule_type: string; schedule_value: string; status: string; next_run: string }) =>
            `- [${t.id}] ${t.prompt.slice(0, 50)}... (${t.schedule_type}: ${t.schedule_value}) - ${t.status}, next: ${t.next_run || 'N/A'}`,
        )
        .join('\n');

      return { content: [{ type: 'text' as const, text: `Scheduled tasks:\n${formatted}` }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error reading tasks: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  },
);

server.tool(
  'pause_task',
  'Pause a scheduled task. It will not run until resumed.',
  { task_id: z.string().describe('The task ID to pause') },
  async (args) => {
    const data = {
      type: 'pause_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} pause requested.` }] };
  },
);

server.tool(
  'resume_task',
  'Resume a paused task.',
  { task_id: z.string().describe('The task ID to resume') },
  async (args) => {
    const data = {
      type: 'resume_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} resume requested.` }] };
  },
);

server.tool(
  'cancel_task',
  'Cancel and delete a scheduled task.',
  { task_id: z.string().describe('The task ID to cancel') },
  async (args) => {
    const data = {
      type: 'cancel_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} cancellation requested.` }] };
  },
);

server.tool(
  'register_group',
  `Register a new WhatsApp group so the agent can respond to messages there. Main group only.

Use available_groups.json to find the JID for a group. The folder name should be lowercase with hyphens (e.g., "family-chat").`,
  {
    jid: z.string().describe('The WhatsApp JID (e.g., "120363336345536173@g.us")'),
    name: z.string().describe('Display name for the group'),
    folder: z.string().describe('Folder name for group files (lowercase, hyphens, e.g., "family-chat")'),
    trigger: z.string().describe('Trigger word (e.g., "@Andy")'),
  },
  async (args) => {
    if (!isMain) {
      return {
        content: [{ type: 'text' as const, text: 'Only the main group can register new groups.' }],
        isError: true,
      };
    }

    const data = {
      type: 'register_group',
      jid: args.jid,
      name: args.name,
      folder: args.folder,
      trigger: args.trigger,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [{ type: 'text' as const, text: `Group "${args.name}" registered. It will start receiving messages immediately.` }],
    };
  },
);

// ── Heartbeat Configuration ───────────────────────────────────────────────────

server.tool(
  'configure_heartbeat',
  `Configure the heartbeat system settings. Main group only.

• enabled: turn heartbeat on/off
• interval_hours: how often heartbeat reports are sent (default 1 hour)
• silence_threshold_hours: how long of user silence triggers an alert (default 24 hours)
• show_ok / show_alerts: control which heartbeat outputs are delivered
• delivery_muted: stop sending heartbeat messages without stopping checks
• heartbeat_prompt: override monitor prompt
• ack_max_chars: cap OK acknowledgement length

Example: "ตั้ง heartbeat ทุก 2 ชั่วโมง" → configure_heartbeat({ interval_hours: 2 })`,
  {
    enabled: z.boolean().optional().describe('Enable or disable the heartbeat system'),
    interval_hours: z.number().positive().optional().describe('Heartbeat report interval in hours (e.g. 1, 2, 6)'),
    silence_threshold_hours: z.number().positive().optional().describe('Hours of user silence before escalation alert (e.g. 24, 48)'),
    show_ok: z.boolean().optional().describe('Send OK heartbeats when system is healthy'),
    show_alerts: z.boolean().optional().describe('Send alert heartbeats when issues are detected'),
    use_indicator: z.boolean().optional().describe('Prefix heartbeat with compact status indicator'),
    delivery_muted: z.boolean().optional().describe('Mute delivery while still running heartbeat checks'),
    alert_repeat_cooldown_minutes: z.number().nonnegative().optional().describe('Cooldown before repeating identical alerts'),
    heartbeat_prompt: z.string().optional().describe('Override heartbeat monitor prompt'),
    ack_max_chars: z.number().int().positive().optional().describe('Max characters for OK acknowledgement'),
  },
  async (args) => {
    if (!isMain) {
      return {
        content: [{ type: 'text' as const, text: '❌ configure_heartbeat can only be used from the main group.' }],
        isError: true,
      };
    }

    const heartbeat: Record<string, unknown> = {};
    if (args.enabled !== undefined) heartbeat.enabled = args.enabled;
    if (args.interval_hours !== undefined) heartbeat.intervalMs = args.interval_hours * 60 * 60 * 1000;
    if (args.silence_threshold_hours !== undefined) heartbeat.silenceThresholdMs = args.silence_threshold_hours * 60 * 60 * 1000;
    if (args.show_ok !== undefined) heartbeat.showOk = args.show_ok;
    if (args.show_alerts !== undefined) heartbeat.showAlerts = args.show_alerts;
    if (args.use_indicator !== undefined) heartbeat.useIndicator = args.use_indicator;
    if (args.delivery_muted !== undefined) heartbeat.deliveryMuted = args.delivery_muted;
    if (args.alert_repeat_cooldown_minutes !== undefined) {
      heartbeat.alertRepeatCooldownMs = args.alert_repeat_cooldown_minutes * 60 * 1000;
    }
    if (args.heartbeat_prompt !== undefined) heartbeat.heartbeatPrompt = args.heartbeat_prompt;
    if (args.ack_max_chars !== undefined) heartbeat.ackMaxChars = args.ack_max_chars;

    if (Object.keys(heartbeat).length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: '⚠️ No changes specified. Provide at least one heartbeat setting.',
        }],
        isError: true,
      };
    }

    const data = {
      type: 'heartbeat_config',
      heartbeat,
      timestamp: new Date().toISOString(),
    };

    const filename = writeIpcFile(TASKS_DIR, data);

    const changes = [
      args.enabled !== undefined ? `enabled: ${args.enabled}` : null,
      args.interval_hours !== undefined ? `interval: ${args.interval_hours}h` : null,
      args.silence_threshold_hours !== undefined ? `silence threshold: ${args.silence_threshold_hours}h` : null,
      args.show_ok !== undefined ? `show ok: ${args.show_ok}` : null,
      args.show_alerts !== undefined ? `show alerts: ${args.show_alerts}` : null,
      args.use_indicator !== undefined ? `indicator: ${args.use_indicator}` : null,
      args.delivery_muted !== undefined ? `delivery muted: ${args.delivery_muted}` : null,
      args.alert_repeat_cooldown_minutes !== undefined ? `alert cooldown: ${args.alert_repeat_cooldown_minutes}m` : null,
      args.ack_max_chars !== undefined ? `ack max chars: ${args.ack_max_chars}` : null,
      args.heartbeat_prompt !== undefined ? 'prompt: updated' : null,
    ].filter(Boolean).join(', ');

    return {
      content: [{ type: 'text' as const, text: `✅ Heartbeat configured (${filename}): ${changes}` }],
    };
  },
);

// ── Smart Heartbeat Job Tools ────────────────────────────────────────────────

server.tool(
  'add_heartbeat_job',
  `Add a smart heartbeat job — a recurring AI task that runs autonomously on a schedule.

Categories:
• learning: AI research, study, knowledge building (e.g., "ศึกษาเรื่อง AI agents ล่าสุด")
• monitor: Track stocks, prices, news, websites (e.g., "ติดตามราคาหุ้น NVDA")
• health: Personal health/wellness checks (e.g., "เตือนให้ดื่มน้ำและยืดเส้น")
• custom: Any other recurring intelligence task

Jobs run automatically at the configured interval (default 60 minutes).
Results are sent to this chat and included in heartbeat reports.`,
  {
    label: z.string().describe('Short name for the job (e.g., "ติดตามหุ้น NVDA", "เรียนรู้ AI agents")'),
    prompt: z.string().describe('What the AI should do each time this job runs. Be specific and detailed.'),
    category: z.enum(['learning', 'monitor', 'health', 'custom']).describe('Job category'),
    interval_minutes: z.number().optional().describe('Run interval in minutes (default: 60). Use null for system default.'),
  },
  async (args) => {
    const clientTs = Date.now();
    const data = {
      type: 'heartbeat_add_job',
      label: args.label,
      prompt: args.prompt,
      category: args.category,
      interval_ms: args.interval_minutes ? args.interval_minutes * 60 * 1000 : null,
      chatJid,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    const filename = writeIpcFile(TASKS_DIR, data);

    // Poll for feedback from the host to confirm the job was created.
    // The host writes data/ipc/{group}/feedback/hbjob-created-{ts}.json after
    // processing the IPC file. We wait up to 4 seconds.
    const feedbackDir = path.join(IPC_DIR, 'feedback');
    let confirmedJobId: string | null = null;
    let duplicateMessage: string | null = null;
    const deadline = clientTs + 4000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 200));
      if (!fs.existsSync(feedbackDir)) continue;
      try {
        const entries = fs.readdirSync(feedbackDir).filter(f => f.startsWith('hbjob-created-') && f.endsWith('.json'));
        for (const entry of entries) {
          const entryTs = parseInt(entry.replace('hbjob-created-', '').replace('.json', ''), 10);
          if (entryTs >= clientTs) {
            try {
              const feedback = JSON.parse(fs.readFileSync(path.join(feedbackDir, entry), 'utf-8'));
              if (feedback.type === 'heartbeat_job_duplicate') {
                duplicateMessage = feedback.message ?? `Job "${args.label}" already exists.`;
              } else {
                confirmedJobId = feedback.jobId ?? null;
              }
            } catch { /* ignore parse errors */ }
            break;
          }
        }
      } catch { /* ignore readdir errors */ }
      if (confirmedJobId || duplicateMessage) break;
    }

    if (duplicateMessage) {
      return {
        content: [{
          type: 'text' as const,
          text: `⚠️ ${duplicateMessage}\n\nUse \`list_heartbeat_jobs\` to see existing jobs, or \`heartbeat_update_job\` to modify the existing one.`,
        }],
      };
    }

    if (confirmedJobId) {
      return {
        content: [{
          type: 'text' as const,
          text: `✅ Heartbeat job "${args.label}" created successfully (ID: ${confirmedJobId.slice(0, 8)}).\nCategory: ${args.category} | Interval: ${args.interval_minutes ?? 60} min.\n\nJob is now active — first run in ~${args.interval_minutes ?? 60} min.`,
        }],
      };
    }

    // Fallback (host may be slow to process)
    return {
      content: [{
        type: 'text' as const,
        text: `✅ Heartbeat job "${args.label}" queued (${filename}). Category: ${args.category}, Interval: ${args.interval_minutes ?? 60} min.\n⚠️ Could not confirm creation within 4s — use list_heartbeat_jobs to verify.`,
      }],
    };
  },
);

server.tool(
  'list_heartbeat_jobs',
  'List all smart heartbeat jobs with their status, last result, and schedule.',
  {},
  async () => {
    const jobsFile = path.join(IPC_DIR, 'heartbeat_jobs.json');

    // Helper: read and format the snapshot file
    const readSnapshot = (): string | null => {
      try {
        if (!fs.existsSync(jobsFile)) return null;
        const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf-8'));
        if (!Array.isArray(jobs) || jobs.length === 0) return '';

        const categoryEmoji: Record<string, string> = {
          learning: '📚',
          monitor: '📊',
          health: '🏥',
          custom: '🔧',
        };

        return jobs
          .map(
            (j: { id: string; label: string; category: string; status: string; interval_ms: number | null; last_run: string | null; last_result: string | null }) => {
              const emoji = categoryEmoji[j.category] ?? '🔧';
              const intervalMin = j.interval_ms ? j.interval_ms / 60000 : 60;
              const lastRun = j.last_run ? new Date(j.last_run).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : 'ยังไม่เคย';
              const rawResult = j.last_result;
              const lastResult = rawResult === '__RUNNING__'
                ? '⏳ กำลังทำงาน'
                : (rawResult ? rawResult.slice(0, 100) : '-');
              return `${emoji} [${j.id.slice(0, 8)}] ${j.label}\n   Status: ${j.status} | ทุก ${intervalMin}น. | Last: ${lastRun}\n   Result: ${lastResult}`;
            },
          )
          .join('\n\n');
      } catch {
        return null;
      }
    };

    try {
      let formatted = readSnapshot();

      // If snapshot is missing or empty, wait briefly for the host to process
      // any recently submitted IPC files (race condition after add_heartbeat_job)
      if (formatted === null || formatted === '') {
        await new Promise(r => setTimeout(r, 1500));
        formatted = readSnapshot();
      }

      if (formatted === null) {
        return { content: [{ type: 'text' as const, text: 'No heartbeat jobs configured yet. Use add_heartbeat_job to create one.' }] };
      }
      if (formatted === '') {
        return { content: [{ type: 'text' as const, text: 'No heartbeat jobs configured yet. Use add_heartbeat_job to create one.' }] };
      }

      return { content: [{ type: 'text' as const, text: `Smart Heartbeat Jobs:\n\n${formatted}` }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error reading jobs: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  },
);

server.tool(
  'update_heartbeat_job',
  'Update a heartbeat job — change its prompt, label, category, interval, or pause/resume it.',
  {
    job_id: z.string().describe('The job ID (first 8 chars are enough)'),
    label: z.string().optional().describe('New label'),
    prompt: z.string().optional().describe('New prompt'),
    category: z.enum(['learning', 'monitor', 'health', 'custom']).optional().describe('New category'),
    interval_minutes: z.number().optional().describe('New interval in minutes'),
    status: z.enum(['active', 'paused']).optional().describe('Set status to active or paused'),
  },
  async (args) => {
    const data: Record<string, unknown> = {
      type: 'heartbeat_update_job',
      jobId: args.job_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    if (args.label !== undefined) data.label = args.label;
    if (args.prompt !== undefined) data.prompt = args.prompt;
    if (args.category !== undefined) data.category = args.category;
    if (args.interval_minutes !== undefined) data.interval_ms = args.interval_minutes * 60 * 1000;
    if (args.status !== undefined) data.status = args.status;

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [{ type: 'text' as const, text: `Heartbeat job ${args.job_id} update requested.` }],
    };
  },
);

server.tool(
  'remove_heartbeat_job',
  'Remove a heartbeat job permanently.',
  {
    job_id: z.string().describe('The job ID to remove (first 8 chars are enough)'),
  },
  async (args) => {
    const data = {
      type: 'heartbeat_remove_job',
      jobId: args.job_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [{ type: 'text' as const, text: `Heartbeat job ${args.job_id} removal requested.` }],
    };
  },
);

// Start the stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);

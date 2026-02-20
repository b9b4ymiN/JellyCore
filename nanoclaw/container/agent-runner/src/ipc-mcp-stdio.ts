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

const IPC_DIR = '/workspace/ipc';
const MESSAGES_DIR = path.join(IPC_DIR, 'messages');
const TASKS_DIR = path.join(IPC_DIR, 'tasks');

// IPC integrity signing secret (passed from host via container env)
const IPC_SECRET = process.env.JELLYCORE_IPC_SECRET || '';

// Context from environment variables (set by the agent runner)
const chatJid = process.env.NANOCLAW_CHAT_JID!;
const groupFolder = process.env.NANOCLAW_GROUP_FOLDER!;
const isMain = process.env.NANOCLAW_IS_MAIN === '1';

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
      const date = new Date(args.schedule_value);
      if (isNaN(date.getTime())) {
        return {
          content: [{ type: 'text' as const, text: `Invalid timestamp: "${args.schedule_value}". Use ISO 8601 format like "2026-02-01T15:30:00.000Z".` }],
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

    return {
      content: [{
        type: 'text' as const,
        text: `✅ Heartbeat job "${args.label}" added (${filename}). Category: ${args.category}, Interval: ${args.interval_minutes ?? 60} min.`,
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

    try {
      if (!fs.existsSync(jobsFile)) {
        return { content: [{ type: 'text' as const, text: 'No heartbeat jobs configured yet. Use add_heartbeat_job to create one.' }] };
      }

      const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf-8'));

      if (jobs.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No heartbeat jobs configured yet. Use add_heartbeat_job to create one.' }] };
      }

      const categoryEmoji: Record<string, string> = {
        learning: '📚',
        monitor: '📊',
        health: '🏥',
        custom: '🔧',
      };

      const formatted = jobs
        .map(
          (j: { id: string; label: string; category: string; status: string; interval_ms: number | null; last_run: string | null; last_result: string | null }) => {
            const emoji = categoryEmoji[j.category] ?? '🔧';
            const intervalMin = j.interval_ms ? j.interval_ms / 60000 : 60;
            const lastRun = j.last_run ? new Date(j.last_run).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : 'ยังไม่เคย';
            const lastResult = j.last_result ? j.last_result.slice(0, 100) : '-';
            return `${emoji} [${j.id.slice(0, 8)}] ${j.label}\n   Status: ${j.status} | ทุก ${intervalMin}น. | Last: ${lastRun}\n   Result: ${lastResult}`;
          },
        )
        .join('\n\n');

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

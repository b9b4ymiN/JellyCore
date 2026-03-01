/**
 * NanoClaw Agent Runner
 * Runs inside a container, receives config via stdin, outputs result to stdout
 *
 * Input protocol:
 *   Stdin: Full ContainerInput JSON (read until EOF, like before)
 *   IPC:   Follow-up messages written as JSON files to /workspace/ipc/input/
 *          Files: {type:"message", text:"..."}.json — polled and consumed
 *          Sentinel: /workspace/ipc/input/_close — signals session end
 *
 * Stdout protocol:
 *   Each result is wrapped in OUTPUT_START_MARKER / OUTPUT_END_MARKER pairs.
 *   Multiple results may be emitted (one per agent teams result).
 *   Final marker after loop ends signals completion.
 */

import fs from 'fs';
import path from 'path';
import { query, HookCallback, PreCompactHookInput, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';
import { fileURLToPath } from 'url';

// ESM doesn't have __dirname — derive it from import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  secrets?: Record<string, string>;
}

interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface SessionEntry {
  sessionId: string;
  fullPath: string;
  summary: string;
  firstPrompt: string;
}

interface SessionsIndex {
  entries: SessionEntry[];
}

interface SDKUserMessage {
  type: 'user';
  message: { role: 'user'; content: string };
  parent_tool_use_id: null;
  session_id: string;
}

const IPC_INPUT_DIR = '/workspace/ipc/input';
const IPC_INPUT_CLOSE_SENTINEL = path.join(IPC_INPUT_DIR, '_close');
const IPC_PROMPT_FILE = path.join(IPC_INPUT_DIR, '_prompt.txt');
const IPC_POLL_MS = 500;

// ── External MCP server config ──────────────────────────────────────────────
// Add entries to /app/config/mcps.json (rebuild image to pick up new installs).

type ExternalMcpStartupMode = 'always' | 'on_demand';

interface ExternalMcpServer {
  name: string;          // becomes mcp__<name>__* prefix
  description?: string;
  command: string;
  args: string[];
  enabled?: boolean;     // default true
  startupMode?: ExternalMcpStartupMode; // default always
  allowGroups?: string[]; // optional group.folder allowlist
  requiredEnv: string[]; // ALL must be truthy in sdkEnv for this server to load
  env: Record<string, string>; // { envVarInServer: envVarInSdkEnv }
  envLiteral?: Record<string, string>; // fixed values (from .mcp.json style env)
  source?: string;
}

interface ExternalMcpsConfig {
  servers: ExternalMcpServer[];
}

interface ExternalMcpActivation {
  server: ExternalMcpServer;
  missingEnv: string[];
  active: boolean;
  reason: string;
}

type OracleWriteMode = 'none' | 'selected' | 'full';

interface OracleWritePolicyEntry {
  mode?: OracleWriteMode;
  allow?: string[];
}

interface OracleWritePolicyConfig {
  default?: OracleWritePolicyEntry;
  groups?: Record<string, OracleWritePolicyEntry>;
}

interface McpJsonServerConfig {
  command?: string;
  args?: unknown;
  env?: Record<string, unknown>;
  description?: string;
  enabled?: boolean;
  startupMode?: ExternalMcpStartupMode;
  allowGroups?: string[];
  requiredEnv?: string[];
}

interface McpJsonConfig {
  mcpServers?: Record<string, McpJsonServerConfig>;
}

function normalizeExternalServer(raw: ExternalMcpServer): ExternalMcpServer {
  return {
    ...raw,
    enabled: raw.enabled !== false,
    startupMode: raw.startupMode === 'on_demand' ? 'on_demand' : 'always',
    allowGroups: Array.isArray(raw.allowGroups)
      ? raw.allowGroups.filter((v) => typeof v === 'string' && v.trim().length > 0)
      : [],
    requiredEnv: Array.isArray(raw.requiredEnv)
      ? raw.requiredEnv.filter((v) => typeof v === 'string' && v.trim().length > 0)
      : [],
    env: raw.env && typeof raw.env === 'object'
      ? Object.fromEntries(
          Object.entries(raw.env).filter(
            ([k, v]) => typeof k === 'string' && k.trim().length > 0 && typeof v === 'string' && v.trim().length > 0,
          ),
        )
      : {},
    envLiteral: raw.envLiteral && typeof raw.envLiteral === 'object'
      ? Object.fromEntries(
          Object.entries(raw.envLiteral).filter(
            ([k, v]) => typeof k === 'string' && k.trim().length > 0 && typeof v === 'string',
          ),
        )
      : {},
  };
}

function readExternalServersFromConfigJson(cfgPath: string): ExternalMcpServer[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as ExternalMcpsConfig;
    const servers = Array.isArray(parsed.servers) ? parsed.servers : [];
    return servers
      .filter((s) => Boolean(s?.name && s?.command && Array.isArray(s?.args)))
      .map((server) => normalizeExternalServer({ ...server, source: cfgPath }));
  } catch {
    return [];
  }
}

function parseMcpJsonEnv(rawEnv: Record<string, unknown> | undefined): {
  env: Record<string, string>;
  envLiteral: Record<string, string>;
} {
  const env: Record<string, string> = {};
  const envLiteral: Record<string, string> = {};
  if (!rawEnv || typeof rawEnv !== 'object') {
    return { env, envLiteral };
  }

  for (const [key, value] of Object.entries(rawEnv)) {
    if (typeof key !== 'string' || key.trim().length === 0) continue;
    if (typeof value !== 'string') {
      envLiteral[key] = String(value);
      continue;
    }
    const ref = value.match(/^\$\{([A-Z_][A-Z0-9_]*)\}$/);
    if (ref) {
      env[key] = ref[1];
      continue;
    }
    envLiteral[key] = value;
  }
  return { env, envLiteral };
}

function readExternalServersFromMcpJson(cfgPath: string): ExternalMcpServer[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as McpJsonConfig;
    const mcpServers = parsed?.mcpServers;
    if (!mcpServers || typeof mcpServers !== 'object') return [];

    const servers: ExternalMcpServer[] = [];
    for (const [name, cfg] of Object.entries(mcpServers)) {
      if (!cfg || typeof cfg !== 'object') continue;
      if (typeof cfg.command !== 'string' || cfg.command.trim().length === 0) continue;
      const args = Array.isArray(cfg.args)
        ? cfg.args.filter((v): v is string => typeof v === 'string')
        : [];
      const envParsed = parseMcpJsonEnv(cfg.env);

      servers.push(normalizeExternalServer({
        name,
        description: cfg.description || '',
        command: cfg.command,
        args,
        enabled: cfg.enabled !== false,
        startupMode: cfg.startupMode === 'on_demand' ? 'on_demand' : 'always',
        allowGroups: Array.isArray(cfg.allowGroups) ? cfg.allowGroups : [],
        requiredEnv: Array.isArray(cfg.requiredEnv) ? cfg.requiredEnv : [],
        env: envParsed.env,
        envLiteral: envParsed.envLiteral,
        source: cfgPath,
      }));
    }

    return servers;
  } catch {
    return [];
  }
}

function loadExternalMcps(): ExternalMcpsConfig {
  const serverMap = new Map<string, ExternalMcpServer>();
  const sources: Array<{ kind: 'config' | 'mcp'; path: string }> = [
    { kind: 'config', path: path.join('/app/config/mcps.json') },
    // Optional per-session override in persistent .claude dir
    { kind: 'mcp', path: path.join('/home/node/.claude/.mcp.json') },
    // Per-group workspace override (mounted from groups/<folder>/)
    { kind: 'mcp', path: path.join('/workspace/group/.mcp.json') },
  ];

  for (const source of sources) {
    if (!fs.existsSync(source.path)) continue;
    const loaded = source.kind === 'config'
      ? readExternalServersFromConfigJson(source.path)
      : readExternalServersFromMcpJson(source.path);
    for (const server of loaded) {
      const previous = serverMap.get(server.name);
      if (previous && previous.source !== server.source) {
        log(`External MCP '${server.name}' overridden by ${server.source}`);
      }
      serverMap.set(server.name, server);
    }
  }

  return { servers: [...serverMap.values()] };
}

function loadOracleWritePolicy(): OracleWritePolicyConfig {
  try {
    const cfgPath = path.join('/app/config/oracle-write-policy.json');
    return JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as OracleWritePolicyConfig;
  } catch {
    return {};
  }
}

const externalMcps = loadExternalMcps();
const oracleWritePolicy = loadOracleWritePolicy();

function parseNameSet(raw: string | undefined): Set<string> {
  return new Set(
    (raw || '')
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  );
}

function evaluateExternalMcpServers(
  sdkEnv: Record<string, string | undefined>,
  groupFolder: string,
): ExternalMcpActivation[] {
  const envDisabled = parseNameSet(sdkEnv.NANOCLAW_EXTERNAL_MCP_DISABLED);

  return externalMcps.servers.map((server) => {
    const missingEnv = server.requiredEnv.filter((v) => !sdkEnv[v]);
    const allowGroups = server.allowGroups || [];

    if (envDisabled.has(server.name.toLowerCase())) {
      return {
        server,
        missingEnv,
        active: false,
        reason: 'disabled by env override',
      };
    }
    if (server.enabled === false) {
      return {
        server,
        missingEnv,
        active: false,
        reason: 'disabled by config',
      };
    }
    if (allowGroups.length > 0 && !allowGroups.includes(groupFolder)) {
      return {
        server,
        missingEnv,
        active: false,
        reason: `group '${groupFolder}' not allowed`,
      };
    }
    if (server.startupMode === 'on_demand') {
      return {
        server,
        missingEnv,
        active: false,
        reason: 'startupMode=on_demand',
      };
    }
    if (missingEnv.length > 0) {
      return {
        server,
        missingEnv,
        active: false,
        reason: `missing required env: ${missingEnv.join(', ')}`,
      };
    }
    return {
      server,
      missingEnv,
      active: true,
      reason: 'ready',
    };
  });
}

function buildExternalMcpServers(
  evaluations: ExternalMcpActivation[],
  sdkEnv: Record<string, string | undefined>,
): Record<string, { command: string; args: string[]; env: Record<string, string> }> {
  const result: Record<string, { command: string; args: string[]; env: Record<string, string> }> = {};
  for (const evaluation of evaluations) {
    if (!evaluation.active) continue;
    const { server } = evaluation;
    const envResolved = {
      ...Object.fromEntries(
        Object.entries(server.env).map(([k, v]) => [k, sdkEnv[v] || '']),
      ),
      ...(server.envLiteral || {}),
    };
    result[server.name] = {
      command: server.command,
      args: server.args,
      env: envResolved,
    };
  }
  return result;
}

function externalMcpAllowedTools(evaluations: ExternalMcpActivation[]): string[] {
  return evaluations
    .filter((e) => e.active)
    .map((e) => `mcp__${e.server.name}__*`);
}

function normalizeOracleWriteMode(mode: string | undefined): OracleWriteMode {
  if (mode === 'none' || mode === 'selected') return mode;
  return 'full';
}

function defaultSelectedWriteTools(): string[] {
  return [
    'oracle_user_model_update',
    'oracle_procedural_learn',
    'oracle_procedural_usage',
    'oracle_episodic_record',
  ];
}

function resolveOracleWritePolicy(
  groupFolder: string,
  isMain: boolean,
): { mode: OracleWriteMode; allow: string[] } {
  const fallback: { mode: OracleWriteMode; allow: string[] } = isMain
    ? { mode: 'full', allow: ['*'] }
    : { mode: 'selected', allow: defaultSelectedWriteTools() };

  const selected = oracleWritePolicy.groups?.[groupFolder]
    || (isMain ? oracleWritePolicy.groups?.main : undefined)
    || oracleWritePolicy.default;
  if (!selected) return fallback;

  const mode = normalizeOracleWriteMode(selected.mode);
  const allow = Array.isArray(selected.allow)
    ? selected.allow.filter((v) => typeof v === 'string' && v.trim().length > 0)
    : fallback.allow;
  return { mode, allow };
}

/**
 * Push-based async iterable for streaming user messages to the SDK.
 * Keeps the iterable alive until end() is called, preventing isSingleUserTurn.
 */
class MessageStream {
  private queue: SDKUserMessage[] = [];
  private waiting: (() => void) | null = null;
  private done = false;

  push(text: string): void {
    this.queue.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: '',
    });
    this.waiting?.();
  }

  end(): void {
    this.done = true;
    this.waiting?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    while (true) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      if (this.done) return;
      await new Promise<void>(r => { this.waiting = r; });
      this.waiting = null;
    }
  }
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}

function getSessionSummary(sessionId: string, transcriptPath: string): string | null {
  const projectDir = path.dirname(transcriptPath);
  const indexPath = path.join(projectDir, 'sessions-index.json');

  if (!fs.existsSync(indexPath)) {
    log(`Sessions index not found at ${indexPath}`);
    return null;
  }

  try {
    const index: SessionsIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const entry = index.entries.find(e => e.sessionId === sessionId);
    if (entry?.summary) {
      return entry.summary;
    }
  } catch (err) {
    log(`Failed to read sessions index: ${err instanceof Error ? err.message : String(err)}`);
  }

  return null;
}

/**
 * Archive the full transcript to conversations/ before compaction.
 */
function createPreCompactHook(): HookCallback {
  return async (input, _toolUseId, _context) => {
    const preCompact = input as PreCompactHookInput;
    const transcriptPath = preCompact.transcript_path;
    const sessionId = preCompact.session_id;

    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
      log('No transcript found for archiving');
      return {};
    }

    try {
      const content = fs.readFileSync(transcriptPath, 'utf-8');
      const messages = parseTranscript(content);

      if (messages.length === 0) {
        log('No messages to archive');
        return {};
      }

      const summary = getSessionSummary(sessionId, transcriptPath);
      const name = summary ? sanitizeFilename(summary) : generateFallbackName();

      const conversationsDir = '/workspace/group/conversations';
      fs.mkdirSync(conversationsDir, { recursive: true });

      const date = new Date().toISOString().split('T')[0];
      const filename = `${date}-${name}.md`;
      const filePath = path.join(conversationsDir, filename);

      const markdown = formatTranscriptMarkdown(messages, summary);
      fs.writeFileSync(filePath, markdown);

      log(`Archived conversation to ${filePath}`);
    } catch (err) {
      log(`Failed to archive transcript: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {};
  };
}

// Secrets to strip from Bash tool subprocess environments.
// These are needed by claude-code for API auth but should never
// be visible to commands Kit runs.
const SECRET_ENV_VARS = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'];

function createSanitizeBashHook(): HookCallback {
  return async (input, _toolUseId, _context) => {
    const preInput = input as PreToolUseHookInput;
    const command = (preInput.tool_input as { command?: string })?.command;
    if (!command) return {};

    const unsetPrefix = `unset ${SECRET_ENV_VARS.join(' ')} 2>/dev/null; `;
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        updatedInput: {
          ...(preInput.tool_input as Record<string, unknown>),
          command: unsetPrefix + command,
        },
      },
    };
  };
}

function sanitizeFilename(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function generateFallbackName(): string {
  const time = new Date();
  return `conversation-${time.getHours().toString().padStart(2, '0')}${time.getMinutes().toString().padStart(2, '0')}`;
}

interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
}

function parseTranscript(content: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'user' && entry.message?.content) {
        const text = typeof entry.message.content === 'string'
          ? entry.message.content
          : entry.message.content.map((c: { text?: string }) => c.text || '').join('');
        if (text) messages.push({ role: 'user', content: text });
      } else if (entry.type === 'assistant' && entry.message?.content) {
        const textParts = entry.message.content
          .filter((c: { type: string }) => c.type === 'text')
          .map((c: { text: string }) => c.text);
        const text = textParts.join('');
        if (text) messages.push({ role: 'assistant', content: text });
      }
    } catch {
    }
  }

  return messages;
}

function formatTranscriptMarkdown(messages: ParsedMessage[], title?: string | null): string {
  const now = new Date();
  const formatDateTime = (d: Date) => d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  const lines: string[] = [];
  lines.push(`# ${title || 'Conversation'}`);
  lines.push('');
  lines.push(`Archived: ${formatDateTime(now)}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of messages) {
    const sender = msg.role === 'user' ? 'User' : 'Andy';
    const content = msg.content.length > 2000
      ? msg.content.slice(0, 2000) + '...'
      : msg.content;
    lines.push(`**${sender}**: ${content}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Check for _close sentinel.
 */
function shouldClose(): boolean {
  if (fs.existsSync(IPC_INPUT_CLOSE_SENTINEL)) {
    try { fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL); } catch { /* ignore */ }
    return true;
  }
  return false;
}

/**
 * Drain all pending IPC input messages.
 * Returns messages found, or empty array.
 */
function drainIpcInput(): string[] {
  try {
    fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });
    const files = fs.readdirSync(IPC_INPUT_DIR)
      .filter(f => f.endsWith('.json'))
      .sort();

    const messages: string[] = [];
    for (const file of files) {
      const filePath = path.join(IPC_INPUT_DIR, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        fs.unlinkSync(filePath);
        if (data.type === 'message' && data.text) {
          messages.push(data.text);
        }
      } catch (err) {
        log(`Failed to process input file ${file}: ${err instanceof Error ? err.message : String(err)}`);
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    }
    return messages;
  } catch (err) {
    log(`IPC drain error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Wait for a new IPC message or _close sentinel.
 * Returns the messages as a single string, or null if _close.
 */
function waitForIpcMessage(): Promise<string | null> {
  return new Promise((resolve) => {
    const poll = () => {
      if (shouldClose()) {
        resolve(null);
        return;
      }
      const messages = drainIpcInput();
      if (messages.length > 0) {
        resolve(messages.join('\n'));
        return;
      }
      setTimeout(poll, IPC_POLL_MS);
    };
    poll();
  });
}

/**
 * Run a single query and stream results via writeOutput.
 * Uses MessageStream (AsyncIterable) to keep isSingleUserTurn=false,
 * allowing agent teams subagents to run to completion.
 * Also pipes IPC messages into the stream during the query.
 */
async function runQuery(
  prompt: string,
  sessionId: string | undefined,
  mcpServerPath: string,
  containerInput: ContainerInput,
  sdkEnv: Record<string, string | undefined>,
  resumeAt?: string,
): Promise<{ newSessionId?: string; lastAssistantUuid?: string; closedDuringQuery: boolean }> {
  const stream = new MessageStream();
  stream.push(prompt);

  // Poll IPC for follow-up messages and _close sentinel during the query
  let ipcPolling = true;
  let closedDuringQuery = false;
  const pollIpcDuringQuery = () => {
    if (!ipcPolling) return;
    if (shouldClose()) {
      log('Close sentinel detected during query, ending stream');
      closedDuringQuery = true;
      stream.end();
      ipcPolling = false;
      return;
    }
    const messages = drainIpcInput();
    for (const text of messages) {
      log(`Piping IPC message into active query (${text.length} chars)`);
      stream.push(text);
    }
    setTimeout(pollIpcDuringQuery, IPC_POLL_MS);
  };
  setTimeout(pollIpcDuringQuery, IPC_POLL_MS);

  let newSessionId: string | undefined;
  let lastAssistantUuid: string | undefined;
  let messageCount = 0;
  let resultCount = 0;

  // Load global personality files (shared across all groups)
  // Priority: SOUL.md (identity/personality) → CLAUDE.md (capabilities/tools)
  const globalFiles = [
    '/workspace/global/SOUL.md',
    '/workspace/global/CLAUDE.md',
  ];
  const globalContext: string[] = [];
  for (const filePath of globalFiles) {
    if (!containerInput.isMain && fs.existsSync(filePath)) {
      globalContext.push(fs.readFileSync(filePath, 'utf-8'));
    }
  }
  const globalAppendBase = globalContext.length > 0 ? globalContext.join('\n\n---\n\n') : undefined;

  // Discover additional directories mounted at /workspace/extra/*
  // These are passed to the SDK so their CLAUDE.md files are loaded automatically
  const extraDirs: string[] = [];
  const extraBase = '/workspace/extra';
  if (fs.existsSync(extraBase)) {
    for (const entry of fs.readdirSync(extraBase)) {
      const fullPath = path.join(extraBase, entry);
      if (fs.statSync(fullPath).isDirectory()) {
        extraDirs.push(fullPath);
      }
    }
  }
  if (extraDirs.length > 0) {
    log(`Additional directories: ${extraDirs.join(', ')}`);
  }

  const resolvedOraclePolicy = resolveOracleWritePolicy(
    containerInput.groupFolder,
    containerInput.isMain,
  );
  log(
    `Oracle write policy: mode=${resolvedOraclePolicy.mode} allow=${resolvedOraclePolicy.allow.join(',') || '(none)'}`,
  );
  const externalMcpEvaluations = evaluateExternalMcpServers(
    sdkEnv,
    containerInput.groupFolder,
  );
  if (externalMcpEvaluations.length > 0) {
    const active = externalMcpEvaluations.filter((e) => e.active);
    const inactive = externalMcpEvaluations.filter((e) => !e.active);
    log(`External MCP active ${active.length}/${externalMcpEvaluations.length}`);
    if (inactive.length > 0) {
      log(
        `External MCP inactive: ${inactive.map((e) => `${e.server.name}(${e.reason})`).join(', ')}`,
      );
    }
  }
  const activeExternalServers = externalMcpEvaluations.filter((e) => e.active);
  const inactiveExternalServers = externalMcpEvaluations.filter((e) => !e.active);
  const runtimeMcpAppend = [
    'Runtime MCP configuration for this session:',
    '- Core namespaces: mcp__nanoclaw__*, mcp__oracle__*',
    `- External configured-to-load: ${
      activeExternalServers.length > 0
        ? activeExternalServers.map((e) => `mcp__${e.server.name}__*`).join(', ')
        : '(none)'
    }`,
    `- External not configured-to-load: ${
      inactiveExternalServers.length > 0
        ? inactiveExternalServers.map((e) => `${e.server.name} (${e.reason})`).join(', ')
        : '(none)'
    }`,
    'Important: configured-to-load does not guarantee successful MCP handshake. If tool/function list in-session is missing a configured MCP, explicitly report it as configured but currently unavailable.',
  ].join('\n');
  const globalAppend = [globalAppendBase, runtimeMcpAppend]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .join('\n\n---\n\n');

  for await (const message of query({
    prompt: stream,
    options: {
      cwd: '/workspace/group',
      additionalDirectories: extraDirs.length > 0 ? extraDirs : undefined,
      resume: sessionId,
      resumeSessionAt: resumeAt,
      systemPrompt: globalAppend
        ? { type: 'preset' as const, preset: 'claude_code' as const, append: globalAppend }
        : undefined,
      allowedTools: [
        'Bash',
        'Read', 'Write', 'Edit', 'Glob', 'Grep',
        'WebSearch', 'WebFetch',
        'Task', 'TaskOutput', 'TaskStop',
        'TeamCreate', 'TeamDelete', 'SendMessage',
        'TodoWrite', 'ToolSearch', 'Skill',
        'NotebookEdit',
        'mcp__nanoclaw__*',
        'mcp__oracle__*',
        ...externalMcpAllowedTools(externalMcpEvaluations),
      ],
      env: sdkEnv,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: ['project', 'user'],
      mcpServers: {
        nanoclaw: {
          command: 'node',
          args: [mcpServerPath],
          env: {
            NANOCLAW_CHAT_JID: containerInput.chatJid,
            NANOCLAW_GROUP_FOLDER: containerInput.groupFolder,
            NANOCLAW_IS_MAIN: containerInput.isMain ? '1' : '0',
          },
        },
        oracle: {
          command: 'node',
          args: [path.join(__dirname, 'oracle-mcp-http.js')],
          env: {
            ORACLE_API_URL: process.env.ORACLE_API_URL || 'http://oracle:47778',
            ORACLE_AUTH_TOKEN: process.env.ORACLE_AUTH_TOKEN || '',
            ORACLE_WRITE_MODE: resolvedOraclePolicy.mode,
            ORACLE_ALLOWED_WRITE_TOOLS: resolvedOraclePolicy.allow.join(','),
            ORACLE_POLICY_GROUP: containerInput.groupFolder,
            NANOCLAW_CHAT_JID: containerInput.chatJid,
          },
        },
        // External MCP servers — loaded from /app/config/mcps.json
        // Activation policy: enabled + allowGroups + startupMode + requiredEnv + env override
        ...buildExternalMcpServers(externalMcpEvaluations, sdkEnv),
      },
      hooks: {
        PreCompact: [{ hooks: [createPreCompactHook()] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [createSanitizeBashHook()] }],
      },
    }
  })) {
    messageCount++;
    const msgType = message.type === 'system' ? `system/${(message as { subtype?: string }).subtype}` : message.type;
    log(`[msg #${messageCount}] type=${msgType}`);
    if (message.type === 'system') {
      const sys = message as { subtype?: string };
      if (sys.subtype === 'mcp_status' || sys.subtype === 'mcp_message') {
        log(`MCP event (${sys.subtype}): ${JSON.stringify(message)}`);
      }
    }

    if (message.type === 'assistant' && 'uuid' in message) {
      lastAssistantUuid = (message as { uuid: string }).uuid;
    }

    if (message.type === 'system' && message.subtype === 'init') {
      newSessionId = message.session_id;
      log(`Session initialized: ${newSessionId}`);
    }

    if (message.type === 'system' && (message as { subtype?: string }).subtype === 'task_notification') {
      const tn = message as { task_id: string; status: string; summary: string };
      log(`Task notification: task=${tn.task_id} status=${tn.status} summary=${tn.summary}`);
    }

    if (message.type === 'result') {
      resultCount++;
      const textResult = 'result' in message ? (message as { result?: string }).result : null;
      log(`Result #${resultCount}: subtype=${message.subtype}${textResult ? ` text=${textResult.slice(0, 200)}` : ''}`);
      writeOutput({
        status: 'success',
        result: textResult || null,
        newSessionId
      });
    }
  }

  ipcPolling = false;
  log(`Query done. Messages: ${messageCount}, results: ${resultCount}, lastAssistantUuid: ${lastAssistantUuid || 'none'}, closedDuringQuery: ${closedDuringQuery}`);
  return { newSessionId, lastAssistantUuid, closedDuringQuery };
}

/**
 * Auto-record an episodic memory summary when conversation ends.
 * Fire-and-forget: Oracle failure doesn't block exit.
 */
async function recordEpisode(groupFolder: string, isMain: boolean): Promise<void> {
  const oracleUrl = process.env.ORACLE_API_URL || 'http://oracle:47778';
  const oracleToken = process.env.ORACLE_AUTH_TOKEN || '';
  const policy = resolveOracleWritePolicy(groupFolder, isMain);
  const canWriteEpisode = policy.mode === 'full'
    || (policy.mode === 'selected' && policy.allow.includes('oracle_episodic_record'));

  if (!canWriteEpisode) {
    log('Skipping auto-episodic: policy does not allow oracle_episodic_record');
    return;
  }

  // Collect user messages and assistant responses from conversation files
  const conversationsDir = '/workspace/group/conversations';
  let userMessages: string[] = [];
  let assistantMessages: string[] = [];

  // Try to read from most recent conversation archive
  try {
    if (fs.existsSync(conversationsDir)) {
      const files = fs.readdirSync(conversationsDir)
        .filter(f => f.endsWith('.md'))
        .sort()
        .reverse();

      if (files.length > 0) {
        const content = fs.readFileSync(path.join(conversationsDir, files[0]), 'utf-8');
        const lines = content.split('\n');
        for (const line of lines) {
          if (line.startsWith('**User**: ')) {
            userMessages.push(line.replace('**User**: ', '').slice(0, 200));
          } else if (line.startsWith('**Andy**: ')) {
            assistantMessages.push(line.replace('**Andy**: ', '').slice(0, 200));
          }
        }
      }
    }
  } catch (err) {
    log(`Failed to read conversations for episode: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Build compact summary
  const topicHints = userMessages.slice(0, 3).join(' | ');
  const outcome = assistantMessages.length > 0
    ? assistantMessages[assistantMessages.length - 1].slice(0, 200)
    : 'no recorded response';

  const summary = `[${groupFolder}] Topics: ${topicHints || 'general conversation'}. Outcome: ${outcome}`;

  if (!topicHints && !outcome) {
    log('No conversation content to record as episode');
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${oracleUrl}/api/episodic`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(oracleToken ? { 'Authorization': `Bearer ${oracleToken}` } : {}),
      },
      body: JSON.stringify({
        summary: summary.slice(0, 800),
        group: groupFolder,
        participants: ['user', 'assistant'],
        key_topics: userMessages.slice(0, 5).map(m => m.slice(0, 50)),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    log(`Auto-episodic recorded: ${response.ok ? 'success' : `error ${response.status}`}`);
  } catch (err) {
    log(`Auto-episodic failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<void> {
  let containerInput: ContainerInput;

  try {
    const stdinData = await readStdin();
    containerInput = JSON.parse(stdinData);
    // Delete the temp file the entrypoint wrote — it contains secrets
    try { fs.unlinkSync('/tmp/input.json'); } catch { /* may not exist */ }
    log(`Received input for group: ${containerInput.groupFolder}`);
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`
    });
    process.exit(1);
  }

  // Build SDK env: merge secrets into process.env for the SDK only.
  // Secrets never touch process.env itself, so Bash subprocesses can't see them.
  const sdkEnv: Record<string, string | undefined> = { ...process.env };
  for (const [key, value] of Object.entries(containerInput.secrets || {})) {
    sdkEnv[key] = value;
  }

  const mcpServerPath = path.join(__dirname, 'ipc-mcp-stdio.js');

  let sessionId = containerInput.sessionId;
  fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });

  // Clean up stale _close sentinel from previous container runs
  try { fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL); } catch { /* ignore */ }

  // Build initial prompt (drain any pending IPC messages too)
  let prompt = containerInput.prompt;

  // Resolve __IPC_PROMPT__ sentinel — the actual prompt is in the IPC prompt file
  // (Container-runner writes large prompts to disk instead of passing via stdin)
  if (prompt === '__IPC_PROMPT__') {
    try {
      prompt = fs.readFileSync(IPC_PROMPT_FILE, 'utf-8');
      fs.unlinkSync(IPC_PROMPT_FILE); // consumed — remove
      log(`Read prompt from IPC file (${prompt.length} chars)`);
    } catch (err) {
      log(`Warning: __IPC_PROMPT__ sentinel but no prompt file found: ${err}`);
      // Fall through — empty prompt will likely produce an error from the SDK
    }
  }
  if (containerInput.isScheduledTask) {
    prompt = `[SCHEDULED TASK - The following message was sent automatically and is not coming directly from the user or group.]\n\n${prompt}`;
  }
  const pending = drainIpcInput();
  if (pending.length > 0) {
    log(`Draining ${pending.length} pending IPC messages into initial prompt`);
    prompt += '\n' + pending.join('\n');
  }

  // Query loop: run query → wait for IPC message → run new query → repeat
  let resumeAt: string | undefined;
  try {
    while (true) {
      log(`Starting query (session: ${sessionId || 'new'}, resumeAt: ${resumeAt || 'latest'})...`);

      const queryResult = await runQuery(prompt, sessionId, mcpServerPath, containerInput, sdkEnv, resumeAt);
      if (queryResult.newSessionId) {
        sessionId = queryResult.newSessionId;
      }
      if (queryResult.lastAssistantUuid) {
        resumeAt = queryResult.lastAssistantUuid;
      }

      // If _close was consumed during the query, exit immediately.
      // Don't emit a session-update marker (it would reset the host's
      // idle timer and cause a 30-min delay before the next _close).
      if (queryResult.closedDuringQuery) {
        log('Close sentinel consumed during query, recording episode then exiting');
        await recordEpisode(containerInput.groupFolder, containerInput.isMain);
        break;
      }

      // Emit session update so host can track it
      writeOutput({ status: 'success', result: null, newSessionId: sessionId });

      log('Query ended, waiting for next IPC message...');

      // Wait for the next message or _close sentinel
      const nextMessage = await waitForIpcMessage();
      if (nextMessage === null) {
        log('Close sentinel received, recording episode then exiting');
        await recordEpisode(containerInput.groupFolder, containerInput.isMain);
        break;
      }

      log(`Got new message (${nextMessage.length} chars), starting new query`);
      prompt = nextMessage;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`Agent error: ${errorMessage}`);
    writeOutput({
      status: 'error',
      result: null,
      newSessionId: sessionId,
      error: errorMessage
    });
    process.exit(1);
  }
}

main();

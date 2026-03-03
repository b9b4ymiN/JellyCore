import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface CodexRunResult {
  status: 'success' | 'error';
  result: string | null;
  error?: string;
}

export interface CodexMcpServerConfig {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  bearerTokenEnvVar?: string;
}

interface CodexJsonLine {
  type?: string;
  msg?: {
    type?: string;
    message?: string;
  };
  message?: string;
  item?: {
    type?: string;
    text?: string;
    message?: string;
  };
  error?: {
    message?: string;
  };
}

const CODEX_AUTH_FILE = '/home/node/.codex/auth.json';
const CODEX_CONFIG_FILE = '/home/node/.codex/config.toml';
const GENERATED_MCP_BEGIN = '# BEGIN NANOCLAW MCP SERVERS';
const GENERATED_MCP_END = '# END NANOCLAW MCP SERVERS';

interface AuthJson {
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    account_id?: string;
  };
}

function stripUtf8Bom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function validateAuthJson(): { ok: true } | { ok: false; reason: string } {
  if (!fs.existsSync(CODEX_AUTH_FILE)) {
    return { ok: false, reason: 'missing_auth_file' };
  }

  try {
    const raw = fs.readFileSync(CODEX_AUTH_FILE, 'utf-8');
    const parsed = JSON.parse(stripUtf8Bom(raw)) as AuthJson;
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
      return { ok: false, reason: 'missing_tokens_fields' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
}

function parseCodexJsonOutput(stdout: string): string | null {
  const messages: string[] = [];
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as CodexJsonLine;
      if (parsed.msg?.type === 'agent_message' && typeof parsed.msg.message === 'string') {
        const text = parsed.msg.message.trim();
        if (text) messages.push(text);
      }
      if (
        parsed.type === 'item.completed'
        && parsed.item?.type === 'agent_message'
      ) {
        const text = (parsed.item.text || parsed.item.message || '').trim();
        if (text) messages.push(text);
      }
    } catch {
      // Ignore non-JSON or malformed lines.
    }
  }

  if (messages.length === 0) return null;
  return messages.join('\n\n').trim();
}

function extractCodexErrorFromJson(stdout: string): string | null {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines.reverse()) {
    try {
      const parsed = JSON.parse(line) as CodexJsonLine;
      if (parsed.error?.message && parsed.error.message.trim()) {
        return parsed.error.message.trim();
      }
      if (parsed.type === 'error' && parsed.message && parsed.message.trim()) {
        return parsed.message.trim();
      }
    } catch {
      // Ignore malformed JSON lines.
    }
  }
  return null;
}

function isAuthFailure(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('401')
    || lower.includes('unauthorized')
    || lower.includes('missing bearer')
    || lower.includes('invalid api key')
    || lower.includes('authentication')
  );
}

function escapeTomlString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function sanitizeMcpName(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9_-]/g, '_');
}

function tomlStringArray(values: string[]): string {
  return `[${values.map((value) => `"${escapeTomlString(value)}"`).join(', ')}]`;
}

function buildMcpToml(
  mcpServers: Record<string, CodexMcpServerConfig>,
): string {
  const lines: string[] = [GENERATED_MCP_BEGIN];
  const entries = Object.entries(mcpServers)
    .filter(([name, cfg]) => name.trim().length > 0 && (Boolean(cfg.command) || Boolean(cfg.url)))
    .sort(([a], [b]) => a.localeCompare(b));

  for (const [rawName, server] of entries) {
    const name = sanitizeMcpName(rawName);
    lines.push(`[mcp_servers.${name}]`);
    if (server.url) {
      lines.push(`url = "${escapeTomlString(server.url)}"`);
      if (server.bearerTokenEnvVar) {
        lines.push(`bearer_token_env_var = "${escapeTomlString(server.bearerTokenEnvVar)}"`);
      }
    } else if (server.command) {
      lines.push(`command = "${escapeTomlString(server.command)}"`);
      lines.push(`args = ${tomlStringArray(server.args || [])}`);
    }
    const envEntries = Object.entries(server.env || {}).filter(([k]) => k.trim().length > 0);
    if (envEntries.length > 0) {
      lines.push('');
      lines.push(`[mcp_servers.${name}.env]`);
      for (const [key, value] of envEntries.sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`${key} = "${escapeTomlString(value)}"`);
      }
    }
    lines.push('');
  }
  lines.push(GENERATED_MCP_END);
  return lines.join('\n').trim() + '\n';
}

function upsertGeneratedMcpBlock(
  originalContent: string,
  generatedBlock: string,
): string {
  const start = originalContent.indexOf(GENERATED_MCP_BEGIN);
  const end = originalContent.indexOf(GENERATED_MCP_END);

  if (start !== -1 && end !== -1 && end > start) {
    const before = originalContent.slice(0, start).replace(/\s*$/, '');
    const after = originalContent.slice(end + GENERATED_MCP_END.length).replace(/^\s*/, '');
    const parts = [before, generatedBlock.trim(), after].filter((part) => part.length > 0);
    return parts.join('\n\n').trim() + '\n';
  }

  const trimmed = originalContent.trim();
  if (trimmed.length === 0) {
    return generatedBlock;
  }
  return `${trimmed}\n\n${generatedBlock}`;
}

function ensureCodexMcpConfig(
  mcpServers: Record<string, CodexMcpServerConfig> | undefined,
): void {
  if (!mcpServers || Object.keys(mcpServers).length === 0) return;

  const generated = buildMcpToml(mcpServers);
  if (!generated.includes('[mcp_servers.')) return;

  fs.mkdirSync(path.dirname(CODEX_CONFIG_FILE), { recursive: true });
  const existing = fs.existsSync(CODEX_CONFIG_FILE)
    ? fs.readFileSync(CODEX_CONFIG_FILE, 'utf-8')
    : '';
  const merged = upsertGeneratedMcpBlock(existing, generated);
  fs.writeFileSync(CODEX_CONFIG_FILE, merged, { encoding: 'utf-8' });
}

export async function runCodexPrompt(
  prompt: string,
  options: {
    model: string;
    timeoutMs: number;
    cwd?: string;
    env?: Record<string, string | undefined>;
    mcpServers?: Record<string, CodexMcpServerConfig>;
    log?: (message: string) => void;
  },
): Promise<CodexRunResult> {
  const auth = validateAuthJson();
  if (!auth.ok) {
    return {
      status: 'error',
      result: null,
      error: `codex_auth_blocked:${auth.reason}`,
    };
  }

  try {
    ensureCodexMcpConfig(options.mcpServers);
    const mcpNames = Object.keys(options.mcpServers || {}).sort();
    if (options.log) {
      options.log(
        `Codex MCP config applied: ${mcpNames.length > 0 ? mcpNames.join(', ') : '(none)'}`,
      );
    }
  } catch (err) {
    return {
      status: 'error',
      result: null,
      error: `codex_runtime_unavailable:codex_config_error:${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const args = [
    'exec',
    '--skip-git-repo-check',
    '-C',
    options.cwd || '/workspace/group',
    '--json',
    '--model',
    options.model,
    '-c',
    'model_reasoning_effort="medium"',
    '-',
  ];

  const childEnv: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const [key, value] of Object.entries(options.env || {})) {
    if (typeof value === 'string') {
      childEnv[key] = value;
    }
  }

  return new Promise<CodexRunResult>((resolve) => {
    const proc = spawn('codex', args, {
      cwd: options.cwd || '/workspace/group',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, Math.max(5_000, options.timeoutMs));

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        status: 'error',
        result: null,
        error: `codex_spawn_error:${err.message}`,
      });
    });

    proc.on('close', (code) => {
      clearTimeout(timer);

      if (timedOut) {
        resolve({
          status: 'error',
          result: null,
          error: 'codex_timeout',
        });
        return;
      }

      if (code !== 0) {
        const stderrTail = stderr.trim().slice(-500);
        const stdoutError = extractCodexErrorFromJson(stdout);
        const errorText = (stderrTail || stdoutError || 'unknown').trim();
        if (errorText.includes('Not inside a trusted directory')) {
          resolve({
            status: 'error',
            result: null,
            error: `codex_repo_trust_blocked:${errorText}`,
          });
          return;
        }
        if (isAuthFailure(errorText)) {
          resolve({
            status: 'error',
            result: null,
            error: `codex_auth_blocked:unauthorized:${errorText}`,
          });
          return;
        }
        resolve({
          status: 'error',
          result: null,
          error: `codex_exit_${code}:${errorText}`,
        });
        return;
      }

      const resultText = parseCodexJsonOutput(stdout);
      if (!resultText) {
        resolve({
          status: 'error',
          result: null,
          error: `codex_output_parse_error:${stderr.trim().slice(-300) || 'empty_json_stream'}`,
        });
        return;
      }

      resolve({
        status: 'success',
        result: resultText,
      });
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

export function codexAuthFilePath(): string {
  return path.resolve(CODEX_AUTH_FILE);
}

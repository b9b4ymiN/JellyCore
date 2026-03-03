import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface CodexRunResult {
  status: 'success' | 'error';
  result: string | null;
  error?: string;
}

interface CodexJsonLine {
  msg?: {
    type?: string;
    message?: string;
  };
}

const CODEX_AUTH_FILE = '/home/node/.codex/auth.json';

interface AuthJson {
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    account_id?: string;
  };
}

function validateAuthJson(): { ok: true } | { ok: false; reason: string } {
  if (!fs.existsSync(CODEX_AUTH_FILE)) {
    return { ok: false, reason: 'missing_auth_file' };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(CODEX_AUTH_FILE, 'utf-8')) as AuthJson;
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
    } catch {
      // Ignore non-JSON or malformed lines.
    }
  }

  if (messages.length === 0) return null;
  return messages.join('\n\n').trim();
}

export async function runCodexPrompt(
  prompt: string,
  options: {
    model: string;
    timeoutMs: number;
    cwd?: string;
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

  const args = [
    'exec',
    '--json',
    '--model',
    options.model,
    '-c',
    'model_reasoning_effort="medium"',
    '-',
  ];

  return new Promise<CodexRunResult>((resolve) => {
    const proc = spawn('codex', args, {
      cwd: options.cwd || '/workspace/group',
      stdio: ['pipe', 'pipe', 'pipe'],
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
        resolve({
          status: 'error',
          result: null,
          error: `codex_exit_${code}:${stderr.trim().slice(-500) || 'unknown'}`,
        });
        return;
      }

      const resultText = parseCodexJsonOutput(stdout);
      if (!resultText) {
        resolve({
          status: 'error',
          result: null,
          error: `codex_no_output:${stderr.trim().slice(-300) || 'empty_json_stream'}`,
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


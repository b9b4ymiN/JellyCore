import crypto from 'crypto';

import { query } from '@anthropic-ai/claude-agent-sdk';

export type LLMProviderId = 'claude' | 'openai' | 'ollama';

export interface LLMProviderSystemPrompt {
  type: 'preset';
  preset: 'claude_code';
  append: string;
}

export interface LLMProviderMcpServer {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface LLMProviderRunInput {
  prompt: string;
  promptStream: AsyncIterable<unknown>;
  sessionId?: string;
  resumeAt?: string;
  cwd: string;
  additionalDirectories?: string[];
  systemPrompt?: LLMProviderSystemPrompt;
  allowedTools: string[];
  sdkEnv: Record<string, string | undefined>;
  mcpServers: Record<string, LLMProviderMcpServer>;
  hooks: Record<string, unknown>;
}

export interface LLMProviderEvent {
  type: string;
  [key: string]: unknown;
}

export interface LLMProvider {
  id: LLMProviderId;
  supportsMcp: boolean;
  run(input: LLMProviderRunInput): AsyncIterable<LLMProviderEvent>;
}

function randomId(prefix: string): string {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${crypto.randomBytes(16).toString('hex')}`;
}

function ensureTrailingSlashRemoved(raw: string): string {
  return raw.replace(/\/+$/, '');
}

function flattenOpenAIContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    const maybeText = (item as Record<string, unknown>).text;
    if (typeof maybeText === 'string' && maybeText.length > 0) {
      parts.push(maybeText);
    }
  }
  return parts.join('\n');
}

function pickProviderId(env: Record<string, string | undefined>): LLMProviderId {
  const raw = (env.LLM_PROVIDER || env.NANOCLAW_LLM_PROVIDER || 'claude').toLowerCase().trim();
  if (raw === 'openai') return 'openai';
  if (raw === 'ollama') return 'ollama';
  return 'claude';
}

class ClaudeProvider implements LLMProvider {
  id: LLMProviderId = 'claude';
  supportsMcp = true;

  run(input: LLMProviderRunInput): AsyncIterable<LLMProviderEvent> {
    return query({
      prompt: input.promptStream as any,
      options: {
        cwd: input.cwd,
        additionalDirectories:
          input.additionalDirectories && input.additionalDirectories.length > 0
            ? input.additionalDirectories
            : undefined,
        resume: input.sessionId,
        resumeSessionAt: input.resumeAt,
        systemPrompt: input.systemPrompt,
        allowedTools: input.allowedTools,
        env: input.sdkEnv,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        settingSources: ['project', 'user'],
        mcpServers: input.mcpServers,
        hooks: input.hooks,
      },
    }) as AsyncIterable<LLMProviderEvent>;
  }
}

class OpenAIProvider implements LLMProvider {
  id: LLMProviderId = 'openai';
  supportsMcp = false;

  async *run(input: LLMProviderRunInput): AsyncIterable<LLMProviderEvent> {
    const baseUrl = ensureTrailingSlashRemoved(
      input.sdkEnv.OPENAI_BASE_URL || 'https://api.openai.com',
    );
    const apiKey = input.sdkEnv.OPENAI_API_KEY || '';
    const model = input.sdkEnv.OPENAI_MODEL || input.sdkEnv.CODEX_MODEL || 'gpt-4.1';
    const timeoutMs = Math.max(
      1000,
      Number.parseInt(input.sdkEnv.OPENAI_TIMEOUT_MS || '180000', 10) || 180000,
    );

    const sessionId = input.sessionId || randomId('openai-session');
    yield {
      type: 'system',
      subtype: 'init',
      session_id: sessionId,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            ...(input.systemPrompt?.append
              ? [{ role: 'system', content: input.systemPrompt.append }]
              : []),
            { role: 'user', content: input.prompt },
          ],
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenAI provider HTTP ${response.status}: ${text.slice(0, 400)}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = flattenOpenAIContent(data?.choices?.[0]?.message?.content);

      yield {
        type: 'assistant',
        uuid: randomId('openai-assistant'),
      };
      yield {
        type: 'result',
        subtype: 'success',
        result: content || '(empty response)',
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

class OllamaProvider implements LLMProvider {
  id: LLMProviderId = 'ollama';
  supportsMcp = false;

  async *run(input: LLMProviderRunInput): AsyncIterable<LLMProviderEvent> {
    const baseUrl = ensureTrailingSlashRemoved(
      input.sdkEnv.OLLAMA_BASE_URL || 'http://host.docker.internal:11434',
    );
    const model = input.sdkEnv.OLLAMA_MODEL || 'llama3.1';
    const timeoutMs = Math.max(
      1000,
      Number.parseInt(input.sdkEnv.OLLAMA_TIMEOUT_MS || '180000', 10) || 180000,
    );
    const prompt = input.systemPrompt?.append
      ? `${input.systemPrompt.append}\n\n---\n\n${input.prompt}`
      : input.prompt;

    const sessionId = input.sessionId || randomId('ollama-session');
    yield {
      type: 'system',
      subtype: 'init',
      session_id: sessionId,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Ollama provider HTTP ${response.status}: ${text.slice(0, 400)}`);
      }

      const data = (await response.json()) as { response?: string };
      yield {
        type: 'assistant',
        uuid: randomId('ollama-assistant'),
      };
      yield {
        type: 'result',
        subtype: 'success',
        result: data?.response || '(empty response)',
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createLlmProvider(env: Record<string, string | undefined>): LLMProvider {
  const providerId = pickProviderId(env);
  if (providerId === 'openai') return new OpenAIProvider();
  if (providerId === 'ollama') return new OllamaProvider();
  return new ClaudeProvider();
}

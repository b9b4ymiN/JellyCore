import { logger } from './logger.js';
import { attachRequestIdHeader, createRequestId } from './request-id.js';

const MIN_RESULT_FOR_MEMORY = 40;
const MIN_RESULT_FOR_SEMANTIC = 180;
const WRITE_TIMEOUT_MS = 2500;

interface CodexEpisodicWrite {
  summary: string;
  outcome: string;
  topics: string[];
}

interface CodexProceduralWrite {
  trigger: string;
  procedure: string[];
  source: string;
}

interface CodexSemanticWrite {
  pattern: string;
  source: string;
  concepts: string[];
  layer: 'semantic';
}

export interface CodexMemoryPlan {
  episodic?: CodexEpisodicWrite;
  procedural?: CodexProceduralWrite;
  semantic?: CodexSemanticWrite;
}

export interface CodexMemoryWriteInput {
  prompt: string;
  result: string;
  classificationReason?: string;
  groupFolder: string;
  stableUserId: string;
  oracleApiUrl?: string;
  oracleAuthToken?: string;
}

export interface CodexMemoryWriteSummary {
  wrote: string[];
  skipped: string[];
  errors: string[];
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit) : text;
}

function normalizeText(text: string | undefined): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function normalizeReason(reason: string | undefined): string {
  const raw = normalizeText(reason).toLowerCase();
  return raw || 'general';
}

export function buildCodexWorkingSummary(prompt: string, result: string): string {
  const compactPrompt = truncate(normalizeText(prompt), 220);
  const compactResult = truncate(normalizeText(result), 260);
  return truncate(`last_prompt=${compactPrompt} | last_result=${compactResult}`, 500);
}

function extractProceduralSteps(result: string): string[] {
  const lines = result
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const steps = lines
    .filter((line) => /^(\d+[\).\s]|[-*]\s+)/.test(line))
    .map((line) => line.replace(/^(\d+[\).\s]+|[-*]\s+)/, '').trim())
    .filter((line) => line.length >= 10)
    .slice(0, 5)
    .map((line) => truncate(line, 180));

  if (steps.length >= 2) return steps;
  return [];
}

export function buildCodexMemoryPlan(input: CodexMemoryWriteInput): CodexMemoryPlan {
  const prompt = normalizeText(input.prompt);
  const result = normalizeText(input.result);
  const reason = normalizeReason(input.classificationReason);

  if (result.length < MIN_RESULT_FOR_MEMORY) {
    return {};
  }

  const episodic: CodexEpisodicWrite = {
    summary: truncate(
      `Codex(${reason}) prompt="${truncate(prompt, 160)}" outcome="${truncate(result, 220)}"`,
      700,
    ),
    outcome: truncate(result, 220),
    topics: ['codex', reason],
  };

  let procedural: CodexProceduralWrite | undefined;
  if (reason === 'code' || reason === 'debug') {
    const steps = extractProceduralSteps(input.result);
    if (steps.length >= 2) {
      procedural = {
        trigger: truncate(`codex_${reason}:${prompt}`, 180),
        procedure: steps,
        source: 'codex_runtime',
      };
    }
  }

  let semantic: CodexSemanticWrite | undefined;
  if (!procedural && result.length >= MIN_RESULT_FOR_SEMANTIC) {
    semantic = {
      pattern: truncate(result, 700),
      source: 'codex_runtime',
      concepts: ['codex', reason],
      layer: 'semantic',
    };
  }

  return {
    episodic,
    procedural,
    semantic,
  };
}

async function postJson(
  fetchImpl: typeof fetch,
  baseUrl: string,
  endpoint: string,
  payload: Record<string, unknown>,
  requestId: string,
  authToken?: string,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WRITE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(new URL(endpoint, baseUrl).toString(), {
      method: 'POST',
      headers: attachRequestIdHeader({
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      }, requestId),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function persistCodexMemory(
  input: CodexMemoryWriteInput,
  fetchImpl: typeof fetch = fetch,
): Promise<CodexMemoryWriteSummary> {
  const plan = buildCodexMemoryPlan(input);
  const apiUrl = input.oracleApiUrl || process.env.ORACLE_API_URL || 'http://oracle:47778';
  const authToken = input.oracleAuthToken || process.env.ORACLE_AUTH_TOKEN;

  const wrote: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const requestId = createRequestId('codex');

  const run = async (
    name: 'episodic' | 'procedural' | 'semantic',
    endpoint: string,
    payload: Record<string, unknown>,
  ) => {
    try {
      await postJson(fetchImpl, apiUrl, endpoint, payload, requestId, authToken);
      wrote.push(name);
    } catch (err) {
      errors.push(`${name}:${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (plan.episodic) {
    await run('episodic', '/api/episodic', {
      summary: plan.episodic.summary,
      userId: input.stableUserId,
      groupId: input.groupFolder,
      topics: plan.episodic.topics,
      outcome: plan.episodic.outcome,
      source: 'codex_runtime',
      runtime: 'codex',
    });
  } else {
    skipped.push('episodic:no_signal');
  }

  if (plan.procedural) {
    await run('procedural', '/api/procedural', {
      trigger: plan.procedural.trigger,
      procedure: plan.procedural.procedure,
      source: plan.procedural.source,
      userId: input.stableUserId,
      groupId: input.groupFolder,
      runtime: 'codex',
    });
  } else {
    skipped.push('procedural:not_applicable');
  }

  if (plan.semantic) {
    await run('semantic', '/api/learn', {
      pattern: plan.semantic.pattern,
      source: plan.semantic.source,
      concepts: plan.semantic.concepts,
      layer: plan.semantic.layer,
      runtime: 'codex',
      userId: input.stableUserId,
      groupId: input.groupFolder,
    });
  } else {
    skipped.push('semantic:not_applicable');
  }

  if (errors.length > 0) {
    logger.warn(
      {
        group: input.groupFolder,
        userId: input.stableUserId,
        requestId,
        wrote,
        errors,
      },
      'Codex memory write-back partially failed',
    );
  }

  return { wrote, skipped, errors };
}

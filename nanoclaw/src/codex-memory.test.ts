import { describe, expect, it, vi } from 'vitest';

import { buildCodexMemoryPlan, buildCodexWorkingSummary, persistCodexMemory } from './codex-memory.js';

function okJsonResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
  } as Response;
}

describe('codex-memory', () => {
  it('builds compact working summary text', () => {
    const summary = buildCodexWorkingSummary(
      'please debug the failing payment webhook',
      'Fixed by validating signature header before JSON parse and adding retry-safe idempotency checks.',
    );
    expect(summary).toContain('last_prompt=');
    expect(summary).toContain('last_result=');
    expect(summary.length).toBeLessThanOrEqual(500);
  });

  it('returns empty plan for short codex output', () => {
    const plan = buildCodexMemoryPlan({
      prompt: 'fix it',
      result: 'ok',
      classificationReason: 'code',
      groupFolder: 'g1',
      stableUserId: 'u1',
    });

    expect(plan.episodic).toBeUndefined();
    expect(plan.procedural).toBeUndefined();
    expect(plan.semantic).toBeUndefined();
  });

  it('builds episodic + procedural plan for code/debug outputs with clear steps', () => {
    const plan = buildCodexMemoryPlan({
      prompt: 'fix build pipeline',
      result: [
        'Implemented a stable fix for the CI race condition.',
        '1. Reproduce failure with isolated test run',
        '2. Add lockfile generation before install',
        '3. Re-run tests and verify artifacts',
      ].join('\n'),
      classificationReason: 'code',
      groupFolder: 'g1',
      stableUserId: 'u1',
    });

    expect(plan.episodic).toBeDefined();
    expect(plan.procedural?.procedure.length).toBeGreaterThanOrEqual(2);
    expect(plan.semantic).toBeUndefined();
  });

  it('writes expected oracle endpoints from generated plan', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
      });
      return okJsonResponse();
    });

    const summary = await persistCodexMemory(
      {
        prompt: 'fix build pipeline',
        result: [
          'Implemented a stable fix for the CI race condition.',
          '1. Reproduce failure with isolated test run',
          '2. Add lockfile generation before install',
          '3. Re-run tests and verify artifacts',
        ].join('\n'),
        classificationReason: 'code',
        groupFolder: 'engineering',
        stableUserId: 'user-123',
        oracleApiUrl: 'http://oracle:47778',
      },
      fetchMock as unknown as typeof fetch,
    );

    const paths = calls.map((call) => new URL(call.url).pathname);
    expect(paths).toContain('/api/episodic');
    expect(paths).toContain('/api/procedural');
    expect(summary.wrote).toContain('episodic');
    expect(summary.wrote).toContain('procedural');
    expect(summary.wrote).not.toContain('semantic');

    const episodicBody = calls.find((call) => new URL(call.url).pathname === '/api/episodic')?.body;
    expect(episodicBody?.runtime).toBe('codex');
    expect(episodicBody?.groupId).toBe('engineering');
  });
});

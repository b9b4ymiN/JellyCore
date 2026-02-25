import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptBuilder } from './prompt-builder.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('PromptBuilder', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('injects procedural section and stays under token budget', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/user-model') {
        return jsonResponse({
          name: 'Alice',
          language: 'th',
          expertise: { docker: 'advanced', db: 'intermediate' },
          preferences: { responseStyle: 'concise' },
          topics: ['automation', 'telegram'],
        });
      }
      if (url.pathname === '/api/procedural') {
        return jsonResponse({
          results: [
            {
              trigger: 'Deploy service',
              procedure: ['check env', 'docker compose pull', 'verify health endpoint'],
            },
          ],
        });
      }
      if (url.pathname === '/api/episodic') {
        return jsonResponse({
          results: [
            {
              created_at: new Date(Date.now() - 3_600_000).toISOString(),
              summary: 'Last deploy failed due to missing token; fixed by updating env.',
            },
          ],
        });
      }
      if (url.pathname === '/api/search') {
        return jsonResponse({
          results: [
            {
              title: 'Deploy runbook',
              content: 'Always validate env, then deploy, then call /health.',
            },
          ],
        });
      }
      return jsonResponse({ results: [] });
    });

    vi.stubGlobal('fetch', fetchMock);

    const builder = new PromptBuilder({
      oracleApiUrl: 'http://oracle:47778',
      cacheTtl: 0,
      cacheMax: 10,
    });

    const ctx = await builder.buildCompactContext('deploy telegram worker', 'main', 'u-main-1');
    const xml = builder.formatCompact(ctx);

    expect(ctx.proceduralGuidance).toContain('Deploy service');
    expect(xml).toContain('<procedural>');
    expect(ctx.tokenEstimate).toBeLessThanOrEqual(600);
  });

  it('passes stable userId to user-model and episodic calls', async () => {
    const calledUrls: URL[] = [];

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      calledUrls.push(url);

      if (url.pathname === '/api/user-model') {
        return jsonResponse({ name: 'User' });
      }
      if (url.pathname === '/api/procedural') {
        return jsonResponse({ results: [] });
      }
      if (url.pathname === '/api/episodic') {
        return jsonResponse({ results: [] });
      }
      if (url.pathname === '/api/search') {
        return jsonResponse({ results: [] });
      }
      return jsonResponse({});
    });

    vi.stubGlobal('fetch', fetchMock);

    const builder = new PromptBuilder({ oracleApiUrl: 'http://oracle:47778' });
    await builder.buildCompactContext('check budget', 'group-abc', 'user-xyz');

    const userModelUrl = calledUrls.find((u) => u.pathname === '/api/user-model');
    const episodicUrl = calledUrls.find((u) => u.pathname === '/api/episodic');

    expect(userModelUrl?.searchParams.get('userId')).toBe('user-xyz');
    expect(episodicUrl?.searchParams.get('userId')).toBe('user-xyz');
    expect(episodicUrl?.searchParams.get('q')).toBe('check budget');
  });

  it('degrades gracefully when Oracle is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('oracle down');
      }),
    );

    const builder = new PromptBuilder({ oracleApiUrl: 'http://oracle:47778' });
    const ctx = await builder.buildCompactContext('any message', 'main', 'u-main-1');

    expect(ctx.userModel).toBe('');
    expect(ctx.proceduralGuidance).toBe('');
    expect(ctx.recentEpisodes).toBe('');
    expect(ctx.relevantKnowledge).toBe('');
    expect(ctx.tokenEstimate).toBe(0);
    expect(builder.formatCompact(ctx)).toBe('');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleOracleOnly } from './oracle-handler.js';
import { classifyQuery } from './query-router.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('message flow smoke (no live telegram)', () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it('routes search query to oracle-only and returns formatted result', async () => {
    const classification = classifyQuery('search oracle architecture');
    expect(classification.tier).toBe('oracle-only');
    expect(classification.reason).toBe('search');

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { type: 'principle', content: 'Use simple interfaces first.' },
        ],
      }),
    });

    const output = await handleOracleOnly(classification.reason, 'search oracle architecture');
    expect(output).toContain('ผลค้นหา');
    expect(output).toContain('principle');
  });

  it('falls back cleanly when oracle is unavailable', async () => {
    const classification = classifyQuery('search retry strategy');
    fetchMock.mockRejectedValueOnce(new Error('oracle down'));

    const output = await handleOracleOnly(classification.reason, 'search retry strategy');
    expect(output).toBe('');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';

import { evaluateCodexAuthStatus } from './codex-auth.js';

describe('codex auth validator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns missing_auth_file when auth.json is absent', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const status = evaluateCodexAuthStatus();
    expect(status.ready).toBe(false);
    expect(status.reason).toBe('missing_auth_file');
  });

  it('returns invalid_json when auth.json cannot be parsed', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('{not json' as any);

    const status = evaluateCodexAuthStatus();
    expect(status.ready).toBe(false);
    expect(status.reason).toBe('invalid_json');
  });

  it('returns missing_tokens_fields when required token fields are incomplete', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        tokens: {
          access_token: 'a',
          refresh_token: 'b',
        },
      }) as any,
    );

    const status = evaluateCodexAuthStatus();
    expect(status.ready).toBe(false);
    expect(status.reason).toBe('missing_tokens_fields');
  });

  it('returns ready=true for valid auth.json', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        tokens: {
          access_token: 'a',
          refresh_token: 'b',
          id_token: 'c',
          account_id: 'd',
        },
      }) as any,
    );

    const status = evaluateCodexAuthStatus();
    expect(status.ready).toBe(true);
    expect(status.reason).toBeUndefined();
  });
});

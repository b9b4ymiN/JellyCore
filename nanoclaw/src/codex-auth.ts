import fs from 'fs';
import path from 'path';

import { CODEX_AUTH_PATH } from './config.js';
import type { CodexAuthStatus } from './agents/types.js';

interface CodexAuthJson {
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    account_id?: string;
  };
}

let cachedStatus: CodexAuthStatus = {
  ready: false,
  reason: 'missing_auth_file',
  checkedAt: new Date().toISOString(),
};

function stripUtf8Bom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function hasRequiredTokens(data: CodexAuthJson): boolean {
  const t = data.tokens;
  return Boolean(
    t
      && typeof t.access_token === 'string'
      && t.access_token.trim().length > 0
      && typeof t.refresh_token === 'string'
      && t.refresh_token.trim().length > 0
      && typeof t.id_token === 'string'
      && t.id_token.trim().length > 0
      && typeof t.account_id === 'string'
      && t.account_id.trim().length > 0,
  );
}

export function getCodexAuthFilePath(): string {
  return path.join(CODEX_AUTH_PATH, 'auth.json');
}

export function evaluateCodexAuthStatus(): CodexAuthStatus {
  const checkedAt = new Date().toISOString();
  const authFile = getCodexAuthFilePath();

  if (!fs.existsSync(authFile)) {
    cachedStatus = { ready: false, reason: 'missing_auth_file', checkedAt };
    return cachedStatus;
  }

  try {
    const raw = fs.readFileSync(authFile, 'utf-8');
    const parsed = JSON.parse(stripUtf8Bom(raw)) as CodexAuthJson;
    if (!hasRequiredTokens(parsed)) {
      cachedStatus = { ready: false, reason: 'missing_tokens_fields', checkedAt };
      return cachedStatus;
    }
    cachedStatus = { ready: true, checkedAt };
    return cachedStatus;
  } catch {
    cachedStatus = { ready: false, reason: 'invalid_json', checkedAt };
    return cachedStatus;
  }
}

export function getCodexAuthStatus(): CodexAuthStatus {
  return cachedStatus;
}

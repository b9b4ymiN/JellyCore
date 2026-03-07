import crypto from 'crypto';

function randomId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

export function createRequestId(prefix = 'nc'): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '') || 'nc';
  return `${safePrefix}-${randomId()}`;
}

function hasHeaderCaseInsensitive(
  headers: Record<string, string>,
  headerName: string,
): boolean {
  const expected = headerName.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === expected);
}

export function attachRequestIdHeader(
  headers: Record<string, string> | undefined,
  requestId: string,
): Record<string, string> {
  const resolved = { ...(headers || {}) };
  if (!hasHeaderCaseInsensitive(resolved, 'x-request-id')) {
    resolved['x-request-id'] = requestId;
  }
  return resolved;
}

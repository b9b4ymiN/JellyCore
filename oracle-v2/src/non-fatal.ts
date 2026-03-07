function stringifyContext(context?: Record<string, unknown>): string {
  if (!context || Object.keys(context).length === 0) return '';
  try {
    return ` context=${JSON.stringify(context)}`;
  } catch {
    return ' context=[unserializable]';
  }
}

function normalizeMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  return String(error);
}

export function logNonFatal(
  scope: string,
  error: unknown,
  context?: Record<string, unknown>,
  level: 'warn' | 'debug' = 'warn',
): void {
  const prefix = `[OracleNonFatal][${scope}]`;
  const line = `${prefix} ${normalizeMessage(error)}${stringifyContext(context)}`;
  if (level === 'debug') {
    console.debug(line);
  } else {
    console.warn(line);
  }
}

export function logNonFatalNote(
  scope: string,
  message: string,
  context?: Record<string, unknown>,
  level: 'warn' | 'debug' = 'debug',
): void {
  const prefix = `[OracleNonFatal][${scope}]`;
  const line = `${prefix} ${message}${stringifyContext(context)}`;
  if (level === 'debug') {
    console.debug(line);
  } else {
    console.warn(line);
  }
}

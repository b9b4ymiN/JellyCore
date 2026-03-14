function normalizeConcepts(values: unknown[]): string[] {
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
}

function splitConceptString(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function looksLikeJsonArray(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('[') && trimmed.endsWith(']');
}

export function parseStoredConcepts(value: unknown): string[] {
  if (value == null || value === '') return [];

  if (Array.isArray(value)) {
    return normalizeConcepts(value);
  }

  if (typeof value !== 'string') {
    return [];
  }

  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return normalizeConcepts(parsed);
    }
    if (typeof parsed === 'string') {
      const nested = parsed.trim();
      if (!nested) return [];
      if (looksLikeJsonArray(nested)) {
        try {
          const reparsed = JSON.parse(nested);
          if (Array.isArray(reparsed)) {
            return normalizeConcepts(reparsed);
          }
        } catch {
          // Fall back to comma splitting for malformed nested payloads.
        }
      }
      return splitConceptString(nested);
    }
    return [];
  } catch {
    return splitConceptString(trimmed);
  }
}

export function serializeStoredConcepts(values?: string[]): string {
  return JSON.stringify(parseStoredConcepts(values ?? []));
}

/**
 * Thai NLP Sidecar Client
 *
 * HTTP client for the thai-nlp-sidecar (Python/FastAPI + PyThaiNLP).
 * Every method has graceful degradation — if sidecar is down or errors,
 * returns the input unchanged so Oracle continues working.
 *
 * Singleton pattern: use getThaiNlpClient()
 */

// ── Response types ──

export interface TokenizeResult {
  tokens: string[];
  segmented: string;
  engine: string;
  elapsed_ms: number;
}

export interface NormalizeResult {
  normalized: string;
  changed: boolean;
  elapsed_ms: number;
}

export interface SpellcheckResult {
  corrected: string;
  changed: boolean;
  elapsed_ms: number;
}

export interface ChunkResult {
  chunks: string[];
  count: number;
  elapsed_ms: number;
}

export interface StopwordsResult {
  filtered: string[];
  removed: string[];
  elapsed_ms: number;
}

export interface HealthResult {
  status: string;
  pythainlp_version: string;
  uptime_seconds: number;
}

// ── Client ──

export class ThaiNlpClient {
  private baseUrl: string;
  private timeout: number;
  private _available: boolean | null = null; // null = unknown

  constructor(baseUrl?: string, timeout: number = 2000) {
    this.baseUrl = baseUrl || process.env.THAI_NLP_URL || 'http://thai-nlp:8000';
    this.timeout = timeout;
  }

  /**
   * Check if sidecar is available (cached after first check, reset on error).
   */
  async isAvailable(): Promise<boolean> {
    try {
      const health = await this.health();
      this._available = health.status === 'ok';
      return this._available;
    } catch {
      this._available = false;
      return false;
    }
  }

  /**
   * Health check — no graceful fallback (caller handles failure)
   */
  async health(): Promise<HealthResult> {
    const resp = await fetch(`${this.baseUrl}/health`, {
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!resp.ok) throw new Error(`Thai NLP health: ${resp.status}`);
    return resp.json() as Promise<HealthResult>;
  }

  /**
   * Word tokenization via PyThaiNLP.
   * Graceful: returns original text split by whitespace if sidecar fails.
   */
  async tokenize(text: string, engine: string = 'newmm'): Promise<TokenizeResult> {
    try {
      const resp = await fetch(`${this.baseUrl}/tokenize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, engine }),
        signal: AbortSignal.timeout(this.timeout),
      });
      if (!resp.ok) throw new Error(`tokenize: ${resp.status}`);
      this._available = true;
      return resp.json() as Promise<TokenizeResult>;
    } catch (err) {
      this._available = false;
      console.warn('[ThaiNLP] tokenize fallback:', err instanceof Error ? err.message : String(err));
      const tokens = text.split(/\s+/).filter(Boolean);
      return { tokens, segmented: text, engine: 'fallback', elapsed_ms: 0 };
    }
  }

  /**
   * Thai text normalization (zero-width chars, vowel reordering, etc.)
   * Graceful: returns original text if sidecar fails.
   */
  async normalize(text: string): Promise<NormalizeResult> {
    try {
      const resp = await fetch(`${this.baseUrl}/normalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(this.timeout),
      });
      if (!resp.ok) throw new Error(`normalize: ${resp.status}`);
      this._available = true;
      return resp.json() as Promise<NormalizeResult>;
    } catch (err) {
      this._available = false;
      console.warn('[ThaiNLP] normalize fallback:', err instanceof Error ? err.message : String(err));
      return { normalized: text, changed: false, elapsed_ms: 0 };
    }
  }

  /**
   * Spell correction for Thai text.
   * Graceful: returns original text if sidecar fails.
   */
  async spellcheck(text: string): Promise<SpellcheckResult> {
    try {
      const resp = await fetch(`${this.baseUrl}/spellcheck`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(this.timeout),
      });
      if (!resp.ok) throw new Error(`spellcheck: ${resp.status}`);
      this._available = true;
      return resp.json() as Promise<SpellcheckResult>;
    } catch (err) {
      this._available = false;
      console.warn('[ThaiNLP] spellcheck fallback:', err instanceof Error ? err.message : String(err));
      return { corrected: text, changed: false, elapsed_ms: 0 };
    }
  }

  /**
   * Sentence-aware document chunking.
   * Graceful: returns input as single chunk if sidecar fails.
   */
  async chunk(text: string, maxTokens: number = 300, overlap: number = 50): Promise<ChunkResult> {
    try {
      const resp = await fetch(`${this.baseUrl}/chunk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, max_tokens: maxTokens, overlap }),
        signal: AbortSignal.timeout(this.timeout * 2), // chunking may take longer
      });
      if (!resp.ok) throw new Error(`chunk: ${resp.status}`);
      this._available = true;
      return resp.json() as Promise<ChunkResult>;
    } catch (err) {
      this._available = false;
      console.warn('[ThaiNLP] chunk fallback:', err instanceof Error ? err.message : String(err));
      return { chunks: [text], count: 1, elapsed_ms: 0 };
    }
  }

  /**
   * Filter Thai stop words from token list.
   * Graceful: returns original tokens if sidecar fails.
   */
  async filterStopwords(tokens: string[]): Promise<StopwordsResult> {
    try {
      const resp = await fetch(`${this.baseUrl}/stopwords`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokens }),
        signal: AbortSignal.timeout(this.timeout),
      });
      if (!resp.ok) throw new Error(`stopwords: ${resp.status}`);
      this._available = true;
      return resp.json() as Promise<StopwordsResult>;
    } catch (err) {
      this._available = false;
      console.warn('[ThaiNLP] stopwords fallback:', err instanceof Error ? err.message : String(err));
      return { filtered: tokens, removed: [], elapsed_ms: 0 };
    }
  }

  /**
   * Convenience: normalize + tokenize in one call (most common pipeline).
   * If normalize succeeds, feeds result to tokenize. Both graceful.
   */
  async normalizeAndTokenize(text: string): Promise<{ normalized: string; tokens: string[]; segmented: string }> {
    const { normalized } = await this.normalize(text);
    const { tokens, segmented } = await this.tokenize(normalized);
    return { normalized, tokens, segmented };
  }

  /**
   * Full preprocessing pipeline: normalize → spellcheck → tokenize.
   * Used for search query preprocessing.
   */
  async preprocessQuery(text: string): Promise<{ original: string; processed: string; tokens: string[]; segmented: string }> {
    const { normalized } = await this.normalize(text);
    const { corrected } = await this.spellcheck(normalized);
    const { tokens, segmented } = await this.tokenize(corrected);
    return { original: text, processed: corrected, tokens, segmented };
  }
}

// ── Singleton ──

let thaiNlpClient: ThaiNlpClient | null = null;

export function getThaiNlpClient(): ThaiNlpClient {
  if (!thaiNlpClient) {
    thaiNlpClient = new ThaiNlpClient();
  }
  return thaiNlpClient;
}

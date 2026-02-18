/**
 * Prompt Builder - Compact Context Injection (v0.7.1)
 *
 * Gathers relevant context from Oracle V2 and injects a compact
 * <ctx> block into the agent's prompt. Token-budgeted to ≤600 tokens.
 *
 * Sections (with char budgets → ~4 chars/token):
 *   <user>     ≤ 600 chars  (~150 tokens) — Layer 1: User Model
 *   <recent>   ≤ 800 chars  (~200 tokens) — Layer 4: Episodic
 *   <knowledge> ≤ 1000 chars (~250 tokens) — Layer 3: Semantic
 *
 * Features:
 * - 3 parallel Oracle queries with 3s total timeout
 * - LRU cache (50 entries, 5min TTL) per group
 * - Skip-if-empty: no XML block if section is empty
 * - Graceful degradation: Oracle down → empty context (0 tokens)
 */

import { logger } from './logger.js';

// Character budgets per section (≈4 chars/token)
const USER_MODEL_CHAR_LIMIT = 600;
const EPISODES_CHAR_LIMIT = 800;
const KNOWLEDGE_CHAR_LIMIT = 1000;
const ORACLE_TIMEOUT_MS = 3000; // Total timeout for all parallel queries

export interface CompactContext {
  userModel: string;       // Compact user summary
  recentEpisodes: string;  // Recent conversation summaries
  relevantKnowledge: string; // Search results
  tokenEstimate: number;   // Estimated token count
  fromCache: boolean;
}

export interface PromptBuilderOpts {
  oracleApiUrl?: string;
  oracleAuthToken?: string;
  cacheTtl?: number;
  cacheMax?: number;
}

interface CacheEntry {
  context: CompactContext;
  timestamp: number;
}

/**
 * LRU Cache for prompt contexts
 */
class ContextCache {
  private cache = new Map<string, CacheEntry>();
  private max: number;
  private ttl: number;

  constructor(max: number = 50, ttl: number = 5 * 60 * 1000) {
    this.max = max;
    this.ttl = ttl;
  }

  get(key: string): CompactContext | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }
    // Move to end (LRU)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.context;
  }

  set(key: string, context: CompactContext): void {
    if (this.cache.size >= this.max) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, { context, timestamp: Date.now() });
  }

  clear(): void { this.cache.clear(); }
  get size(): number { return this.cache.size; }
}

/**
 * Compact Oracle V2 HTTP Client
 */
class OracleClient {
  constructor(
    private baseUrl: string,
    private authToken?: string,
  ) {}

  private async request(
    path: string,
    params?: Record<string, any>,
    signal?: AbortSignal,
  ): Promise<any> {
    const url = new URL(path, this.baseUrl);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined) url.searchParams.set(k, String(v));
      });
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authToken) headers['Authorization'] = `Bearer ${this.authToken}`;

    const response = await fetch(url.toString(), { headers, signal });
    if (!response.ok) throw new Error(`Oracle ${response.status}`);
    return response.json();
  }

  /** Layer 1: Get user model (compact) */
  async getUserModel(signal?: AbortSignal): Promise<string> {
    try {
      const result = await this.request('/api/user-model', undefined, signal);
      if (!result || !result.model) return '';

      // Compact format: key facts only
      const m = result.model;
      const parts: string[] = [];
      if (m.name) parts.push(`ชื่อ: ${m.name}`);
      if (m.language) parts.push(`ภาษา: ${m.language}`);
      if (m.expertise) {
        const exp = Array.isArray(m.expertise) ? m.expertise.join(', ') : m.expertise;
        parts.push(`expertise: ${exp}`);
      }
      if (m.preferences) {
        const prefs = typeof m.preferences === 'object'
          ? Object.entries(m.preferences).map(([k, v]) => `${k}: ${v}`).join(', ')
          : m.preferences;
        parts.push(`preferences: ${prefs}`);
      }
      if (m.topics) {
        const topics = Array.isArray(m.topics) ? m.topics.join(', ') : m.topics;
        parts.push(`สนใจ: ${topics}`);
      }
      // Include any extra fields as key=value
      for (const [key, value] of Object.entries(m)) {
        if (['name', 'language', 'expertise', 'preferences', 'topics', 'id', 'created_at', 'updated_at'].includes(key)) continue;
        if (value && typeof value === 'string') parts.push(`${key}: ${value}`);
      }
      return parts.join(', ').slice(0, USER_MODEL_CHAR_LIMIT);
    } catch {
      return '';
    }
  }

  /** Layer 4: Get recent episodes */
  async getRecentEpisodes(limit = 2, signal?: AbortSignal): Promise<string> {
    try {
      const result = await this.request('/api/episodic', { limit }, signal);
      const episodes = result?.episodes || result?.results || [];
      if (episodes.length === 0) return '';

      return episodes
        .slice(0, limit)
        .map((ep: any) => {
          const time = ep.created_at ? formatTimeAgo(ep.created_at) : '?';
          const summary = (ep.summary || ep.content || '').slice(0, 300);
          return `- ${time}: ${summary}`;
        })
        .join('\n')
        .slice(0, EPISODES_CHAR_LIMIT);
    } catch {
      return '';
    }
  }

  /** Layer 3: Search relevant knowledge */
  async searchKnowledge(query: string, limit = 3, signal?: AbortSignal): Promise<string> {
    try {
      const result = await this.request('/api/search', { q: query, limit, mode: 'hybrid' }, signal);
      const results = result?.results || [];
      if (results.length === 0) return '';

      return results
        .slice(0, limit)
        .map((doc: any) => {
          const title = doc.title || doc.type || 'doc';
          const snippet = (doc.content || '').slice(0, 250);
          return `- [${title}] ${snippet}`;
        })
        .join('\n')
        .slice(0, KNOWLEDGE_CHAR_LIMIT);
    } catch {
      return '';
    }
  }
}

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Main Prompt Builder Class — Compact Context Injection
 */
export class PromptBuilder {
  private oracleClient: OracleClient;
  private cache: ContextCache;

  constructor(opts: PromptBuilderOpts = {}) {
    const {
      oracleApiUrl = process.env.ORACLE_API_URL || 'http://localhost:47778',
      oracleAuthToken = process.env.ORACLE_AUTH_TOKEN,
      cacheTtl = 5 * 60 * 1000,
      cacheMax = 50,
    } = opts;

    this.oracleClient = new OracleClient(oracleApiUrl, oracleAuthToken);
    this.cache = new ContextCache(cacheMax, cacheTtl);
  }

  /**
   * Build compact context for a user message.
   * Total budget: ≤600 tokens (~2400 chars).
   * Returns empty string if Oracle is unavailable.
   */
  async buildCompactContext(
    latestUserMessage: string,
    groupId: string,
  ): Promise<CompactContext> {
    // Check cache (keyed by group — user model + episodes don't change per message)
    const cacheKey = `ctx:${groupId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { ...cached, fromCache: true };
    }

    // Create abort controller for total timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ORACLE_TIMEOUT_MS);

    try {
      // Parallel queries: User Model + Episodic + Knowledge Search
      const [userModel, recentEpisodes, relevantKnowledge] = await Promise.all([
        this.oracleClient.getUserModel(controller.signal),
        this.oracleClient.getRecentEpisodes(2, controller.signal),
        this.oracleClient.searchKnowledge(latestUserMessage, 3, controller.signal),
      ]);

      clearTimeout(timeout);

      const totalChars = userModel.length + recentEpisodes.length + relevantKnowledge.length;
      const tokenEstimate = Math.ceil(totalChars / 4);

      const context: CompactContext = {
        userModel,
        recentEpisodes,
        relevantKnowledge,
        tokenEstimate,
        fromCache: false,
      };

      // Cache (keyed by group — knowledge varies but cache evicts in 5 min)
      this.cache.set(cacheKey, context);

      return context;
    } catch (err) {
      clearTimeout(timeout);
      logger.warn({ err, groupId }, 'Oracle context injection failed, skipping');
      return { userModel: '', recentEpisodes: '', relevantKnowledge: '', tokenEstimate: 0, fromCache: false };
    }
  }

  /**
   * Format compact context as XML for prepending to prompt.
   * Skip-if-empty: returns empty string if all sections are empty.
   */
  formatCompact(ctx: CompactContext): string {
    const sections: string[] = [];

    if (ctx.userModel) sections.push(`<user>${ctx.userModel}</user>`);
    if (ctx.recentEpisodes) sections.push(`<recent>\n${ctx.recentEpisodes}\n</recent>`);
    if (ctx.relevantKnowledge) sections.push(`<knowledge>\n${ctx.relevantKnowledge}\n</knowledge>`);

    if (sections.length === 0) return '';

    return `<ctx>\n${sections.join('\n')}\n</ctx>`;
  }

  /** Get cache statistics */
  getCacheStats(): { size: number } {
    return { size: this.cache.size };
  }

  /** Clear cache */
  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * Singleton instance
 */
let instance: PromptBuilder | undefined;

export function getPromptBuilder(opts?: PromptBuilderOpts): PromptBuilder {
  if (!instance) {
    instance = new PromptBuilder(opts);
  }
  return instance;
}

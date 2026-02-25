/**
 * Prompt Builder - Compact Context Injection (v0.8.0)
 *
 * Builds a compact <ctx> block from Oracle memory layers.
 * Budget target: <=600 tokens (~2400 chars).
 */

import { createHash } from 'crypto';

import { logger } from './logger.js';

// Character budgets per section (~4 chars/token)
const USER_MODEL_CHAR_LIMIT = 500;
const PROCEDURAL_CHAR_LIMIT = 600;
const EPISODES_CHAR_LIMIT = 600;
const KNOWLEDGE_CHAR_LIMIT = 700;
const TOTAL_CHAR_LIMIT = 2400;
const ORACLE_TIMEOUT_MS = 3000;

export interface CompactContext {
  userModel: string;
  proceduralGuidance: string;
  recentEpisodes: string;
  relevantKnowledge: string;
  tokenEstimate: number;
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

type JsonObject = Record<string, unknown>;

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

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

class OracleClient {
  constructor(
    private baseUrl: string,
    private authToken?: string,
  ) {}

  private async request(
    path: string,
    params?: Record<string, string | number | undefined>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && String(v).length > 0) {
          url.searchParams.set(k, String(v));
        }
      }
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authToken) headers.Authorization = `Bearer ${this.authToken}`;

    const response = await fetch(url.toString(), { headers, signal });
    if (!response.ok) throw new Error(`Oracle ${response.status}`);
    return response.json();
  }

  async getUserModel(userId: string, signal?: AbortSignal): Promise<string> {
    try {
      const result = await this.request('/api/user-model', { userId }, signal);
      const obj = asObject(result);
      if (!obj) return '';

      const model = asObject(obj.model) || obj;
      const parts: string[] = [];

      const name = toText(model.name);
      if (name) parts.push(`name: ${name}`);

      const language = toText(model.language);
      if (language) parts.push(`language: ${language}`);

      const expertise = compactKvOrList(model.expertise);
      if (expertise) parts.push(`expertise: ${expertise}`);

      const preferences = compactKvOrList(model.preferences);
      if (preferences) parts.push(`preferences: ${preferences}`);

      const topics = compactKvOrList(model.topics ?? model.commonTopics);
      if (topics) parts.push(`topics: ${topics}`);

      return truncate(parts.join(', '), USER_MODEL_CHAR_LIMIT);
    } catch {
      return '';
    }
  }

  async getProceduralGuidance(query: string, limit = 2, signal?: AbortSignal): Promise<string> {
    try {
      const result = await this.request('/api/procedural', { q: query, limit }, signal);
      const rows = extractResults(result);
      if (rows.length === 0) return '';

      const lines = rows.slice(0, limit).map((row) => {
        const trigger = toText(row.trigger) || toText(row.title) || 'procedure';
        const steps = (Array.isArray(row.procedure) ? row.procedure : [])
          .map((step) => toText(step))
          .filter(Boolean)
          .slice(0, 3)
          .map((step) => truncate(step, 90));

        if (steps.length === 0) return `- ${truncate(trigger, 120)}`;
        return `- ${truncate(trigger, 120)}: ${steps.join(' -> ')}`;
      });

      return truncate(lines.join('\n'), PROCEDURAL_CHAR_LIMIT);
    } catch {
      return '';
    }
  }

  async getRecentEpisodes(
    query: string,
    userId: string,
    limit = 2,
    signal?: AbortSignal,
  ): Promise<string> {
    try {
      const result = await this.request('/api/episodic', { q: query, userId, limit }, signal);
      const rows = extractResults(result);
      if (rows.length === 0) return '';

      const lines = rows.slice(0, limit).map((row) => {
        const createdAt = toText(row.created_at);
        const time = createdAt ? formatTimeAgo(createdAt) : '?';
        const summary = toText(row.summary) || toText(row.content) || '';
        return `- ${time}: ${truncate(summary, 220)}`;
      });

      return truncate(lines.join('\n'), EPISODES_CHAR_LIMIT);
    } catch {
      return '';
    }
  }

  async searchKnowledge(query: string, limit = 3, signal?: AbortSignal): Promise<string> {
    try {
      const result = await this.request('/api/search', { q: query, limit, mode: 'hybrid' }, signal);
      const rows = extractResults(result);
      if (rows.length === 0) return '';

      const lines = rows.slice(0, limit).map((row) => {
        const title = toText(row.title) || toText(row.type) || 'doc';
        const snippet = toText(row.content) || '';
        return `- [${truncate(title, 80)}] ${truncate(snippet, 180)}`;
      });

      return truncate(lines.join('\n'), KNOWLEDGE_CHAR_LIMIT);
    } catch {
      return '';
    }
  }
}

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonObject;
}

function extractResults(value: unknown): JsonObject[] {
  const obj = asObject(value);
  if (!obj) return [];

  const direct = Array.isArray(obj.results) ? obj.results : [];
  if (direct.length > 0) {
    return direct.map((v) => asObject(v)).filter((v): v is JsonObject => v !== null);
  }

  const fallback = Array.isArray(obj.episodes) ? obj.episodes : [];
  return fallback.map((v) => asObject(v)).filter((v): v is JsonObject => v !== null);
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function compactKvOrList(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((v) => toText(v)).filter(Boolean).join(', ');
  }

  const obj = asObject(value);
  if (obj) {
    return Object.entries(obj)
      .map(([k, v]) => {
        const text = toText(v);
        return text ? `${k}:${text}` : '';
      })
      .filter(Boolean)
      .join(', ');
  }

  return toText(value);
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit) : text;
}

function hashKey(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 10);
}

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  if (!Number.isFinite(diff) || diff < 0) return 'just now';
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function enforceTotalBudget(context: Omit<CompactContext, 'tokenEstimate' | 'fromCache'>): Omit<CompactContext, 'tokenEstimate' | 'fromCache'> {
  const current = context.userModel.length
    + context.proceduralGuidance.length
    + context.recentEpisodes.length
    + context.relevantKnowledge.length;

  if (current <= TOTAL_CHAR_LIMIT) return context;

  // Trim in least-critical order first.
  let over = current - TOTAL_CHAR_LIMIT;

  const trimField = (value: string, minKeep: number): string => {
    if (over <= 0) return value;
    const room = Math.max(0, value.length - minKeep);
    const cut = Math.min(room, over);
    over -= cut;
    return value.slice(0, value.length - cut);
  };

  return {
    ...context,
    relevantKnowledge: trimField(context.relevantKnowledge, 180),
    recentEpisodes: trimField(context.recentEpisodes, 180),
    proceduralGuidance: trimField(context.proceduralGuidance, 180),
    userModel: trimField(context.userModel, 120),
  };
}

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

  async buildCompactContext(
    latestUserMessage: string,
    groupId: string,
    userId: string = 'default',
  ): Promise<CompactContext> {
    const normalizedMsg = latestUserMessage.trim().toLowerCase();
    const cacheKey = `ctx:${groupId}:${userId}:${hashKey(normalizedMsg)}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return { ...cached, fromCache: true };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ORACLE_TIMEOUT_MS);

    try {
      const [userModel, proceduralGuidance, recentEpisodes, relevantKnowledge] = await Promise.all([
        this.oracleClient.getUserModel(userId, controller.signal),
        this.oracleClient.getProceduralGuidance(latestUserMessage, 2, controller.signal),
        this.oracleClient.getRecentEpisodes(latestUserMessage, userId, 2, controller.signal),
        this.oracleClient.searchKnowledge(latestUserMessage, 3, controller.signal),
      ]);

      clearTimeout(timeout);

      const budgeted = enforceTotalBudget({
        userModel,
        proceduralGuidance,
        recentEpisodes,
        relevantKnowledge,
      });

      const totalChars = budgeted.userModel.length
        + budgeted.proceduralGuidance.length
        + budgeted.recentEpisodes.length
        + budgeted.relevantKnowledge.length;

      const context: CompactContext = {
        ...budgeted,
        tokenEstimate: Math.ceil(totalChars / 4),
        fromCache: false,
      };

      this.cache.set(cacheKey, context);
      return context;
    } catch (err) {
      clearTimeout(timeout);
      logger.warn({ err, groupId, userId }, 'Oracle context injection failed, skipping');
      return {
        userModel: '',
        proceduralGuidance: '',
        recentEpisodes: '',
        relevantKnowledge: '',
        tokenEstimate: 0,
        fromCache: false,
      };
    }
  }

  formatCompact(ctx: CompactContext): string {
    const sections: string[] = [];

    if (ctx.userModel) sections.push(`<user>${ctx.userModel}</user>`);
    if (ctx.proceduralGuidance) sections.push(`<procedural>\n${ctx.proceduralGuidance}\n</procedural>`);
    if (ctx.recentEpisodes) sections.push(`<recent>\n${ctx.recentEpisodes}\n</recent>`);
    if (ctx.relevantKnowledge) sections.push(`<knowledge>\n${ctx.relevantKnowledge}\n</knowledge>`);

    if (sections.length === 0) return '';
    return `<ctx>\n${sections.join('\n')}\n</ctx>`;
  }

  getCacheStats(): { size: number } {
    return { size: this.cache.size };
  }

  clearCache(): void {
    this.cache.clear();
  }
}

let instance: PromptBuilder | undefined;

export function getPromptBuilder(opts?: PromptBuilderOpts): PromptBuilder {
  if (!instance) {
    instance = new PromptBuilder(opts);
  }
  return instance;
}

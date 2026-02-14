/**
 * Prompt Builder - Context-Aware System Prompt Construction
 *
 * Gathers relevant context from Oracle V2 and constructs
 * enriched system prompts for Agent SDK.
 *
 * Features:
 * - Parallel Oracle queries (knowledge, preferences, decisions)
 * - LRU caching for context (5min TTL)
 * - XML-formatted context injection
 * - Graceful fallback when Oracle unavailable
 */

import { createHash } from 'crypto';

interface OracleDocument {
  id: string;
  type: string;
  content: string;
  source_file: string;
  concepts: string[];
  project: string;
  relevance?: number;
}

interface OraclePreference {
  id: string;
  preference: string;
  category: string;
}

interface OracleDecision {
  id: string;
  title: string;
  status: string;
  context: string;
  decision?: string;
  rationale?: string;
  project: string;
  decided_at?: string;
}

interface ConversationSummary {
  id: string;
  summary: string;
  timestamp: number;
}

export interface PromptContext {
  knowledge: OracleDocument[];
  userPrefs: OraclePreference[];
  recentDecisions: OracleDecision[];
  conversationSummary?: ConversationSummary;
  confidence: number;
}

export interface PromptBuilderOpts {
  oracleApiUrl?: string;
  oracleAuthToken?: string;
  cacheTtl?: number; // milliseconds, default 5min
  cacheMax?: number; // default 50
}

interface CacheEntry {
  context: PromptContext;
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

  get(key: string): PromptContext | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (LRU)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.context;
  }

  set(key: string, context: PromptContext): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.max) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      context,
      timestamp: Date.now(),
    });
  }

  clear(): void {
    this.cache.clear();
  }

  stats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

/**
 * Oracle V2 HTTP Client
 */
class OracleClient {
  constructor(
    private baseUrl: string,
    private authToken?: string,
  ) {}

  private async request(
    path: string,
    params?: Record<string, any>,
  ): Promise<any> {
    const url = new URL(path, this.baseUrl);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined) url.searchParams.set(k, String(v));
      });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

    try {
      const response = await fetch(url.toString(), {
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Oracle error ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new Error('Oracle request timeout (5s)');
      }
      throw err;
    }
  }

  async search(query: string, limit = 5): Promise<OracleDocument[]> {
    try {
      const result = await this.request('/api/search', { q: query, limit, mode: 'hybrid' });
      return result.results || [];
    } catch {
      return [];
    }
  }

  async getUserPreferences(userId: string, limit = 3): Promise<OraclePreference[]> {
    try {
      const result = await this.request('/api/search', {
        q: `user preferences ${userId}`,
        type: 'preference',
        limit,
        mode: 'vector',
      });
      return result.results || [];
    } catch {
      return [];
    }
  }

  async getRecentDecisions(limit = 3): Promise<OracleDecision[]> {
    try {
      const result = await this.request('/api/decisions', {
        limit,
        status: 'active',
      });
      return result.decisions || [];
    } catch {
      return [];
    }
  }

  async getConversationSummary(chatJid: string): Promise<ConversationSummary | undefined> {
    try {
      const result = await this.request('/api/thread', { id: chatJid });
      if (result.thread) {
        return {
          id: result.thread.id,
          summary: result.thread.title || '',
          timestamp: Date.now(),
        };
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
}

/**
 * Main Prompt Builder Class
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
   * Build context for a user message
   */
  async buildContext(
    userMessage: string,
    userId: string,
    groupId: string,
  ): Promise<PromptContext> {
    // Generate cache key
    const messageHash = createHash('sha256').update(userMessage).digest('hex').slice(0, 16);
    const cacheKey = `${groupId}:${userId}:${messageHash}`;

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Parallel Oracle queries
    const [knowledge, prefs, decisions, convSummary] = await Promise.all([
      this.oracleClient.search(userMessage, 5),
      this.oracleClient.getUserPreferences(userId, 3),
      this.oracleClient.getRecentDecisions(3),
      this.oracleClient.getConversationSummary(groupId),
    ]);

    // Calculate confidence score
    const knowledgeScore = knowledge.length > 0 ? 0.6 : 0;
    const prefScore = prefs.length > 0 ? 0.2 : 0;
    const decisionScore = decisions.length > 0 ? 0.2 : 0;
    const confidence = knowledgeScore + prefScore + decisionScore;

    const context: PromptContext = {
      knowledge,
      userPrefs: prefs,
      recentDecisions: decisions,
      conversationSummary: convSummary,
      confidence,
    };

    // Cache result
    this.cache.set(cacheKey, context);

    return context;
  }

  /**
   * Format context as XML for system prompt injection
   */
  formatAsXML(context: PromptContext): string {
    const parts: string[] = [];

    // Knowledge section
    if (context.knowledge.length > 0) {
      parts.push('<oracle_context>');
      parts.push(`  <relevant_knowledge confidence="${context.confidence.toFixed(2)}">`);
      for (const doc of context.knowledge.slice(0, 5)) {
        parts.push(`    - Document: "${doc.type}" (relevance: ${doc.relevance || 0.8})`);
        parts.push(`      Content: ${doc.content.slice(0, 200)}...`);
        parts.push(`      Source: ${doc.source_file}`);
      }
      parts.push('  </relevant_knowledge>');
      parts.push('</oracle_context>');
    }

    // User preferences
    if (context.userPrefs.length > 0) {
      parts.push('<user_preferences>');
      for (const pref of context.userPrefs) {
        parts.push(`  - ${pref.category}: ${pref.preference}`);
      }
      parts.push('</user_preferences>');
    }

    // Recent decisions
    if (context.recentDecisions.length > 0) {
      parts.push('<recent_decisions>');
      for (const dec of context.recentDecisions) {
        parts.push(`  - Decision: "${dec.title}" (${dec.status})`);
        if (dec.decision) {
          parts.push(`    Made: ${dec.decision}`);
        }
        if (dec.rationale) {
          parts.push(`    Reason: ${dec.rationale.slice(0, 100)}`);
        }
        parts.push(`    Date: ${dec.decided_at || 'pending'}`);
      }
      parts.push('</recent_decisions>');
    }

    // Conversation summary
    if (context.conversationSummary) {
      parts.push('<conversation_history>');
      parts.push(`  Last conversation: ${context.conversationSummary.summary}`);
      parts.push(`  ID: ${context.conversationSummary.id}`);
      parts.push('</conversation_history>');
    }

    return parts.join('\n');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; keys: string[] } {
    return this.cache.stats();
  }

  /**
   * Clear cache (e.g., after Oracle update)
   */
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

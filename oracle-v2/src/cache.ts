/**
 * Oracle V2 Search Cache
 *
 * Simple LRU cache for search results with TTL support.
 * No external dependencies — uses a Map with LRU eviction.
 */

interface CacheEntry<T> {
  value: T;
  createdAt: number;
}

export class SearchCache<T = any> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxSize: number;
  private ttlMs: number;
  private _hits = 0;
  private _misses = 0;

  constructor(maxSize: number = 1000, ttlMs: number = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /**
   * Generate a normalized cache key for search queries
   */
  static makeKey(query: string, mode: string, limit: number, type: string = 'all', project?: string): string {
    return `${mode}:${type}:${limit}:${project ?? ''}:${query.toLowerCase().trim()}`;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this._misses++;
      return undefined;
    }

    // Check TTL
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(key);
      this._misses++;
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    this._hits++;
    return entry.value;
  }

  set(key: string, value: T): void {
    // Delete first to reset position if exists
    this.cache.delete(key);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }

    this.cache.set(key, { value, createdAt: Date.now() });
  }

  /**
   * Clear all cached results (called on write operations)
   */
  invalidate(): void {
    this.cache.clear();
  }

  get stats() {
    return {
      hits: this._hits,
      misses: this._misses,
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
      hitRate: this._hits + this._misses > 0
        ? ((this._hits / (this._hits + this._misses)) * 100).toFixed(1) + '%'
        : 'N/A',
    };
  }
}

/** Singleton search cache */
export const searchCache = new SearchCache(1000, 5 * 60 * 1000);

/**
 * File Watcher for Incremental Indexing (P0 - Critical)
 * 
 * Watches ψ/memory/* for file changes and triggers incremental indexing
 * to make newly learned information searchable within 2-5 seconds.
 * 
 * Features:
 * - Recursive watch on memory directories
 * - Debouncing to avoid redundant indexes
 * - Only index .md files
 * - Graceful error handling
 */

import { watch, type FSWatcher } from 'fs';
import path from 'path';
import { OracleIndexer } from './indexer.js';
import { logNonFatal } from './non-fatal.js';

interface FileWatcherConfig {
  memoryRoot: string;
  debounceMs?: number;
  enabled?: boolean;
}

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private indexer: OracleIndexer;
  private config: FileWatcherConfig;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private indexQueue: Set<string> = new Set();
  private isProcessing = false;

  constructor(indexer: OracleIndexer, config: FileWatcherConfig) {
    this.indexer = indexer;
    this.config = {
      debounceMs: 2000,
      enabled: true,
      ...config,
    };
  }

  /**
   * Start watching ψ/memory/* for changes
   */
  start(): void {
    if (!this.config.enabled) {
      console.log('[FileWatcher] Disabled via config');
      return;
    }

    if (this.watcher) {
      console.warn('[FileWatcher] Already watching');
      return;
    }

    try {
      console.log(`[FileWatcher] 👀 Watching: ${this.config.memoryRoot}`);
      
      this.watcher = watch(
        this.config.memoryRoot,
        { recursive: true },
        (eventType, filename) => {
          this.handleFileChange(eventType, filename);
        }
      );

      console.log('[FileWatcher] ✅ Started');
    } catch (error) {
      logNonFatal('file_watcher.start', error, { memoryRoot: this.config.memoryRoot });
      console.error('[FileWatcher] ❌ Failed to start:', error);
    }
  }

  /**
   * Handle file system change event
   */
  private handleFileChange(eventType: string, filename: string | null): void {
    if (!filename) return;

    // Only index .md files
    if (!filename.endsWith('.md')) return;

    // Ignore temporary files and hidden files
    if (filename.includes('~') || filename.startsWith('.')) return;

    const fullPath = path.join(this.config.memoryRoot, filename);
    
    console.log(`[FileWatcher] 📝 Detected ${eventType}: ${filename}`);

    // Clear existing debounce timer
    const existingTimer = this.debounceTimers.get(filename);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Add to queue and schedule debounced processing
    const timer = setTimeout(() => {
      this.indexQueue.add(fullPath);
      this.debounceTimers.delete(filename);
      this.processQueue();
    }, this.config.debounceMs);

    this.debounceTimers.set(filename, timer);
  }

  /**
   * Process queued files for indexing
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.indexQueue.size === 0) return;

    this.isProcessing = true;

    // Process all queued files
    const files = Array.from(this.indexQueue);
    this.indexQueue.clear();

    console.log(`[FileWatcher] 🔄 Processing ${files.length} file(s)...`);

    for (const filePath of files) {
      await this.indexSingleFile(filePath);
    }

    this.isProcessing = false;

    // Check if more files were added while processing
    if (this.indexQueue.size > 0) {
      this.processQueue();
    }
  }

  /**
   * Index a single file (incremental update)
   */
  private async indexSingleFile(filePath: string): Promise<void> {
    const startTime = Date.now();

    try {
      const relPath = path.relative(this.config.memoryRoot, filePath);
      console.log(`[FileWatcher] 📇 Indexing: ${relPath}`);

      // Call indexer's incremental index method
      await this.indexer.indexSingleFile(filePath);

      const duration = Date.now() - startTime;
      console.log(`[FileWatcher] ✅ Indexed ${relPath} (${duration}ms)`);
    } catch (error) {
      logNonFatal('file_watcher.index_single', error, { filePath });
      console.error(`[FileWatcher] ❌ Failed to index ${filePath}:`, error);
    }
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (!this.watcher) return;

    // Clear all pending timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Close watcher
    this.watcher.close();
    this.watcher = null;

    console.log('[FileWatcher] 👋 Stopped');
  }

  /**
   * Get current status
   */
  get status() {
    return {
      isWatching: this.watcher !== null,
      queueSize: this.indexQueue.size,
      pendingDebounce: this.debounceTimers.size,
      isProcessing: this.isProcessing,
    };
  }
}

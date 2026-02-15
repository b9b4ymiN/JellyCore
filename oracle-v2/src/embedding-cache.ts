/**
 * Embedding Cache Layer (v0.5.0)
 *
 * Tracks which embedding model was used for each document.
 * Enables graceful model migration:
 *   1. Change model config → getStaleDocuments() returns docs with old model
 *   2. Background job re-embeds in batches
 *   3. No downtime — old embeddings still work until replaced
 *
 * Uses the embedding_model, embedding_version, embedding_hash columns
 * added to oracle_documents in the v0.5.0 schema migration.
 */

import crypto from 'crypto';
import { db, sqlite, oracleDocuments } from './db/index.js';
import { eq, ne, isNull, or, sql } from 'drizzle-orm';

// Current embedding model config (change this when upgrading models)
const CURRENT_MODEL = process.env.EMBEDDING_MODEL || 'all-MiniLM-L6-v2';
const CURRENT_VERSION = parseInt(process.env.EMBEDDING_VERSION || '1', 10);

export class EmbeddingCache {
  /**
   * Get the current embedding model name.
   */
  get currentModel(): string {
    return CURRENT_MODEL;
  }

  /**
   * Get the current embedding version.
   */
  get currentVersion(): number {
    return CURRENT_VERSION;
  }

  /**
   * Compute SHA-256 hash of content for change detection.
   */
  static contentHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Check if a document already has an up-to-date embedding.
   * Returns true if the document's embedding model matches current AND content hasn't changed.
   */
  hasCurrentEmbedding(docId: string, contentHash: string): boolean {
    const doc = db.select({
      embeddingModel: oracleDocuments.embeddingModel,
      embeddingHash: oracleDocuments.embeddingHash,
    })
      .from(oracleDocuments)
      .where(eq(oracleDocuments.id, docId))
      .get();

    if (!doc) return false;
    return doc.embeddingModel === CURRENT_MODEL && doc.embeddingHash === contentHash;
  }

  /**
   * Record that a document has been embedded with the current model.
   */
  recordEmbedding(docId: string, contentHash: string): void {
    db.update(oracleDocuments)
      .set({
        embeddingModel: CURRENT_MODEL,
        embeddingVersion: CURRENT_VERSION,
        embeddingHash: contentHash,
      })
      .where(eq(oracleDocuments.id, docId))
      .run();
  }

  /**
   * Get documents that need re-embedding.
   * Returns doc IDs where:
   *   - embedding_model differs from current model, OR
   *   - embedding_model is NULL (legacy docs before v0.5.0), OR
   *   - embedding_hash is NULL (never tracked)
   */
  getStaleDocuments(limit: number = 100): { id: string; sourceFile: string; currentModel: string | null }[] {
    return db.select({
      id: oracleDocuments.id,
      sourceFile: oracleDocuments.sourceFile,
      currentModel: oracleDocuments.embeddingModel,
    })
      .from(oracleDocuments)
      .where(
        or(
          ne(oracleDocuments.embeddingModel, CURRENT_MODEL),
          isNull(oracleDocuments.embeddingModel),
          isNull(oracleDocuments.embeddingHash),
        )
      )
      .limit(limit)
      .all();
  }

  /**
   * Get stats about embedding model coverage.
   */
  getStats(): {
    total: number;
    current: number;
    stale: number;
    untracked: number;
    models: Record<string, number>;
  } {
    // Total docs
    const totalResult = db.select({ count: sql<number>`count(*)` })
      .from(oracleDocuments)
      .get();
    const total = totalResult?.count || 0;

    // Docs with current model
    const currentResult = db.select({ count: sql<number>`count(*)` })
      .from(oracleDocuments)
      .where(eq(oracleDocuments.embeddingModel, CURRENT_MODEL))
      .get();
    const current = currentResult?.count || 0;

    // Docs with no model tracking (NULL)
    const untrackedResult = db.select({ count: sql<number>`count(*)` })
      .from(oracleDocuments)
      .where(isNull(oracleDocuments.embeddingModel))
      .get();
    const untracked = untrackedResult?.count || 0;

    // Count by model
    const modelCounts = db.select({
      model: oracleDocuments.embeddingModel,
      count: sql<number>`count(*)`,
    })
      .from(oracleDocuments)
      .groupBy(oracleDocuments.embeddingModel)
      .all();

    const models: Record<string, number> = {};
    for (const row of modelCounts) {
      models[row.model || '(untracked)'] = row.count;
    }

    return {
      total,
      current,
      stale: total - current,
      untracked,
      models,
    };
  }
}

// ── Singleton ──

let embeddingCache: EmbeddingCache | null = null;

export function getEmbeddingCache(): EmbeddingCache {
  if (!embeddingCache) {
    embeddingCache = new EmbeddingCache();
  }
  return embeddingCache;
}

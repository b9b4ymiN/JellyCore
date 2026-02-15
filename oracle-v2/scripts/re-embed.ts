/**
 * Re-embed Script (v0.6.0 Part B.3)
 *
 * Migrates all documents to the currently configured embedding model.
 * Safe to run multiple times — uses EmbeddingCache for change detection.
 *
 * Usage:
 *   bun run re-embed                     # Uses default model (env EMBEDDING_MODEL)
 *   EMBEDDING_MODEL=multilingual-e5-small bun run re-embed
 *
 * What it does:
 *   1. Compare current model vs documents' embedding_model
 *   2. Delete old ChromaDB collection (if dimension changed)
 *   3. Re-embed all stale documents with new model
 *   4. Update embedding metadata in SQLite
 *   5. Report stats
 */

import { eq } from 'drizzle-orm';
import { db, sqlite, oracleDocuments, ensureSchema, initFts5 } from '../db/index.js';
import { createEmbedder } from '../embedder.js';
import { ChromaHttpClient } from '../chroma-http.js';
import { getEmbeddingCache, EmbeddingCache } from '../embedding-cache.js';

async function main() {
  // Initialize
  ensureSchema();
  initFts5();

  const embedder = createEmbedder();
  const cache = getEmbeddingCache();
  const stats = cache.getStats();

  console.log('=== Oracle Re-embed Tool ===');
  console.log(`Target model:  ${embedder.modelName} (${embedder.dimensions}-dim)`);
  console.log(`Current stats: ${stats.total} total, ${stats.current} current, ${stats.stale} stale`);
  console.log(`Models in DB:  ${JSON.stringify(stats.models)}`);
  console.log();

  if (stats.stale === 0) {
    console.log('✅ All documents are up-to-date. Nothing to do.');
    return;
  }

  // Initialize ChromaDB client with new embedder
  const chroma = new ChromaHttpClient(
    'oracle_knowledge',
    process.env.CHROMA_URL || 'http://localhost:8000',
    process.env.CHROMA_AUTH_TOKEN,
    embedder,
  );

  // Check if we need to recreate the collection (dimension change)
  // MiniLM = 384, E5-small = 384 → no recreation needed
  // E5-base = 768, E5-large = 1024 → recreation needed
  const prevModels = Object.keys(stats.models).filter(m => m !== '(untracked)');
  const dimensionChanged = prevModels.some(m => {
    if (m === 'all-MiniLM-L6-v2') return embedder.dimensions !== 384;
    if (m.includes('e5-small')) return embedder.dimensions !== 384;
    if (m.includes('e5-base')) return embedder.dimensions !== 768;
    if (m.includes('e5-large')) return embedder.dimensions !== 1024;
    return true; // Unknown model → recreate to be safe
  });

  if (dimensionChanged) {
    console.log(`⚠️  Dimension changed → recreating ChromaDB collection`);
    await chroma.deleteCollection();
    await chroma.ensureCollection();
  } else {
    await chroma.ensureCollection();
  }

  // Get all stale documents
  const staleDocs = cache.getStaleDocuments(100000);
  console.log(`📝 Re-embedding ${staleDocs.length} documents...`);
  console.log();

  let success = 0;
  let skipped = 0;
  let failed = 0;
  const startTime = Date.now();

  for (let i = 0; i < staleDocs.length; i++) {
    const doc = staleDocs[i];

    try {
      // Read content from FTS table
      const ftsRow = sqlite.prepare('SELECT content FROM oracle_fts WHERE id = ?').get(doc.id) as any;
      if (!ftsRow?.content) {
        console.warn(`  [${i + 1}/${staleDocs.length}] ${doc.id} — no FTS content, skipping`);
        skipped++;
        continue;
      }

      const content = ftsRow.content;
      const hash = EmbeddingCache.contentHash(content);

      // Skip if already up-to-date (race condition guard)
      if (cache.hasCurrentEmbedding(doc.id, hash)) {
        skipped++;
        continue;
      }

      // Embed with new model
      const embeddings = await embedder.embedDocuments([content]);

      // Get metadata for ChromaDB
      const docRow = db.select({
        type: oracleDocuments.type,
        sourceFile: oracleDocuments.sourceFile,
        concepts: oracleDocuments.concepts,
      }).from(oracleDocuments).where(
        eq(oracleDocuments.id, doc.id),
      ).get();

      const metadata = docRow ? {
        type: docRow.type,
        source_file: docRow.sourceFile,
        concepts: JSON.parse(docRow.concepts || '[]').join(','),
      } : { type: 'unknown', source_file: '', concepts: '' };

      // Upsert to ChromaDB (add handles upsert for existing IDs)
      await chroma.addDocuments([{
        id: doc.id,
        document: content,
        metadata,
      }]);

      // Record in cache
      cache.recordEmbedding(doc.id, hash);
      success++;

      // Progress report every 10 documents
      if ((i + 1) % 10 === 0 || i === staleDocs.length - 1) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const pct = (((i + 1) / staleDocs.length) * 100).toFixed(0);
        console.log(`  [${i + 1}/${staleDocs.length}] ${pct}% — ${success} done, ${elapsed}s elapsed`);
      }
    } catch (err) {
      console.error(`  [${i + 1}/${staleDocs.length}] ${doc.id} — FAILED:`, err);
      failed++;
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log();
  console.log('=== Re-embed Complete ===');
  console.log(`✅ Success: ${success}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`❌ Failed:  ${failed}`);
  console.log(`⏱️  Time:    ${totalTime}s`);
  console.log();
  console.log('Updated stats:', cache.getStats());
}

main().catch(err => {
  console.error('Re-embed failed:', err);
  process.exit(1);
});

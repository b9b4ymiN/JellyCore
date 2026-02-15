/**
 * Re-index FTS5 with Thai NLP segmentation
 *
 * This script re-processes all oracle_documents through the thai-nlp sidecar,
 * replacing FTS5 content with properly segmented Thai text.
 *
 * IMPORTANT: Query time + index time must use the same tokenizer engine (newmm).
 *
 * Usage:
 *   bun run scripts/reindex-with-thai-nlp.ts
 *
 * Prerequisites:
 *   - thai-nlp sidecar must be running (docker compose up thai-nlp)
 *   - Oracle V2 database must exist
 *
 * Safety:
 *   - Creates backup of FTS5 data before re-indexing
 *   - Processes in batches of 50 (won't overwhelm sidecar)
 *   - Aborts with clear message if sidecar is unreachable
 */

import { Database } from 'bun:sqlite';
import path from 'path';
import fs from 'fs';
import { ThaiNlpClient } from '../src/thai-nlp-client.js';

// ── Config ──
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '/tmp';
const ORACLE_DATA_DIR = process.env.ORACLE_DATA_DIR || path.join(HOME_DIR, '.oracle-v2');
const DB_PATH = process.env.ORACLE_DB_PATH || path.join(ORACLE_DATA_DIR, 'oracle.db');
const BATCH_SIZE = 50;

const thaiNlpUrl = process.env.THAI_NLP_URL || 'http://localhost:47780';

// ── Main ──

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  Re-index FTS5 with Thai NLP segmentation   ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log();

  // 1. Check sidecar connectivity
  const client = new ThaiNlpClient(thaiNlpUrl, 5000);
  console.log(`[1/5] Checking thai-nlp sidecar at ${thaiNlpUrl}...`);

  try {
    const health = await client.health();
    console.log(`  ✓ Sidecar online (PyThaiNLP v${health.pythainlp_version})\n`);
  } catch (err) {
    console.error(`  ✗ Cannot reach sidecar at ${thaiNlpUrl}`);
    console.error(`    Make sure thai-nlp service is running: docker compose up thai-nlp`);
    console.error(`    Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // 2. Open database
  console.log(`[2/5] Opening database: ${DB_PATH}`);
  if (!fs.existsSync(DB_PATH)) {
    console.error(`  ✗ Database not found: ${DB_PATH}`);
    process.exit(1);
  }
  const db = new Database(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');

  // 3. Backup FTS5 data
  console.log(`[3/5] Backing up FTS5 data...`);
  const allFts = db.prepare('SELECT id, content, concepts FROM oracle_fts').all() as {
    id: string;
    content: string;
    concepts: string;
  }[];
  console.log(`  ✓ Backed up ${allFts.length} documents in memory\n`);

  if (allFts.length === 0) {
    console.log('  No documents to re-index. Done.');
    db.close();
    return;
  }

  // 4. Re-index in batches
  console.log(`[4/5] Re-indexing ${allFts.length} documents (batch size: ${BATCH_SIZE})...\n`);

  const updateStmt = db.prepare('UPDATE oracle_fts SET content = ? WHERE id = ?');

  let processed = 0;
  let changed = 0;
  let errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < allFts.length; i += BATCH_SIZE) {
    const batch = allFts.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(allFts.length / BATCH_SIZE);

    for (const doc of batch) {
      try {
        // Normalize + tokenize via sidecar
        const { segmented } = await client.normalizeAndTokenize(doc.content);

        if (segmented !== doc.content) {
          updateStmt.run(segmented, doc.id);
          changed++;
        }
        processed++;
      } catch (err) {
        errors++;
        console.warn(`  ⚠ Error processing ${doc.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const pct = Math.round((Math.min(i + BATCH_SIZE, allFts.length) / allFts.length) * 100);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stdout.write(`\r  [${batchNum}/${totalBatches}] ${pct}% — ${processed} processed, ${changed} changed (${elapsed}s)`);
  }

  console.log('\n');

  // 5. Summary
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[5/5] Done!`);
  console.log(`  ├── Processed: ${processed}/${allFts.length} documents`);
  console.log(`  ├── Changed:   ${changed} documents re-segmented`);
  console.log(`  ├── Errors:    ${errors}`);
  console.log(`  ├── Time:      ${totalTime}s`);
  console.log(`  └── Rate:      ${(processed / parseFloat(totalTime)).toFixed(0)} docs/s`);

  if (errors > 0) {
    console.log(`\n  ⚠ ${errors} documents failed — they keep their original FTS5 content.`);
  }

  db.close();
  console.log('\n✓ Re-indexing complete. FTS5 now uses Thai-segmented content.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

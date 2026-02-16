/**
 * Temporal Decay System (Part D — Five-Layer Memory v0.7.0)
 *
 * คำนวณ decay_score สำหรับทุก document เพื่อปรับ search ranking:
 * - ข้อมูลใหม่ + เข้าถึงบ่อย → score สูง
 * - ข้อมูลเก่า + ไม่เคยเข้าถึง → score ต่ำ
 *
 * สูตร: decay_score = recencyFactor × accessFactor
 *
 *   recencyFactor = e^(-λ × daysSinceUpdate)
 *     λ = 0.01 → half-life ~69 วัน (doc อายุ 69 วัน = score ~0.5)
 *
 *   accessFactor = min(1.0, 0.5 + accessCount × 0.05)
 *     เข้าถึง 10+ ครั้ง = factor 1.0
 *     ไม่เคยเข้าถึง    = factor 0.5
 *
 * ข้อยกเว้น:
 *   - user_model:  decay_score = 1.0 เสมอ (ไม่ decay)
 *   - procedural:  λ = 0.005 (ช้ากว่า, half-life ~139 วัน)
 */

import { sql } from 'drizzle-orm';
import { db, oracleDocuments } from '../db/index.js';
import { floatToInt } from '../types.js';

const MS_PER_DAY = 86_400_000;

/** Default λ for semantic/episodic */
const LAMBDA_DEFAULT = 0.01;
/** Slower λ for procedural memory */
const LAMBDA_PROCEDURAL = 0.005;

/**
 * Compute decay score for a single document
 *
 * @returns integer 0-100 (stored as-is in DB)
 */
export function computeDecayScore(doc: {
  updatedAt: number | null;
  accessCount: number | null;
  memoryLayer?: string | null;
  now?: number;
}): number {
  const now = doc.now ?? Date.now();

  // user_model never decays
  if (doc.memoryLayer === 'user_model') return 100;

  const updatedAt = doc.updatedAt ?? now;
  const accessCount = doc.accessCount ?? 0;

  // Pick λ based on layer
  const lambda = doc.memoryLayer === 'procedural' ? LAMBDA_PROCEDURAL : LAMBDA_DEFAULT;

  // recencyFactor = e^(-λ × days)
  const daysSinceUpdate = Math.max(0, (now - updatedAt) / MS_PER_DAY);
  const recencyFactor = Math.exp(-lambda * daysSinceUpdate);

  // accessFactor = min(1.0, 0.5 + accessCount × 0.05)
  const accessFactor = Math.min(1.0, 0.5 + accessCount * 0.05);

  // Combined score: 0.0 - 1.0
  const score = recencyFactor * accessFactor;

  return floatToInt(score);
}

/**
 * Background job: อัปเดต decay_score ทุก document
 * เรียกทุก 6 ชั่วโมง + เมื่อ server start
 *
 * ใช้ batch UPDATE ผ่าน raw SQL เพื่อ performance
 * (Drizzle ไม่รองรับ CASE expression ใน UPDATE ได้สะดวก)
 */
export async function refreshAllDecayScores(): Promise<{ updated: number }> {
  const now = Date.now();

  // Fetch all docs ที่ต้อง compute (ไม่รวม user_model ที่ไม่ decay)
  const rows = db
    .select({
      id: oracleDocuments.id,
      updatedAt: oracleDocuments.updatedAt,
      accessCount: oracleDocuments.accessCount,
      memoryLayer: oracleDocuments.memoryLayer,
    })
    .from(oracleDocuments)
    .all();

  let updated = 0;

  // Batch update in chunks of 100 for efficiency
  const BATCH_SIZE = 100;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    for (const row of batch) {
      const newScore = computeDecayScore({
        updatedAt: row.updatedAt,
        accessCount: row.accessCount,
        memoryLayer: row.memoryLayer,
        now,
      });

      db.update(oracleDocuments)
        .set({ decayScore: newScore })
        .where(sql`${oracleDocuments.id} = ${row.id}`)
        .run();

      updated++;
    }
  }

  return { updated };
}

/**
 * Track access: increment access_count + update last_accessed_at
 * Called after search results are returned (fire-and-forget)
 */
export function trackAccess(docIds: string[]): void {
  if (docIds.length === 0) return;

  const now = Date.now();
  for (const id of docIds) {
    try {
      db.update(oracleDocuments)
        .set({
          accessCount: sql`COALESCE(${oracleDocuments.accessCount}, 0) + 1`,
          lastAccessedAt: now,
        })
        .where(sql`${oracleDocuments.id} = ${id}`)
        .run();
    } catch {
      // Non-critical — don't fail the request
    }
  }
}

/**
 * Compute confidence score for new learnings
 *
 * Confidence rules:
 *   origin = 'human'            → 0.95
 *   origin = 'mother'           → 0.90
 *   explicit source (has URL)   → 0.80
 *   correction                  → 0.85
 *   auto-extracted              → 0.60
 */
export function computeConfidence(origin?: string | null, source?: string | null): number {
  if (origin === 'human') return 0.95;
  if (origin === 'mother') return 0.90;

  // Source contains URL → probably has reference
  if (source && /https?:\/\//.test(source)) return 0.80;

  // Source mentions correction
  if (source && /correct|fix|แก้|ปรับ/i.test(source)) return 0.85;

  // Default: auto-extracted without strong provenance
  return 0.60;
}

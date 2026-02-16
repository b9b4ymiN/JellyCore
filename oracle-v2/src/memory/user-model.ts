/**
 * User Model Store (Layer 1 — Five-Layer Memory)
 *
 * เก็บข้อมูลเกี่ยวกับ user: expertise, preferences, communication style
 * ถูกดึงเข้า system prompt ทุก request เพื่อ personalize response
 *
 * Storage strategy:
 *   - 1 document per user ใน oracle_documents
 *   - id = 'user_model_{userId}'
 *   - memory_layer = 'user_model'
 *   - type = 'learning' (reuse existing type)
 *   - is_private = 1 (ไม่ให้ agent อื่นเห็น)
 *   - ไม่สร้างไฟล์ Markdown (ข้อมูลส่วนตัว)
 *   - decay_score = 100 เสมอ (user_model ไม่ decay)
 */

import { eq } from 'drizzle-orm';
import { db, oracleDocuments } from '../db/index.js';
import {
  type UserModel,
  DEFAULT_USER_MODEL,
  floatToInt,
} from '../types.js';

/**
 * Deep merge two objects (recursive, not overwrite)
 * Arrays are replaced, not merged
 */
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (
      sourceVal !== null &&
      sourceVal !== undefined &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal) &&
      targetVal !== null
    ) {
      // Recursively merge nested objects
      result[key] = deepMerge(targetVal as any, sourceVal as any);
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal as T[keyof T];
    }
  }
  return result;
}

export class UserModelStore {
  /**
   * ดึง User Model สำหรับ userId
   * ถ้ายังไม่มี → สร้าง default model
   */
  async get(userId: string): Promise<UserModel> {
    const docId = `user_model_${userId}`;

    const rows = await db
      .select()
      .from(oracleDocuments)
      .where(eq(oracleDocuments.id, docId));

    if (rows.length === 0) {
      // สร้าง default model
      const model: UserModel = {
        userId,
        ...DEFAULT_USER_MODEL,
        updatedAt: Date.now(),
      };
      return model;
    }

    // Parse content stored in source_file field as "memory://user_model/{userId}"
    // Actual model data is stored in concepts field as JSON (since we don't use content column in Drizzle schema)
    try {
      // We store the UserModel JSON in a special way:
      // The model is embedded in concepts as: ["memory:user_model", "user:{userId}", "{modelJSON}"]
      const concepts = JSON.parse(rows[0].concepts) as string[];
      const modelJson = concepts.find(c => c.startsWith('{'));
      if (modelJson) {
        return JSON.parse(modelJson) as UserModel;
      }
    } catch {
      // Fallback: return default
    }

    return {
      userId,
      ...DEFAULT_USER_MODEL,
      updatedAt: Date.now(),
    };
  }

  /**
   * อัปเดต User Model (deep merge กับ existing)
   * ไม่ overwrite ทั้ง object — merge เฉพาะ field ที่ส่งมา
   */
  async update(userId: string, partial: Partial<UserModel>): Promise<UserModel> {
    const existing = await this.get(userId);

    // Deep merge — ไม่ลบ key อื่นที่มีอยู่เดิม
    const merged: UserModel = deepMerge(existing, {
      ...partial,
      userId, // ensure userId stays consistent
      updatedAt: Date.now(),
    });

    const docId = `user_model_${userId}`;
    const now = Date.now();

    // Store model as third element in concepts array
    const conceptsArray = [
      'memory:user_model',
      `user:${userId}`,
      JSON.stringify(merged),
    ];

    const existingRows = await db
      .select({ id: oracleDocuments.id })
      .from(oracleDocuments)
      .where(eq(oracleDocuments.id, docId));

    if (existingRows.length > 0) {
      // UPDATE existing
      await db
        .update(oracleDocuments)
        .set({
          concepts: JSON.stringify(conceptsArray),
          updatedAt: now,
          confidence: floatToInt(0.95),
        })
        .where(eq(oracleDocuments.id, docId));
    } else {
      // INSERT new
      await db.insert(oracleDocuments).values({
        id: docId,
        type: 'learning',
        sourceFile: `memory://user_model/${userId}`,
        concepts: JSON.stringify(conceptsArray),
        createdAt: now,
        updatedAt: now,
        indexedAt: now,
        memoryLayer: 'user_model',
        confidence: floatToInt(0.95),
        isPrivate: 1,
        decayScore: 100, // user_model never decays
        createdBy: 'memory_system',
      });
    }

    return merged;
  }

  /**
   * ลบ User Model (reset)
   */
  async reset(userId: string): Promise<void> {
    const docId = `user_model_${userId}`;
    await db
      .delete(oracleDocuments)
      .where(eq(oracleDocuments.id, docId));
  }
}

// Singleton
let _store: UserModelStore | null = null;
export function getUserModelStore(): UserModelStore {
  if (!_store) {
    _store = new UserModelStore();
  }
  return _store;
}

// For testing — reset singleton
export function resetUserModelStore(): void {
  _store = null;
}

/** Deep merge utility exported for testing */
export { deepMerge };

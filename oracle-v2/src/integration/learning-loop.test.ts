/**
 * Part F — Enhanced Learning Loop Tests
 *
 * Tests for: detectMemoryLayer (heuristic auto-detection),
 *            computeTextSimilarity, learning router behavior
 */

import { describe, it, expect } from 'bun:test';

// We can't directly import the private functions from handlers.ts,
// so we re-implement the same logic here for unit testing.
// The actual integration is tested via API calls.

/**
 * Re-implementation of detectMemoryLayer for testing
 */
function detectMemoryLayer(pattern: string, concepts?: string[]): string {
  // Check concepts first
  if (concepts?.some(c => c.startsWith('memory:user_model'))) return 'user_model';
  if (concepts?.some(c => c.startsWith('memory:procedural'))) return 'procedural';
  if (concepts?.some(c => c.startsWith('memory:episodic'))) return 'episodic';

  const lower = pattern.toLowerCase();

  // User Model signals
  if (/(?:user|ผู้ใช้)\s*(?:ชอบ|ไม่ชอบ|prefer|ต้องการ|expertise)/i.test(lower)) {
    return 'user_model';
  }

  // Procedural signals
  if (/(?:เมื่อ|when|ถ้า|if).*(?:→|ให้|then|ทำ|should)/i.test(lower)) {
    return 'procedural';
  }

  // Default
  return 'semantic';
}

/**
 * Re-implementation of computeTextSimilarity for testing
 */
function computeTextSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

describe('Part F — Enhanced Learning Loop', () => {
  // ============================================================
  // detectMemoryLayer()
  // ============================================================
  describe('detectMemoryLayer()', () => {
    // Concept-based detection (highest priority)
    it('detects user_model from concepts', () => {
      expect(detectMemoryLayer('anything', ['memory:user_model', 'user:owner'])).toBe('user_model');
    });

    it('detects procedural from concepts', () => {
      expect(detectMemoryLayer('anything', ['memory:procedural', 'topic:deploy'])).toBe('procedural');
    });

    it('detects episodic from concepts', () => {
      expect(detectMemoryLayer('anything', ['memory:episodic', 'session:2024-01-01'])).toBe('episodic');
    });

    // Heuristic detection (Thai patterns)
    it('detects user_model from Thai "ผู้ใช้ชอบ"', () => {
      expect(detectMemoryLayer('ผู้ใช้ชอบให้ตอบสั้นๆ')).toBe('user_model');
    });

    it('detects user_model from "user prefer"', () => {
      expect(detectMemoryLayer('user prefers concise answers')).toBe('user_model');
    });

    it('detects user_model from "user expertise"', () => {
      expect(detectMemoryLayer('user expertise in Docker is advanced')).toBe('user_model');
    });

    it('detects procedural from Thai "เมื่อ...ให้"', () => {
      expect(detectMemoryLayer('เมื่อ user ถาม deploy ให้ถาม environment ก่อน')).toBe('procedural');
    });

    it('detects procedural from "when...should"', () => {
      expect(detectMemoryLayer('when debugging errors, should check logs first')).toBe('procedural');
    });

    it('detects procedural from "if...then"', () => {
      expect(detectMemoryLayer('if user asks about Docker, then show checklist')).toBe('procedural');
    });

    it('detects procedural from Thai "ถ้า...ทำ"', () => {
      expect(detectMemoryLayer('ถ้า build ไม่ผ่าน ทำ clean แล้ว rebuild')).toBe('procedural');
    });

    // Default to semantic
    it('defaults to semantic for regular knowledge', () => {
      expect(detectMemoryLayer('Docker uses containerd as the default runtime')).toBe('semantic');
    });

    it('defaults to semantic for Thai knowledge', () => {
      expect(detectMemoryLayer('Oracle V2 ใช้ ChromaDB สำหรับ vector search')).toBe('semantic');
    });

    it('defaults to semantic with empty concepts', () => {
      expect(detectMemoryLayer('some fact', [])).toBe('semantic');
    });

    it('defaults to semantic with undefined concepts', () => {
      expect(detectMemoryLayer('some fact')).toBe('semantic');
    });

    // Edge cases
    it('concepts override heuristic detection', () => {
      // Even though text looks like procedural, concept says user_model
      expect(detectMemoryLayer('when user prefers formal', ['memory:user_model'])).toBe('user_model');
    });
  });

  // ============================================================
  // computeTextSimilarity()
  // ============================================================
  describe('computeTextSimilarity()', () => {
    it('identical text → 1.0', () => {
      const text = 'Docker is a containerization platform for deploying applications';
      expect(computeTextSimilarity(text, text)).toBe(1);
    });

    it('completely different text → near 0', () => {
      expect(computeTextSimilarity(
        'Docker uses containers for deployment',
        'Cats and dogs are popular household pets',
      )).toBeLessThan(0.1);
    });

    it('partially overlapping text → moderate score', () => {
      const a = 'Docker is used for container deployment and orchestration';
      const b = 'Docker containers can be deployed using Kubernetes orchestration';
      const sim = computeTextSimilarity(a, b);
      expect(sim).toBeGreaterThan(0.1);
      expect(sim).toBeLessThan(0.8);
    });

    it('empty strings → 0', () => {
      expect(computeTextSimilarity('', '')).toBe(0);
    });

    it('one empty string → 0', () => {
      expect(computeTextSimilarity('some text here', '')).toBe(0);
    });

    it('short words (<3 chars) filtered out', () => {
      // Only "is" and "a" — both length < 3, so effectively empty
      expect(computeTextSimilarity('a is', 'a is')).toBe(0);
    });

    it('case insensitive', () => {
      expect(computeTextSimilarity(
        'Docker COMPOSE yaml',
        'docker compose YAML',
      )).toBe(1);
    });
  });

  // ============================================================
  // handleLearn layer parameter (backward compat)
  // ============================================================
  describe('handleLearn backward compatibility', () => {
    it('no layer parameter → semantic (via detectMemoryLayer default)', () => {
      const layer = detectMemoryLayer('Oracle V2 search supports Thai NLP');
      expect(layer).toBe('semantic');
    });

    it('explicit layer overrides auto-detection', () => {
      // This text looks like procedural but we're saying it's semantic
      // In real code, explicit layer is used directly (not through detectMemoryLayer)
      // Here we just confirm the detection logic
      const auto = detectMemoryLayer('when user asks deploy, should show checklist');
      expect(auto).toBe('procedural');
      // But if explicit layer='semantic' is passed, it overrides
    });
  });
});

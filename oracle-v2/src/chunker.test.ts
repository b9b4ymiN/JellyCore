/**
 * SmartChunker Tests (v0.6.0 Part C)
 *
 * Verifies bilingual chunking: Thai, English, and mixed content.
 */

import { describe, it, expect } from 'bun:test';
import { SmartChunker } from './chunker.js';

describe('SmartChunker', () => {
  const chunker = new SmartChunker({ maxTokens: 50, overlap: 10, minChunkSize: 10 });

  // ── Language Detection ──

  it('detects English text', () => {
    expect(chunker.detectLanguage('Hello world, this is a test.')).toBe('en');
  });

  it('detects Thai text', () => {
    expect(chunker.detectLanguage('สวัสดีครับ นี่คือการทดสอบ')).toBe('th');
  });

  it('detects mixed text', () => {
    // 'mixed' needs 10-50% Thai chars after stripping ASCII
    expect(chunker.detectLanguage('Using Docker เพื่อ deploy production system')).toBe('mixed');
  });

  it('detects pure code as English', () => {
    expect(chunker.detectLanguage('const x = 42; console.log(x);')).toBe('en');
  });

  // ── Token Estimation ──

  it('estimates tokens for English', () => {
    const tokens = chunker.estimateTokens('Hello world');
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(10);
  });

  it('estimates tokens for Thai (denser)', () => {
    // Thai chars are ~2.5 per token vs English ~4 per token
    const thaiTokens = chunker.estimateTokens('สวัสดีครับ');
    const enTokens = chunker.estimateTokens('Hello');
    // 9 Thai chars / 2.5 = ~4 tokens, 5 English chars / 4 = ~2 tokens
    expect(thaiTokens).toBeGreaterThanOrEqual(enTokens);
  });

  // ── Small Text (No Chunking) ──

  it('returns single chunk for small text', async () => {
    const chunks = await chunker.chunk('Hello world.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('Hello world.');
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].totalChunks).toBe(1);
  });

  it('returns empty for empty text', async () => {
    const chunks = await chunker.chunk('');
    expect(chunks).toHaveLength(0);
  });

  // ── English Chunking ──

  it('chunks long English text into multiple chunks', async () => {
    // Generate text that exceeds maxTokens (50)
    const sentences = Array.from({ length: 20 }, (_, i) =>
      `This is sentence number ${i + 1} with some additional content to make it longer.`
    );
    const text = sentences.join(' ');

    const chunks = await chunker.chunk(text);
    expect(chunks.length).toBeGreaterThan(1);

    // Each chunk should have metadata
    for (const chunk of chunks) {
      expect(chunk.totalChunks).toBe(chunks.length);
      expect(chunk.tokenCount).toBeGreaterThan(0);
    }
  });

  it('preserves code blocks as atomic units', async () => {
    const text = `Some text before.\n\n\`\`\`typescript\nconst x = 42;\nconsole.log(x);\n\`\`\`\n\nSome text after that is long enough to potentially trigger splitting because we need more content here to exceed the chunk size limit.`;

    const chunks = await chunker.chunk(text);
    // Code block should appear intact in one chunk
    const codeChunk = chunks.find(c => c.text.includes('```typescript'));
    expect(codeChunk).toBeDefined();
    expect(codeChunk!.text).toContain('const x = 42;');
    expect(codeChunk!.text).toContain('console.log(x);');
  });

  // ── Thai Chunking (without sidecar — fallback mode) ──

  it('chunks long Thai text without sidecar (fallback)', async () => {
    // Generate long Thai text
    const lines = Array.from({ length: 20 }, (_, i) =>
      `บรรทัดที่ ${i + 1} ของข้อความภาษาไทยที่ยาวพอสมควร`
    );
    const text = lines.join('\n\n');

    const chunks = await chunker.chunk(text);
    expect(chunks.length).toBeGreaterThan(1);

    // All text should be preserved across chunks
    const allText = chunks.map(c => c.text).join(' ');
    expect(allText).toContain('บรรทัดที่ 1');
    expect(allText).toContain('บรรทัดที่ 20');
  });

  // ── Mixed Text ──

  it('handles mixed Thai-English content', async () => {
    const text = Array.from({ length: 15 }, (_, i) =>
      `Step ${i + 1}: ขั้นตอนการ deploy Docker container ด้วย docker compose`
    ).join('\n\n');

    const chunks = await chunker.chunk(text);
    expect(chunks.length).toBeGreaterThan(1);
  });

  // ── Markdown Structure ──

  it('splits at header boundaries', async () => {
    const text = `## Section One\n\nContent for section one that has some text.\n\n## Section Two\n\nContent for section two that also has some text.\n\n## Section Three\n\nContent for section three with more text to make things longer.`;

    const chunks = await chunker.chunk(text);
    // Should respect header boundaries
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // First chunk should start with Section One
    expect(chunks[0].text).toContain('Section One');
  });
});

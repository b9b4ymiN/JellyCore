/**
 * Smart Chunker (v0.6.0 Part C)
 *
 * Bilingual document chunker: splits text into overlapping chunks
 * respecting markdown structure, code blocks, and sentence boundaries.
 *
 * Language handling:
 *   - Thai text  → sentence splitting via Thai NLP sidecar (/chunk endpoint)
 *   - English text → regex-based sentence splitting (no sidecar needed)
 *   - Mixed text → split by paragraphs, handle each by dominant language
 *
 * IMPORTANT: English works normally WITHOUT the Thai NLP sidecar.
 * Thai is the primary language but English is also used regularly.
 * If sidecar is unavailable, Thai text falls back to paragraph/line splitting.
 */

import type { ThaiNlpClient } from './thai-nlp-client.js';

// ── Types ──

export interface ChunkOptions {
  maxTokens: number;           // Target chunk size in approx tokens (default: 400)
  overlap: number;             // Overlap tokens between chunks (default: 80)
  minChunkSize: number;        // Merge chunks smaller than this (default: 50)
  preserveCodeBlocks: boolean; // Keep ``` blocks intact (default: true)
}

export interface Chunk {
  text: string;
  index: number;
  totalChunks: number;
  tokenCount: number;
  startOffset: number;
  endOffset: number;
}

const DEFAULT_OPTIONS: ChunkOptions = {
  maxTokens: 400,
  overlap: 80,
  minChunkSize: 50,
  preserveCodeBlocks: true,
};

// Thai character range U+0E00..U+0E7F
const THAI_CHAR = /[\u0E00-\u0E7F]/;

// ── SmartChunker ──

export class SmartChunker {
  private opts: ChunkOptions;
  private thaiNlp: ThaiNlpClient | null;

  constructor(options: Partial<ChunkOptions> = {}, thaiNlp?: ThaiNlpClient | null) {
    this.opts = { ...DEFAULT_OPTIONS, ...options };
    this.thaiNlp = thaiNlp ?? null;
  }

  /**
   * Split text into overlapping chunks.
   * Handles Thai, English, and mixed content automatically.
   */
  async chunk(text: string): Promise<Chunk[]> {
    if (!text.trim()) return [];

    // Small enough → single chunk, no splitting needed
    if (this.estimateTokens(text) <= this.opts.maxTokens) {
      return [this.makeChunk(text.trim(), 0, 1, 0, text.length)];
    }

    // 1. Extract code blocks as atomic units (never split)
    const { cleaned, codeBlocks } = this.extractCodeBlocks(text);

    // 2. Split by markdown headers (##, ###)
    const sections = this.splitByHeaders(cleaned);

    // 3. Process each section — chunk large ones
    const rawChunks: string[] = [];
    for (const section of sections) {
      if (this.estimateTokens(section) <= this.opts.maxTokens) {
        rawChunks.push(section);
        continue;
      }
      // Too large → split by language-aware sentence boundaries
      const sub = await this.splitLargeSection(section);
      rawChunks.push(...sub);
    }

    // 4. Re-inject code blocks
    const withCode = rawChunks.map(chunk => {
      let result = chunk;
      for (const [placeholder, code] of codeBlocks) {
        result = result.replace(placeholder, code);
      }
      return result;
    });

    // 5. Merge chunks that are too small
    const merged = this.mergeSmallChunks(withCode);

    // 6. Build Chunk objects with metadata
    let offset = 0;
    const final = merged.map((chunkText, i) => {
      const trimmed = chunkText.trim();
      const chunk = this.makeChunk(trimmed, i, merged.length, offset, offset + trimmed.length);
      offset += trimmed.length;
      return chunk;
    });

    return final;
  }

  // ── Language Detection ──

  /**
   * Detect dominant language of text.
   * Uses ratio of Thai characters to total non-whitespace characters.
   */
  detectLanguage(text: string): 'th' | 'en' | 'mixed' {
    const nonWhitespace = text.replace(/\s+/g, '');
    if (nonWhitespace.length === 0) return 'en';

    const thaiChars = (nonWhitespace.match(/[\u0E00-\u0E7F]/g) || []).length;
    const ratio = thaiChars / nonWhitespace.length;

    if (ratio > 0.4) return 'th';
    if (ratio < 0.05) return 'en';
    return 'mixed';
  }

  // ── Token Estimation ──

  /**
   * Estimate token count for text.
   * Thai: ~2.5 chars per token (dense script, subword tokenization).
   * English: ~4 chars per token (GPT-style BPE).
   */
  estimateTokens(text: string): number {
    const thaiChars = (text.match(/[\u0E00-\u0E7F]/g) || []).length;
    const otherChars = text.length - thaiChars;
    return Math.ceil(thaiChars / 2.5 + otherChars / 4);
  }

  // ── Internal: Structure Parsing ──

  private makeChunk(text: string, index: number, total: number, start: number, end: number): Chunk {
    return {
      text,
      index,
      totalChunks: total,
      tokenCount: this.estimateTokens(text),
      startOffset: start,
      endOffset: end,
    };
  }

  /**
   * Extract fenced code blocks and replace with placeholders.
   * Code blocks are never split — they're atomic semantic units.
   */
  private extractCodeBlocks(text: string): { cleaned: string; codeBlocks: Map<string, string> } {
    const codeBlocks = new Map<string, string>();
    if (!this.opts.preserveCodeBlocks) return { cleaned: text, codeBlocks };

    let idx = 0;
    const cleaned = text.replace(/```[\s\S]*?```/g, (match) => {
      const placeholder = `__CODE_BLOCK_${idx++}__`;
      codeBlocks.set(placeholder, match);
      return placeholder;
    });

    return { cleaned, codeBlocks };
  }

  /**
   * Split text at markdown header boundaries.
   * Each header stays attached to its following content.
   */
  private splitByHeaders(text: string): string[] {
    const parts = text.split(/(?=^#{1,3}\s+)/m);
    return parts.filter(p => p.trim().length > 0);
  }

  // ── Internal: Sentence-level Splitting ──

  /**
   * Split a large section into chunks using language-appropriate logic.
   */
  private async splitLargeSection(section: string): Promise<string[]> {
    const lang = this.detectLanguage(section);

    if (lang === 'th' || lang === 'mixed') {
      return this.chunkThaiSection(section);
    }
    return this.chunkEnglishSection(section);
  }

  /**
   * Chunk a Thai/mixed section.
   * Uses Thai NLP sidecar /chunk endpoint (handles sent_tokenize + overlap).
   * Falls back to paragraph/line splitting if sidecar is unavailable.
   */
  private async chunkThaiSection(text: string): Promise<string[]> {
    if (this.thaiNlp) {
      try {
        const result = await this.thaiNlp.chunk(
          text,
          this.opts.maxTokens,
          this.opts.overlap,
        );
        if (result.chunks.length > 0) return result.chunks;
      } catch {
        // Sidecar failed → fall through to paragraph splitting
      }
    }

    // Fallback: split by paragraphs, then lines
    return this.chunkByParagraphs(text);
  }

  /**
   * Chunk an English section.
   * Uses regex-based sentence splitting + grouping with overlap.
   * No sidecar dependency — works standalone.
   */
  private chunkEnglishSection(text: string): string[] {
    // Step 1: Split into paragraphs
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim());

    // Step 2: For large paragraphs, split into sentences
    const units: string[] = [];
    for (const para of paragraphs) {
      if (this.estimateTokens(para) <= this.opts.maxTokens) {
        units.push(para.trim());
      } else {
        // Split on sentence boundaries: .  ?  !  followed by whitespace
        // Also split on newlines within paragraphs
        const sentences = para
          .split(/(?<=[.!?])\s+|\n/)
          .filter(s => s.trim().length > 0)
          .map(s => s.trim());
        units.push(...sentences);
      }
    }

    // Step 3: Group sentences into chunks with overlap
    return this.groupWithOverlap(units);
  }

  /**
   * Fallback chunking: split by paragraphs then lines.
   * Used when Thai NLP sidecar is unavailable.
   */
  private chunkByParagraphs(text: string): string[] {
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim());

    if (paragraphs.length <= 1) {
      // Single paragraph — split by lines
      const lines = text.split(/\n/).filter(l => l.trim());
      return this.groupWithOverlap(lines);
    }

    // Check each paragraph size
    const units: string[] = [];
    for (const para of paragraphs) {
      if (this.estimateTokens(para) <= this.opts.maxTokens) {
        units.push(para.trim());
      } else {
        const lines = para.split(/\n/).filter(l => l.trim());
        units.push(...lines);
      }
    }

    return this.groupWithOverlap(units);
  }

  /**
   * Group text units (sentences/paragraphs/lines) into chunks
   * with overlap from the end of the previous chunk.
   */
  private groupWithOverlap(units: string[]): string[] {
    if (units.length === 0) return [];

    const chunks: string[] = [];
    let current: string[] = [];
    let currentTokens = 0;

    for (const unit of units) {
      const unitTokens = this.estimateTokens(unit);

      // If adding this unit would exceed max, flush current chunk
      if (currentTokens + unitTokens > this.opts.maxTokens && current.length > 0) {
        chunks.push(current.join('\n'));

        // Compute overlap: keep trailing units from current chunk
        const overlapUnits: string[] = [];
        let overlapTokens = 0;
        for (let i = current.length - 1; i >= 0; i--) {
          const t = this.estimateTokens(current[i]);
          if (overlapTokens + t > this.opts.overlap) break;
          overlapUnits.unshift(current[i]);
          overlapTokens += t;
        }

        current = [...overlapUnits];
        currentTokens = overlapTokens;
      }

      current.push(unit);
      currentTokens += unitTokens;
    }

    // Flush remaining
    if (current.length > 0) {
      chunks.push(current.join('\n'));
    }

    return chunks;
  }

  // ── Internal: Post-processing ──

  /**
   * Merge chunks that are too small with their neighbors.
   */
  private mergeSmallChunks(chunks: string[]): string[] {
    if (chunks.length <= 1) return chunks;

    const result: string[] = [];
    for (const chunk of chunks) {
      if (
        result.length > 0 &&
        this.estimateTokens(chunk) < this.opts.minChunkSize
      ) {
        // Merge with previous chunk
        result[result.length - 1] += '\n\n' + chunk;
      } else {
        result.push(chunk);
      }
    }
    return result;
  }
}

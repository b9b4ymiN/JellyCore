/**
 * Pluggable Embedding Interface (v0.6.0 Part B)
 *
 * Supports switching embedding models via EMBEDDING_MODEL env var.
 * Default: all-MiniLM-L6-v2 (384-dim) — backwards compatible
 * Upgrade: multilingual-e5-small (384-dim) — Thai + 100 languages
 *
 * E5 models use prefix strategy:
 *   query:    "query: <text>"     → better retrieval
 *   document: "passage: <text>"   → better indexing
 *
 * ARM64 note: multilingual-e5-small (384-dim, ~120MB ONNX) is the
 * recommended choice for VM.Standard.A1.Flex (OCI ARM64).
 * Same dimension as MiniLM → no ChromaDB collection recreation needed.
 */

import { DefaultEmbeddingFunction } from '@chroma-core/default-embed';

// ── Types ──

export interface Embedder {
  readonly modelName: string;
  readonly dimensions: number;

  /** Raw embedding generation (no model-specific prefix) */
  embed(texts: string[]): Promise<number[][]>;

  /** Embed a search query (adds "query: " for E5 models) */
  embedQuery(text: string): Promise<number[]>;

  /** Embed documents/passages in batch (adds "passage: " for E5 models) */
  embedDocuments(texts: string[]): Promise<number[][]>;
}

// ── all-MiniLM-L6-v2 (Default, backwards-compatible) ──

export class MiniLMEmbedder implements Embedder {
  readonly modelName = 'all-MiniLM-L6-v2';
  readonly dimensions = 384;
  private ef = new DefaultEmbeddingFunction();
  private ready = false;

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.ready) {
      await this.ef.generate(['warmup']);
      this.ready = true;
    }
    return this.ef.generate(texts);
  }

  async embedQuery(text: string): Promise<number[]> {
    // MiniLM: no prefix needed
    const [emb] = await this.embed([text]);
    return emb;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    // MiniLM: no prefix, sub-batch at 10
    const results: number[][] = [];
    const BATCH = 10;
    for (let i = 0; i < texts.length; i += BATCH) {
      results.push(...await this.embed(texts.slice(i, i + BATCH)));
    }
    return results;
  }
}

// ── Multilingual E5 (Thai + 100 languages) ──

export class MultilingualE5Embedder implements Embedder {
  readonly modelName: string;
  readonly dimensions: number;
  private pipeline: any = null;

  constructor(modelVariant: string = 'multilingual-e5-small') {
    this.modelName = modelVariant;
    this.dimensions = modelVariant.includes('large') ? 1024
      : modelVariant.includes('base') ? 768 : 384;
  }

  private async ensurePipeline(): Promise<void> {
    if (this.pipeline) return;
    try {
      const mod = await import('@xenova/transformers');
      const onnxModel = `Xenova/${this.modelName}`;
      console.log(`[Embedder] Loading ${onnxModel} (ONNX, ${this.dimensions}-dim)...`);
      this.pipeline = await mod.pipeline('feature-extraction', onnxModel, {
        quantized: true, // Quantized ONNX for lower memory on ARM64
      });
      console.log(`[Embedder] ${onnxModel} ready`);
    } catch (err: any) {
      throw new Error(
        `Failed to load ${this.modelName}. Install: bun add @xenova/transformers\n` +
        `Error: ${err?.message || err}`
      );
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    await this.ensurePipeline();
    const results: number[][] = [];
    // Process one at a time to avoid batch dimension issues with Tensor output
    for (const text of texts) {
      const output = await this.pipeline(text, { pooling: 'mean', normalize: true });
      results.push(Array.from(output.data as Float32Array));
    }
    return results;
  }

  async embedQuery(text: string): Promise<number[]> {
    // E5 models require "query: " prefix for retrieval queries
    const [emb] = await this.embed([`query: ${text}`]);
    return emb;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    // E5 models require "passage: " prefix for documents
    return this.embed(texts.map(t => `passage: ${t}`));
  }
}

// ── Factory ──

const MODEL_ENV = process.env.EMBEDDING_MODEL || 'all-MiniLM-L6-v2';

let _embedder: Embedder | null = null;

export function createEmbedder(): Embedder {
  if (_embedder) return _embedder;

  switch (MODEL_ENV) {
    case 'multilingual-e5-small':
    case 'multilingual-e5-base':
    case 'multilingual-e5-large':
      _embedder = new MultilingualE5Embedder(MODEL_ENV);
      break;
    default:
      _embedder = new MiniLMEmbedder();
      break;
  }

  console.log(`[Embedder] Model: ${_embedder.modelName} (${_embedder.dimensions}-dim)`);
  return _embedder;
}

/** Reset singleton (for testing / model switch) */
export function resetEmbedder(): void {
  _embedder = null;
}

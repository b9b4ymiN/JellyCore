/**
 * Pluggable embedding interface.
 *
 * Supports switching embedding models via EMBEDDING_MODEL.
 * Default: all-MiniLM-L6-v2 (384-dim).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { DefaultEmbeddingFunction } from '@chroma-core/default-embed';
import { env as transformersEnv } from '@huggingface/transformers';

const MODEL_ENV = process.env.EMBEDDING_MODEL || 'all-MiniLM-L6-v2';
const ORACLE_DATA_DIR = process.env.ORACLE_DATA_DIR || path.join(process.cwd(), '.oracle-data');
const HF_CACHE_DIR = process.env.HF_CACHE_DIR || path.join(ORACLE_DATA_DIR, 'transformers-cache');
const MODEL_NAMESPACE = 'Xenova';

let transformersConfigured = false;

function configureTransformersCache(): void {
  if (transformersConfigured) return;
  transformersConfigured = true;

  transformersEnv.cacheDir = HF_CACHE_DIR;
  transformersEnv.useFSCache = true;
  transformersEnv.allowRemoteModels = true;
  transformersEnv.allowLocalModels = true;

  console.log(`[Embedder] Transformers cache dir: ${transformersEnv.cacheDir}`);
}

function isCorruptModelLoadError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('protobuf parsing failed') ||
    message.includes('load model') ||
    message.includes('invalid protobuf') ||
    message.includes('invalid wire type') ||
    message.includes('unexpected end of file')
  );
}

function getModelCacheDirs(modelName: string): string[] {
  const normalizedModelName = modelName.replace(/^Xenova\//, '');
  const dirs = new Set<string>();
  dirs.add(path.join(HF_CACHE_DIR, MODEL_NAMESPACE, normalizedModelName));
  dirs.add(
    path.join(
      process.cwd(),
      'node_modules',
      '@huggingface',
      'transformers',
      '.cache',
      MODEL_NAMESPACE,
      normalizedModelName,
    ),
  );
  return [...dirs];
}

async function clearModelCache(modelName: string): Promise<void> {
  const cacheDirs = getModelCacheDirs(modelName);
  await Promise.all(
    cacheDirs.map(async (dir) => {
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors. Best effort only.
      }
    }),
  );
}

export interface Embedder {
  readonly modelName: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
  embedDocuments(texts: string[]): Promise<number[][]>;
}

export class MiniLMEmbedder implements Embedder {
  readonly modelName = 'all-MiniLM-L6-v2';
  readonly dimensions = 384;

  private ef: DefaultEmbeddingFunction | null = null;
  private ready = false;
  private initialization: Promise<void> | null = null;

  private async warmup(): Promise<void> {
    await fs.mkdir(HF_CACHE_DIR, { recursive: true });
    this.ef = new DefaultEmbeddingFunction({ modelName: `${MODEL_NAMESPACE}/${this.modelName}` });
    await this.ef.generate(['warmup']);
    this.ready = true;
  }

  private async ensureReady(): Promise<void> {
    if (this.ready) return;
    if (!this.initialization) {
      this.initialization = this.initializeWithRecovery();
    }
    await this.initialization;
  }

  private async initializeWithRecovery(): Promise<void> {
    configureTransformersCache();

    try {
      await this.warmup();
      return;
    } catch (error) {
      if (!isCorruptModelLoadError(error)) {
        this.initialization = null;
        throw error;
      }

      console.warn(`[Embedder] ${this.modelName} cache looks corrupted. Resetting cache and retrying once...`);
      await clearModelCache(this.modelName);

      try {
        await this.warmup();
        console.warn(`[Embedder] ${this.modelName} recovered after cache reset.`);
        return;
      } catch (retryError: unknown) {
        this.initialization = null;
        const detail = retryError instanceof Error ? retryError.message : String(retryError);
        throw new Error(
          `Failed to initialize ${MODEL_NAMESPACE}/${this.modelName} after cache reset: ${detail}`,
        );
      }
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    await this.ensureReady();
    return this.ef!.generate(texts);
  }

  async embedQuery(text: string): Promise<number[]> {
    const [emb] = await this.embed([text]);
    return emb;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    const BATCH = 10;
    for (let i = 0; i < texts.length; i += BATCH) {
      results.push(...(await this.embed(texts.slice(i, i + BATCH))));
    }
    return results;
  }
}

export class MultilingualE5Embedder implements Embedder {
  readonly modelName: string;
  readonly dimensions: number;
  private pipeline: any = null;

  constructor(modelVariant: string = 'multilingual-e5-small') {
    this.modelName = modelVariant;
    this.dimensions = modelVariant.includes('large')
      ? 1024
      : modelVariant.includes('base')
      ? 768
      : 384;
  }

  private async ensurePipeline(): Promise<void> {
    if (this.pipeline) return;
    try {
      const mod = await import('@xenova/transformers');
      const onnxModel = `${MODEL_NAMESPACE}/${this.modelName}`;
      console.log(`[Embedder] Loading ${onnxModel} (ONNX, ${this.dimensions}-dim)...`);
      this.pipeline = await mod.pipeline('feature-extraction', onnxModel, {
        quantized: true,
      });
      console.log(`[Embedder] ${onnxModel} ready`);
    } catch (err: any) {
      throw new Error(
        `Failed to load ${this.modelName}. Install: bun add @xenova/transformers\n` +
          `Error: ${err?.message || err}`,
      );
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    await this.ensurePipeline();
    const results: number[][] = [];
    for (const text of texts) {
      const output = await this.pipeline(text, { pooling: 'mean', normalize: true });
      results.push(Array.from(output.data as Float32Array));
    }
    return results;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [emb] = await this.embed([`query: ${text}`]);
    return emb;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return this.embed(texts.map((t) => `passage: ${t}`));
  }
}

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

export function resetEmbedder(): void {
  _embedder = null;
}

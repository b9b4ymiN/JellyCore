/**
 * ChromaDB HTTP Client with Client-Side Embeddings
 *
 * Direct HTTP client for ChromaDB with token authentication.
 * Uses @chroma-core/default-embed (all-MiniLM-L6-v2, 384-dim) to compute
 * embeddings client-side before sending to the ChromaDB REST API.
 *
 * The ChromaDB REST API does NOT support server-side embedding — it always
 * requires pre-computed embeddings (query_embeddings, not query_texts).
 * This client transparently handles that by computing embeddings locally.
 *
 * Environment variables:
 *   CHROMA_URL     - ChromaDB server URL (default: http://chromadb:8000)
 *   CHROMA_AUTH_TOKEN - Bearer token for authentication (required in production)
 */

import { DefaultEmbeddingFunction } from '@chroma-core/default-embed';

interface ChromaDocument {
  id: string;
  document: string;
  metadata: Record<string, string | number>;
}

export class ChromaHttpClient {
  private baseUrl: string;
  private authToken?: string;
  private collectionName: string;
  private collectionId?: string;
  private embedder: DefaultEmbeddingFunction;
  private embedderReady = false;

  constructor(collectionName: string, baseUrl?: string, authToken?: string) {
    this.collectionName = collectionName;
    this.baseUrl = baseUrl || process.env.CHROMA_URL || 'http://chromadb:8000';
    this.authToken = authToken || process.env.CHROMA_AUTH_TOKEN;
    this.embedder = new DefaultEmbeddingFunction();
  }

  /**
   * Compute embeddings for an array of texts.
   * Lazy-initializes the ONNX model on first call.
   */
  private async embed(texts: string[]): Promise<number[][]> {
    if (!this.embedderReady) {
      // Warm up the model (first call loads ONNX weights)
      await this.embedder.generate(['warmup']);
      this.embedderReady = true;
    }
    return this.embedder.generate(texts);
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authToken) {
      h['Authorization'] = `Bearer ${this.authToken}`;
    }
    return h;
  }

  private async request(method: string, path: string, body?: any): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`ChromaDB ${method} ${path} failed (${response.status}): ${text}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    return response.text();
  }

  /**
   * Ensure collection exists, create if not
   */
  async ensureCollection(): Promise<void> {
    try {
      // Try to get collection
      const result = await this.request('GET', `/api/v1/collections/${this.collectionName}`);
      this.collectionId = result.id;
      console.log(`Collection '${this.collectionName}' exists (id: ${this.collectionId})`);
    } catch {
      // Create collection
      console.log(`Creating collection '${this.collectionName}'...`);
      const result = await this.request('POST', '/api/v1/collections', {
        name: this.collectionName,
        get_or_create: true,
      });
      this.collectionId = result.id;
      console.log(`Collection '${this.collectionName}' created (id: ${this.collectionId})`);
    }
  }

  /**
   * Delete collection if exists
   */
  async deleteCollection(): Promise<void> {
    try {
      await this.request('DELETE', `/api/v1/collections/${this.collectionName}`);
      this.collectionId = undefined;
      console.log(`Collection '${this.collectionName}' deleted`);
    } catch {
      // Collection doesn't exist, ignore
    }
  }

  /**
   * Add documents in batch (with client-side embeddings)
   */
  async addDocuments(documents: ChromaDocument[]): Promise<void> {
    if (documents.length === 0) return;

    await this.ensureCollection();
    if (!this.collectionId) throw new Error('Collection not initialized');

    // Sub-batch embeddings to avoid OOM (ONNX model + 384-dim vectors)
    const SUB_BATCH = 10;
    for (let i = 0; i < documents.length; i += SUB_BATCH) {
      const batch = documents.slice(i, i + SUB_BATCH);
      const texts = batch.map(d => d.document);
      const embeddings = await this.embed(texts);

      await this.request('POST', `/api/v1/collections/${this.collectionId}/add`, {
        ids: batch.map(d => d.id),
        documents: texts,
        embeddings,
        metadatas: batch.map(d => d.metadata),
      });
    }

    console.log(`Added ${documents.length} documents to collection`);
  }

  /**
   * Query collection for semantic search (with client-side query embedding)
   */
  async query(
    queryText: string,
    limit: number = 10,
    whereFilter?: Record<string, any>,
  ): Promise<{ ids: string[]; documents: string[]; distances: number[]; metadatas: any[] }> {
    await this.ensureCollection();
    if (!this.collectionId) throw new Error('Collection not initialized');

    // Compute query embedding client-side
    const queryEmbeddings = await this.embed([queryText]);

    const body: any = {
      query_embeddings: queryEmbeddings,
      n_results: limit,
      include: ['documents', 'metadatas', 'distances'],
    };

    if (whereFilter) {
      body.where = whereFilter;
    }

    const result = await this.request(
      'POST',
      `/api/v1/collections/${this.collectionId}/query`,
      body,
    );

    return {
      ids: result.ids?.[0] || [],
      documents: result.documents?.[0] || [],
      distances: result.distances?.[0] || [],
      metadatas: result.metadatas?.[0] || [],
    };
  }

  /**
   * Get collection stats
   */
  async getStats(): Promise<{ count: number }> {
    try {
      await this.ensureCollection();
      if (!this.collectionId) return { count: 0 };

      const result = await this.request('GET', `/api/v1/collections/${this.collectionId}/count`);
      return { count: typeof result === 'number' ? result : 0 };
    } catch {
      return { count: 0 };
    }
  }

  /**
   * Close (no-op for HTTP client, kept for interface compatibility)
   */
  async close(): Promise<void> {
    // HTTP client doesn't need cleanup (no subprocess)
  }
}

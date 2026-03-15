import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import type { Subprocess } from 'bun';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const ORACLE_ROOT = import.meta.dir.replace(/[/\\]src[/\\]integration$/, '');
const TEMP_ROOT = mkdtempSync(join(tmpdir(), 'oracle-graph-it-'));
const DATA_DIR = join(TEMP_ROOT, 'data');
const REPO_ROOT = join(TEMP_ROOT, 'repo');
const DB_PATH = join(DATA_DIR, 'oracle.db');
const PORT = 49100 + Math.floor(Math.random() * 500);
const BASE_URL = `http://127.0.0.1:${PORT}`;

let serverProcess: Subprocess | null = null;

setDefaultTimeout(60_000);

function ensureRepoRoot(): void {
  mkdirSync(join(REPO_ROOT, 'ψ', 'memory', 'learnings'), { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });
}

function seedDatabase(): void {
  const sqlite = new Database(DB_PATH);
  const now = Date.now();

  sqlite.exec(`
    CREATE TABLE oracle_documents (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      source_file TEXT NOT NULL,
      concepts TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL
    )
  `);

  const insertDocument = sqlite.prepare(`
    INSERT INTO oracle_documents (id, type, source_file, concepts, created_at, updated_at, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const documents = [
    ['graph-1', 'learning', '/tmp/graph-1.md', '["a","b","c"]'],
    ['graph-2', 'learning', '/tmp/graph-2.md', '["b","c"]'],
    ['graph-3', 'learning', '/tmp/graph-3.md', '["a","a","b"," "]'],
    ['graph-4', 'learning', '/tmp/graph-4.md', 'not-json'],
    ['graph-5', 'learning', '/tmp/graph-5.md', '["solo"]'],
  ] as const;

  for (const [id, type, sourceFile, concepts] of documents) {
    insertDocument.run(id, type, sourceFile, concepts, now, now, now);
  }

  sqlite.close();
}

async function waitForServer(maxAttempts = 60): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }

    await Bun.sleep(500);
  }

  throw new Error('Graph integration server failed to start');
}

function readRow<T>(query: string, ...params: unknown[]): T | null {
  const sqlite = new Database(DB_PATH, { readonly: true });
  try {
    return sqlite.prepare(query).get(...params) as T | null;
  } finally {
    sqlite.close();
  }
}

async function cleanupTempRoot(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      rmSync(TEMP_ROOT, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!(error instanceof Error) || !`${error}`.includes('EBUSY')) {
        return;
      }

      await Bun.sleep(200);
    }
  }
}

describe('Graph API rebuild flow', () => {
  beforeAll(async () => {
    ensureRepoRoot();
    seedDatabase();

    serverProcess = Bun.spawn(['bun', 'run', 'src/server.ts'], {
      cwd: ORACLE_ROOT,
      stdout: 'ignore',
      stderr: 'ignore',
      env: {
        ...process.env,
        ORACLE_DB_PATH: DB_PATH,
        ORACLE_DATA_DIR: DATA_DIR,
        ORACLE_PORT: String(PORT),
        ORACLE_REPO_ROOT: REPO_ROOT,
        ORACLE_FILE_WATCHER_ENABLED: 'false',
        ORACLE_MCP_ENABLED: 'false',
      },
    });

    await waitForServer();
  });

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill();
      await serverProcess.exited;
      serverProcess = null;
    }

    if (existsSync(TEMP_ROOT)) {
      await cleanupTempRoot();
    }
  });

  test('rebuilds graph, exposes health, and stays idempotent across reruns', async () => {
    const initialHealthResponse = await fetch(`${BASE_URL}/api/health`);
    expect(initialHealthResponse.status).toBe(200);
    const initialHealth = await initialHealthResponse.json() as {
      status: string;
      graph: { tableExists: boolean; relationshipCount: number; status: string };
    };

    expect(initialHealth.status).toBe('ok');
    expect(initialHealth.graph.tableExists).toBe(true);
    expect(initialHealth.graph.relationshipCount).toBe(0);
    expect(initialHealth.graph.status).toBe('empty');

    const discoverResponse = await fetch(`${BASE_URL}/api/graph/discover`, {
      method: 'POST',
    });
    expect(discoverResponse.status).toBe(200);
    const discover = await discoverResponse.json() as {
      mode: string;
      processed: number;
      attemptedPairs: number;
      relationships: number;
      skippedInvalidDocuments: number;
      skippedInsufficientConcepts: number;
      durationMs: number;
    };

    expect(discover.mode).toBe('rebuild');
    expect(discover.processed).toBe(5);
    expect(discover.attemptedPairs).toBe(5);
    expect(discover.relationships).toBe(3);
    expect(discover.skippedInvalidDocuments).toBe(1);
    expect(discover.skippedInsufficientConcepts).toBe(1);
    expect(discover.durationMs).toBeGreaterThanOrEqual(0);

    const statsResponse = await fetch(`${BASE_URL}/api/graph/stats`);
    expect(statsResponse.status).toBe(200);
    const statsPayload = await statsResponse.json() as {
      stats: {
        totalRelationships: number;
        totalConcepts: number;
        byType: Record<string, number>;
        avgStrength: number;
      };
    };

    expect(statsPayload.stats.totalRelationships).toBe(discover.relationships);
    expect(statsPayload.stats.totalConcepts).toBe(3);
    expect(statsPayload.stats.byType['co-occurs']).toBe(3);
    expect(statsPayload.stats.avgStrength).toBeCloseTo(5 / 3, 5);

    const readyHealthResponse = await fetch(`${BASE_URL}/api/health`);
    expect(readyHealthResponse.status).toBe(200);
    const readyHealth = await readyHealthResponse.json() as {
      graph: { tableExists: boolean; relationshipCount: number; status: string };
    };

    expect(readyHealth.graph.tableExists).toBe(true);
    expect(readyHealth.graph.relationshipCount).toBe(3);
    expect(readyHealth.graph.status).toBe('ready');

    const relatedAResponse = await fetch(`${BASE_URL}/api/graph/concepts/a/related?limit=10`);
    expect(relatedAResponse.status).toBe(200);
    const relatedA = await relatedAResponse.json() as {
      related: Array<{ concept: string; relationship: string; strength: number }>;
    };
    const aMap = new Map(relatedA.related.map((entry) => [entry.concept, entry]));
    expect(aMap.get('b')?.relationship).toBe('co-occurs');
    expect(aMap.get('b')?.strength).toBe(2);
    expect(aMap.get('c')?.strength).toBe(1);

    const relatedCResponse = await fetch(`${BASE_URL}/api/graph/concepts/c/related?limit=10`);
    expect(relatedCResponse.status).toBe(200);
    const relatedC = await relatedCResponse.json() as {
      related: Array<{ concept: string; relationship: string; strength: number }>;
    };
    const cMap = new Map(relatedC.related.map((entry) => [entry.concept, entry]));
    expect(cMap.get('b')?.strength).toBe(2);
    expect(cMap.get('a')?.strength).toBe(1);

    const topConceptsResponse = await fetch(`${BASE_URL}/api/graph/top-concepts?limit=10`);
    expect(topConceptsResponse.status).toBe(200);
    const topConcepts = await topConceptsResponse.json() as {
      concepts: Array<{ concept: string; connections: number }>;
    };
    const topMap = new Map(topConcepts.concepts.map((entry) => [entry.concept, entry.connections]));
    expect(topMap.get('a')).toBe(2);
    expect(topMap.get('b')).toBe(2);
    expect(topMap.get('c')).toBe(2);

    const firstAB = readRow<{ strength: number; created_at: number; last_seen: number }>(
      'SELECT strength, created_at, last_seen FROM concept_relationships WHERE from_concept = ? AND to_concept = ?',
      'a',
      'b',
    );
    expect(firstAB?.strength).toBe(2);
    expect((firstAB?.created_at || 0) > 0).toBe(true);
    expect((firstAB?.last_seen || 0) > 0).toBe(true);

    await Bun.sleep(10);

    const secondDiscoverResponse = await fetch(`${BASE_URL}/api/graph/discover`, {
      method: 'POST',
    });
    expect(secondDiscoverResponse.status).toBe(200);
    const secondDiscover = await secondDiscoverResponse.json() as {
      attemptedPairs: number;
      relationships: number;
    };
    expect(secondDiscover.attemptedPairs).toBe(5);
    expect(secondDiscover.relationships).toBe(3);

    const secondAB = readRow<{ strength: number; created_at: number; last_seen: number }>(
      'SELECT strength, created_at, last_seen FROM concept_relationships WHERE from_concept = ? AND to_concept = ?',
      'a',
      'b',
    );
    expect(secondAB?.strength).toBe(2);
    expect(secondAB?.created_at).toBe(firstAB?.created_at);
    expect((secondAB?.last_seen || 0) > (firstAB?.last_seen || 0)).toBe(true);

    const secondStatsResponse = await fetch(`${BASE_URL}/api/graph/stats`);
    expect(secondStatsResponse.status).toBe(200);
    const secondStatsPayload = await secondStatsResponse.json() as {
      stats: {
        totalRelationships: number;
        totalConcepts: number;
        byType: Record<string, number>;
        avgStrength: number;
      };
    };

    expect(secondStatsPayload.stats.totalRelationships).toBe(3);
    expect(secondStatsPayload.stats.totalConcepts).toBe(3);
    expect(secondStatsPayload.stats.byType['co-occurs']).toBe(3);
    expect(secondStatsPayload.stats.avgStrength).toBeCloseTo(5 / 3, 5);
  });
});

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { Subprocess } from "bun";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const ORACLE_ROOT = import.meta.dir.replace(/[/\\]src[/\\]integration$/, "");
const tempRoot = mkdtempSync(join(tmpdir(), "oracle-mcp-sync-"));
const repoRoot = join(tempRoot, "repo");
const dbPath = join(tempRoot, "oracle.db");
const port = 49000 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;

let serverProcess: Subprocess | null = null;

setDefaultTimeout(30_000);

interface SeedDoc {
  id: string;
  type: string;
  sourceFile: string;
  concepts: string;
  content: string;
}

interface McpSyncResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  error?: {
    code: number;
    message: string;
    data?: string;
  };
}

function ensureRepoRoot(): void {
  const learningsDir = join(repoRoot, "ψ", "memory", "learnings");
  if (!existsSync(learningsDir)) {
    mkdirSync(learningsDir, { recursive: true });
  }
}

function seedDatabase(): void {
  const db = new Database(dbPath);
  const now = Date.now();

  db.exec(`
    CREATE TABLE oracle_documents (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      source_file TEXT NOT NULL,
      concepts TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL,
      superseded_by TEXT,
      superseded_at INTEGER,
      superseded_reason TEXT,
      origin TEXT,
      project TEXT,
      created_by TEXT,
      is_private INTEGER DEFAULT 0,
      embedding_model TEXT DEFAULT 'all-MiniLM-L6-v2',
      embedding_version INTEGER DEFAULT 1,
      embedding_hash TEXT,
      chunk_index INTEGER,
      total_chunks INTEGER,
      parent_id TEXT,
      memory_layer TEXT,
      confidence INTEGER,
      access_count INTEGER DEFAULT 0,
      last_accessed_at INTEGER,
      decay_score INTEGER DEFAULT 100,
      expires_at INTEGER
    )
  `);

  db.exec(`
    CREATE VIRTUAL TABLE oracle_fts USING fts5(
      id,
      type,
      title,
      content,
      concepts,
      tokenize = 'porter unicode61'
    )
  `);

  const docs: SeedDoc[] = [
    {
      id: "retro-json",
      type: "retro",
      sourceFile: join(repoRoot, "retro-json.md"),
      concepts: '["oracle","learn","test"]',
      content: "oracle json search target",
    },
    {
      id: "retro-legacy",
      type: "retro",
      sourceFile: join(repoRoot, "retro-legacy.md"),
      concepts: "oracle, legacy, test",
      content: "legacy search target",
    },
    {
      id: "retro-double",
      type: "retro",
      sourceFile: join(repoRoot, "retro-double.md"),
      concepts: '"[\\"oracle\\",\\"double\\",\\"test\\"]"',
      content: "double encoded search target",
    },
    {
      id: "learning-reflect",
      type: "learning",
      sourceFile: join(repoRoot, "learning-reflect.md"),
      concepts: "oracle, reflect, legacy",
      content: "reflect oracle legacy target",
    },
  ];

  const insertDoc = db.prepare(`
    INSERT INTO oracle_documents (id, type, source_file, concepts, created_at, updated_at, indexed_at, project, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFts = db.prepare(`
    INSERT INTO oracle_fts (id, type, title, content, concepts)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const doc of docs) {
    insertDoc.run(doc.id, doc.type, doc.sourceFile, doc.concepts, now, now, now, null, "manual");
    insertFts.run(doc.id, doc.type, doc.id, doc.content, doc.content);
  }

  db.close();
}

async function waitForServer(maxAttempts = 60): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await Bun.sleep(500);
  }
  throw new Error("Server failed to start within 30 seconds");
}

async function callMcpTool(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const response = await fetch(`${baseUrl}/mcp/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name,
        arguments: args,
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json() as McpSyncResponse;
  if (payload.error) {
    throw new Error(payload.error.data || payload.error.message);
  }

  const text = payload.result?.content?.[0]?.text;
  expect(typeof text).toBe("string");
  return JSON.parse(text as string);
}

function readRow<T>(query: string, ...params: unknown[]): T {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare(query).get(...params) as T;
  } finally {
    db.close();
  }
}

async function cleanupTempRoot(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!(error instanceof Error) || !`${error}`.includes("EBUSY")) {
        return;
      }
      await Bun.sleep(200);
    }
  }
}

describe("HTTP MCP sync concepts handling", () => {
  beforeAll(async () => {
    ensureRepoRoot();
    seedDatabase();

    serverProcess = Bun.spawn(["bun", "run", "src/server.ts"], {
      cwd: ORACLE_ROOT,
      stdout: "ignore",
      stderr: "ignore",
      env: {
        ...process.env,
        ORACLE_DB_PATH: dbPath,
        ORACLE_PORT: String(port),
        ORACLE_REPO_ROOT: repoRoot,
        ORACLE_FILE_WATCHER_ENABLED: "false",
        ORACLE_MCP_ENABLED: "true",
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

    await cleanupTempRoot();
  });

  test("oracle_concepts normalizes canonical and legacy stored concepts", async () => {
    const result = await callMcpTool("oracle_concepts", { limit: 10 });

    const counts = new Map<string, number>(
      result.concepts.map((entry: { concept: string; count: number }) => [entry.concept, entry.count]),
    );

    expect(counts.get("oracle")).toBe(4);
    expect(counts.get("test")).toBe(3);
    expect(counts.get("legacy")).toBe(2);
    expect(counts.get("learn")).toBe(1);
    expect(counts.get("double")).toBe(1);
    expect(counts.get("reflect")).toBe(1);
    expect(result.concepts.some((entry: { concept: string }) => /[\[\]"]/.test(entry.concept))).toBe(false);
  });

  test("oracle_search, oracle_list, and oracle_reflect return parsed concept arrays", async () => {
    const search = await callMcpTool("oracle_search", {
      query: "legacy",
      limit: 10,
      mode: "fts",
    });
    expect(search.results.length).toBeGreaterThan(0);
    expect(search.results.every((entry: { concepts: unknown }) => Array.isArray(entry.concepts))).toBe(true);

    const list = await callMcpTool("oracle_list", { limit: 10 });
    expect(list.documents.length).toBeGreaterThanOrEqual(4);
    expect(list.documents.every((entry: { concepts: unknown }) => Array.isArray(entry.concepts))).toBe(true);

    const reflect = await callMcpTool("oracle_reflect");
    expect(reflect.reflection.id).toBe("learning-reflect");
    expect(reflect.reflection.concepts).toEqual(["oracle", "reflect", "legacy"]);
  });

  test("oracle_learn stores canonical JSON in oracle_documents and learn_log", async () => {
    const learned = await callMcpTool("oracle_learn", {
      pattern: "Normalize concepts in HTTP MCP route",
      source: "mcp-sync-test",
      concepts: ["oracle", " learn ", "test", ""],
    });

    const storedDoc = readRow<{ concepts: string }>(
      "SELECT concepts FROM oracle_documents WHERE id = ?",
      learned.id,
    );
    const storedLearnLog = readRow<{ concepts: string }>(
      "SELECT concepts FROM learn_log WHERE document_id = ? ORDER BY id DESC LIMIT 1",
      learned.id,
    );

    expect(storedDoc.concepts).toBe('["oracle","learn","test"]');
    expect(storedLearnLog.concepts).toBe('["oracle","learn","test"]');
  });
});

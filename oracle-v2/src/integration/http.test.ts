/**
 * HTTP API Integration Tests
 * Tests oracle-v2 server endpoints
 */
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test";
import type { Subprocess } from "bun";

const BASE_URL = "http://localhost:47778";
const ORACLE_ROOT = import.meta.dir.replace(/[/\\]src[/\\]integration$/, "");
let serverProcess: Subprocess | null = null;
setDefaultTimeout(30_000);

async function waitForServer(maxAttempts = 60): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return true;
    } catch {
      // Server not ready yet
    }
    await Bun.sleep(500);
  }
  return false;
}

async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

describe("HTTP API Integration", () => {
  beforeAll(async () => {
    // Check if server already running
    if (await isServerRunning()) {
      console.log("Using existing server");
      return;
    }

    // Start server
    console.log("Starting server...");
    serverProcess = Bun.spawn(["bun", "run", "src/server.ts"], {
      cwd: ORACLE_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const ready = await waitForServer();
    if (!ready) {
      throw new Error("Server failed to start within 30 seconds");
    }
    console.log("Server ready");
  });

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill();
      console.log("Server stopped");
    }
  });

  // ===================
  // Health & Stats
  // ===================
  describe("Health & Stats", () => {
    test("GET /api/health returns ok", async () => {
      const res = await fetch(`${BASE_URL}/api/health`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.status).toBe("ok");
    });

    test("GET /api/stats returns statistics", async () => {
      const res = await fetch(`${BASE_URL}/api/stats`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(typeof data.total).toBe("number");
    });

  });

  // ===================
  // Search
  // ===================
  describe("Search", () => {
    test("GET /api/search with query returns results", async () => {
      const res = await fetch(`${BASE_URL}/api/search?q=oracle`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.results)).toBe(true);
    });

    test("GET /api/search with type filter", async () => {
      const res = await fetch(`${BASE_URL}/api/search?q=test&type=learning`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.results)).toBe(true);
    });

    test("GET /api/search with limit and offset", async () => {
      const res = await fetch(`${BASE_URL}/api/search?q=test&limit=5&offset=0`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.results.length).toBeLessThanOrEqual(5);
    });

    test("GET /api/search handles empty query", async () => {
      const res = await fetch(`${BASE_URL}/api/search?q=`);
      // Should return empty or error gracefully
      expect(res.status).toBeLessThan(500);
    });
  });

  // ===================
  // List & Browse
  // ===================
  describe("List & Browse", () => {
    test("GET /api/list returns documents", async () => {
      const res = await fetch(`${BASE_URL}/api/list`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.results)).toBe(true);
    });

    test("GET /api/list with type filter", async () => {
      const res = await fetch(`${BASE_URL}/api/list?type=principle`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.results)).toBe(true);
    });

    test("GET /api/list with pagination", async () => {
      const res = await fetch(`${BASE_URL}/api/list?limit=10&offset=0`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.results.length).toBeLessThanOrEqual(10);
    });
  });

  // ===================
  // Learn
  // ===================
  describe("Learn", () => {
    test("POST /api/learn accepts Thai-only pattern", async () => {
      const payload = {
        pattern: "โบ๊ท ฝน ภาษาไทย ทดสอบ ระบบตัดคำ",
        source: "http-test-thai",
        concepts: ["thai", "nlp"],
      };

      const res = await fetch(`${BASE_URL}/api/learn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(typeof data.id).toBe("string");
      expect(data.id.startsWith("learning_")).toBe(true);
      expect(data.id.includes("_entry-")).toBe(true);
    });
  });

  // ===================
  // Consult & Reflect
  // ===================
  describe("Consult & Reflect", () => {
    test("GET /api/consult with decision", async () => {
      const res = await fetch(
        `${BASE_URL}/api/consult?q=${encodeURIComponent("Should I use TypeScript?")}`
      );
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toHaveProperty("guidance");
    });

    test("GET /api/reflect returns random wisdom", async () => {
      const res = await fetch(`${BASE_URL}/api/reflect`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(typeof data).toBe("object");
      expect(Boolean(data.content) || Boolean(data.error)).toBe(true);
    });
  });

  // ===================
  // Dashboard
  // ===================
  describe("Dashboard", () => {
    test("GET /api/dashboard returns summary", async () => {
      const res = await fetch(`${BASE_URL}/api/dashboard`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(typeof data).toBe("object");
    });

    test("GET /api/dashboard/activity returns history", async () => {
      const res = await fetch(`${BASE_URL}/api/dashboard/activity?days=7`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.activity) || typeof data === "object").toBe(true);
    });

    test("GET /api/session/stats returns usage", async () => {
      const res = await fetch(`${BASE_URL}/api/session/stats`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(typeof data).toBe("object");
    });
  });

  // ===================
  // Threads
  // ===================
  describe("Threads", () => {
    test("GET /api/threads returns thread list", async () => {
      const res = await fetch(`${BASE_URL}/api/threads`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.threads)).toBe(true);
    });

    test("GET /api/threads with status filter", async () => {
      const res = await fetch(`${BASE_URL}/api/threads?status=active`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.threads)).toBe(true);
    });
  });

  // ===================
  // Decisions
  // ===================
  describe("Decisions", () => {
    test("GET /api/decisions returns decision list", async () => {
      const res = await fetch(`${BASE_URL}/api/decisions`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.decisions)).toBe(true);
    });

    test("GET /api/decisions with status filter", async () => {
      const res = await fetch(`${BASE_URL}/api/decisions?status=pending`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.decisions)).toBe(true);
    });
  });

  // ===================
  // Error Handling
  // ===================
  describe("Error Handling", () => {
    test("Invalid endpoint returns 404", async () => {
      const res = await fetch(`${BASE_URL}/api/nonexistent`);
      // Should be 404 or serve SPA
      expect(res.status).toBeLessThan(500);
    });

    test("GET /api/file without path returns error", async () => {
      const res = await fetch(`${BASE_URL}/api/file`);
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ===================
  // API Version Compatibility (/api vs /api/v1)
  // ===================
  describe("API Version Compatibility", () => {
    test("GET /api/v1/health matches /api/health shape", async () => {
      const [legacyRes, v1Res] = await Promise.all([
        fetch(`${BASE_URL}/api/health`),
        fetch(`${BASE_URL}/api/v1/health`),
      ]);
      expect(legacyRes.ok).toBe(true);
      expect(v1Res.ok).toBe(true);

      const legacy = await legacyRes.json();
      const v1 = await v1Res.json();
      expect(v1).toEqual(legacy);
    });

    test("GET /api/v1/list works and stays payload-compatible", async () => {
      const [legacyRes, v1Res] = await Promise.all([
        fetch(`${BASE_URL}/api/list?limit=5`),
        fetch(`${BASE_URL}/api/v1/list?limit=5`),
      ]);
      expect(legacyRes.ok).toBe(true);
      expect(v1Res.ok).toBe(true);

      const legacy = await legacyRes.json();
      const v1 = await v1Res.json();
      expect(Array.isArray(v1.results)).toBe(true);
      expect(v1.total).toBe(legacy.total);
      expect(v1.type).toBe(legacy.type);
    });

    test("GET /api/v1/search keeps query/result parity", async () => {
      const [legacyRes, v1Res] = await Promise.all([
        fetch(`${BASE_URL}/api/search?q=oracle&limit=3`),
        fetch(`${BASE_URL}/api/v1/search?q=oracle&limit=3`),
      ]);
      expect(legacyRes.ok).toBe(true);
      expect(v1Res.ok).toBe(true);

      const legacy = await legacyRes.json();
      const v1 = await v1Res.json();
      expect(v1.query).toBe(legacy.query);
      expect(v1.results.length).toBe(legacy.results.length);
    });
  });
});

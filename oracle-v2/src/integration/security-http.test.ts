/**
 * Security middleware integration tests.
 * Verifies sensitive-route auth, route-level rate limiting, and CORS allowlist behavior.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Subprocess } from "bun";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const ORACLE_ROOT = import.meta.dir.replace(/[/\\]src[/\\]integration$/, "");
const PORT = 47878;
const BASE_URL = `http://localhost:${PORT}`;
const ADMIN_TOKEN = "integration-secret-token";
const ALLOWED_ORIGIN = "http://allowed.local";
const BLOCKED_ORIGIN = "http://blocked.local";

let serverProcess: Subprocess | null = null;
let dataDir = "";

setDefaultTimeout(60_000);

async function waitForServer(maxAttempts = 60): Promise<void> {
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {
      // Server not ready yet.
    }
    await Bun.sleep(500);
  }
  throw new Error("Security test server failed to start");
}

describe("HTTP Security Middleware", () => {
  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "oracle-security-it-"));

    serverProcess = Bun.spawn(["bun", "run", "src/server.ts"], {
      cwd: ORACLE_ROOT,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        ORACLE_PORT: String(PORT),
        ORACLE_AUTH_TOKEN: ADMIN_TOKEN,
        ORACLE_RATE_LIMIT_WINDOW_MS: "60000",
        ORACLE_RATE_LIMIT_READ_LIMIT: "2",
        ORACLE_RATE_LIMIT_WRITE_LIMIT: "2",
        ORACLE_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
        ORACLE_DATA_DIR: dataDir,
        ORACLE_DB_PATH: join(dataDir, "oracle.db"),
      },
    });

    await waitForServer();
  });

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill();
      await serverProcess.exited;
    }
    if (dataDir && existsSync(dataDir)) {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("public route stays accessible without auth", async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    expect(res.status).toBe(200);
  });

  test("request id header is preserved when provided", async () => {
    const requestId = "security-it-request-123";
    const res = await fetch(`${BASE_URL}/api/health`, {
      headers: {
        "x-request-id": requestId,
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe(requestId);
  });

  test("request id header is generated when missing", async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    expect(res.status).toBe(200);
    const generated = res.headers.get("x-request-id") || "";
    expect(generated.startsWith("oracle-")).toBe(true);
  });

  test("sensitive routes require bearer token", async () => {
    const paths = [
      "/api/nanoclaw/health",
      "/api/logs",
      "/api/user-model",
      "/api/procedural?q=test",
      "/api/episodic?q=test",
    ];

    for (const path of paths) {
      const res = await fetch(`${BASE_URL}${path}`);
      expect(res.status).toBe(401);
    }
  });

  test("sensitive route works with bearer token", async () => {
    const res = await fetch(`${BASE_URL}/api/logs`, {
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
      },
    });
    expect(res.status).toBe(200);
  });

  test("read-heavy endpoints are rate-limited", async () => {
    const first = await fetch(`${BASE_URL}/api/search?q=oracle`);
    const second = await fetch(`${BASE_URL}/api/search?q=oracle`);
    const third = await fetch(`${BASE_URL}/api/search?q=oracle`);

    expect(first.status).toBeLessThan(429);
    expect(second.status).toBeLessThan(429);
    expect(third.status).toBe(429);
  });

  test("write-heavy endpoints are rate-limited", async () => {
    const body = JSON.stringify({ message: "" }); // Returns 400 in handler, but still passes middleware.
    const init = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    };

    const first = await fetch(`${BASE_URL}/api/thread`, init);
    const second = await fetch(`${BASE_URL}/api/thread`, init);
    const third = await fetch(`${BASE_URL}/api/thread`, init);

    expect(first.status).toBeGreaterThanOrEqual(400);
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(third.status).toBe(429);
  });

  test("CORS preflight allows only same-origin or configured allowlist", async () => {
    const allowed = await fetch(`${BASE_URL}/api/health`, {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);

    const blocked = await fetch(`${BASE_URL}/api/health`, {
      method: "OPTIONS",
      headers: {
        Origin: BLOCKED_ORIGIN,
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(blocked.status).toBe(403);
  });

  test("metrics endpoint returns Prometheus payload", async () => {
    // Generate at least one datapoint before scraping.
    await fetch(`${BASE_URL}/api/health`);

    const res = await fetch(`${BASE_URL}/metrics`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("oracle_http_requests_total");
    expect(body).toContain("oracle_http_rate_limited_total");
    expect(body).toContain("oracle_http_requests_by_route_total");
  });
});

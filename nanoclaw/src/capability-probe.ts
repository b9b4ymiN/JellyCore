import { execSync, ExecSyncOptions } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  CAPABILITY_AGENT_BROWSER_CHECK_INTERVAL_MS,
  CAPABILITY_PROBE_INTERVAL_MS,
  CAPABILITY_PROBE_TIMEOUT_MS,
  CONTAINER_IMAGE,
} from './config.js';
import { logger } from './logger.js';

type CheckKey = 'oracle' | 'mcpBridge' | 'agentBrowser';
type CommandRunner = (command: string, options?: ExecSyncOptions) => string | Buffer;

interface CheckResult {
  ok: boolean;
  checkedAt: string;
  failureStreak: number;
  latencyMs?: number;
  detail?: string;
  error?: string | null;
}

interface ExternalMcpServerHealth {
  name: string;
  requiredEnv: string[];
  missingEnv: string[];
  enabled: boolean;
}

type ExternalCheckResult = CheckResult & {
  configured: number;
  active: number;
  servers: ExternalMcpServerHealth[];
};

export interface CapabilityHealthState {
  healthy: boolean;
  failureStreak: number;
  lastProbeAt: string | null;
  checks: {
    oracle: CheckResult;
    mcpBridge: CheckResult;
    agentBrowser: CheckResult;
    externalMcp: CheckResult & {
      configured: number;
      active: number;
      servers: ExternalMcpServerHealth[];
    };
  };
}

function isoNow(): string {
  return new Date().toISOString();
}

function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(Math.max(1000, ms));
}

function emptyCheck(): CheckResult {
  return {
    ok: false,
    checkedAt: '',
    failureStreak: 0,
    error: 'not_probed',
  };
}

export class CapabilityProbe {
  constructor(private runCommand: CommandRunner = execSync) {}

  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastAgentBrowserProbeAt = 0;
  private state: CapabilityHealthState = {
    healthy: false,
    failureStreak: 0,
    lastProbeAt: null,
    checks: {
      oracle: emptyCheck(),
      mcpBridge: emptyCheck(),
      agentBrowser: emptyCheck(),
      externalMcp: {
        ...emptyCheck(),
        configured: 0,
        active: 0,
        servers: [],
      },
    },
  };

  start(): void {
    if (this.timer) return;
    void this.runProbe(true);
    this.timer = setInterval(() => {
      void this.runProbe(false);
    }, Math.max(30_000, CAPABILITY_PROBE_INTERVAL_MS));
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getState(): CapabilityHealthState {
    return this.state;
  }

  async runProbe(forceAgentBrowser: boolean): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const [oracle, mcpBridge, externalMcp] = await Promise.all([
        this.probeOracle(),
        Promise.resolve(this.probeMcpBridgeFiles()),
        Promise.resolve(this.probeExternalMcp()),
      ]);
      const agentBrowser = this.probeAgentBrowser(forceAgentBrowser);

      this.updateCheck('oracle', oracle);
      this.updateCheck('mcpBridge', mcpBridge);
      this.updateCheck('agentBrowser', agentBrowser);
      this.updateExternalCheck(externalMcp);

      this.state.lastProbeAt = isoNow();
      this.state.healthy = Boolean(
        this.state.checks.oracle.ok
        && this.state.checks.mcpBridge.ok
        && this.state.checks.agentBrowser.ok,
      );
      this.state.failureStreak = this.state.healthy ? 0 : this.state.failureStreak + 1;

      if (!this.state.healthy) {
        logger.warn(
          {
            capability: this.state,
          },
          'Capability probe detected degraded runtime',
        );
      } else {
        logger.debug(
          {
            oracleMs: this.state.checks.oracle.latencyMs,
            externalActive: this.state.checks.externalMcp.active,
            externalConfigured: this.state.checks.externalMcp.configured,
          },
          'Capability probe healthy',
        );
      }
    } finally {
      this.running = false;
    }
  }

  private updateCheck(
    key: CheckKey,
    next: CheckResult,
  ): void {
    const prev = this.state.checks[key];
    const failureStreak = next.ok ? 0 : prev.failureStreak + 1;
    const merged = {
      ...next,
      failureStreak,
    } as CheckResult;
    this.state.checks[key] = merged;
  }

  private updateExternalCheck(next: ExternalCheckResult): void {
    const prev = this.state.checks.externalMcp;
    const failureStreak = next.ok ? 0 : prev.failureStreak + 1;
    this.state.checks.externalMcp = {
      ...next,
      failureStreak,
    };
  }

  private async probeOracle(): Promise<CheckResult> {
    const started = Date.now();
    const oracleUrl = process.env.ORACLE_API_URL || 'http://oracle:47778';
    const oracleToken = process.env.ORACLE_AUTH_TOKEN || '';
    try {
      const response = await fetch(`${oracleUrl}/health`, {
        headers: oracleToken ? { Authorization: `Bearer ${oracleToken}` } : undefined,
        signal: timeoutSignal(CAPABILITY_PROBE_TIMEOUT_MS),
      });
      if (!response.ok) {
        return {
          ok: false,
          checkedAt: isoNow(),
          failureStreak: 0,
          latencyMs: Date.now() - started,
          error: `http_${response.status}`,
        };
      }
      return {
        ok: true,
        checkedAt: isoNow(),
        failureStreak: 0,
        latencyMs: Date.now() - started,
        detail: 'oracle healthy',
      };
    } catch (err) {
      return {
        ok: false,
        checkedAt: isoNow(),
        failureStreak: 0,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private probeMcpBridgeFiles(): CheckResult {
    const root = process.cwd();
    const files = [
      path.join(root, 'container', 'agent-runner', 'src', 'ipc-mcp-stdio.ts'),
      path.join(root, 'container', 'agent-runner', 'src', 'oracle-mcp-http.ts'),
    ];
    const missing = files.filter((f) => !fs.existsSync(f));
    if (missing.length > 0) {
      return {
        ok: false,
        checkedAt: isoNow(),
        failureStreak: 0,
        error: `missing_files:${missing.map((f) => path.basename(f)).join(',')}`,
      };
    }
    return {
      ok: true,
      checkedAt: isoNow(),
      failureStreak: 0,
      detail: 'mcp bridge sources present',
    };
  }

  private probeExternalMcp(): ExternalCheckResult {
    const cfgPath = path.join(process.cwd(), 'container', 'config', 'mcps.json');
    const empty = {
      ok: true,
      checkedAt: isoNow(),
      failureStreak: 0,
      configured: 0,
      active: 0,
      servers: [] as ExternalMcpServerHealth[],
      detail: 'no external MCP config',
      error: null,
    };
    if (!fs.existsSync(cfgPath)) return empty;

    try {
      const raw = fs.readFileSync(cfgPath, 'utf-8');
      const parsed = JSON.parse(raw) as {
        servers?: Array<{ name: string; requiredEnv?: string[] }>;
      };
      const servers = (parsed.servers || []).map((server) => {
        const requiredEnv = Array.isArray(server.requiredEnv) ? server.requiredEnv : [];
        const missingEnv = requiredEnv.filter((key) => !process.env[key]);
        return {
          name: server.name,
          requiredEnv,
          missingEnv,
          enabled: missingEnv.length === 0,
        };
      });

      return {
        ok: true,
        checkedAt: isoNow(),
        failureStreak: 0,
        configured: servers.length,
        active: servers.filter((s) => s.enabled).length,
        servers,
        detail: `external MCP active ${servers.filter((s) => s.enabled).length}/${servers.length}`,
        error: null,
      };
    } catch (err) {
      return {
        ok: false,
        checkedAt: isoNow(),
        failureStreak: 0,
        configured: 0,
        active: 0,
        servers: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private probeAgentBrowser(force: boolean): CheckResult {
    const now = Date.now();
    const previous = this.state.checks.agentBrowser;
    const shouldSkip = !force
      && this.lastAgentBrowserProbeAt > 0
      && now - this.lastAgentBrowserProbeAt < CAPABILITY_AGENT_BROWSER_CHECK_INTERVAL_MS;

    if (shouldSkip && previous.checkedAt) {
      return {
        ...previous,
        checkedAt: isoNow(),
        detail: `${previous.detail || 'cached'} (cached)`,
      };
    }

    this.lastAgentBrowserProbeAt = now;
    const image = process.env.CONTAINER_IMAGE || CONTAINER_IMAGE;
    try {
      this.runDockerCheck(
        image,
        'command -v agent-browser >/dev/null',
      );
      return {
        ok: true,
        checkedAt: isoNow(),
        failureStreak: 0,
        detail: `agent-browser found in image ${image}`,
        error: null,
      };
    } catch (err) {
      const fallback = this.probePlaywrightFallback(image);
      if (fallback.ok) {
        return {
          ok: true,
          checkedAt: isoNow(),
          failureStreak: 0,
          detail: `agent-browser unavailable; fallback ready (${fallback.detail})`,
          error: null,
        };
      }
      return {
        ok: false,
        checkedAt: isoNow(),
        failureStreak: 0,
        error: [
          err instanceof Error ? err.message : String(err),
          fallback.error || 'fallback unavailable',
        ].join(' | '),
      };
    }
  }

  private probePlaywrightFallback(image: string): CheckResult {
    try {
      this.runDockerCheck(
        image,
        "python3 -c \"import importlib.util, os, sys; ok = importlib.util.find_spec('playwright') is not None and os.path.exists('/usr/bin/chromium'); sys.exit(0 if ok else 1)\"",
      );
      return {
        ok: true,
        checkedAt: isoNow(),
        failureStreak: 0,
        detail: 'python+playwright available',
        error: null,
      };
    } catch (err) {
      return {
        ok: false,
        checkedAt: isoNow(),
        failureStreak: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private runDockerCheck(image: string, checkScript: string): void {
    const escaped = checkScript.replace(/"/g, '\\"');
    this.runCommand(
      `docker run --rm --entrypoint sh ${image} -lc "${escaped}"`,
      { stdio: 'pipe', timeout: Math.max(3000, CAPABILITY_PROBE_TIMEOUT_MS * 2) },
    );
  }
}

export const capabilityProbe = new CapabilityProbe();

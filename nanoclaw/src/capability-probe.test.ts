import fs from 'fs';
import os from 'os';
import path from 'path';

import { describe, expect, it, vi } from 'vitest';

import { CapabilityProbe } from './capability-probe.js';

describe('CapabilityProbe agent-browser fallback', () => {
  it('passes when agent-browser is available', () => {
    const runCommand = vi.fn(() => 'ok');
    const probe = new CapabilityProbe(runCommand);

    const result = (probe as any).probeAgentBrowser(true) as {
      ok: boolean;
      detail?: string;
      error?: string;
    };

    expect(result.ok).toBe(true);
    expect(result.detail).toContain('agent-browser found');
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it('uses python+playwright fallback when agent-browser is unavailable', () => {
    const runCommand = vi.fn((command: string) => {
      if (command.includes('agent-browser')) {
        throw new Error('agent-browser not found');
      }
      return 'fallback-ok';
    });

    const probe = new CapabilityProbe(runCommand);
    const result = (probe as any).probeAgentBrowser(true) as {
      ok: boolean;
      detail?: string;
    };

    expect(result.ok).toBe(true);
    expect(result.detail).toContain('fallback ready');
    expect(runCommand).toHaveBeenCalledTimes(2);
  });

  it('fails when both agent-browser and fallback are unavailable', () => {
    const runCommand = vi.fn(() => {
      throw new Error('command failed');
    });

    const probe = new CapabilityProbe(runCommand);
    const result = (probe as any).probeAgentBrowser(true) as {
      ok: boolean;
      error?: string;
    };

    expect(result.ok).toBe(false);
    expect(result.error).toContain('command failed');
    expect(result.error).toContain('|');
    expect(runCommand).toHaveBeenCalledTimes(2);
  });
});

describe('CapabilityProbe external MCP policy', () => {
  it('treats disabled and on_demand MCP servers as inactive', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-cap-probe-'));
    const cfgDir = path.join(tmpRoot, 'container', 'config');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(
      path.join(cfgDir, 'mcps.json'),
      JSON.stringify({
        servers: [
          { name: 'active', requiredEnv: [] },
          { name: 'disabled', enabled: false, requiredEnv: [] },
          { name: 'ondemand', startupMode: 'on_demand', requiredEnv: [] },
        ],
      }),
      'utf-8',
    );

    const previousCwd = process.cwd();
    process.chdir(tmpRoot);

    try {
      const probe = new CapabilityProbe(vi.fn(() => 'ok'));
      const result = (probe as any).probeExternalMcp() as {
        ok: boolean;
        configured: number;
        active: number;
        servers: Array<{ name: string; enabled: boolean; reason: string }>;
      };

      expect(result.ok).toBe(true);
      expect(result.configured).toBe(3);
      expect(result.active).toBe(1);

      const byName = Object.fromEntries(result.servers.map((s) => [s.name, s]));
      expect(byName.active.enabled).toBe(true);
      expect(byName.disabled.enabled).toBe(false);
      expect(byName.disabled.reason).toContain('disabled by config');
      expect(byName.ondemand.enabled).toBe(false);
      expect(byName.ondemand.reason).toContain('startupMode=on_demand');
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

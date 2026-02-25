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

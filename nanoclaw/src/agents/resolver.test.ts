import { describe, expect, it } from 'vitest';

import { resolveAgentRuntime } from './resolver.js';

describe('agent runtime resolver', () => {
  it('forces Fon for non-user lanes', () => {
    const resolved = resolveAgentRuntime({
      lane: 'scheduler',
      mode: 'codex',
      classificationReason: 'code',
      codexEnabled: true,
      swarmEnabled: true,
      codexAuthReady: true,
    });
    expect(resolved.runtime).toBe('fon');
    expect(resolved.reason).toContain('lane_scheduler_forced_fon');
  });

  it('uses Fon when mode=off', () => {
    const resolved = resolveAgentRuntime({
      lane: 'user',
      mode: 'off',
      classificationReason: 'code',
      codexEnabled: true,
      swarmEnabled: true,
      codexAuthReady: true,
    });
    expect(resolved.runtime).toBe('fon');
    expect(resolved.reason).toBe('mode_off');
  });

  it('uses Codex when mode=codex and auth is ready', () => {
    const resolved = resolveAgentRuntime({
      lane: 'user',
      mode: 'codex',
      classificationReason: 'general',
      codexEnabled: true,
      swarmEnabled: true,
      codexAuthReady: true,
    });
    expect(resolved.runtime).toBe('codex');
    expect(resolved.allowFallbackToFon).toBe(true);
    expect(resolved.reason).toBe('mode_codex');
  });

  it('falls back to Fon when mode=codex but auth is blocked', () => {
    const resolved = resolveAgentRuntime({
      lane: 'user',
      mode: 'codex',
      classificationReason: 'general',
      codexEnabled: true,
      swarmEnabled: true,
      codexAuthReady: false,
    });
    expect(resolved.runtime).toBe('fon');
    expect(resolved.reason).toBe('mode_codex_blocked');
  });

  it('routes swarm code tasks directly to Codex when ready', () => {
    const resolved = resolveAgentRuntime({
      lane: 'user',
      mode: 'swarm',
      classificationReason: 'code',
      codexEnabled: true,
      swarmEnabled: true,
      codexAuthReady: true,
    });
    expect(resolved.runtime).toBe('codex');
    expect(resolved.codexDirectToUser).toBe(true);
    expect(resolved.reason).toBe('mode_swarm_code_direct');
  });

  it('keeps non-code swarm tasks on Fon', () => {
    const resolved = resolveAgentRuntime({
      lane: 'user',
      mode: 'swarm',
      classificationReason: 'analysis',
      codexEnabled: true,
      swarmEnabled: true,
      codexAuthReady: true,
    });
    expect(resolved.runtime).toBe('fon');
    expect(resolved.reason).toBe('mode_swarm_fon_default');
  });

  it('blocks swarm when swarm flag is disabled', () => {
    const resolved = resolveAgentRuntime({
      lane: 'user',
      mode: 'swarm',
      classificationReason: 'code',
      codexEnabled: true,
      swarmEnabled: false,
      codexAuthReady: true,
    });
    expect(resolved.runtime).toBe('fon');
    expect(resolved.reason).toBe('mode_swarm_blocked');
  });
});

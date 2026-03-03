import type { AgentResolution, AgentResolutionInput } from './types.js';

function isCodeLikeReason(reason?: string): boolean {
  if (!reason) return false;
  return reason === 'code';
}

export function resolveAgentRuntime(input: AgentResolutionInput): AgentResolution {
  const {
    lane,
    mode,
    classificationReason,
    codexEnabled,
    swarmEnabled,
    codexAuthReady,
    codexRuntimeReady,
  } = input;

  // Scheduler/heartbeat lanes are always handled by Fon.
  if (lane !== 'user') {
    return {
      runtime: 'fon',
      allowFallbackToFon: false,
      codexDirectToUser: false,
      reason: `lane_${lane}_forced_fon`,
    };
  }

  const codexReady = codexEnabled && codexAuthReady && codexRuntimeReady;
  const swarmReady = swarmEnabled && codexReady;

  if (mode === 'off') {
    return {
      runtime: 'fon',
      allowFallbackToFon: false,
      codexDirectToUser: false,
      reason: 'mode_off',
    };
  }

  if (mode === 'codex') {
    if (codexReady) {
      return {
        runtime: 'codex',
        allowFallbackToFon: true,
        codexDirectToUser: true,
        reason: 'mode_codex',
      };
    }
    return {
      runtime: 'fon',
      allowFallbackToFon: false,
      codexDirectToUser: false,
      reason: 'mode_codex_blocked',
    };
  }

  // mode = swarm
  if (!swarmReady) {
    return {
      runtime: 'fon',
      allowFallbackToFon: false,
      codexDirectToUser: false,
      reason: 'mode_swarm_blocked',
    };
  }

  if (isCodeLikeReason(classificationReason)) {
    return {
      runtime: 'codex',
      allowFallbackToFon: true,
      codexDirectToUser: true,
      reason: 'mode_swarm_code_direct',
    };
  }

  return {
    runtime: 'fon',
    allowFallbackToFon: false,
    codexDirectToUser: false,
    reason: 'mode_swarm_fon_default',
  };
}

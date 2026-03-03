import type { LaneType } from '../types.js';

export type AgentMode = 'off' | 'swarm' | 'codex';
export type AgentRuntime = 'fon' | 'codex';

export interface CodexAuthStatus {
  ready: boolean;
  reason?: 'missing_auth_file' | 'invalid_json' | 'missing_tokens_fields';
  checkedAt: string;
}

export interface AgentResolutionInput {
  lane: LaneType;
  mode: AgentMode;
  classificationReason?: string;
  codexEnabled: boolean;
  swarmEnabled: boolean;
  codexAuthReady: boolean;
}

export interface AgentResolution {
  runtime: AgentRuntime;
  allowFallbackToFon: boolean;
  reason: string;
  codexDirectToUser: boolean;
}


import type { LaneType } from '../types.js';

export type AgentMode = 'off' | 'swarm' | 'codex';
export type AgentRuntime = 'fon' | 'codex';
export type CodexFailureCode =
  | 'codex_repo_trust_blocked'
  | 'codex_runtime_unavailable'
  | 'codex_output_parse_error'
  | 'codex_auth_blocked';

export interface CodexAuthStatus {
  ready: boolean;
  reason?: 'missing_auth_file' | 'invalid_json' | 'missing_tokens_fields';
  checkedAt: string;
}

export interface CodexRuntimeStatus {
  ready: boolean;
  reason?:
    | 'image_not_found'
    | 'inspect_failed'
    | 'runner_missing_skip_git_repo_check'
    | 'runner_missing_json_parser'
    | 'probe_failed'
    | 'docker_unavailable'
    | 'unknown';
  checkedAt: string;
  image: string;
  imageId?: string;
  imageCreated?: string;
  imageRevision?: string;
  sourceRevision?: string;
  driftDetected?: boolean;
}

export interface AgentResolutionInput {
  lane: LaneType;
  mode: AgentMode;
  classificationReason?: string;
  codexEnabled: boolean;
  swarmEnabled: boolean;
  codexAuthReady: boolean;
  codexRuntimeReady: boolean;
}

export interface AgentResolution {
  runtime: AgentRuntime;
  allowFallbackToFon: boolean;
  reason: string;
  codexDirectToUser: boolean;
}

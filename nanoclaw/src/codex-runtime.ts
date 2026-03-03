import { execSync } from 'child_process';

import { CONTAINER_IMAGE } from './config.js';
import type { CodexFailureCode, CodexRuntimeStatus } from './agents/types.js';

interface DockerImageInspect {
  Id?: string;
  Created?: string;
  Config?: {
    Labels?: Record<string, string>;
  };
}

const PROBE_TIMEOUT_MS = 15_000;
const STATUS_CACHE_TTL_MS = 30_000;

let cachedStatus: CodexRuntimeStatus = {
  ready: false,
  reason: 'image_not_found',
  checkedAt: new Date().toISOString(),
  image: CONTAINER_IMAGE,
};
let cacheLastUpdatedAt = 0;

function commandOutput(command: string): string {
  return execSync(command, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: PROBE_TIMEOUT_MS,
  }).trim();
}

function inspectAgentImage(image: string): {
  image: DockerImageInspect | null;
  error?: string;
} {
  try {
    const raw = commandOutput(`docker image inspect ${image}`);
    const parsed = JSON.parse(raw) as DockerImageInspect[];
    return { image: parsed[0] || null };
  } catch (err) {
    return {
      image: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function sourceRevision(): string | undefined {
  try {
    const rev = commandOutput('git rev-parse --short=12 HEAD');
    return rev || undefined;
  } catch {
    return undefined;
  }
}

function detectDrift(sourceRev?: string, imageRev?: string): boolean {
  if (!sourceRev || !imageRev) return false;
  const source = sourceRev.trim();
  const image = imageRev.trim();
  return !(source === image || source.startsWith(image) || image.startsWith(source));
}

function probeContains(image: string, needle: string): {
  ok: boolean;
  probeError?: string;
} {
  try {
    commandOutput(`docker run --rm --entrypoint sh ${image} -lc "grep -q -- '${needle}' /app/dist/codex-runner.js"`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      probeError: err instanceof Error ? err.message : String(err),
    };
  }
}

function runtimeBaseStatus(): CodexRuntimeStatus {
  return {
    ready: false,
    checkedAt: new Date().toISOString(),
    image: CONTAINER_IMAGE,
  };
}

export function evaluateCodexRuntimeStatus(
  options?: { force?: boolean },
): CodexRuntimeStatus {
  const now = Date.now();
  if (!options?.force && now - cacheLastUpdatedAt < STATUS_CACHE_TTL_MS) {
    return cachedStatus;
  }

  const status = runtimeBaseStatus();
  const inspected = inspectAgentImage(CONTAINER_IMAGE);
  if (!inspected.image) {
    const err = (inspected.error || '').toLowerCase();
    const reason = err.includes('cannot connect')
      || err.includes('is the docker daemon running')
      || err.includes('docker daemon')
      ? 'docker_unavailable'
      : 'image_not_found';
    cachedStatus = { ...status, reason };
    cacheLastUpdatedAt = now;
    return cachedStatus;
  }

  const labels = inspected.image.Config?.Labels || {};
  const imageRevision = labels['org.opencontainers.image.revision'] || undefined;
  const sourceRev = sourceRevision();

  status.imageId = inspected.image.Id || undefined;
  status.imageCreated = inspected.image.Created || undefined;
  status.imageRevision = imageRevision;
  status.sourceRevision = sourceRev;
  status.driftDetected = detectDrift(sourceRev, imageRevision);

  // Probe 1: ensure runtime image has git-trust bypass flag in compiled runner.
  const skipProbe = probeContains(CONTAINER_IMAGE, '--skip-git-repo-check');
  if (!skipProbe.ok) {
    const err = (skipProbe.probeError || '').toLowerCase();
    if (err.includes('cannot connect') || err.includes('docker daemon')) {
      cachedStatus = {
        ...status,
        reason: 'docker_unavailable',
      };
      cacheLastUpdatedAt = now;
      return cachedStatus;
    }
    cachedStatus = {
      ...status,
      reason: 'runner_missing_skip_git_repo_check',
    };
    cacheLastUpdatedAt = now;
    return cachedStatus;
  }

  // Probe 2: ensure parser handles current Codex CLI JSON event schema.
  const parserProbe = probeContains(CONTAINER_IMAGE, 'item.completed');
  if (!parserProbe.ok) {
    const err = (parserProbe.probeError || '').toLowerCase();
    if (err.includes('cannot connect') || err.includes('docker daemon')) {
      cachedStatus = {
        ...status,
        reason: 'docker_unavailable',
      };
      cacheLastUpdatedAt = now;
      return cachedStatus;
    }
    cachedStatus = {
      ...status,
      reason: 'runner_missing_json_parser',
    };
    cacheLastUpdatedAt = now;
    return cachedStatus;
  }

  cachedStatus = {
    ...status,
    ready: true,
  };
  cacheLastUpdatedAt = now;
  return cachedStatus;
}

export function getCodexRuntimeStatus(): CodexRuntimeStatus {
  return cachedStatus;
}

export function classifyCodexFailure(error?: string): CodexFailureCode {
  const text = (error || '').toLowerCase();
  if (text.includes('codex_auth_blocked')) return 'codex_auth_blocked';
  if (
    text.includes('not inside a trusted directory')
    || text.includes('codex_repo_trust_blocked')
  ) {
    return 'codex_repo_trust_blocked';
  }
  if (text.includes('codex_no_output') || text.includes('codex_output_parse_error')) {
    return 'codex_output_parse_error';
  }
  return 'codex_runtime_unavailable';
}

export function codexFallbackMessage(reason: CodexFailureCode): string {
  if (reason === 'codex_repo_trust_blocked') {
    return 'ℹ️ Codex unavailable (codex_repo_trust_blocked). Rebuild/restart agent image. Falling back to Fon.';
  }
  if (reason === 'codex_auth_blocked') {
    return 'ℹ️ Codex unavailable (codex_auth_blocked). Check auth.json. Falling back to Fon.';
  }
  if (reason === 'codex_output_parse_error') {
    return 'ℹ️ Codex unavailable (codex_output_parse_error). Falling back to Fon.';
  }
  return 'ℹ️ Codex unavailable (codex_runtime_unavailable). Falling back to Fon.';
}

/**
 * Container Runner for NanoClaw
 * Spawns agent execution in Apple Container and handles IPC
 */
import { ChildProcess, exec, execSync, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  AGENT_FULL_ACCESS,
  CONTAINER_IMAGE,
  CONTAINER_MAX_OUTPUT_SIZE,
  CONTAINER_TIMEOUT,
  CODEX_AUTH_PATH,
  DATA_DIR,
  GOOGLE_DOCS_AUTH_PATH,
  GROUPS_DIR,
  IDLE_TIMEOUT,
  IPC_SECRET,
  POOL_ENABLED,
  STORE_DIR,
} from './config.js';
import { dockerResilience } from './docker-resilience.js';
import { eventBus } from './event-bus.js';
import { logger } from './logger.js';
import { validateAdditionalMounts } from './mount-security.js';
import { containerPool } from './container-pool.js';
import { LaneType, RegisteredGroup } from './types.js';
import { recordNonFatalError } from './non-fatal-errors.js';
import type { AgentMode, AgentRuntime } from './agents/types.js';

/** Format milliseconds as human-readable duration (e.g., "30 min", "1h 30 min"). */
function formatMs(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m} min` : `${h}h`;
}

// Sentinel markers for robust output parsing (must match agent-runner)
const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

function withDockerEnv<T>(options: T): T {
  const dockerHost = process.env.DOCKER_HOST;
  if (!dockerHost) return options;
  if (!options || typeof options !== 'object') return options;
  const withEnv = options as T & { env?: NodeJS.ProcessEnv };
  return {
    ...withEnv,
    env: {
      ...process.env,
      ...(withEnv.env || {}),
      DOCKER_HOST: dockerHost,
    },
  } as T;
}

function runtimeToProvider(runtime: AgentRuntime | undefined): string {
  if (runtime === 'codex') return 'codex';
  return 'claude';
}

/**
 * Docker-in-Docker mount path resolution.
 *
 * When NanoClaw runs inside a Docker container and spawns agent containers via
 * the shared Docker socket, volume mount paths must reference the Docker HOST
 * filesystem — not paths inside the NanoClaw container. This function inspects
 * NanoClaw's own container to discover the actual host paths for its mounts,
 * then translates container-internal paths to host-equivalent paths.
 *
 * Example:
 *   Container path:  /app/nanoclaw/data/ipc/main
 *   Named volume mount: nanoclaw-data → /app/nanoclaw/data
 *   Volume source on host: /var/lib/docker/volumes/jellycore_nanoclaw-data/_data
 *   Resolved host path: /var/lib/docker/volumes/jellycore_nanoclaw-data/_data/ipc/main
 */
interface DockerMount {
  Type: string;        // 'bind' | 'volume'
  Source: string;      // Host path (bind) or volume mount point (volume)
  Destination: string; // Container path
}

interface ContainerImageInspect {
  Id?: string;
  Created?: string;
  Config?: {
    Labels?: Record<string, string>;
  };
}

interface ContainerImageMetadata {
  image: string;
  checkedAt: string;
  imageId?: string;
  imageCreated?: string;
  imageRevision?: string;
  inspectError?: string;
}

let cachedMounts: DockerMount[] | null = null;
let cachedImageMetadata: ContainerImageMetadata | null = null;
let cachedImageMetadataAt = 0;

function loadContainerMounts(): DockerMount[] {
  if (cachedMounts) return cachedMounts;

  try {
    // Use hostname (= container ID in Docker) to inspect ourselves
    const containerId = os.hostname();
    const result = execSync(
      `docker inspect --format '{{json .Mounts}}' ${containerId}`,
      withDockerEnv({ encoding: 'utf-8', timeout: 5000 }),
    );
    cachedMounts = JSON.parse(result.trim());
    logger.info(
      { mounts: cachedMounts!.map(m => `${m.Source} → ${m.Destination} (${m.Type})`) },
      'Discovered Docker host mount paths via self-inspect',
    );
    return cachedMounts!;
  } catch (err) {
    logger.warn({ err }, 'Failed to inspect own container mounts — using container-internal paths (DinD mounts may fail)');
    cachedMounts = [];
    return [];
  }
}

/**
 * Translate a container-internal path to the corresponding Docker host path.
 * Falls back to the original path if no matching mount is found.
 */
function resolveHostPath(containerPath: string): string {
  const mounts = loadContainerMounts();
  if (mounts.length === 0) return containerPath;

  // Find the longest matching mount destination (most specific mount wins)
  let bestMatch: DockerMount | null = null;
  for (const mount of mounts) {
    const dest = mount.Destination.endsWith('/')
      ? mount.Destination
      : mount.Destination + '/';
    const cp = containerPath.endsWith('/')
      ? containerPath
      : containerPath + '/';

    if (cp.startsWith(dest) || containerPath === mount.Destination) {
      if (!bestMatch || mount.Destination.length > bestMatch.Destination.length) {
        bestMatch = mount;
      }
    }
  }

  if (!bestMatch) {
    logger.debug({ containerPath }, 'No mount match found — using container-internal path');
    return containerPath;
  }

  const relativePath = containerPath.slice(bestMatch.Destination.length);
  const hostPath = bestMatch.Source + relativePath;
  logger.debug({ containerPath, hostPath, mountType: bestMatch.Type }, 'Resolved host path');
  return hostPath;
}

export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  lane?: LaneType;
  agentRuntime?: AgentRuntime;
  agentMode?: AgentMode;
  requestId?: string;
  secrets?: Record<string, string>;
}

function getContainerImageMetadata(): ContainerImageMetadata {
  const now = Date.now();
  if (cachedImageMetadata && now - cachedImageMetadataAt < 30_000) {
    return cachedImageMetadata;
  }

  const base: ContainerImageMetadata = {
    image: CONTAINER_IMAGE,
    checkedAt: new Date().toISOString(),
  };

  try {
    const raw = execSync(
      `docker image inspect ${CONTAINER_IMAGE}`,
      withDockerEnv({
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    );
    const parsed = JSON.parse(raw) as ContainerImageInspect[];
    const inspected = parsed[0];
    cachedImageMetadata = {
      ...base,
      imageId: inspected?.Id,
      imageCreated: inspected?.Created,
      imageRevision: inspected?.Config?.Labels?.['org.opencontainers.image.revision'],
    };
  } catch (err) {
    cachedImageMetadata = {
      ...base,
      inspectError: err instanceof Error ? err.message : String(err),
    };
  }

  cachedImageMetadataAt = now;
  return cachedImageMetadata;
}

export interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface VolumeMount {
  hostPath: string;
  containerPath: string;
  readonly: boolean;
}

function copyDirectoryRecursive(srcDir: string, dstDir: string): void {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, dstPath);
      continue;
    }
    if (entry.isFile()) {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function stripUtf8Bom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function readJsonFileNormalized(filePath: string): { ok: true; normalized: string } | { ok: false } {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const normalized = stripUtf8Bom(raw);
    JSON.parse(normalized);
    return { ok: true, normalized };
  } catch (err) {
    recordNonFatalError(
      'container_runner.read_json_normalized_failed',
      err,
      { filePath },
      'debug',
    );
    return { ok: false };
  }
}

function resolveCodexBootstrapAuthFile(): string | undefined {
  const candidate = path.join(CODEX_AUTH_PATH, 'auth.json');
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return candidate;
  }
  return undefined;
}

function syncCodexBootstrapAuth(
  groupCodexHomeDir: string,
  groupFolder: string,
): boolean {
  const sourceAuth = resolveCodexBootstrapAuthFile();
  if (!sourceAuth) return false;

  fs.mkdirSync(groupCodexHomeDir, { recursive: true });
  try {
    fs.chmodSync(groupCodexHomeDir, 0o777);
  } catch (err) {
    recordNonFatalError(
      'container_runner.chmod_group_codex_home_failed',
      err,
      { group: groupFolder, groupCodexHomeDir },
      'debug',
    );
  }

  const destinationAuth = path.join(groupCodexHomeDir, 'auth.json');
  const sourceParsed = readJsonFileNormalized(sourceAuth);
  if (!sourceParsed.ok) {
    logger.warn(
      {
        group: groupFolder,
        sourceAuth,
      },
      'Skipped codex auth sync: source auth.json is invalid JSON',
    );
    return false;
  }

  let shouldCopy = true;
  try {
    if (fs.existsSync(destinationAuth)) {
      const destinationParsed = readJsonFileNormalized(destinationAuth);
      if (destinationParsed.ok) {
        const sourceMtime = fs.statSync(sourceAuth).mtimeMs;
        const destinationMtime = fs.statSync(destinationAuth).mtimeMs;
        // Keep runtime-refreshed tokens unless user replaced source auth.json.
        shouldCopy = sourceMtime > destinationMtime + 500;
      }
    }
  } catch (err) {
    recordNonFatalError(
      'container_runner.stat_destination_auth_failed',
      err,
      { group: groupFolder, destinationAuth },
      'debug',
    );
    shouldCopy = true;
  }

  if (!shouldCopy) return true;

  fs.writeFileSync(destinationAuth, sourceParsed.normalized, {
    encoding: 'utf-8',
  });
  try {
    fs.chmodSync(destinationAuth, 0o600);
  } catch (err) {
    recordNonFatalError(
      'container_runner.chmod_destination_auth_failed',
      err,
      { group: groupFolder, destinationAuth },
      'debug',
    );
  }
  logger.info(
    {
      group: groupFolder,
      sourceAuth,
      destinationAuth,
    },
    'Synced codex auth.json from shared auth path',
  );
  return true;
}

function resolveGoogleDocsBootstrapToken(profile: string): string | undefined {
  const candidates = profile
    ? [
        path.join(GOOGLE_DOCS_AUTH_PATH, profile, 'token.json'),
        path.join(GOOGLE_DOCS_AUTH_PATH, 'token.json'),
      ]
    : [path.join(GOOGLE_DOCS_AUTH_PATH, 'token.json')];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return undefined;
}

function syncGoogleDocsBootstrapToken(
  groupSessionsDir: string,
  groupFolder: string,
): void {
  const profile = (process.env.GOOGLE_MCP_PROFILE || '').trim();
  const sourceToken = resolveGoogleDocsBootstrapToken(profile);
  if (!sourceToken) return;

  const destinationDir = profile
    ? path.join(groupSessionsDir, 'config', 'google-docs-mcp', profile)
    : path.join(groupSessionsDir, 'config', 'google-docs-mcp');
  const destinationToken = path.join(destinationDir, 'token.json');
  fs.mkdirSync(destinationDir, { recursive: true });

  const sourceParsed = readJsonFileNormalized(sourceToken);
  if (!sourceParsed.ok) {
    logger.warn(
      {
        group: groupFolder,
        sourceToken,
        profile: profile || null,
      },
      'Skipped google_docs token sync: source token.json is invalid JSON',
    );
    return;
  }

  let shouldCopy = true;
  try {
    if (fs.existsSync(destinationToken)) {
      const destinationParsed = readJsonFileNormalized(destinationToken);
      if (destinationParsed.ok) {
        shouldCopy = sourceParsed.normalized !== destinationParsed.normalized;
      }
    }
  } catch (err) {
    recordNonFatalError(
      'container_runner.stat_destination_token_failed',
      err,
      { group: groupFolder, destinationToken, profile: profile || null },
      'debug',
    );
    shouldCopy = true;
  }

  if (!shouldCopy) return;

  fs.writeFileSync(destinationToken, sourceParsed.normalized, {
    encoding: 'utf-8',
  });
  try {
    fs.chmodSync(destinationToken, 0o600);
  } catch (err) {
    recordNonFatalError(
      'container_runner.chmod_destination_token_failed',
      err,
      { group: groupFolder, destinationToken, profile: profile || null },
      'debug',
    );
  }
  logger.info(
    {
      group: groupFolder,
      sourceToken,
      destinationToken,
      profile: profile || null,
    },
    'Synced google_docs token.json from shared auth path',
  );
}

function buildVolumeMounts(
  group: RegisteredGroup,
  isMain: boolean,
): VolumeMount[] {
  const mounts: VolumeMount[] = [];

  if (isMain) {
    // Main group — mount only its own workspace (NOT project root)
    // Security: prevents agent from accessing store/auth/, .env, src/, etc.
    mounts.push({
      hostPath: path.join(GROUPS_DIR, group.folder),
      containerPath: '/workspace/group',
      readonly: false,
    });

    // Global memory directory (read-only) for shared CLAUDE.md access
    const globalDir = path.join(GROUPS_DIR, 'global');
    if (fs.existsSync(globalDir)) {
      mounts.push({
        hostPath: globalDir,
        containerPath: '/workspace/global',
        readonly: true,
      });
    }
  } else {
    // Other groups only get their own folder
    mounts.push({
      hostPath: path.join(GROUPS_DIR, group.folder),
      containerPath: '/workspace/group',
      readonly: false,
    });

    // Global memory directory (read-only for non-main)
    // Apple Container only supports directory mounts, not file mounts
    const globalDir = path.join(GROUPS_DIR, 'global');
    if (fs.existsSync(globalDir)) {
      mounts.push({
        hostPath: globalDir,
        containerPath: '/workspace/global',
        readonly: true,
      });
    }
  }

  if (AGENT_FULL_ACCESS) {
    // Full access mode intentionally lifts isolation so agents can self-remediate
    // infra/runtime issues without human intervention.
    const fullAccessMounts: VolumeMount[] = [
      { hostPath: GROUPS_DIR, containerPath: '/workspace/all-groups', readonly: false },
      { hostPath: DATA_DIR, containerPath: '/workspace/all-data', readonly: false },
      { hostPath: STORE_DIR, containerPath: '/workspace/all-store', readonly: false },
      { hostPath: path.join(process.cwd(), 'container'), containerPath: '/workspace/agent-container-src', readonly: false },
      { hostPath: '/var/run/docker.sock', containerPath: '/var/run/docker.sock', readonly: false },
    ];

    for (const m of fullAccessMounts) {
      if (fs.existsSync(m.hostPath)) {
        mounts.push(m);
      }
    }
  }

  // Per-group Claude sessions directory (isolated from other groups)
  // Each group gets their own .claude/ to prevent cross-group session access
  const groupSessionsDir = path.join(
    DATA_DIR,
    'sessions',
    group.folder,
    '.claude',
  );
  fs.mkdirSync(groupSessionsDir, { recursive: true });
  // Make sessions dir writable by container's node user (uid 1000)
  try {
    fs.chmodSync(groupSessionsDir, 0o777);
  } catch (err) {
    recordNonFatalError(
      'container_runner.chmod_group_sessions_dir_failed',
      err,
      { group: group.folder, groupSessionsDir },
      'debug',
    );
  }
  // Always overwrite settings.json so Z.AI config changes take effect
  const settingsFile = path.join(groupSessionsDir, 'settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify({
    env: {
      // Enable agent swarms (subagent orchestration)
      // https://code.claude.com/docs/en/agent-teams#orchestrate-teams-of-claude-code-sessions
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
      // Load CLAUDE.md from additional mounted directories
      // https://code.claude.com/docs/en/memory#load-memory-from-additional-directories
      CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
      // Enable Claude's memory feature (persists user preferences between sessions)
      // https://code.claude.com/docs/en/memory#manage-auto-memory
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
      // Z.AI GLM Coding Plan — native Anthropic-compatible endpoint
      // https://docs.z.ai/devpack/tool/claude#manual-configuration
      ...(process.env.ANTHROPIC_AUTH_TOKEN && {
        ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
      }),
      ...(process.env.ANTHROPIC_BASE_URL && {
        ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
      }),
      // Z.AI model mapping — Claude model aliases → GLM models
      ...(process.env.ANTHROPIC_DEFAULT_SONNET_MODEL && {
        ANTHROPIC_DEFAULT_SONNET_MODEL: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL,
      }),
      ...(process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL && {
        ANTHROPIC_DEFAULT_HAIKU_MODEL: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
      }),
      ...(process.env.ANTHROPIC_DEFAULT_OPUS_MODEL && {
        ANTHROPIC_DEFAULT_OPUS_MODEL: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL,
      }),
      API_TIMEOUT_MS: process.env.API_TIMEOUT_MS || '3000000',
    },
  }, null, 2) + '\n');

  // Sync skills from container/skills/ into each group's .claude/skills/
  const skillsSrc = path.join(process.cwd(), 'container', 'skills');
  const skillsDst = path.join(groupSessionsDir, 'skills');
  if (fs.existsSync(skillsSrc)) {
    // Replace the directory each run so removed/renamed skills do not linger.
    fs.rmSync(skillsDst, { recursive: true, force: true });
    fs.mkdirSync(skillsDst, { recursive: true });
    for (const skillDir of fs.readdirSync(skillsSrc, { withFileTypes: true })) {
      if (!skillDir.isDirectory()) continue;
      const srcDir = path.join(skillsSrc, skillDir.name);
      const dstDir = path.join(skillsDst, skillDir.name);
      copyDirectoryRecursive(srcDir, dstDir);
    }
  }

  // Optional project-level MCP override:
  // If nanoclaw/.mcp.json exists, mirror it into the per-group .claude mount
  // so Telegram runtime can load it from /home/node/.claude/.mcp.json.
  const projectMcpPath = path.join(process.cwd(), '.mcp.json');
  const sessionMcpPath = path.join(groupSessionsDir, '.mcp.json');
  if (fs.existsSync(projectMcpPath)) {
    try {
      fs.copyFileSync(projectMcpPath, sessionMcpPath);
    } catch (err) {
      logger.warn(
        { err, group: group.folder, projectMcpPath, sessionMcpPath },
        'Failed to mirror project .mcp.json into group session directory',
      );
    }
  } else if (fs.existsSync(sessionMcpPath)) {
    // Keep behavior deterministic: remove stale mirrored config when project file is deleted.
    try {
      fs.rmSync(sessionMcpPath, { force: true });
    } catch (err) {
      recordNonFatalError(
        'container_runner.remove_stale_session_mcp_failed',
        err,
        { group: group.folder, sessionMcpPath },
        'debug',
      );
    }
  }

  // Optional Google Docs MCP token bootstrap:
  // If shared token exists in data/google-docs-auth, copy it into this group's
  // session namespace so users don't need per-group manual placement.
  syncGoogleDocsBootstrapToken(groupSessionsDir, group.folder);

  mounts.push({
    hostPath: groupSessionsDir,
    containerPath: '/home/node/.claude',
    readonly: false,
  });

  // Codex runtime home (writable) + auth bootstrap from shared data/codex-auth/auth.json.
  // Auth file stays user-provided, while Codex can still write cache/skills metadata.
  const groupCodexHomeDir = path.join(DATA_DIR, 'sessions', group.folder, '.codex');
  const hasCodexAuth = syncCodexBootstrapAuth(groupCodexHomeDir, group.folder);
  if (hasCodexAuth) {
    mounts.push({
      hostPath: groupCodexHomeDir,
      containerPath: '/home/node/.codex',
      readonly: false,
    });
  }

  // Per-group IPC namespace: each group gets its own IPC directory
  // This prevents cross-group privilege escalation via IPC
  const groupIpcDir = path.join(DATA_DIR, 'ipc', group.folder);
  fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'input'), { recursive: true });
  // Make IPC dirs writable by container's node user (uid 1000)
  try {
    fs.chmodSync(groupIpcDir, 0o777);
    fs.chmodSync(path.join(groupIpcDir, 'messages'), 0o777);
    fs.chmodSync(path.join(groupIpcDir, 'tasks'), 0o777);
    fs.chmodSync(path.join(groupIpcDir, 'input'), 0o777);
  } catch (err) {
    recordNonFatalError(
      'container_runner.chmod_group_ipc_dir_failed',
      err,
      { group: group.folder, groupIpcDir },
      'debug',
    );
  }
  mounts.push({
    hostPath: groupIpcDir,
    containerPath: '/workspace/ipc',
    readonly: false,
  });

  // Additional mounts validated against external allowlist (tamper-proof from containers)
  if (group.containerConfig?.additionalMounts) {
    const validatedMounts = validateAdditionalMounts(
      group.containerConfig.additionalMounts,
      group.name,
      isMain,
    );
    mounts.push(...validatedMounts);
  }

  return mounts;
}

/**
 * Read allowed secrets from .env for passing to the container via stdin.
 * Secrets are never written to disk or mounted as files.
 */
function readSecrets(): Record<string, string> {
  const allowedVars = [
    'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL', 'ORACLE_API_URL', 'ORACLE_AUTH_TOKEN',
    // Provider abstraction (default: claude, optional: openai/ollama)
    'LLM_PROVIDER', 'NANOCLAW_LLM_PROVIDER',
    'OPENAI_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_TIMEOUT_MS',
    'OLLAMA_BASE_URL', 'OLLAMA_MODEL', 'OLLAMA_TIMEOUT_MS',
    // Z.AI model mapping (docs.z.ai/devpack/tool/claude#manual-configuration)
    'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    // Oura Ring MCP (optional — set to enable health/sleep/activity data access)
    'NANOCLAW_EXTERNAL_MCP_DISABLED',
    'OURA_PERSONAL_ACCESS_TOKEN',
    // Google Docs MCP (optional — requires OAuth client credentials)
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_MCP_PROFILE',
    'GOOGLE_DOCS_XDG_CONFIG_HOME',
  ];
  const secrets: Record<string, string> = {};

  // Always inject IPC_SECRET for integrity signing (not from .env file)
  secrets['JELLYCORE_IPC_SECRET'] = IPC_SECRET;

  // First: read from process.env (works in Docker where env vars are set directly)
  for (const key of allowedVars) {
    if (process.env[key]) {
      secrets[key] = process.env[key]!;
    }
  }

  // Second: read from .env file (override/supplement — works on host)
  const envFile = path.join(process.cwd(), '.env');
  if (fs.existsSync(envFile)) {
    const content = fs.readFileSync(envFile, 'utf-8');

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      if (!allowedVars.includes(key)) continue;
      let value = trimmed.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (value) secrets[key] = value;
    }
  }

  return secrets;
}

function buildContainerArgs(
  mounts: VolumeMount[],
  containerName: string,
  groupFolder?: string,
  requestId?: string,
): string[] {
  // --rm: auto-remove the container when it exits (prevents Exited container accumulation).
  // This is the standard practice for ephemeral task containers.
  const args: string[] = ['run', '-i', '--rm', '--name', containerName];
  args.push('--label', 'jellycore.managed=true');
  if (groupFolder) {
    args.push('--label', `jellycore.group=${groupFolder}`);
  }

  // Resource limits: prevent runaway agents from consuming all host resources
  const memLimit = process.env.CONTAINER_MEMORY_LIMIT || '512m';
  const cpuLimit = process.env.CONTAINER_CPU_LIMIT || '1.0';
  args.push('--memory', memLimit);
  args.push('--cpus', cpuLimit);

  // Connect to jellycore network if it exists (so agent can reach oracle, proxy etc.)
  const dockerNetwork = process.env.DOCKER_NETWORK || '';
  if (dockerNetwork) {
    args.push('--network', dockerNetwork);
  }

  // Pass timezone so container's Node.js uses correct local time (not UTC)
  args.push('-e', `TZ=${process.env.TZ || 'Asia/Bangkok'}`);
  if (requestId) {
    args.push('-e', `NANOCLAW_REQUEST_ID=${requestId}`);
  }

  // Docker: -v with :ro suffix for readonly
  // Resolve container-internal paths to Docker host paths for DinD compatibility
  for (const mount of mounts) {
    const hostPath = resolveHostPath(mount.hostPath);
    if (mount.readonly) {
      args.push('-v', `${hostPath}:${mount.containerPath}:ro`);
    } else {
      args.push('-v', `${hostPath}:${mount.containerPath}`);
    }
  }

  args.push(CONTAINER_IMAGE);

  return args;
}

export async function runContainerAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  onProcess: (proc: ChildProcess, containerName: string) => void,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<ContainerOutput> {
  const startTime = Date.now();
  const lane: LaneType = input.lane || 'user';

  const spawnCheck = dockerResilience.canSpawn(lane);
  if (!spawnCheck.allowed) {
    return {
      status: 'error',
      result: null,
      error: spawnCheck.reason || 'Container spawn blocked by runtime health policy',
    };
  }

  const groupDir = path.join(GROUPS_DIR, group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  // Try to acquire a warm container from the pool
  const pooled =
    POOL_ENABLED && input.agentRuntime !== 'codex'
      ? containerPool.acquire(group.folder)
      : null;
  if (pooled) {
    return runPooledContainer(pooled, group, input, onProcess, onOutput, startTime);
  }

  // Cold-spawn fallback

  const mounts = buildVolumeMounts(group, input.isMain);
  const safeName = group.folder.replace(/[^a-zA-Z0-9-]/g, '-');
  const containerName = `nanoclaw-${safeName}-${Date.now()}`;
  const containerArgs = buildContainerArgs(mounts, containerName, group.folder, input.requestId);
  const imageMeta = getContainerImageMetadata();
  const provider = runtimeToProvider(input.agentRuntime);

  eventBus.emit('live', {
    type: 'container:start',
    data: {
      containerId: containerName,
      group: group.folder,
      provider,
      prompt: input.prompt.slice(0, 200),
      startedAt: new Date().toISOString(),
      requestId: input.requestId,
    },
  });

  logger.debug(
    {
      group: group.name,
      containerName,
      mounts: mounts.map(
        (m) =>
          `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
      ),
      containerArgs: containerArgs.join(' '),
    },
    'Container mount configuration',
  );

  logger.info(
    {
      group: group.name,
      containerName,
      mountCount: mounts.length,
      isMain: input.isMain,
      image: imageMeta.image,
      imageRevision: imageMeta.imageRevision || null,
      imageId: imageMeta.imageId || null,
      imageCreated: imageMeta.imageCreated || null,
      imageInspectError: imageMeta.inspectError || null,
    },
    'Spawning container agent',
  );

  const logsDir = path.join(GROUPS_DIR, group.folder, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  // Log rotation: keep only the newest MAX_LOG_FILES log files
  try {
    const logFiles = fs.readdirSync(logsDir)
      .filter(f => f.startsWith('container-') && f.endsWith('.log'))
      .sort();
    const MAX_LOG_FILES = 20;
    if (logFiles.length > MAX_LOG_FILES) {
      const toDelete = logFiles.slice(0, logFiles.length - MAX_LOG_FILES);
      for (const f of toDelete) {
        fs.unlinkSync(path.join(logsDir, f));
      }
      logger.debug({ deleted: toDelete.length, remaining: MAX_LOG_FILES }, 'Rotated old container logs');
    }
  } catch (err) {
    logger.warn({ err }, 'Log rotation failed');
  }

  return new Promise((resolve) => {
    const container = spawn(
      'docker',
      containerArgs,
      withDockerEnv({
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    );
    dockerResilience.recordSpawnSuccess();

    onProcess(container, containerName);

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;

    // Pass config via stdin (secrets stay in memory, never touch disk)
    // Prompt is written to IPC directory (no secrets) so it can be large
    const promptFile = path.join(DATA_DIR, 'ipc', group.folder, 'input', '_prompt.txt');
    fs.writeFileSync(promptFile, input.prompt);

    const stdinPayload = {
      ...input,
      prompt: '__IPC_PROMPT__', // sentinel: agent reads from IPC prompt file
      secrets: readSecrets(),
    };
    container.stdin.write(JSON.stringify(stdinPayload));
    container.stdin.end();
    // Don't log secrets
    delete input.secrets;

    // Streaming output: parse OUTPUT_START/END marker pairs as they arrive
    let parseBuffer = '';
    let newSessionId: string | undefined;
    let outputChain = Promise.resolve();
    let lastStreamError: string | undefined;
    let emittedEnd = false;

    const emitContainerEnd = (exitCode: number, summary: string) => {
      if (emittedEnd) return;
      emittedEnd = true;
      eventBus.emit('live', {
        type: 'container:end',
        data: {
          containerId: containerName,
          exitCode,
          durationMs: Date.now() - startTime,
          resultSummary: summary.slice(0, 500),
          requestId: input.requestId,
        },
      });
    };

    container.stdout.on('data', (data) => {
      const chunk = data.toString();

      // Always accumulate for logging
      if (!stdoutTruncated) {
        const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
        if (chunk.length > remaining) {
          stdout += chunk.slice(0, remaining);
          stdoutTruncated = true;
          logger.warn(
            { group: group.name, size: stdout.length },
            'Container stdout truncated due to size limit',
          );
        } else {
          stdout += chunk;
        }
      }

      // Stream-parse for output markers
      if (onOutput) {
        parseBuffer += chunk;
        let startIdx: number;
        while ((startIdx = parseBuffer.indexOf(OUTPUT_START_MARKER)) !== -1) {
          const endIdx = parseBuffer.indexOf(OUTPUT_END_MARKER, startIdx);
          if (endIdx === -1) break; // Incomplete pair, wait for more data

          const jsonStr = parseBuffer
            .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
            .trim();
          parseBuffer = parseBuffer.slice(endIdx + OUTPUT_END_MARKER.length);

          try {
            const parsed: ContainerOutput = JSON.parse(jsonStr);
            if (parsed.newSessionId) {
              newSessionId = parsed.newSessionId;
            }
            if (parsed.status === 'error' && typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
              lastStreamError = parsed.error;
            }
            hadStreamingOutput = true;
            if (typeof parsed.result === 'string' && parsed.result.length > 0) {
              eventBus.emit('live', {
                type: 'container:output',
                data: {
                  containerId: containerName,
                  chunk: parsed.result.slice(0, 2_000),
                  timestamp: new Date().toISOString(),
                  requestId: input.requestId,
                },
              });
            }
            // Activity detected — reset the hard timeout
            resetTimeout();
            // Call onOutput for all markers (including null results)
            // so idle timers start even for "silent" query completions.
            outputChain = outputChain.then(() => onOutput(parsed));
          } catch (err) {
            logger.warn(
              { group: group.name, error: err },
              'Failed to parse streamed output chunk',
            );
          }
        }
      }
    });

    container.stderr.on('data', (data) => {
      const chunk = data.toString();
      const lines = chunk.trim().split('\n');
      for (const line of lines) {
        if (!line) continue;
        const isMcpRuntimeLine =
          line.includes('[agent-runner] MCP event')
          || line.includes('[agent-runner] External MCP')
          || line.includes('[agent-runner] Runtime MCP configuration')
          || line.includes('[agent-runner] Codex MCP active')
          || line.includes('[agent-runner] Codex MCP config applied');
        if (isMcpRuntimeLine) {
          logger.info({ container: group.folder }, line);
        } else {
          logger.debug({ container: group.folder }, line);
        }
      }
      // Don't reset timeout on stderr — SDK writes debug logs continuously.
      // Timeout only resets on actual output (OUTPUT_MARKER in stdout).
      if (stderrTruncated) return;
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stderr.length;
      if (chunk.length > remaining) {
        stderr += chunk.slice(0, remaining);
        stderrTruncated = true;
        logger.warn(
          { group: group.name, size: stderr.length },
          'Container stderr truncated due to size limit',
        );
      } else {
        stderr += chunk;
      }
    });

    let timedOut = false;
    let hadStreamingOutput = false;
    const configTimeout = group.containerConfig?.timeout || CONTAINER_TIMEOUT;
    // Grace period: hard timeout must be at least IDLE_TIMEOUT + 30s so the
    // graceful _close sentinel has time to trigger before the hard kill fires.
    const timeoutMs = Math.max(configTimeout, IDLE_TIMEOUT + 30_000);

    const killOnTimeout = () => {
      timedOut = true;
      logger.error({ group: group.name, containerName }, 'Container timeout, stopping gracefully');
      exec(`docker stop ${containerName}`, withDockerEnv({ timeout: 15000 }), (err) => {
        if (err) {
          logger.warn({ group: group.name, containerName, err }, 'Graceful stop failed, force killing');
          container.kill('SIGKILL');
        }
      });
    };

    let timeout = setTimeout(killOnTimeout, timeoutMs);

    // Reset the timeout whenever there's activity (streaming output)
    const resetTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(killOnTimeout, timeoutMs);
    };

    container.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;
      if (code === 125) {
        dockerResilience.recordSpawnFailure(
          `docker_exit_125:${stderr.slice(-200) || 'unknown docker run failure'}`,
        );
      }

      if (timedOut) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const timeoutLog = path.join(logsDir, `container-${ts}.log`);
        try {
          fs.writeFileSync(timeoutLog, [
            `=== Container Run Log (TIMEOUT) ===`,
            `Timestamp: ${new Date().toISOString()}`,
            `Group: ${group.name}`,
            `Container: ${containerName}`,
            `Duration: ${duration}ms`,
            `Exit Code: ${code}`,
            `Had Streaming Output: ${hadStreamingOutput}`,
          ].join('\n'));
        } catch (writeErr) {
          logger.warn({ err: writeErr }, 'Failed to write timeout log (disk full?)');
        }

        // Timeout after output = idle cleanup, not failure.
        // The agent already sent its response; this is just the
        // container being reaped after the idle period expired.
        if (hadStreamingOutput) {
          logger.info(
            { group: group.name, containerName, duration, code },
            'Container timed out after output (idle cleanup)',
          );
          outputChain.then(() => {
            emitContainerEnd(code ?? -1, 'Timed out after output (idle cleanup)');
            resolve({
              status: 'success',
              result: null,
              newSessionId,
            });
          });
          return;
        }

        logger.error(
          { group: group.name, containerName, duration, code },
          'Container timed out with no output',
        );

        emitContainerEnd(code ?? -1, `Container timed out after ${formatMs(configTimeout)} (no output)`);
        resolve({
          status: 'error',
          result: null,
          error: `Container timed out after ${formatMs(configTimeout)} (no output)`,
        });
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = path.join(logsDir, `container-${timestamp}.log`);
      const isVerbose = process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace';

      const logLines = [
        `=== Container Run Log ===`,
        `Timestamp: ${new Date().toISOString()}`,
        `Group: ${group.name}`,
        `IsMain: ${input.isMain}`,
        `Duration: ${duration}ms`,
        `Exit Code: ${code}`,
        `Stdout Truncated: ${stdoutTruncated}`,
        `Stderr Truncated: ${stderrTruncated}`,
        ``,
      ];

      const isError = code !== 0;

      if (isVerbose || isError) {
        logLines.push(
          `=== Input ===`,
          JSON.stringify(input, null, 2),
          ``,
          `=== Container Args ===`,
          containerArgs.join(' '),
          ``,
          `=== Mounts ===`,
          mounts
            .map(
              (m) =>
                `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
            )
            .join('\n'),
          ``,
          `=== Stderr${stderrTruncated ? ' (TRUNCATED)' : ''} ===`,
          stderr,
          ``,
          `=== Stdout${stdoutTruncated ? ' (TRUNCATED)' : ''} ===`,
          stdout,
        );
      } else {
        logLines.push(
          `=== Input Summary ===`,
          `Prompt length: ${input.prompt.length} chars`,
          `Session ID: ${input.sessionId || 'new'}`,
          ``,
          `=== Mounts ===`,
          mounts
            .map((m) => `${m.containerPath}${m.readonly ? ' (ro)' : ''}`)
            .join('\n'),
          ``,
        );
      }

      try {
        fs.writeFileSync(logFile, logLines.join('\n'));
        logger.debug({ logFile, verbose: isVerbose }, 'Container log written');
      } catch (writeErr) {
        logger.warn({ err: writeErr, logFile }, 'Failed to write container log (disk full?)');
      }

      if (code !== 0) {
        logger.error(
          {
            group: group.name,
            code,
            duration,
            stderr,
            stdout,
            logFile,
          },
          'Container exited with error',
        );

        emitContainerEnd(code ?? -1, lastStreamError || stderr.slice(-200) || 'Container exited with error');
        resolve({
          status: 'error',
          result: null,
          error: lastStreamError
            ? `Container exited with code ${code}: ${lastStreamError}`
            : `Container exited with code ${code}: ${stderr.slice(-200)}`,
        });
        return;
      }

      // Streaming mode: wait for output chain to settle, return completion marker
      if (onOutput) {
        outputChain.then(() => {
          emitContainerEnd(code ?? 0, 'Completed');
          logger.info(
            { group: group.name, duration, newSessionId },
            'Container completed (streaming mode)',
          );
          resolve({
            status: 'success',
            result: null,
            newSessionId,
          });
        });
        return;
      }

      // Legacy mode: parse the last output marker pair from accumulated stdout
      try {
        // Extract JSON between sentinel markers for robust parsing
        const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
        const endIdx = stdout.indexOf(OUTPUT_END_MARKER);

        let jsonLine: string;
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          jsonLine = stdout
            .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
            .trim();
        } else {
          // Fallback: last non-empty line (backwards compatibility)
          const lines = stdout.trim().split('\n');
          jsonLine = lines[lines.length - 1];
        }

        const output: ContainerOutput = JSON.parse(jsonLine);

        logger.info(
          {
            group: group.name,
            duration,
            status: output.status,
            hasResult: !!output.result,
          },
          'Container completed',
        );

        emitContainerEnd(code ?? 0, output.result || 'Completed');
        resolve(output);
      } catch (err) {
        logger.error(
          {
            group: group.name,
            stdout,
            stderr,
            error: err,
          },
          'Failed to parse container output',
        );

        emitContainerEnd(code ?? -1, 'Failed to parse container output');
        resolve({
          status: 'error',
          result: null,
          error: `Failed to parse container output: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });

    container.on('error', (err) => {
      clearTimeout(timeout);
      dockerResilience.recordSpawnFailure(`spawn_error:${err.message}`);
      logger.error({ group: group.name, containerName, error: err }, 'Container spawn error');
      emitContainerEnd(-1, `Container spawn error: ${err.message}`);
      resolve({
        status: 'error',
        result: null,
        error: `Container spawn error: ${err.message}`,
      });
    });
  });
}

/**
 * Run a task on a pooled (pre-warmed) container via IPC assignment.
 * The container is already running in standby mode and has its output stream active.
 */
async function runPooledContainer(
  pooled: import('./container-pool.js').PooledContainer,
  group: RegisteredGroup,
  input: ContainerInput,
  onProcess: (proc: ChildProcess, containerName: string) => void,
  onOutput?: (output: ContainerOutput) => Promise<void>,
  startTime: number = Date.now(),
): Promise<ContainerOutput> {
  const containerName = pooled.containerName;
  const provider = runtimeToProvider(input.agentRuntime);

  eventBus.emit('live', {
    type: 'container:start',
    data: {
      containerId: containerName,
      group: group.folder,
      provider,
      prompt: input.prompt.slice(0, 200),
      startedAt: new Date().toISOString(),
      requestId: input.requestId,
    },
  });

  onProcess(pooled.process, containerName);

  // Write prompt to IPC directory (same as cold-spawn)
  const promptFile = path.join(DATA_DIR, 'ipc', group.folder, 'input', '_prompt.txt');
  fs.writeFileSync(promptFile, input.prompt);

  // Assign the task to the container via IPC
  await containerPool.assignTask(pooled, {
    prompt: input.prompt,
    sessionId: input.sessionId,
    chatJid: input.chatJid,
    isMain: input.isMain,
    isScheduledTask: input.isScheduledTask,
    agentRuntime: input.agentRuntime,
    agentMode: input.agentMode,
    requestId: input.requestId,
    secrets: readSecrets(),
  });

  logger.info(
    { group: group.name, containerName, pooled: true },
    'Assigned task to pooled container',
  );

  // Parse output from the pooled container's stdout (same as cold-spawn)
  return new Promise((resolve) => {
    let hadStreamingOutput = false;
    let newSessionId: string | undefined;
    let outputChain = Promise.resolve();
    let parseBuffer = '';
    let emittedEnd = false;

    const emitContainerEnd = (exitCode: number, summary: string) => {
      if (emittedEnd) return;
      emittedEnd = true;
      eventBus.emit('live', {
        type: 'container:end',
        data: {
          containerId: containerName,
          exitCode,
          durationMs: Date.now() - startTime,
          resultSummary: summary.slice(0, 500),
          requestId: input.requestId,
        },
      });
    };

    const configTimeout = group.containerConfig?.timeout || CONTAINER_TIMEOUT;
    const timeoutMs = Math.max(configTimeout, IDLE_TIMEOUT + 30_000);

    const killOnTimeout = () => {
      logger.error({ group: group.name, containerName, pooled: true }, 'Pooled container timeout');
      containerPool.release(pooled.id, false);
      emitContainerEnd(-1, hadStreamingOutput ? 'Timed out after output (pooled)' : 'Pooled container timeout');
      resolve({
        status: hadStreamingOutput ? 'success' : 'error',
        result: null,
        newSessionId,
        error: hadStreamingOutput ? undefined : `Container timed out after ${formatMs(configTimeout)} (no output)`,
      });
    };

    let timeout = setTimeout(killOnTimeout, timeoutMs);
    const resetTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(killOnTimeout, timeoutMs);
    };

    // Listen for output from the pooled container
    const onData = (data: Buffer) => {
      const chunk = data.toString();
      if (!onOutput) return;

      parseBuffer += chunk;
      let startIdx: number;
      while ((startIdx = parseBuffer.indexOf(OUTPUT_START_MARKER)) !== -1) {
        const endIdx = parseBuffer.indexOf(OUTPUT_END_MARKER, startIdx);
        if (endIdx === -1) break;

        const jsonStr = parseBuffer.slice(startIdx + OUTPUT_START_MARKER.length, endIdx).trim();
        parseBuffer = parseBuffer.slice(endIdx + OUTPUT_END_MARKER.length);

        try {
          const parsed: ContainerOutput = JSON.parse(jsonStr);
          if (parsed.newSessionId) newSessionId = parsed.newSessionId;
          hadStreamingOutput = true;
          if (typeof parsed.result === 'string' && parsed.result.length > 0) {
            eventBus.emit('live', {
              type: 'container:output',
              data: {
                containerId: containerName,
                chunk: parsed.result.slice(0, 2_000),
                timestamp: new Date().toISOString(),
                requestId: input.requestId,
              },
            });
          }
          resetTimeout();
          outputChain = outputChain.then(() => onOutput(parsed));
        } catch (err) {
          logger.warn({ group: group.name, error: err }, 'Failed to parse pooled output');
        }
      }
    };

    pooled.process.stdout?.on('data', onData);

    // Watch for _close sentinel as completion signal for this task
    const ipcCloseFile = path.join(DATA_DIR, 'ipc', group.folder, 'input', '_close');

    // The container writes _ready when it returns to standby (task complete)
    const readyFile = path.join(DATA_DIR, 'ipc', group.folder, 'input', '_ready');
    const checkDone = () => {
      if (fs.existsSync(readyFile)) {
        // Container returned to standby — task complete
        clearTimeout(timeout);
        pooled.process.stdout?.removeListener('data', onData);
        containerPool.release(pooled.id, true);

        outputChain.then(() => {
          emitContainerEnd(0, 'Completed');
          resolve({
            status: 'success',
            result: null,
            newSessionId,
          });
        });
        return;
      }
      setTimeout(checkDone, 500);
    };
    // Start checking after a short delay (container needs time to process)
    setTimeout(checkDone, 1000);

    // Handle container exit (unexpected)
    const onClose = () => {
      clearTimeout(timeout);
      pooled.process.stdout?.removeListener('data', onData);
      containerPool.release(pooled.id, false);

      outputChain.then(() => {
        emitContainerEnd(
          hadStreamingOutput ? 0 : -1,
          hadStreamingOutput ? 'Completed with unexpected pooled exit' : 'Pooled container exited unexpectedly',
        );
        resolve({
          status: hadStreamingOutput ? 'success' : 'error',
          result: null,
          newSessionId,
          error: hadStreamingOutput ? undefined : 'Pooled container exited unexpectedly',
        });
      });
    };
    pooled.process.once('close', onClose);
  });
}

/**
 * Initialize the container pool with build functions.
 * Call this at startup after container system is verified.
 */
export function initContainerPool(): void {
  if (!POOL_ENABLED) {
    logger.info('Container pool disabled via POOL_ENABLED=false');
    return;
  }
  containerPool.init(buildVolumeMounts, buildContainerArgs);
  containerPool.start();
}

export function writeTasksSnapshot(
  groupFolder: string,
  isMain: boolean,
  tasks: Array<{
    id: string;
    groupFolder: string;
    prompt: string;
    schedule_type: string;
    schedule_value: string;
    status: string;
    next_run: string | null;
    // Phase 6: enriched fields for agent visibility
    next_run_local?: string | null;
    timezone?: string;
    label?: string | null;
  }>,
): void {
  // Write filtered tasks to the group's IPC directory
  const groupIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  // Main sees all tasks, others only see their own
  const filteredTasks = isMain
    ? tasks
    : tasks.filter((t) => t.groupFolder === groupFolder);

  const tasksFile = path.join(groupIpcDir, 'current_tasks.json');
  fs.writeFileSync(tasksFile, JSON.stringify(filteredTasks, null, 2));
}

export interface AvailableGroup {
  jid: string;
  name: string;
  lastActivity: string;
  isRegistered: boolean;
}

/**
 * Write available groups snapshot for the container to read.
 * Only main group can see all available groups (for activation).
 * Non-main groups only see their own registration status.
 */
export function writeGroupsSnapshot(
  groupFolder: string,
  isMain: boolean,
  groups: AvailableGroup[],
  registeredJids: Set<string>,
): void {
  const groupIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  // Main sees all groups; others see nothing (they can't activate groups)
  const visibleGroups = isMain ? groups : [];

  const groupsFile = path.join(groupIpcDir, 'available_groups.json');
  fs.writeFileSync(
    groupsFile,
    JSON.stringify(
      {
        groups: visibleGroups,
        lastSync: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

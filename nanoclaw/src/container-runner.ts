/**
 * Container Runner for NanoClaw
 * Spawns agent execution in Apple Container and handles IPC
 */
import { ChildProcess, exec, execSync, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  CONTAINER_IMAGE,
  CONTAINER_MAX_OUTPUT_SIZE,
  CONTAINER_TIMEOUT,
  DATA_DIR,
  GROUPS_DIR,
  IDLE_TIMEOUT,
  IPC_SECRET,
} from './config.js';
import { logger } from './logger.js';
import { validateAdditionalMounts } from './mount-security.js';
import { containerPool } from './container-pool.js';
import { RegisteredGroup } from './types.js';

// Sentinel markers for robust output parsing (must match agent-runner)
const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

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

let cachedMounts: DockerMount[] | null = null;

function loadContainerMounts(): DockerMount[] {
  if (cachedMounts) return cachedMounts;

  try {
    // Use hostname (= container ID in Docker) to inspect ourselves
    const containerId = os.hostname();
    const result = execSync(
      `docker inspect --format '{{json .Mounts}}' ${containerId}`,
      { encoding: 'utf-8', timeout: 5000 },
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

function getHomeDir(): string {
  const home = process.env.HOME || os.homedir();
  if (!home) {
    throw new Error(
      'Unable to determine home directory: HOME environment variable is not set and os.homedir() returned empty',
    );
  }
  return home;
}

export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  secrets?: Record<string, string>;
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

function buildVolumeMounts(
  group: RegisteredGroup,
  isMain: boolean,
): VolumeMount[] {
  const mounts: VolumeMount[] = [];
  const homeDir = getHomeDir();
  const projectRoot = process.cwd();

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
  try { fs.chmodSync(groupSessionsDir, 0o777); } catch { /* best-effort on Windows */ }
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
    for (const skillDir of fs.readdirSync(skillsSrc)) {
      const srcDir = path.join(skillsSrc, skillDir);
      if (!fs.statSync(srcDir).isDirectory()) continue;
      const dstDir = path.join(skillsDst, skillDir);
      fs.mkdirSync(dstDir, { recursive: true });
      for (const file of fs.readdirSync(srcDir)) {
        const srcFile = path.join(srcDir, file);
        const dstFile = path.join(dstDir, file);
        fs.copyFileSync(srcFile, dstFile);
      }
    }
  }
  mounts.push({
    hostPath: groupSessionsDir,
    containerPath: '/home/node/.claude',
    readonly: false,
  });

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
  } catch { /* best-effort on Windows */ }
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
    // Z.AI model mapping (docs.z.ai/devpack/tool/claude#manual-configuration)
    'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL',
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

function buildContainerArgs(mounts: VolumeMount[], containerName: string): string[] {
  const args: string[] = ['run', '-i', '--name', containerName];

  // Connect to jellycore network if it exists (so agent can reach oracle, proxy etc.)
  const dockerNetwork = process.env.DOCKER_NETWORK || '';
  if (dockerNetwork) {
    args.push('--network', dockerNetwork);
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

  const groupDir = path.join(GROUPS_DIR, group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  // Try to acquire a warm container from the pool
  const pooled = containerPool.acquire(group.folder);
  if (pooled) {
    return runPooledContainer(pooled, group, input, onProcess, onOutput, startTime);
  }

  // Cold-spawn fallback

  const mounts = buildVolumeMounts(group, input.isMain);
  const safeName = group.folder.replace(/[^a-zA-Z0-9-]/g, '-');
  const containerName = `nanoclaw-${safeName}-${Date.now()}`;
  const containerArgs = buildContainerArgs(mounts, containerName);

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
    },
    'Spawning container agent',
  );

  const logsDir = path.join(GROUPS_DIR, group.folder, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  return new Promise((resolve) => {
    const container = spawn('docker', containerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

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
            hadStreamingOutput = true;
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
        if (line) logger.debug({ container: group.folder }, line);
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
      exec(`docker stop ${containerName}`, { timeout: 15000 }, (err) => {
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

      if (timedOut) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const timeoutLog = path.join(logsDir, `container-${ts}.log`);
        fs.writeFileSync(timeoutLog, [
          `=== Container Run Log (TIMEOUT) ===`,
          `Timestamp: ${new Date().toISOString()}`,
          `Group: ${group.name}`,
          `Container: ${containerName}`,
          `Duration: ${duration}ms`,
          `Exit Code: ${code}`,
          `Had Streaming Output: ${hadStreamingOutput}`,
        ].join('\n'));

        // Timeout after output = idle cleanup, not failure.
        // The agent already sent its response; this is just the
        // container being reaped after the idle period expired.
        if (hadStreamingOutput) {
          logger.info(
            { group: group.name, containerName, duration, code },
            'Container timed out after output (idle cleanup)',
          );
          outputChain.then(() => {
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

        resolve({
          status: 'error',
          result: null,
          error: `Container timed out after ${configTimeout}ms`,
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

      fs.writeFileSync(logFile, logLines.join('\n'));
      logger.debug({ logFile, verbose: isVerbose }, 'Container log written');

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

        resolve({
          status: 'error',
          result: null,
          error: `Container exited with code ${code}: ${stderr.slice(-200)}`,
        });
        return;
      }

      // Streaming mode: wait for output chain to settle, return completion marker
      if (onOutput) {
        outputChain.then(() => {
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

        resolve({
          status: 'error',
          result: null,
          error: `Failed to parse container output: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });

    container.on('error', (err) => {
      clearTimeout(timeout);
      logger.error({ group: group.name, containerName, error: err }, 'Container spawn error');
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

    const configTimeout = group.containerConfig?.timeout || CONTAINER_TIMEOUT;
    const timeoutMs = Math.max(configTimeout, IDLE_TIMEOUT + 30_000);

    const killOnTimeout = () => {
      logger.error({ group: group.name, containerName, pooled: true }, 'Pooled container timeout');
      containerPool.release(pooled.id, false);
      resolve({
        status: hadStreamingOutput ? 'success' : 'error',
        result: null,
        newSessionId,
        error: hadStreamingOutput ? undefined : `Container timed out after ${configTimeout}ms`,
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

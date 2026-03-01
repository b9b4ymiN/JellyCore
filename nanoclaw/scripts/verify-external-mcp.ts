import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

type StartupMode = 'always' | 'on_demand';
type ProbeProtocol = 'jsonl' | 'framed';

interface ExternalMcpServer {
  name: string;
  description?: string;
  enabled?: boolean;
  startupMode?: StartupMode;
  allowGroups?: string[];
  command: string;
  args: string[];
  requiredEnv?: string[];
  env?: Record<string, string>;
}

interface ExternalMcpsConfig {
  servers: ExternalMcpServer[];
}

interface ProbeResult {
  ok: boolean;
  toolCount?: number;
  tools?: string[];
  error?: string;
  stderr?: string;
}

interface ProbeTarget {
  name: string;
  command: string;
  args: string[];
  startupMode: StartupMode;
  requiredEnv: string[];
  env: Record<string, string>;
  enabled: boolean;
}

const PROBE_SCRIPT = `
const { spawn } = require('child_process');

const timeoutMs = Math.max(3000, Number(process.env.MCP_PROBE_TIMEOUT_MS || 15000));
const cmd = process.env.MCP_CMD || '';
const args = JSON.parse(process.env.MCP_ARGS_JSON || '[]');
const protocol = (process.env.MCP_PROBE_PROTOCOL || 'jsonl').toLowerCase();

if (!cmd) {
  process.stdout.write(JSON.stringify({ ok: false, error: 'missing MCP_CMD' }));
  process.exit(1);
}

const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });

let stdoutBuffer = Buffer.alloc(0);
let stderrText = '';
let done = false;
const pending = new Map();
const overallTimer = setTimeout(() => fail(new Error('probe timeout')), timeoutMs);

child.stdout.on('data', (chunk) => {
  stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
  pump();
});

child.stderr.on('data', (chunk) => {
  stderrText += chunk.toString();
  if (stderrText.length > 6000) stderrText = stderrText.slice(-6000);
});

child.on('error', (err) => fail(err));
child.on('exit', (code, signal) => {
  if (!done) {
    fail(new Error(\`MCP process exited early (code=\${code}, signal=\${signal})\`));
  }
});

function parseFramedMessage() {
  const headerEnd = stdoutBuffer.indexOf('\\r\\n\\r\\n');
  if (headerEnd < 0) return null;
  const header = stdoutBuffer.slice(0, headerEnd).toString();
  const match = header.match(/content-length:\\s*(\\d+)/i);
  if (!match) throw new Error('invalid MCP frame: missing content-length');
  const bodyLen = Number(match[1]);
  const bodyStart = headerEnd + 4;
  const bodyEnd = bodyStart + bodyLen;
  if (stdoutBuffer.length < bodyEnd) return null;
  const body = stdoutBuffer.slice(bodyStart, bodyEnd).toString();
  stdoutBuffer = stdoutBuffer.slice(bodyEnd);
  return JSON.parse(body);
}

function parseJsonlMessage() {
  const nl = stdoutBuffer.indexOf('\\n');
  if (nl < 0) return null;
  const rawLine = stdoutBuffer.slice(0, nl).toString();
  stdoutBuffer = stdoutBuffer.slice(nl + 1);
  const line = rawLine.replace(/\\r$/, '').trim();
  if (!line) return undefined;
  try {
    return JSON.parse(line);
  } catch {
    throw new Error(\`non-JSON stdout line from MCP server: \${line.slice(0, 200)}\`);
  }
}

function pump() {
  try {
    while (true) {
      const msg = protocol === 'framed' ? parseFramedMessage() : parseJsonlMessage();
      if (msg === null) break;
      if (typeof msg === 'undefined') continue;
      if (typeof msg.id === 'undefined') continue;
      const key = String(msg.id);
      const waiter = pending.get(key);
      if (!waiter) continue;
      pending.delete(key);
      waiter.resolve(msg);
    }
  } catch (err) {
    fail(err);
  }
}

function sendMessage(payload) {
  if (protocol === 'framed') {
    const body = Buffer.from(JSON.stringify(payload));
    child.stdin.write(\`Content-Length: \${body.length}\\r\\n\\r\\n\`);
    child.stdin.write(body);
    return;
  }
  child.stdin.write(JSON.stringify(payload) + '\\n');
}

function request(id, method, params) {
  return new Promise((resolve) => {
    pending.set(String(id), { resolve });
    sendMessage({ jsonrpc: '2.0', id, method, params });
  });
}

function cleanup() {
  clearTimeout(overallTimer);
  try { child.kill('SIGTERM'); } catch {}
}

function succeed(payload) {
  if (done) return;
  done = true;
  cleanup();
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

function fail(err) {
  if (done) return;
  done = true;
  cleanup();
  process.stdout.write(JSON.stringify({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    stderr: stderrText,
  }));
  process.exit(1);
}

(async () => {
  try {
    const init = await request(1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'nanoclaw-mcp-probe', version: '1.0.0' },
    });
    if (init.error) throw new Error(\`initialize failed: \${JSON.stringify(init.error)}\`);

    sendMessage({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });

    const toolsResp = await request(2, 'tools/list', {});
    if (toolsResp.error) throw new Error(\`tools/list failed: \${JSON.stringify(toolsResp.error)}\`);
    const tools = Array.isArray(toolsResp?.result?.tools)
      ? toolsResp.result.tools.map((t) => t?.name).filter((v) => typeof v === 'string')
      : [];
    succeed({ ok: true, toolCount: tools.length, tools });
  } catch (err) {
    fail(err);
  }
})();
`;

function loadConfig(configPath: string): ExternalMcpsConfig {
  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<ExternalMcpsConfig>;
  return {
    servers: Array.isArray(parsed.servers) ? parsed.servers : [],
  };
}

function parseProbeResult(raw: string): ProbeResult {
  const text = raw.trim();
  if (!text) return { ok: false, error: 'empty probe output' };
  try {
    return JSON.parse(text) as ProbeResult;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as ProbeResult;
      } catch {
        return { ok: false, error: `invalid probe JSON: ${text.slice(0, 500)}` };
      }
    }
    return { ok: false, error: `invalid probe output: ${text.slice(0, 500)}` };
  }
}

function ensureDockerReady(): void {
  const probe = spawnSync('docker', ['info'], {
    encoding: 'utf-8',
    timeout: 8000,
    maxBuffer: 1024 * 1024,
  });
  if (probe.error) {
    console.error(`docker not available: ${probe.error.message}`);
    process.exit(2);
  }
  if (probe.status !== 0) {
    const detail = (probe.stderr || probe.stdout || '').trim() || `exit code ${probe.status ?? 'unknown'}`;
    console.error(`docker daemon not ready: ${detail}`);
    process.exit(2);
  }
}

function boolEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function probeTarget(
  target: ProbeTarget,
  containerImage: string,
  timeoutMs: number,
  network: string,
): { ok: boolean; line: string; detail?: string } {
  const missingEnv = target.requiredEnv.filter((name) => {
    const value = process.env[name];
    return typeof value !== 'string' || value.length === 0;
  });

  if (!target.enabled) {
    return { ok: true, line: `- ${target.name}: SKIP (disabled)` };
  }
  if (missingEnv.length > 0) {
    return { ok: false, line: `- ${target.name}: FAIL (missing env: ${missingEnv.join(', ')})` };
  }

  const protocols: ProbeProtocol[] = ['jsonl', 'framed'];
  let pass: { parsed: ProbeResult; elapsed: number; protocol: ProbeProtocol } | null = null;
  let lastFailure = 'unknown error';
  let lastFailureStderr = '';

  for (const probeProtocol of protocols) {
    const dockerArgs: string[] = ['run', '--rm'];
    if (network) {
      dockerArgs.push('--network', network);
    } else {
      dockerArgs.push('--add-host', 'host.docker.internal:host-gateway');
    }
    dockerArgs.push(
      '--entrypoint',
      'node',
      '-e',
      `MCP_CMD=${target.command}`,
      '-e',
      `MCP_ARGS_JSON=${JSON.stringify(target.args)}`,
      '-e',
      `MCP_PROBE_TIMEOUT_MS=${timeoutMs}`,
      '-e',
      `MCP_PROBE_PROTOCOL=${probeProtocol}`,
    );

    for (const [name, value] of Object.entries(target.env)) {
      dockerArgs.push('-e', `${name}=${value}`);
    }

    dockerArgs.push(containerImage, '-e', PROBE_SCRIPT);

    const started = Date.now();
    const probe = spawnSync('docker', dockerArgs, {
      encoding: 'utf-8',
      timeout: timeoutMs + 8000,
      maxBuffer: 1024 * 1024,
    });
    const elapsed = Date.now() - started;

    if (probe.error) {
      lastFailure = probe.error.message;
      lastFailureStderr = '';
      continue;
    }

    const parsed = parseProbeResult(probe.stdout || '');
    if (probe.status === 0 && parsed.ok) {
      pass = { parsed, elapsed, protocol: probeProtocol };
      break;
    }

    const stderrText = (probe.stderr || '').trim();
    lastFailure = parsed.error === 'empty probe output' && stderrText
      ? stderrText
      : parsed.error || stderrText || `exit code ${probe.status ?? 'unknown'}`;
    lastFailureStderr = parsed.stderr || '';
  }

  if (!pass) {
    const detail = lastFailureStderr ? `stderr: ${lastFailureStderr}` : undefined;
    return { ok: false, line: `- ${target.name}: FAIL (${lastFailure})`, detail };
  }

  const tools = Array.isArray(pass.parsed.tools) ? pass.parsed.tools : [];
  const line = `- ${target.name}: PASS (${pass.parsed.toolCount ?? tools.length} tools, ${pass.elapsed}ms, startupMode=${target.startupMode}, protocol=${pass.protocol})`;
  const detail = tools.length > 0 ? `tools: ${tools.join(', ')}` : undefined;
  return { ok: true, line, detail };
}

function main(): void {
  const root = process.cwd();
  const configPath = path.join(root, 'container', 'config', 'mcps.json');
  const containerImage = process.env.CONTAINER_IMAGE || 'nanoclaw-agent:latest';
  const timeoutMs = Math.max(3000, parseInt(process.env.MCP_VERIFY_TIMEOUT_MS || '20000', 10) || 20000);
  const strictMode = boolEnv('MCP_VERIFY_STRICT', false);
  const verifyOracle = boolEnv('MCP_VERIFY_ORACLE', true);
  const network = process.env.MCP_VERIFY_DOCKER_NETWORK || '';

  if (!fs.existsSync(configPath)) {
    console.error(`config not found: ${configPath}`);
    process.exit(2);
  }

  ensureDockerReady();

  const cfg = loadConfig(configPath);
  const externalTargets: ProbeTarget[] = cfg.servers.map((server) => {
    const envMap = server.env && typeof server.env === 'object' ? server.env : {};
    const resolvedEnv: Record<string, string> = {};
    for (const [insideName, sourceName] of Object.entries(envMap)) {
      const value = process.env[sourceName];
      if (typeof value === 'string') resolvedEnv[insideName] = value;
    }
    return {
      name: server.name,
      command: server.command,
      args: Array.isArray(server.args) ? server.args : [],
      startupMode: server.startupMode === 'on_demand' ? 'on_demand' : 'always',
      requiredEnv: Array.isArray(server.requiredEnv) ? server.requiredEnv : [],
      env: resolvedEnv,
      enabled: server.enabled !== false,
    };
  });

  let failed = 0;
  console.log(`Verifying MCP tools via image: ${containerImage}`);
  console.log(`Docker network mode: ${network || 'default bridge (+ host-gateway alias)'}`);

  if (verifyOracle) {
    console.log('Core MCP checks:');
    const oracleApiUrl = process.env.MCP_VERIFY_ORACLE_API_URL
      || process.env.ORACLE_API_URL
      || 'http://host.docker.internal:47778';
    const oracleTarget: ProbeTarget = {
      name: 'oracle',
      command: 'node',
      args: ['/app/dist/oracle-mcp-http.js'],
      startupMode: 'always',
      requiredEnv: strictMode ? ['ORACLE_AUTH_TOKEN'] : [],
      env: {
        ORACLE_API_URL: oracleApiUrl,
        ORACLE_AUTH_TOKEN: process.env.ORACLE_AUTH_TOKEN || '',
        ORACLE_WRITE_MODE: 'none',
        ORACLE_ALLOWED_WRITE_TOOLS: '',
        ORACLE_POLICY_GROUP: 'verify',
        NANOCLAW_CHAT_JID: 'verify@local',
      },
      enabled: true,
    };
    const oracleResult = probeTarget(oracleTarget, containerImage, timeoutMs, network);
    console.log(oracleResult.line);
    if (oracleResult.detail) console.log(`  ${oracleResult.detail}`);
    if (!oracleResult.ok) failed += 1;
  }

  console.log('External MCP checks:');
  console.log(`Configured external servers: ${externalTargets.length}`);
  for (const target of externalTargets) {
    const missingRequired = target.requiredEnv.filter((name) => {
      const value = process.env[name];
      return typeof value !== 'string' || value.length === 0;
    });

    if (missingRequired.length > 0 && !strictMode) {
      console.log(`- ${target.name}: SKIP (missing env: ${missingRequired.join(', ')})`);
      continue;
    }

    const result = probeTarget(target, containerImage, timeoutMs, network);
    console.log(result.line);
    if (result.detail) console.log(`  ${result.detail}`);
    if (!result.ok) failed += 1;
  }

  if (failed > 0) {
    console.error(`Verification failed: ${failed} server(s) failed`);
    process.exit(1);
  }

  console.log('MCP verification passed: all checked servers returned tools/list successfully.');
}

main();

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

type StartupMode = 'always' | 'on_demand';

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
  return new Promise((resolve, reject) => {
    pending.set(String(id), { resolve, reject });
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

function isTruthyEnv(name: string): boolean {
  const value = process.env[name];
  return typeof value === 'string' && value.length > 0;
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

function main(): void {
  const root = process.cwd();
  const configPath = path.join(root, 'container', 'config', 'mcps.json');
  const containerImage = process.env.CONTAINER_IMAGE || 'nanoclaw-agent:latest';
  const timeoutMs = Math.max(3000, parseInt(process.env.MCP_VERIFY_TIMEOUT_MS || '20000', 10) || 20000);

  if (!fs.existsSync(configPath)) {
    console.error(`config not found: ${configPath}`);
    process.exit(2);
  }

  const cfg = loadConfig(configPath);
  const servers = cfg.servers;
  const strictMode = ['1', 'true', 'yes'].includes((process.env.MCP_VERIFY_STRICT || '').toLowerCase());

  ensureDockerReady();

  if (servers.length === 0) {
    console.log('no external MCP servers configured');
    return;
  }

  let failed = 0;
  console.log(`Verifying external MCP tools via image: ${containerImage}`);
  console.log(`Configured servers: ${servers.length}`);

  for (const server of servers) {
    const startupMode: StartupMode = server.startupMode === 'on_demand' ? 'on_demand' : 'always';
    const configEnabled = server.enabled !== false;
    const requiredEnv = Array.isArray(server.requiredEnv) ? server.requiredEnv : [];
    const missingEnv = requiredEnv.filter((envName) => !isTruthyEnv(envName));

    if (!configEnabled) {
      console.log(`- ${server.name}: SKIP (disabled by config)`);
      continue;
    }
    if (missingEnv.length > 0) {
      if (strictMode) {
        failed += 1;
        console.log(`- ${server.name}: FAIL (missing env: ${missingEnv.join(', ')})`);
      } else {
        console.log(`- ${server.name}: SKIP (missing env: ${missingEnv.join(', ')})`);
      }
      continue;
    }

    const protocols: Array<'jsonl' | 'framed'> = ['jsonl', 'framed'];
    let passResult: { parsed: ProbeResult; elapsed: number; protocol: 'jsonl' | 'framed' } | null = null;
    let lastFailure = 'unknown error';
    let lastFailureStderr = '';

    for (const probeProtocol of protocols) {
      const dockerArgs: string[] = [
        'run',
        '--rm',
        '--entrypoint',
        'node',
        '-e',
        `MCP_CMD=${server.command}`,
        '-e',
        `MCP_ARGS_JSON=${JSON.stringify(Array.isArray(server.args) ? server.args : [])}`,
        '-e',
        `MCP_PROBE_TIMEOUT_MS=${timeoutMs}`,
        '-e',
        `MCP_PROBE_PROTOCOL=${probeProtocol}`,
      ];

      const envMap = server.env && typeof server.env === 'object' ? server.env : {};
      for (const [insideName, sourceName] of Object.entries(envMap)) {
        const value = process.env[sourceName];
        if (typeof value === 'string') {
          dockerArgs.push('-e', `${insideName}=${value}`);
        }
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
        passResult = { parsed, elapsed, protocol: probeProtocol };
        break;
      }

      const stderrText = (probe.stderr || '').trim();
      lastFailure = parsed.error === 'empty probe output' && stderrText
        ? stderrText
        : parsed.error || stderrText || `exit code ${probe.status ?? 'unknown'}`;
      lastFailureStderr = parsed.stderr || '';
    }

    if (!passResult) {
      failed += 1;
      console.log(`- ${server.name}: FAIL (${lastFailure})`);
      if (lastFailureStderr) console.log(`  stderr: ${lastFailureStderr}`);
      continue;
    }

    const tools = Array.isArray(passResult.parsed.tools) ? passResult.parsed.tools : [];
    console.log(
      `- ${server.name}: PASS (${passResult.parsed.toolCount ?? tools.length} tools, ${passResult.elapsed}ms, startupMode=${startupMode}, protocol=${passResult.protocol})`,
    );
    if (tools.length > 0) {
      console.log(`  tools: ${tools.join(', ')}`);
    }
  }

  if (failed > 0) {
    console.error(`Verification failed: ${failed} server(s) failed`);
    process.exit(1);
  }

  console.log('All eligible external MCP servers are callable and returned tools/list successfully.');
}

main();

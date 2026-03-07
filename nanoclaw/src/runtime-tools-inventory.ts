import fs from 'fs';
import path from 'path';

import { MAIN_GROUP_FOLDER, TIMEZONE } from './config.js';
import { recordNonFatalError } from './non-fatal-errors.js';

interface ExternalMcpConfig {
  name: string;
  description?: string;
  command?: string;
  args?: string[];
  enabled?: boolean;
  startupMode?: 'always' | 'on_demand';
  allowGroups?: string[];
  requiredEnv?: string[];
  env?: Record<string, string>;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function readFileUtf8Safe(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    recordNonFatalError(
      'inventory.read_file_failed',
      err,
      { filePath },
      'debug',
    );
    return null;
  }
}

function extractMatches(content: string, pattern: RegExp): string[] {
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    if (match[1]) matches.push(match[1]);
  }
  return uniqueSorted(matches);
}

function parseSimpleFrontmatter(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return out;
  for (const line of fm[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

function discoverSkillInventory(projectRoot: string): Array<{
  name: string;
  directory: string;
  description: string | null;
}> {
  const skillsDir = path.join(projectRoot, 'container', 'skills');
  if (!fs.existsSync(skillsDir)) return [];

  const items: Array<{ name: string; directory: string; description: string | null }> = [];
  for (const entry of fs.readdirSync(skillsDir)) {
    const fullDir = path.join(skillsDir, entry);
    if (!fs.statSync(fullDir).isDirectory()) continue;
    const skillMdPath = path.join(fullDir, 'SKILL.md');
    const skillContent = readFileUtf8Safe(skillMdPath);
    const meta = skillContent ? parseSimpleFrontmatter(skillContent) : {};
    items.push({
      name: meta.name || entry,
      directory: entry,
      description: meta.description || null,
    });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

function discoverNanoclawMcpTools(projectRoot: string): string[] {
  const p = path.join(projectRoot, 'container', 'agent-runner', 'src', 'ipc-mcp-stdio.ts');
  const content = readFileUtf8Safe(p);
  if (!content) return [];
  return extractMatches(content, /server\.tool\(\s*'([^']+)'/g);
}

function discoverOracleMcpTools(projectRoot: string): string[] {
  const p = path.join(projectRoot, 'container', 'agent-runner', 'src', 'oracle-mcp-http.ts');
  const content = readFileUtf8Safe(p);
  if (!content) return [];
  return extractMatches(content, /name:\s*'(oracle_[^']+)'/g);
}

function discoverAgentAllowedTools(projectRoot: string): string[] {
  const p = path.join(projectRoot, 'container', 'agent-runner', 'src', 'index.ts');
  const content = readFileUtf8Safe(p);
  if (!content) return [];

  const blockMatch = content.match(/allowedTools:\s*\[([\s\S]*?)\],\s*env:/m);
  if (!blockMatch) return [];
  return extractMatches(blockMatch[1], /'([^']+)'/g);
}

function parseMcpServersJson(raw: string): ExternalMcpConfig[] {
  try {
    const parsed = JSON.parse(raw) as {
      mcpServers?: Record<string, {
        command?: string;
        args?: unknown;
        env?: Record<string, unknown>;
        description?: string;
        enabled?: boolean;
        startupMode?: 'always' | 'on_demand';
        allowGroups?: string[];
        requiredEnv?: string[];
      }>;
    };
    if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') return [];

    const servers: ExternalMcpConfig[] = [];
    for (const [name, cfg] of Object.entries(parsed.mcpServers)) {
      if (!cfg || typeof cfg !== 'object') continue;
      if (typeof cfg.command !== 'string' || cfg.command.trim().length === 0) continue;
      servers.push({
        name,
        description: cfg.description || '',
        command: cfg.command,
        args: Array.isArray(cfg.args)
          ? cfg.args.filter((v): v is string => typeof v === 'string')
          : [],
        enabled: cfg.enabled !== false,
        startupMode: cfg.startupMode === 'on_demand' ? 'on_demand' : 'always',
        allowGroups: Array.isArray(cfg.allowGroups) ? cfg.allowGroups : [],
        requiredEnv: Array.isArray(cfg.requiredEnv) ? cfg.requiredEnv : [],
        env: {},
      });
    }
    return servers;
  } catch (err) {
    recordNonFatalError(
      'inventory.parse_mcp_servers_json_failed',
      err,
      { rawLength: raw.length },
      'debug',
    );
    return [];
  }
}

function loadExternalMcpConfigs(projectRoot: string): ExternalMcpConfig[] {
  const merged = new Map<string, ExternalMcpConfig>();

  const primaryPath = path.join(projectRoot, 'container', 'config', 'mcps.json');
  const primaryRaw = readFileUtf8Safe(primaryPath);
  if (primaryRaw) {
    try {
      const parsed = JSON.parse(primaryRaw) as { servers?: ExternalMcpConfig[] };
      const servers = Array.isArray(parsed.servers) ? parsed.servers : [];
      for (const server of servers) {
        if (!server?.name) continue;
        merged.set(server.name, server);
      }
    } catch (err) {
      recordNonFatalError(
        'inventory.parse_primary_mcp_config_failed',
        err,
        { primaryPath },
        'debug',
      );
    }
  }

  const projectMcpPath = path.join(projectRoot, '.mcp.json');
  const projectMcpRaw = readFileUtf8Safe(projectMcpPath);
  if (projectMcpRaw) {
    for (const server of parseMcpServersJson(projectMcpRaw)) {
      if (!server?.name) continue;
      merged.set(server.name, server);
    }
  }

  // Optional per-main-group .mcp.json for runtime parity with agent-runner
  const groupMcpPath = path.join(projectRoot, 'groups', MAIN_GROUP_FOLDER, '.mcp.json');
  const groupMcpRaw = readFileUtf8Safe(groupMcpPath);
  if (groupMcpRaw) {
    for (const server of parseMcpServersJson(groupMcpRaw)) {
      if (!server?.name) continue;
      merged.set(server.name, server);
    }
  }

  return [...merged.values()];
}

export function buildRuntimeToolsInventory(channelNames: string[]): Record<string, unknown> {
  const projectRoot = process.cwd();
  const skills = discoverSkillInventory(projectRoot);
  const nanoclawTools = discoverNanoclawMcpTools(projectRoot);
  const oracleTools = discoverOracleMcpTools(projectRoot);
  const staticAllowedTools = discoverAgentAllowedTools(projectRoot);
  const externalConfigs = loadExternalMcpConfigs(projectRoot);

  const externalServers = externalConfigs.map((server) => {
    const configEnabled = server.enabled !== false;
    const requiredEnv = Array.isArray(server.requiredEnv) ? server.requiredEnv : [];
    const startupMode = server.startupMode === 'on_demand' ? 'on_demand' : 'always';
    const allowGroups = Array.isArray(server.allowGroups) ? server.allowGroups : [];
    const missingEnv = requiredEnv.filter((key) => !process.env[key]);
    const active = configEnabled && startupMode === 'always' && missingEnv.length === 0;
    const reason = !configEnabled
      ? 'disabled by config'
      : startupMode === 'on_demand'
        ? 'startupMode=on_demand'
        : missingEnv.length > 0
          ? `missing required env: ${missingEnv.join(', ')}`
          : 'ready';
    return {
      name: server.name,
      description: server.description || null,
      command: server.command || null,
      args: Array.isArray(server.args) ? server.args : [],
      configEnabled,
      startupMode,
      allowGroups,
      requiredEnv,
      missingEnv,
      enabled: active,
      reason,
    };
  });
  const externalAllowedTools = externalServers
    .filter((server) => server.enabled)
    .map((server) => `mcp__${server.name}__*`);
  const allowedTools = uniqueSorted([
    ...staticAllowedTools,
    ...externalAllowedTools,
  ]);

  return {
    timestamp: new Date().toISOString(),
    runtime: {
      channels: uniqueSorted(channelNames),
      timezone: TIMEZONE,
      projectRoot,
    },
    sdk: {
      allowedToolsCount: allowedTools.length,
      allowedTools,
    },
    skills: {
      count: skills.length,
      items: skills,
    },
    mcp: {
      nanoclaw: {
        configured: true,
        toolCount: nanoclawTools.length,
        tools: nanoclawTools,
        source: 'container/agent-runner/src/ipc-mcp-stdio.ts',
      },
      oracle: {
        configured: true,
        apiUrl: process.env.ORACLE_API_URL || 'http://oracle:47778',
        authConfigured: Boolean(process.env.ORACLE_AUTH_TOKEN),
        toolCount: oracleTools.length,
        tools: oracleTools,
        source: 'container/agent-runner/src/oracle-mcp-http.ts',
      },
      external: {
        configuredCount: externalServers.length,
        activeCount: externalServers.filter((s) => s.enabled).length,
        servers: externalServers,
        source: 'container/config/mcps.json',
      },
    },
  };
}

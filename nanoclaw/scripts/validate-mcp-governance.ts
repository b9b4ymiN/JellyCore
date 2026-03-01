import fs from 'fs';
import path from 'path';

type StartupMode = 'always' | 'on_demand';
type Tier = 'core' | 'optional' | 'experimental';

interface McpServerConfig {
  name: string;
  enabled?: boolean;
  startupMode?: StartupMode;
  requiredEnv?: string[];
}

interface McpsConfig {
  servers: McpServerConfig[];
}

interface GovernanceServer {
  tier: Tier;
  defaultEnabled: boolean;
  startupMode: StartupMode;
  requiredEnv: string[];
  purpose: string;
  riskLevel: string;
}

interface GovernanceConfig {
  version: string;
  defaultProfile: string;
  external: Record<string, GovernanceServer>;
}

function readJsonFile<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

function normalizedMode(mode: string | undefined): StartupMode {
  return mode === 'on_demand' ? 'on_demand' : 'always';
}

function toSet(values: string[] | undefined): Set<string> {
  return new Set(
    (values || [])
      .filter((v) => typeof v === 'string')
      .map((v) => v.trim())
      .filter(Boolean),
  );
}

function compareSetEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function main(): void {
  const root = process.cwd();
  const mcpsPath = path.join(root, 'container', 'config', 'mcps.json');
  const governancePath = path.join(root, 'container', 'config', 'mcp-governance.json');

  if (!fs.existsSync(mcpsPath)) {
    console.error(`Missing file: ${mcpsPath}`);
    process.exit(2);
  }
  if (!fs.existsSync(governancePath)) {
    console.error(`Missing file: ${governancePath}`);
    process.exit(2);
  }

  const mcps = readJsonFile<McpsConfig>(mcpsPath);
  const governance = readJsonFile<GovernanceConfig>(governancePath);
  const errors: string[] = [];
  const warnings: string[] = [];

  const servers = Array.isArray(mcps.servers) ? mcps.servers : [];
  const governanceMap = governance.external || {};

  for (const server of servers) {
    const gov = governanceMap[server.name];
    if (!gov) {
      errors.push(`governance missing external.${server.name}`);
      continue;
    }

    const mcpsEnabled = server.enabled !== false;
    if (gov.defaultEnabled !== mcpsEnabled) {
      errors.push(
        `${server.name}: governance.defaultEnabled=${gov.defaultEnabled} != mcps.enabled=${mcpsEnabled}`,
      );
    }

    const mcpsMode = normalizedMode(server.startupMode);
    if (gov.startupMode !== mcpsMode) {
      errors.push(
        `${server.name}: governance.startupMode=${gov.startupMode} != mcps.startupMode=${mcpsMode}`,
      );
    }

    const govReq = toSet(gov.requiredEnv);
    const mcpsReq = toSet(server.requiredEnv);
    if (!compareSetEqual(govReq, mcpsReq)) {
      errors.push(
        `${server.name}: governance.requiredEnv=[${[...govReq].join(', ')}] != mcps.requiredEnv=[${[...mcpsReq].join(', ')}]`,
      );
    }

    if (!gov.purpose || gov.purpose.trim().length < 12) {
      warnings.push(`${server.name}: purpose is too short`);
    }
  }

  for (const name of Object.keys(governanceMap)) {
    const exists = servers.some((s) => s.name === name);
    if (!exists) {
      warnings.push(`governance has external.${name} but mcps.json has no matching server`);
    }
  }

  console.log(`MCP governance version: ${governance.version}`);
  console.log(`Default profile: ${governance.defaultProfile}`);
  console.log(`Servers in mcps.json: ${servers.length}`);

  for (const server of servers) {
    const gov = governanceMap[server.name];
    const tier = gov?.tier || 'unknown';
    const mode = normalizedMode(server.startupMode);
    const enabled = server.enabled !== false;
    const req = (server.requiredEnv || []).join(', ') || '(none)';
    console.log(`- ${server.name}: tier=${tier} enabled=${enabled} startupMode=${mode} requiredEnv=${req}`);
  }

  if (warnings.length > 0) {
    console.log('\nWarnings:');
    for (const warning of warnings) console.log(`- ${warning}`);
  }

  if (errors.length > 0) {
    console.error('\nValidation errors:');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log('\nMCP governance validation passed.');
}

main();

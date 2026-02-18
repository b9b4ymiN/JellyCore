/**
 * Admin API client for NanoClaw monitoring + Oracle memory management
 */

const API_BASE = '/api';

// Auth token storage
let authToken: string | null = localStorage.getItem('admin_token');

export function setAdminToken(token: string): void {
  authToken = token;
  localStorage.setItem('admin_token', token);
}

export function getAdminToken(): string | null {
  return authToken;
}

export function clearAdminToken(): void {
  authToken = null;
  localStorage.removeItem('admin_token');
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  return headers;
}

async function authFetch(url: string, opts?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...opts,
    headers: { ...authHeaders(), ...(opts?.headers || {}) },
  });
  if (res.status === 401) {
    clearAdminToken();
    throw new Error('Unauthorized — please re-enter your admin token');
  }
  return res;
}

// ============================================================================
// NanoClaw Status
// ============================================================================

export interface NanoClawHealth {
  status: string;
  uptime: number;
  version: string;
  timestamp: string;
  error?: string;
}

export interface NanoClawStatus {
  activeContainers: number;
  queueDepth: number;
  registeredGroups: string[];
  resources: {
    currentMax: number;
    cpuUsage: number;
    memoryFree: number;
  } | null;
  recentErrors: Array<{
    timestamp: string;
    message: string;
    group?: string;
  }>;
  uptime: number;
  version: string;
  timestamp: string;
  status?: string;
  error?: string;
}

export async function getNanoClawHealth(): Promise<NanoClawHealth> {
  const res = await authFetch(`${API_BASE}/nanoclaw/health`);
  return res.json();
}

export async function getNanoClawStatus(): Promise<NanoClawStatus> {
  const res = await authFetch(`${API_BASE}/nanoclaw/status`);
  return res.json();
}

// ============================================================================
// Oracle Memory Management
// ============================================================================

export interface UserModel {
  model: Record<string, any>;
}

export interface Episode {
  id: string;
  summary: string;
  group?: string;
  participants?: string[];
  key_topics?: string[];
  created_at: string;
  expires_at?: string;
}

export interface Procedure {
  id: string;
  name: string;
  description: string;
  steps?: string[];
  confidence: number;
  usage_count: number;
  created_at: string;
}

export async function getUserModel(): Promise<UserModel> {
  const res = await authFetch(`${API_BASE}/user-model`);
  return res.json();
}

export async function updateUserModel(data: Record<string, any>): Promise<any> {
  const res = await authFetch(`${API_BASE}/user-model`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function deleteUserModel(): Promise<any> {
  const res = await authFetch(`${API_BASE}/user-model`, { method: 'DELETE' });
  return res.json();
}

export async function getEpisodes(limit = 20): Promise<{ episodes: Episode[] }> {
  const res = await authFetch(`${API_BASE}/episodic?limit=${limit}`);
  const data = await res.json();
  return { episodes: data.episodes || data.results || [] };
}

export async function getProcedures(limit = 20): Promise<{ procedures: Procedure[] }> {
  const res = await authFetch(`${API_BASE}/procedural?limit=${limit}`);
  const data = await res.json();
  return { procedures: data.procedures || data.results || [] };
}

export async function searchKnowledge(query: string, limit = 20): Promise<any> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await authFetch(`${API_BASE}/search?${params}`);
  return res.json();
}

// ============================================================================
// Oracle Logs
// ============================================================================

export interface LogEntry {
  id: string;
  type: string;
  query?: string;
  created_at: string;
  [key: string]: any;
}

export async function getLogs(limit = 100): Promise<{ logs: LogEntry[] }> {
  const res = await authFetch(`${API_BASE}/logs?limit=${limit}`);
  const data = await res.json();
  return { logs: data.logs || data.results || [] };
}

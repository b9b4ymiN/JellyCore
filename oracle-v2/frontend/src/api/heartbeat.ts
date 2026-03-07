const API = '/api/heartbeat';

function authHeaders(includeJson = true): HeadersInit {
  const headers: Record<string, string> = {};
  if (includeJson) {
    headers['Content-Type'] = 'application/json';
  }
  const token = localStorage.getItem('admin_token');
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function heartbeatFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...authHeaders(!(init?.body === undefined)),
      ...(init?.headers || {}),
    },
  });
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const errMsg = parsed && typeof parsed.error === 'string'
      ? parsed.error
      : `Request failed (${res.status})`;
    throw new Error(errMsg);
  }
  return parsed as T;
}

export interface HeartbeatConfig {
  enabled: boolean;
  intervalMs: number;
  silenceThresholdMs: number;
  mainChatJid: string;
  escalateAfterErrors: number;
  showOk: boolean;
  showAlerts: boolean;
  useIndicator: boolean;
  deliveryMuted: boolean;
  alertRepeatCooldownMs: number;
  heartbeatPrompt: string;
  ackMaxChars: number;
}

export async function getHeartbeatConfig(): Promise<HeartbeatConfig> {
  const res = await heartbeatFetch('/config', { method: 'GET' });
  return readJson(res);
}

export async function patchHeartbeatConfig(
  patch: Partial<HeartbeatConfig>,
): Promise<{ success: boolean; config: HeartbeatConfig }> {
  const res = await heartbeatFetch('/config', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return readJson(res);
}

export async function pingHeartbeat(): Promise<{ success: boolean }> {
  const res = await heartbeatFetch('/ping', { method: 'POST' });
  return readJson(res);
}

const API = '/api/chat';
const DIRECT_NANOCLAW = (
  import.meta.env.VITE_NANOCLAW_DIRECT_URL
  || `http://${window.location.hostname}:47779`
).replace(/\/$/, '');

function authHeaders(requestId?: string): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = localStorage.getItem('admin_token');
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (requestId) {
    headers['x-request-id'] = requestId;
  }
  return headers;
}

function directHeaders(requestId?: string): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (requestId) {
    headers['x-request-id'] = requestId;
  }
  return headers;
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

export interface ChatSendResponse {
  reply: string;
  groupFolder: string;
  latencyMs: number;
  tier: string;
  mode?: string;
}

export interface ChatHistoryItem {
  id: string;
  sender: string;
  senderName: string;
  content: string;
  timestamp: string;
  isFromMe: boolean;
  role: 'user' | 'assistant' | 'system';
}

export interface ChatHistoryResponse {
  groupFolder: string;
  chatJid: string;
  messages: ChatHistoryItem[];
}

export async function sendChatMessage(
  message: string,
  groupFolder?: string,
  requestId?: string,
): Promise<ChatSendResponse> {
  const body = JSON.stringify({
    message,
    group_folder: groupFolder,
  });

  const res = await fetch(`${API}/send`, {
    method: 'POST',
    headers: authHeaders(requestId),
    body,
  });
  const payload = await readJson(res);
  const fallbackAllowed = (
    res.status === 502
    || res.status === 503
    || (typeof payload.error === 'string'
      && payload.error.toLowerCase().includes('upstream unavailable'))
  );
  if (fallbackAllowed) {
    const detail = `${payload?.detail || payload?.error || ''}`.toLowerCase();
    const timeoutLike = detail.includes('timed out') || detail.includes('timeout');
    if (timeoutLike) {
      return {
        reply: 'Processing continues in background. Keep this page open and wait for history sync.',
        groupFolder: groupFolder || 'main',
        latencyMs: 0,
        tier: 'proxy-timeout',
        mode: 'background',
      };
    }

    const direct = await fetch(`${DIRECT_NANOCLAW}/chat/send`, {
      method: 'POST',
      headers: directHeaders(requestId),
      body,
    });
    const directPayload = await readJson(direct);
    if (!direct.ok) {
      const errorMessage = typeof directPayload.error === 'string'
        ? directPayload.error
        : `Chat request failed (${direct.status})`;
      throw new Error(errorMessage);
    }
    return directPayload as ChatSendResponse;
  }
  if (!res.ok) {
    const errorMessage = typeof payload.error === 'string'
      ? payload.error
      : `Chat request failed (${res.status})`;
    throw new Error(errorMessage);
  }
  return payload as ChatSendResponse;
}

export async function getChatHistory(
  groupFolder?: string,
  limit = 120,
): Promise<ChatHistoryResponse> {
  const params = new URLSearchParams();
  if (groupFolder) params.set('group_folder', groupFolder);
  params.set('limit', String(limit));
  const query = params.toString();
  const path = `/chat/history${query ? `?${query}` : ''}`;
  const res = await fetch(`${API}/history${query ? `?${query}` : ''}`, {
    method: 'GET',
    headers: authHeaders(),
  });
  const payload = await readJson(res);
  const fallbackAllowed = (
    res.status === 502
    || res.status === 503
    || (typeof payload.error === 'string'
      && payload.error.toLowerCase().includes('upstream unavailable'))
  );
  if (fallbackAllowed) {
    const direct = await fetch(`${DIRECT_NANOCLAW}${path}`, {
      method: 'GET',
      headers: directHeaders(),
    });
    const directPayload = await readJson(direct);
    if (!direct.ok) {
      const errorMessage = typeof directPayload.error === 'string'
        ? directPayload.error
        : `Chat history failed (${direct.status})`;
      throw new Error(errorMessage);
    }
    return directPayload as ChatHistoryResponse;
  }
  if (!res.ok) {
    const errorMessage = typeof payload.error === 'string'
      ? payload.error
      : `Chat history failed (${res.status})`;
    throw new Error(errorMessage);
  }
  return payload as ChatHistoryResponse;
}

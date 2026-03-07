const API = '/api/scheduler';

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

async function schedulerFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...authHeaders(!(init?.body === undefined)),
      ...(init?.headers || {}),
    },
  });
  return res;
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const errMsg = (parsed && typeof parsed.error === 'string')
      ? parsed.error
      : `Request failed (${res.status})`;
    throw new Error(errMsg);
  }
  return parsed as T;
}

export interface SchedulerTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  context_mode: 'group' | 'isolated';
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  created_at: string;
  label?: string | null;
}

export interface TaskRunLog {
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: 'success' | 'error';
  result: string | null;
  error: string | null;
}

export interface SchedulerStats {
  total: number;
  byStatus: {
    active: number;
    paused: number;
    completed: number;
    cancelled: number;
  };
  dueSoon: number;
  overdue: number;
  withRetries: number;
  timestamp: string;
}

export async function listTasks(params?: {
  status?: string;
  group?: string;
}): Promise<{ tasks: SchedulerTask[]; count: number }> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.group) query.set('group', params.group);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  const res = await schedulerFetch(`/tasks${suffix}`, { method: 'GET' });
  return readJson(res);
}

export async function getTask(id: string): Promise<{
  task: SchedulerTask;
  recentRuns: TaskRunLog[];
}> {
  const res = await schedulerFetch(`/tasks/${encodeURIComponent(id)}`, { method: 'GET' });
  return readJson(res);
}

export async function createTask(data: {
  name: string;
  group_folder: string;
  prompt: string;
  category?: 'learning' | 'monitor' | 'health' | 'custom';
  interval_ms: number;
  status?: 'active' | 'paused';
}): Promise<{ task: SchedulerTask }> {
  const res = await schedulerFetch('/tasks', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return readJson(res);
}

export async function updateTask(id: string, data: {
  name?: string;
  prompt?: string;
  interval_ms?: number;
  status?: 'active' | 'paused' | 'cancelled';
}): Promise<{ task?: SchedulerTask; success?: boolean; status?: string }> {
  const res = await schedulerFetch(`/tasks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  return readJson(res);
}

export async function pauseTask(id: string): Promise<void> {
  const res = await schedulerFetch(`/tasks/${encodeURIComponent(id)}/pause`, {
    method: 'POST',
  });
  await readJson(res);
}

export async function resumeTask(id: string): Promise<void> {
  const res = await schedulerFetch(`/tasks/${encodeURIComponent(id)}/resume`, {
    method: 'POST',
  });
  await readJson(res);
}

export async function cancelTask(id: string): Promise<void> {
  const res = await schedulerFetch(`/tasks/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
  });
  await readJson(res);
}

export async function runTaskNow(id: string): Promise<void> {
  const res = await schedulerFetch(`/tasks/${encodeURIComponent(id)}/run`, {
    method: 'POST',
  });
  await readJson(res);
}

export async function getSchedulerStats(): Promise<SchedulerStats> {
  const res = await schedulerFetch('/stats', { method: 'GET' });
  return readJson(res);
}

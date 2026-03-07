import { useEffect, useRef } from 'react';

export interface LiveEventPayloadMap {
  'container:start': {
    containerId: string;
    group: string;
    provider: string;
    prompt: string;
    startedAt: string;
    requestId?: string;
  };
  'container:output': {
    containerId: string;
    chunk: string;
    timestamp: string;
    requestId?: string;
  };
  'container:end': {
    containerId: string;
    exitCode: number;
    durationMs: number;
    resultSummary: string;
    requestId?: string;
  };
  'task:enqueue': {
    taskId: string;
    label: string;
    group: string;
    enqueuedAt: string;
  };
  'task:start': {
    taskId: string;
    label: string;
    group: string;
    startedAt: string;
  };
  'task:complete': {
    taskId: string;
    label: string;
    group: string;
    status: 'success' | 'error';
    durationMs: number;
    summary: string;
    completedAt: string;
  };
  'heartbeat:tick': {
    reason: 'scheduled' | 'silence' | 'escalated' | 'manual';
    ok: boolean;
    summary: string;
    timestamp: string;
  };
  'heartbeat:job:start': {
    jobId: string;
    label: string;
    category: string;
    startedAt: string;
  };
  'heartbeat:job:end': {
    jobId: string;
    label: string;
    category: string;
    status: 'ok' | 'error';
    durationMs: number;
    summary: string;
    completedAt: string;
  };
  'health:change': {
    status: 'ok' | 'warn' | 'error';
    activeContainers: number;
    queueDepth: number;
    timestamp: string;
  };
}

export type LiveEventType = keyof LiveEventPayloadMap;
export type LiveEvent = {
  [K in LiveEventType]: { type: K; data: LiveEventPayloadMap[K] }
}[LiveEventType];

export type LiveConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

const EVENT_TYPES: LiveEventType[] = [
  'container:start',
  'container:output',
  'container:end',
  'task:enqueue',
  'task:start',
  'task:complete',
  'heartbeat:tick',
  'heartbeat:job:start',
  'heartbeat:job:end',
  'health:change',
];

const LIVE_RETRY_MS = 3000;

export function useLiveEvents(
  onEvent: (event: LiveEvent) => void,
  options?: {
    enabled?: boolean;
    onStatusChange?: (status: LiveConnectionStatus) => void;
  },
): void {
  const onEventRef = useRef(onEvent);
  const onStatusRef = useRef(options?.onStatusChange);
  const enabled = options?.enabled ?? true;

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    onStatusRef.current = options?.onStatusChange;
  }, [options?.onStatusChange]);

  useEffect(() => {
    if (!enabled) {
      onStatusRef.current?.('disconnected');
      return;
    }

    let closed = false;
    let es: EventSource | null = null;
    let listeners: Array<{ type: LiveEventType; listener: EventListener }> = [];
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const clearRetry = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const closeStream = () => {
      if (!es) return;
      for (const { type, listener } of listeners) {
        es.removeEventListener(type, listener);
      }
      listeners = [];
      es.close();
      es = null;
    };

    const scheduleRetry = () => {
      if (closed) return;
      clearRetry();
      onStatusRef.current?.('reconnecting');
      retryTimer = setTimeout(() => {
        void setup();
      }, LIVE_RETRY_MS);
    };

    const setup = async () => {
      if (closed) return;
      closeStream();

      const token = localStorage.getItem('admin_token') || '';
      if (!token) {
        onStatusRef.current?.('disconnected');
        return;
      }

      // Validate token first to avoid endless reconnect loop on 401.
      try {
        const healthRes = await fetch('/api/nanoclaw/health', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!healthRes.ok) {
          if (healthRes.status === 401 || healthRes.status === 403) {
            onStatusRef.current?.('disconnected');
            return;
          }
          scheduleRetry();
          return;
        }
      } catch {
        scheduleRetry();
        return;
      }

      if (closed) return;

      const query = `?token=${encodeURIComponent(token)}`;
      es = new EventSource(`/api/live/events${query}`);
      listeners = EVENT_TYPES.map((type) => {
        const listener = (evt: Event) => {
          const msg = evt as MessageEvent;
          try {
            const data = JSON.parse(msg.data) as LiveEventPayloadMap[typeof type];
            onEventRef.current({
              type,
              data,
            } as LiveEvent);
          } catch {
            // Ignore malformed event payloads.
          }
        };
        es!.addEventListener(type, listener);
        return { type, listener };
      });

      es.onopen = () => {
        clearRetry();
        onStatusRef.current?.('connected');
      };

      es.onerror = () => {
        closeStream();
        scheduleRetry();
      };
    };

    void setup();

    return () => {
      closed = true;
      clearRetry();
      closeStream();
      onStatusRef.current?.('disconnected');
    };
  }, [enabled]);
}

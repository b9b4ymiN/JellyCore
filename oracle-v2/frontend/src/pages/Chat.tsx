import { useEffect, useMemo, useRef, useState } from 'react';
import { getChatHistory, sendChatMessage, type ChatHistoryItem } from '../api/chat';
import {
  useLiveEvents,
  type LiveConnectionStatus,
  type LiveEvent,
} from '../hooks/useLiveEvents';
import styles from './Chat.module.css';

type Role = 'user' | 'assistant' | 'system';
type TraceKind = 'info' | 'output' | 'error';

interface ChatLine {
  id: string;
  role: Role;
  text: string;
  timestamp: number;
  meta?: string;
}

interface TraceLine {
  id: string;
  text: string;
  timestamp: number;
  kind: TraceKind;
}

function makeId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeRequestId(): string {
  return `webchat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const MAX_TRACE_LINES = 80;
const INTRO_ID = '__system_intro__';
const HISTORY_POLL_MS = 2500;
const RESPONSE_WAIT_TIMEOUT_MS = 45000;

function introLine(): ChatLine {
  return {
    id: INTRO_ID,
    role: 'system',
    text: 'Jellycode two-way chat is linked with Telegram. Messages from either side should appear here.',
    timestamp: 0,
  };
}

function mapHistoryToLine(item: ChatHistoryItem): ChatLine {
  const timestamp = Date.parse(item.timestamp);
  return {
    id: item.id,
    role: item.role,
    text: item.content,
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    meta: item.role === 'user' ? item.senderName : undefined,
  };
}

export function Chat() {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [groupFolder, setGroupFolder] = useState('main');
  const [liveStatus, setLiveStatus] = useState<LiveConnectionStatus>('disconnected');
  const [traceLines, setTraceLines] = useState<TraceLine[]>([]);
  const [lines, setLines] = useState<ChatLine[]>([introLine()]);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const activeContainerIdRef = useRef<string | null>(null);
  const progressTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const lastOutputSignatureRef = useRef<string>('');

  const disabled = sending || input.trim().length === 0;
  const placeholder = useMemo(() => `Message ${groupFolder}...`, [groupFolder]);

  function appendTrace(text: string, kind: TraceKind = 'info'): void {
    setTraceLines((prev) => [
      ...prev,
      { id: makeId(), text, kind, timestamp: Date.now() },
    ].slice(-MAX_TRACE_LINES));
  }

  function clearProgressTimers(): void {
    for (const timer of progressTimersRef.current) {
      clearTimeout(timer);
    }
    progressTimersRef.current = [];
  }

  function settleActiveRequest(requestId: string): void {
    if (activeRequestIdRef.current !== requestId) return;
    clearProgressTimers();
    activeRequestIdRef.current = null;
    activeContainerIdRef.current = null;
    setSending(false);
  }

  function scheduleProgressHints(requestId: string): void {
    const hints: Array<{ delay: number; text: string }> = [
      { delay: 1200, text: 'Routing query and selecting execution tier...' },
      { delay: 4200, text: 'Preparing context and runtime workspace...' },
      { delay: 9000, text: 'Waiting for model output stream...' },
      { delay: 16000, text: 'Long-running task detected. Continuing to stream progress...' },
    ];
    for (const hint of hints) {
      const timer = setTimeout(() => {
        if (activeRequestIdRef.current === requestId) {
          appendTrace(hint.text);
        }
      }, hint.delay);
      progressTimersRef.current.push(timer);
    }
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.round(ms / 100) / 10;
    return `${seconds}s`;
  }

  function mergeHistory(items: ChatHistoryItem[], replace = false): void {
    setLines((prev) => {
      const base = replace ? [introLine()] : [...prev];
      const known = new Set(base.map((line) => line.id));
      for (const item of items) {
        const line = mapHistoryToLine(item);
        if (known.has(line.id)) continue;
        known.add(line.id);
        base.push(line);
      }
      const intro = base.find((line) => line.id === INTRO_ID) || introLine();
      const content = base
        .filter((line) => line.id !== INTRO_ID)
        .sort((a, b) => a.timestamp - b.timestamp);
      return [intro, ...content];
    });
  }

  async function refreshHistory(replace = false): Promise<void> {
    try {
      const history = await getChatHistory(groupFolder, 160);
      mergeHistory(history.messages, replace);
      const activeRequestId = activeRequestIdRef.current;
      if (activeRequestId) {
        const replyId = `${activeRequestId}:assistant`;
        const hasReply = history.messages.some((item) => item.id === replyId);
        if (hasReply) {
          appendTrace('Reply synced from history.');
          settleActiveRequest(activeRequestId);
        }
      }
    } catch {
      // keep chat usable even if history fetch is unavailable
    }
  }

  const onLiveEvent = (event: LiveEvent): void => {
    const activeRequestId = activeRequestIdRef.current;
    if (!activeRequestId) return;

    if (event.type === 'container:start') {
      if (event.data.requestId !== activeRequestId) return;
      activeContainerIdRef.current = event.data.containerId;
      appendTrace(`Container started (${event.data.provider}) for ${event.data.group}`);
      return;
    }

    if (event.type === 'container:output') {
      const fromRequest = event.data.requestId === activeRequestId;
      const fromContainer = Boolean(
        activeContainerIdRef.current
          && event.data.containerId === activeContainerIdRef.current,
      );
      if (!fromRequest && !fromContainer) return;

      const linesFromChunk = event.data.chunk
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 4);
      if (linesFromChunk.length === 0) return;

      for (const chunkLine of linesFromChunk) {
        const compact = chunkLine.length > 220
          ? `${chunkLine.slice(0, 220)}...`
          : chunkLine;
        const signature = `${event.data.containerId}:${compact}`;
        if (signature === lastOutputSignatureRef.current) continue;
        lastOutputSignatureRef.current = signature;
        appendTrace(compact, 'output');
      }
      return;
    }

    if (event.type === 'container:end') {
      const fromRequest = event.data.requestId === activeRequestId;
      const fromContainer = Boolean(
        activeContainerIdRef.current
          && event.data.containerId === activeContainerIdRef.current,
      );
      if (!fromRequest && !fromContainer) return;

      const status = event.data.exitCode === 0 ? 'success' : `exit ${event.data.exitCode}`;
      appendTrace(
        `Container finished (${status}) in ${formatDuration(event.data.durationMs)}`,
        event.data.exitCode === 0 ? 'info' : 'error',
      );
      void refreshHistory(false);
    }
  };

  useLiveEvents(onLiveEvent, {
    enabled: true,
    onStatusChange: setLiveStatus,
  });

  useEffect(() => {
    let active = true;
    void refreshHistory(true);
    const timer = setInterval(() => {
      if (!active) return;
      void refreshHistory(false);
    }, HISTORY_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
      clearProgressTimers();
    };
  }, [groupFolder]);

  useEffect(() => {
    if (!viewportRef.current) return;
    viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
  }, [lines, sending, traceLines.length]);

  async function send(): Promise<void> {
    const text = input.trim();
    if (!text || sending) return;
    const requestId = makeRequestId();

    const userLine: ChatLine = {
      id: `${requestId}:web`,
      role: 'user',
      text,
      timestamp: Date.now(),
      meta: 'Web',
    };
    setLines((prev) => [...prev, userLine]);
    setInput('');
    setTraceLines([]);
    appendTrace(`Request queued (${requestId})`);
    if (liveStatus !== 'connected') {
      appendTrace('Live trace channel is not connected. Falling back to timed status hints.', 'error');
    }
    activeRequestIdRef.current = requestId;
    activeContainerIdRef.current = null;
    lastOutputSignatureRef.current = '';
    scheduleProgressHints(requestId);
    const waitGuard = setTimeout(() => {
      if (activeRequestIdRef.current !== requestId) return;
      appendTrace(
        'Response channel is delayed. Continuing in background; final reply will sync automatically.',
        'error',
      );
      void refreshHistory(false);
      settleActiveRequest(requestId);
    }, RESPONSE_WAIT_TIMEOUT_MS);
    progressTimersRef.current.push(waitGuard);
    setSending(true);

    try {
      const res = await sendChatMessage(text, groupFolder, requestId);
      const assistantLine: ChatLine = {
        id: `${requestId}:assistant`,
        role: 'assistant',
        text: res.reply || '(empty response)',
        timestamp: Date.now(),
        meta: `${res.tier}${res.mode ? ` | ${res.mode}` : ''} | ${res.latencyMs}ms | ${res.groupFolder}`,
      };
      setLines((prev) => {
        if (prev.some((line) => line.id === assistantLine.id)) return prev;
        return [...prev, assistantLine];
      });
      if (activeRequestIdRef.current === requestId) {
        appendTrace(
          `Reply received (${res.tier}${res.mode ? `/${res.mode}` : ''}) in ${formatDuration(res.latencyMs)}`,
        );
      }
      void refreshHistory(false);
    } catch (err: any) {
      if (activeRequestIdRef.current !== requestId) {
        return;
      }
      setLines((prev) => [
        ...prev,
        {
          id: makeId(),
          role: 'system',
          text: `Error: ${err?.message || 'chat failed'}`,
          timestamp: Date.now(),
        },
      ]);
      appendTrace(`Request failed: ${err?.message || 'chat failed'}`, 'error');
    } finally {
      settleActiveRequest(requestId);
    }
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <h1>/chat</h1>
          <p className={styles.subtle}>
            Jellycode runtime chat with live execution trace
          </p>
        </div>
        <div className={styles.headerRight}>
          <label>
            Group
            <input
              value={groupFolder}
              onChange={(e) => setGroupFolder(e.target.value.trim() || 'main')}
              disabled={sending}
            />
          </label>
          <span className={`${styles.liveBadge} ${styles[liveStatus]}`}>
            live: {liveStatus}
          </span>
        </div>
      </header>

      <main className={styles.terminal} ref={viewportRef}>
        {lines.map((line) => (
          <article key={line.id} className={`${styles.line} ${styles[line.role]}`}>
            <div className={styles.prompt}>
              {line.role === 'user' ? 'you' : line.role === 'assistant' ? 'ai' : 'sys'}
              <span>{'>'}</span>
            </div>
            <div className={styles.payload}>
              <pre>{line.text}</pre>
              {line.meta && <small>{line.meta}</small>}
            </div>
          </article>
        ))}
        {sending && (
          <article className={`${styles.line} ${styles.system}`}>
            <div className={styles.prompt}>sys<span>{'>'}</span></div>
            <div className={styles.payload}>
              <pre>processing...</pre>
            </div>
          </article>
        )}
      </main>

      <section className={styles.tracePanel}>
        <div className={styles.traceHeader}>
          <h2>Processing Trace</h2>
          <small>{sending ? 'live' : 'last run'}</small>
        </div>
        {traceLines.length === 0 ? (
          <p className={styles.traceEmpty}>No trace yet. Send a message to start tracing.</p>
        ) : (
          <div className={styles.traceBody}>
            {traceLines.map((trace) => (
              <p key={trace.id} className={`${styles.traceLine} ${styles[trace.kind]}`}>
                <span>{new Date(trace.timestamp).toLocaleTimeString()}</span>
                <code>{trace.text}</code>
              </p>
            ))}
          </div>
        )}
      </section>

      <footer className={styles.composer}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          rows={3}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="button" onClick={() => void send()} disabled={disabled}>
          {sending ? 'Sending...' : 'Send'}
        </button>
      </footer>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getChatHistory, sendChatMessage, type ChatHistoryItem } from '../api/chat';
import { useLiveEvents, type LiveConnectionStatus, type LiveEvent } from '../hooks/useLiveEvents';
import { useToast } from '../hooks/useToast';
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

interface GroupItem {
  name: string;
  lastActive: number;
  unread: number;
}

const INTRO_ID = '__system_intro__';
const HISTORY_POLL_MS = 2500;
const RESPONSE_WAIT_TIMEOUT_MS = 45000;
const MAX_TRACE_LINES = 120;
const GROUPS_KEY = 'chat_known_groups_v2';
const PINS_KEY = 'chat_pins_v2';
const TRACE_PANEL_KEY = 'chat_trace_open_v2';
const ENTER_SEND_KEY = 'chat_enter_to_send_v2';

function makeId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeRequestId(): string {
  return `webchat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function introLine(): ChatLine {
  return {
    id: INTRO_ID,
    role: 'system',
    text: 'Jellycode chat syncs with Telegram and Oracle runtime. Replies and traces stream in near real time.',
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

function formatRelativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes <= 0) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatAbsoluteTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

function loadKnownGroups(): GroupItem[] {
  try {
    const raw = localStorage.getItem(GROUPS_KEY);
    if (!raw) return [{ name: 'main', lastActive: Date.now(), unread: 0 }];
    const parsed = JSON.parse(raw) as GroupItem[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [{ name: 'main', lastActive: Date.now(), unread: 0 }];
    }
    return parsed;
  } catch {
    return [{ name: 'main', lastActive: Date.now(), unread: 0 }];
  }
}

function loadPinnedIds(): string[] {
  try {
    const raw = localStorage.getItem(PINS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readTracePanelOpen(): boolean {
  return localStorage.getItem(TRACE_PANEL_KEY) !== 'false';
}

function readEnterToSend(): boolean {
  return localStorage.getItem(ENTER_SEND_KEY) !== 'false';
}

function parseDocPath(text: string): string | null {
  const direct = text.match(/\/doc\/[A-Za-z0-9%_.-]+/);
  if (direct?.[0]) return direct[0];
  const id = text.match(/doc(?:ument)?\s*id[:\s]+([A-Za-z0-9_.-]+)/i);
  if (!id?.[1]) return null;
  return `/doc/${encodeURIComponent(id[1])}`;
}

function TypingIndicator({ stage }: { stage: string }) {
  return (
    <div className={styles.typingWrap}>
      <div className={styles.typingDots} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <span className={styles.typingStage}>{stage}</span>
    </div>
  );
}

export function Chat() {
  const toast = useToast();

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [groupFolder, setGroupFolder] = useState('main');
  const [liveStatus, setLiveStatus] = useState<LiveConnectionStatus>('disconnected');
  const [traceLines, setTraceLines] = useState<TraceLine[]>([]);
  const [lines, setLines] = useState<ChatLine[]>([introLine()]);
  const [knownGroups, setKnownGroups] = useState<GroupItem[]>(() => loadKnownGroups());
  const [groupInput, setGroupInput] = useState('main');
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => loadPinnedIds());
  const [traceOpen, setTraceOpen] = useState(() => readTracePanelOpen());
  const [enterToSend, setEnterToSend] = useState(() => readEnterToSend());
  const [streamingReply, setStreamingReply] = useState('');
  const [processingStage, setProcessingStage] = useState('Thinking...');
  const [stickToBottom, setStickToBottom] = useState(true);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const groupInputRef = useRef<HTMLInputElement | null>(null);

  const activeRequestIdRef = useRef<string | null>(null);
  const activeContainerIdRef = useRef<string | null>(null);
  const progressTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const lastOutputSignatureRef = useRef('');

  const disabled = sending || input.trim().length === 0;

  const pinnedMessages = useMemo(
    () => lines.filter((line) => pinnedIds.includes(line.id) && line.id !== INTRO_ID),
    [lines, pinnedIds],
  );

  const sortedGroups = useMemo(
    () => [...knownGroups].sort((a, b) => b.lastActive - a.lastActive),
    [knownGroups],
  );

  useEffect(() => {
    localStorage.setItem(PINS_KEY, JSON.stringify(pinnedIds));
  }, [pinnedIds]);

  useEffect(() => {
    localStorage.setItem(TRACE_PANEL_KEY, String(traceOpen));
  }, [traceOpen]);

  useEffect(() => {
    localStorage.setItem(ENTER_SEND_KEY, String(enterToSend));
  }, [enterToSend]);

  useEffect(() => {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(knownGroups));
  }, [knownGroups]);

  useEffect(() => {
    const draft = sessionStorage.getItem(`chat_draft:${groupFolder}`) || '';
    setInput(draft);
    setGroupInput(groupFolder);
  }, [groupFolder]);

  useEffect(() => {
    sessionStorage.setItem(`chat_draft:${groupFolder}`, input);
  }, [groupFolder, input]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        groupInputRef.current?.focus();
        groupInputRef.current?.select();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const copyText = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Copy failed');
    }
  }, [toast]);

  const markdownComponents = useMemo(() => ({
    code(props: any) {
      const text = String(props.children ?? '').replace(/\n$/, '');
      if (!props.className) {
        return <code className={styles.inlineCode}>{text}</code>;
      }
      return (
        <div className={styles.codeBlock}>
          <button type="button" className={styles.codeCopy} onClick={() => void copyText(text)}>
            Copy
          </button>
          <pre><code className={props.className}>{text}</code></pre>
        </div>
      );
    },
  }), [copyText]);

  function updateKnownGroup(name: string, update: Partial<GroupItem> = {}) {
    setKnownGroups((prev) => {
      const idx = prev.findIndex((g) => g.name === name);
      if (idx === -1) {
        return [{ name, lastActive: Date.now(), unread: 0, ...update }, ...prev];
      }
      const next = [...prev];
      next[idx] = { ...next[idx], ...update };
      return next;
    });
  }

  function clearProgressTimers(): void {
    for (const timer of progressTimersRef.current) {
      clearTimeout(timer);
    }
    progressTimersRef.current = [];
  }

  function appendTrace(text: string, kind: TraceKind = 'info'): void {
    setTraceLines((prev) => [...prev, { id: makeId(), text, kind, timestamp: Date.now() }].slice(-MAX_TRACE_LINES));
  }

  function settleActiveRequest(requestId: string): void {
    if (activeRequestIdRef.current !== requestId) return;
    clearProgressTimers();
    activeRequestIdRef.current = null;
    activeContainerIdRef.current = null;
    setStreamingReply('');
    setSending(false);
    setProcessingStage('Thinking...');
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
      const history = await getChatHistory(groupFolder, 180);
      mergeHistory(history.messages, replace);
      updateKnownGroup(groupFolder, { lastActive: Date.now(), unread: 0 });

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
      // keep page responsive even if history endpoint fails
    }
  }

  function scheduleProgressHints(requestId: string): void {
    const hints = [
      { delay: 800, stage: 'Thinking...', trace: 'Routing request and selecting lane.' },
      { delay: 3000, stage: 'Processing...', trace: 'Preparing runtime context.' },
      { delay: 7000, stage: 'Writing response...', trace: 'Waiting for model stream.' },
      { delay: 15000, stage: 'Still running...', trace: 'Long-running task; will sync automatically when done.' },
    ];

    for (const hint of hints) {
      const timer = setTimeout(() => {
        if (activeRequestIdRef.current !== requestId) return;
        setProcessingStage(hint.stage);
        appendTrace(hint.trace);
      }, hint.delay);
      progressTimersRef.current.push(timer);
    }
  }

  const onLiveEvent = useCallback((event: LiveEvent): void => {
    const activeRequestId = activeRequestIdRef.current;
    if (!activeRequestId) return;

    if (event.type === 'container:start') {
      if (event.data.requestId !== activeRequestId) return;
      activeContainerIdRef.current = event.data.containerId;
      setProcessingStage('Processing...');
      appendTrace(`Container started (${event.data.provider}).`);
      return;
    }

    if (event.type === 'container:output') {
      const fromRequest = event.data.requestId === activeRequestId;
      const fromContainer = Boolean(
        activeContainerIdRef.current
          && event.data.containerId === activeContainerIdRef.current,
      );
      if (!fromRequest && !fromContainer) return;

      const trimmed = event.data.chunk.trim();
      if (!trimmed) return;
      const signature = `${event.data.containerId}:${trimmed.slice(0, 120)}`;
      if (signature === lastOutputSignatureRef.current) return;
      lastOutputSignatureRef.current = signature;

      setStreamingReply((prev) => `${prev}${prev ? '\n' : ''}${trimmed}`.slice(-8000));
      appendTrace(trimmed, 'output');
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
      appendTrace(`Container finished (${status}) in ${Math.round(event.data.durationMs)}ms.`, event.data.exitCode === 0 ? 'info' : 'error');
      setProcessingStage('Writing response...');
      void refreshHistory(false);
    }
  }, [groupFolder]);

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
    if (!viewportRef.current || !stickToBottom) return;
    viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
  }, [lines, sending, streamingReply, stickToBottom]);

  async function sendMessage(raw?: string): Promise<void> {
    const text = (raw ?? input).trim();
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
    sessionStorage.removeItem(`chat_draft:${groupFolder}`);
    setTraceLines([]);
    setStreamingReply('');
    setProcessingStage('Thinking...');

    updateKnownGroup(groupFolder, { lastActive: Date.now(), unread: 0 });

    appendTrace(`Request queued (${requestId}).`);
    if (liveStatus !== 'connected') {
      appendTrace('Live trace channel is disconnected. Falling back to timed hints.', 'error');
    }

    activeRequestIdRef.current = requestId;
    activeContainerIdRef.current = null;
    lastOutputSignatureRef.current = '';
    scheduleProgressHints(requestId);
    setSending(true);

    const waitGuard = setTimeout(() => {
      if (activeRequestIdRef.current !== requestId) return;
      appendTrace('Response channel delayed. Final reply will sync from history.', 'error');
      void refreshHistory(false);
      settleActiveRequest(requestId);
    }, RESPONSE_WAIT_TIMEOUT_MS);
    progressTimersRef.current.push(waitGuard);

    try {
      const res = await sendChatMessage(text, groupFolder, requestId);
      const assistantLine: ChatLine = {
        id: `${requestId}:assistant`,
        role: 'assistant',
        text: res.reply || '(empty response)',
        timestamp: Date.now(),
        meta: `${res.tier}${res.mode ? ` | ${res.mode}` : ''} | ${res.latencyMs}ms`,
      };

      setLines((prev) => {
        if (prev.some((line) => line.id === assistantLine.id)) return prev;
        return [...prev, assistantLine];
      });

      appendTrace(`Reply received in ${res.latencyMs}ms.`);
      void refreshHistory(false);
    } catch (err: any) {
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

  function togglePin(id: string) {
    setPinnedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <h1>Runtime Chat</h1>
          <p className={styles.subtle}>Real-time conversation with live execution traces.</p>
        </div>
        <span className={`${styles.liveBadge} ${styles[liveStatus]}`}>live: {liveStatus}</span>
      </header>

      <section className={styles.groupSection}>
        <div className={styles.groupInputRow}>
          <input
            ref={groupInputRef}
            value={groupInput}
            onChange={(e) => setGroupInput(e.target.value)}
            placeholder="Group folder"
            className={styles.groupInput}
          />
          <button
            type="button"
            className={styles.groupApply}
            onClick={() => {
              const next = groupInput.trim() || 'main';
              setGroupFolder(next);
              updateKnownGroup(next, { lastActive: Date.now(), unread: 0 });
            }}
          >
            Switch
          </button>
        </div>
        <div className={styles.groupCards}>
          {sortedGroups.map((group) => (
            <button
              key={group.name}
              type="button"
              className={`${styles.groupCard} ${groupFolder === group.name ? styles.groupCardActive : ''}`}
              onClick={() => {
                setGroupFolder(group.name);
                setGroupInput(group.name);
                updateKnownGroup(group.name, { unread: 0, lastActive: Date.now() });
              }}
            >
              <strong>{group.name}</strong>
              <small>{formatRelativeTime(group.lastActive)}</small>
              {group.unread > 0 ? <span className={styles.unreadDot}>{group.unread}</span> : null}
            </button>
          ))}
        </div>
      </section>

      {pinnedMessages.length > 0 && (
        <section className={styles.pinnedRow}>
          {pinnedMessages.map((line) => (
            <button key={line.id} type="button" className={styles.pinChip} onClick={() => void copyText(line.text)}>
              Pinned: {line.text.slice(0, 64)}
            </button>
          ))}
        </section>
      )}

      <main
        className={styles.chatViewport}
        ref={viewportRef}
        onScroll={() => {
          const node = viewportRef.current;
          if (!node) return;
          const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 120;
          setStickToBottom(nearBottom);
        }}
      >
        {lines.map((line) => {
          const docPath = parseDocPath(line.text);
          const isPinned = pinnedIds.includes(line.id);
          return (
            <article
              key={line.id}
              className={`${styles.message} ${styles[line.role]} ${line.role === 'system' ? styles.systemCenter : ''}`}
            >
              {line.role !== 'system' && (
                <div className={styles.avatar}>{line.role === 'user' ? 'U' : 'AI'}</div>
              )}

              <div className={styles.messageBody}>
                <div className={styles.bubble}>
                  {line.role === 'assistant' ? (
                    <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{line.text}</Markdown>
                  ) : (
                    <p>{line.text}</p>
                  )}
                </div>

                <div className={styles.messageMeta}>
                  <time title={formatAbsoluteTime(line.timestamp)}>{line.timestamp ? formatRelativeTime(line.timestamp) : 'system'}</time>
                  {line.meta ? <span>{line.meta}</span> : null}
                </div>

                {line.id !== INTRO_ID && (
                  <div className={styles.messageActions}>
                    <button type="button" onClick={() => void copyText(line.text)}>Copy</button>
                    {line.role === 'user' && (
                      <button type="button" onClick={() => void sendMessage(line.text)} disabled={sending}>Retry</button>
                    )}
                    <button type="button" onClick={() => togglePin(line.id)}>{isPinned ? 'Unpin' : 'Pin'}</button>
                    {docPath && (
                      <a href={docPath}>View in Oracle</a>
                    )}
                  </div>
                )}
              </div>
            </article>
          );
        })}

        {sending && (
          <article className={`${styles.message} ${styles.assistant}`}>
            <div className={styles.avatar}>AI</div>
            <div className={styles.messageBody}>
              <div className={styles.bubble}>
                {streamingReply ? (
                  <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{streamingReply}</Markdown>
                ) : (
                  <TypingIndicator stage={processingStage} />
                )}
              </div>
            </div>
          </article>
        )}
      </main>

      {!stickToBottom && (
        <button
          type="button"
          className={styles.scrollLatest}
          onClick={() => {
            const node = viewportRef.current;
            if (!node) return;
            node.scrollTop = node.scrollHeight;
            setStickToBottom(true);
          }}
        >
          Scroll to latest
        </button>
      )}

      <section className={`${styles.tracePanel} ${traceOpen ? styles.traceOpen : ''}`}>
        <button type="button" className={styles.traceToggle} onClick={() => setTraceOpen((prev) => !prev)}>
          {traceOpen ? 'Hide Trace' : 'Show Trace'}
        </button>
        {traceOpen && (
          <div className={styles.traceBody}>
            {traceLines.length === 0 ? (
              <p className={styles.traceEmpty}>No trace yet. Send a message to start tracing.</p>
            ) : (
              traceLines.map((trace) => (
                <p key={trace.id} className={`${styles.traceLine} ${styles[trace.kind]}`}>
                  <span>{new Date(trace.timestamp).toLocaleTimeString()}</span>
                  <code>{trace.text}</code>
                </p>
              ))
            )}
          </div>
        )}
      </section>

      <footer className={styles.composer}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Message ${groupFolder}...`}
          rows={3}
          onKeyDown={(e) => {
            if (!enterToSend) {
              if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                void sendMessage();
              }
              return;
            }

            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void sendMessage();
            }
          }}
        />

        <div className={styles.composerActions}>
          <label className={styles.toggleRow}>
            <input
              type="checkbox"
              checked={enterToSend}
              onChange={(e) => setEnterToSend(e.target.checked)}
            />
            Enter to send
          </label>
          <button type="button" onClick={() => void sendMessage()} disabled={disabled}>
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </footer>
    </div>
  );
}

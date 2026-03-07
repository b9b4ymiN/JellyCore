import { useEffect, useMemo, useState } from 'react';
import { ActiveTaskCard, type ActiveTaskView } from '../components/ActiveTaskCard';
import { CompletedList, type CompletedTaskView } from '../components/CompletedList';
import { LiveStatusBadge } from '../components/LiveStatusBadge';
import { QueueList, type QueuedTaskView } from '../components/QueueList';
import {
  useLiveEvents,
  type LiveConnectionStatus,
  type LiveEvent,
} from '../hooks/useLiveEvents';
import styles from './LiveOps.module.css';

type ActiveTaskMap = Record<string, ActiveTaskView>;

function nowIso(): string {
  return new Date().toISOString();
}

export function LiveOps() {
  const [activeTaskMap, setActiveTaskMap] = useState<ActiveTaskMap>({});
  const [queue, setQueue] = useState<QueuedTaskView[]>([]);
  const [completed, setCompleted] = useState<CompletedTaskView[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<LiveConnectionStatus>('disconnected');
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const onEvent = (event: LiveEvent) => {
    if (event.type === 'container:start') {
      setActiveTaskMap((prev) => ({
        ...prev,
        [event.data.containerId]: {
          containerId: event.data.containerId,
          group: event.data.group,
          provider: event.data.provider,
          prompt: event.data.prompt || '(no prompt)',
          startedAt: new Date(event.data.startedAt).getTime(),
          outputLines: [],
          expanded: true,
        },
      }));
      return;
    }

    if (event.type === 'container:output') {
      setActiveTaskMap((prev) => {
        const existing = prev[event.data.containerId];
        if (!existing) return prev;
        const nextLines = [
          ...existing.outputLines,
          ...event.data.chunk.split(/\r?\n/).filter((line) => line.length > 0),
        ].slice(-300);
        return {
          ...prev,
          [event.data.containerId]: {
            ...existing,
            outputLines: nextLines,
          },
        };
      });
      return;
    }

    if (event.type === 'container:end') {
      setActiveTaskMap((prev) => {
        const next = { ...prev };
        const endedTask = next[event.data.containerId];
        delete next[event.data.containerId];

        setCompleted((current) => {
          const entry: CompletedTaskView = {
            taskId: event.data.containerId,
            label: endedTask ? endedTask.prompt.slice(0, 60) : `Container ${event.data.containerId}`,
            group: endedTask?.group || 'unknown',
            status: event.data.exitCode === 0 ? 'success' : 'error',
            durationMs: event.data.durationMs,
            summary: event.data.resultSummary || 'Completed',
            completedAt: nowIso(),
          };
          return [entry, ...current].slice(0, 50);
        });

        return next;
      });
      return;
    }

    if (event.type === 'task:enqueue') {
      setQueue((prev) => {
        const deduped = prev.filter((item) => item.taskId !== event.data.taskId);
        return [
          {
            taskId: event.data.taskId,
            label: event.data.label,
            group: event.data.group,
            enqueuedAt: event.data.enqueuedAt,
          },
          ...deduped,
        ].slice(0, 50);
      });
      return;
    }

    if (event.type === 'task:start') {
      setQueue((prev) => prev.filter((item) => item.taskId !== event.data.taskId));
      return;
    }

    if (event.type === 'task:complete') {
      setQueue((prev) => prev.filter((item) => item.taskId !== event.data.taskId));
      setCompleted((prev) => [
        {
          taskId: event.data.taskId,
          label: event.data.label,
          group: event.data.group,
          status: event.data.status,
          durationMs: event.data.durationMs,
          summary: event.data.summary,
          completedAt: event.data.completedAt,
        },
        ...prev,
      ].slice(0, 50));
    }
  };

  useLiveEvents(onEvent, {
    enabled: true,
    onStatusChange: setConnectionStatus,
  });

  const activeTasks = useMemo(
    () => Object.values(activeTaskMap).sort((a, b) => a.startedAt - b.startedAt),
    [activeTaskMap],
  );

  function toggleExpanded(containerId: string): void {
    setActiveTaskMap((prev) => {
      const task = prev[containerId];
      if (!task) return prev;
      return {
        ...prev,
        [containerId]: {
          ...task,
          expanded: !task.expanded,
        },
      };
    });
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Live Operations</h1>
        <LiveStatusBadge status={connectionStatus} />
      </header>

      <section className={styles.section}>
        <h2>Active Tasks ({activeTasks.length})</h2>
        <div className={styles.grid}>
          {activeTasks.length === 0 && (
            <div className={styles.empty}>No active containers right now.</div>
          )}
          {activeTasks.map((task) => (
            <ActiveTaskCard
              key={task.containerId}
              task={task}
              nowMs={nowMs}
              onToggle={toggleExpanded}
            />
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2>Queue ({queue.length})</h2>
        <QueueList items={queue} />
      </section>

      <section className={styles.section}>
        <h2>Recent Completed ({completed.length})</h2>
        <CompletedList items={completed} />
      </section>
    </div>
  );
}

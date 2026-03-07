import type { TaskRunLog } from '../api/scheduler';

interface RunHistoryListProps {
  logs: TaskRunLog[];
}

function durationLabel(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export function RunHistoryList({ logs }: RunHistoryListProps) {
  if (logs.length === 0) {
    return <div style={{ color: 'var(--text-muted)' }}>No run history yet.</div>;
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {logs.map((log, idx) => (
        <article
          key={`${log.task_id}:${log.run_at}:${idx}`}
          style={{
            border: '1px solid var(--border)',
            borderRadius: 10,
            background: '#121523',
            padding: '10px 12px',
            display: 'grid',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <strong style={{ color: 'var(--text-primary)' }}>
              {log.status === 'success' ? '✅ OK' : '❌ ERROR'}
            </strong>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {durationLabel(log.duration_ms)}
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {new Date(log.run_at).toLocaleString()}
            </span>
          </div>
          <div style={{ fontSize: 12, color: '#aab2d8' }}>
            {log.status === 'success' ? (log.result || '(no result)') : (log.error || '(error)')}
          </div>
        </article>
      ))}
    </div>
  );
}

export interface CompletedTaskView {
  taskId: string;
  label: string;
  group: string;
  status: 'success' | 'error';
  durationMs: number;
  summary: string;
  completedAt: string;
}

interface CompletedListProps {
  items: CompletedTaskView[];
}

function durationLabel(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  const sec = Math.floor(durationMs / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export function CompletedList({ items }: CompletedListProps) {
  return (
    <section style={{ display: 'grid', gap: 8 }}>
      {items.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No completed tasks yet.</div>
      )}

      {items.map((item) => (
        <div
          key={`${item.taskId}:${item.completedAt}`}
          style={{
            border: '1px solid #2b2e43',
            borderRadius: 8,
            padding: '10px 12px',
            background: '#121523',
            color: 'var(--text-secondary)',
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <strong style={{ color: 'var(--text-primary)' }}>
              {item.status === 'success' ? '✅' : '❌'} {item.label}
            </strong>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {durationLabel(item.durationMs)}
            </span>
          </div>
          <div style={{ fontSize: 12, marginTop: 4, color: 'var(--text-muted)' }}>
            {item.group} | {new Date(item.completedAt).toLocaleTimeString()}
          </div>
          <div style={{ fontSize: 12, marginTop: 6, color: '#aeb5d8' }}>
            {item.summary}
          </div>
        </div>
      ))}
    </section>
  );
}

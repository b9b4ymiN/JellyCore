export interface QueuedTaskView {
  taskId: string;
  label: string;
  group: string;
  enqueuedAt: string;
}

interface QueueListProps {
  items: QueuedTaskView[];
}

function ageLabel(isoTime: string): string {
  const diffMs = Date.now() - new Date(isoTime).getTime();
  const sec = Math.max(0, Math.floor(diffMs / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

export function QueueList({ items }: QueueListProps) {
  return (
    <section style={{ display: 'grid', gap: 8 }}>
      {items.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No queued tasks.</div>
      )}

      {items.map((item) => (
        <div
          key={`${item.taskId}:${item.enqueuedAt}`}
          style={{
            border: '1px solid #2a2c40',
            borderRadius: 8,
            padding: '10px 12px',
            background: '#131626',
            color: 'var(--text-secondary)',
          }}
        >
          <strong style={{ color: 'var(--text-primary)' }}>⏳ {item.label}</strong>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            {item.group} | {ageLabel(item.enqueuedAt)}
          </div>
        </div>
      ))}
    </section>
  );
}

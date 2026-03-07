import type { LiveConnectionStatus } from '../hooks/useLiveEvents';

interface LiveStatusBadgeProps {
  status: LiveConnectionStatus;
}

export function LiveStatusBadge({ status }: LiveStatusBadgeProps) {
  const palette: Record<LiveConnectionStatus, { dot: string; label: string }> = {
    connected: { dot: '#22c55e', label: 'Connected' },
    reconnecting: { dot: '#f59e0b', label: 'Reconnecting' },
    disconnected: { dot: '#ef4444', label: 'Disconnected' },
  };

  const value = palette[status];

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        border: '1px solid var(--border)',
        borderRadius: 999,
        padding: '4px 10px',
        fontSize: 12,
        color: 'var(--text-secondary)',
        background: 'var(--bg-card)',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: value.dot,
          boxShadow: `0 0 10px ${value.dot}`,
        }}
      />
      {value.label}
    </span>
  );
}

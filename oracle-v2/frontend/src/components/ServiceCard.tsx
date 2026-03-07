interface ServiceCardProps {
  name: string;
  status: 'healthy' | 'warn' | 'error';
  detail: string;
  port?: string;
}

const statusColor: Record<ServiceCardProps['status'], string> = {
  healthy: '#22c55e',
  warn: '#f59e0b',
  error: '#ef4444',
};

export function ServiceCard({ name, status, detail, port }: ServiceCardProps) {
  const color = statusColor[status];

  return (
    <article
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        background: '#131627',
        padding: 12,
        display: 'grid',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: color,
            boxShadow: `0 0 8px ${color}`,
          }}
        />
        <strong style={{ color: 'var(--text-primary)' }}>{name}</strong>
      </div>
      <div style={{ color, fontSize: 13 }}>{status}</div>
      <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{detail}</div>
      {port && <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Port {port}</div>}
    </article>
  );
}

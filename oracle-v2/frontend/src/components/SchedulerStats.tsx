import type { SchedulerStats as SchedulerStatsData } from '../api/scheduler';

interface SchedulerStatsProps {
  stats: SchedulerStatsData | null;
}

export function SchedulerStats({ stats }: SchedulerStatsProps) {
  if (!stats) {
    return <div style={{ color: 'var(--text-muted)' }}>Loading scheduler stats...</div>;
  }

  const cells = [
    { label: 'Total', value: stats.total },
    { label: 'Active', value: stats.byStatus.active },
    { label: 'Paused', value: stats.byStatus.paused },
    { label: 'Due Soon', value: stats.dueSoon },
    { label: 'Overdue', value: stats.overdue },
  ];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
        gap: 8,
      }}
    >
      {cells.map((cell) => (
        <div
          key={cell.label}
          style={{
            border: '1px solid var(--border)',
            borderRadius: 10,
            background: '#15172a',
            padding: '10px 12px',
          }}
        >
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{cell.label}</div>
          <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: 18 }}>
            {cell.value}
          </div>
        </div>
      ))}
    </div>
  );
}

import { Link } from 'react-router-dom';
import type { SchedulerTask } from '../api/scheduler';
import { CategoryBadge, type SchedulerCategory } from './CategoryBadge';

interface JobCardProps {
  task: SchedulerTask;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRunNow: (id: string) => void;
  onCancel: (id: string) => void;
  busy?: boolean;
}

function intervalLabel(task: SchedulerTask): string {
  if (task.schedule_type !== 'interval') return task.schedule_value;
  const ms = Number(task.schedule_value);
  if (!Number.isFinite(ms) || ms <= 0) return task.schedule_value;
  if (ms % (24 * 60 * 60 * 1000) === 0) return `${ms / (24 * 60 * 60 * 1000)}d`;
  if (ms % (60 * 60 * 1000) === 0) return `${ms / (60 * 60 * 1000)}h`;
  if (ms % (60 * 1000) === 0) return `${ms / (60 * 1000)}m`;
  return `${ms}ms`;
}

function nextRunLabel(nextRun: string | null): string {
  if (!nextRun) return 'none';
  const diff = new Date(nextRun).getTime() - Date.now();
  if (diff <= 0) return 'now';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `~${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `~${min}m`;
  const hr = Math.floor(min / 60);
  return `~${hr}h`;
}

export function JobCard({
  task,
  onPause,
  onResume,
  onRunNow,
  onCancel,
  busy,
}: JobCardProps) {
  const statusColor = task.status === 'active'
    ? '#22c55e'
    : task.status === 'paused'
      ? '#f59e0b'
      : '#6b7280';

  return (
    <article
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        background: '#131627',
        padding: 12,
        display: 'grid',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <strong style={{ color: 'var(--text-primary)' }}>{task.label || task.id}</strong>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Group: {task.group_folder}
          </div>
          <div style={{ display: 'inline-flex' }}>
            <CategoryBadge category={'custom' as SchedulerCategory} />
          </div>
        </div>
        <span
          style={{
            color: statusColor,
            border: `1px solid ${statusColor}55`,
            background: `${statusColor}22`,
            borderRadius: 999,
            padding: '2px 8px',
            fontSize: 12,
          }}
        >
          {task.status}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', color: 'var(--text-muted)', fontSize: 12 }}>
        <span>Interval: {intervalLabel(task)}</span>
        <span>Next: {nextRunLabel(task.next_run)}</span>
        <span>Last run: {task.last_run ? new Date(task.last_run).toLocaleString() : 'never'}</span>
      </div>

      {task.last_result && (
        <div style={{ fontSize: 12, color: '#9fa7cd' }}>
          {task.last_result.slice(0, 140)}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {task.status === 'active' ? (
          <button type="button" onClick={() => onPause(task.id)} disabled={busy}>
            Pause
          </button>
        ) : (
          <button type="button" onClick={() => onResume(task.id)} disabled={busy}>
            Resume
          </button>
        )}
        <button type="button" onClick={() => onRunNow(task.id)} disabled={busy || task.status !== 'active'}>
          Run Now
        </button>
        <button type="button" onClick={() => onCancel(task.id)} disabled={busy}>
          Cancel
        </button>
        <Link to={`/scheduler/${encodeURIComponent(task.id)}`}>Detail</Link>
      </div>
    </article>
  );
}

import { OutputTerminal } from './OutputTerminal';

export interface ActiveTaskView {
  containerId: string;
  group: string;
  provider: string;
  prompt: string;
  startedAt: number;
  outputLines: string[];
  expanded: boolean;
}

interface ActiveTaskCardProps {
  task: ActiveTaskView;
  nowMs: number;
  onToggle: (containerId: string) => void;
}

function elapsedText(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec}s`;
}

export function ActiveTaskCard({ task, nowMs, onToggle }: ActiveTaskCardProps) {
  const providerColor = task.provider === 'codex'
    ? '#f59e0b'
    : task.provider === 'ollama'
      ? '#60a5fa'
      : '#22c55e';

  return (
    <article
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        background: 'var(--bg-card)',
        padding: 14,
        display: 'grid',
        gap: 10,
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <strong style={{ color: 'var(--text-primary)' }}>
            <span style={{ color: providerColor, marginRight: 8 }}>●</span>
            {task.provider.toUpperCase()} - {task.prompt.slice(0, 100)}
          </strong>
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            Container: {task.containerId} | Group: {task.group}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            Running: {elapsedText(nowMs - task.startedAt)}
          </div>
        </div>

        <button
          type="button"
          onClick={() => onToggle(task.containerId)}
          style={{
            border: '1px solid var(--border)',
            background: '#16182a',
            color: 'var(--text-secondary)',
            borderRadius: 8,
            padding: '6px 10px',
            cursor: 'pointer',
          }}
        >
          {task.expanded ? 'Collapse' : 'Expand'}
        </button>
      </header>

      {task.expanded && <OutputTerminal lines={task.outputLines} />}
    </article>
  );
}

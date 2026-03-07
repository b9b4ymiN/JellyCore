import { useEffect, useState } from 'react';
import { IntervalPicker } from './IntervalPicker';
import styles from './JobFormModal.module.css';

export interface JobFormValue {
  name: string;
  group_folder: string;
  prompt: string;
  interval_ms: number;
  status: 'active' | 'paused';
}

interface JobFormModalProps {
  open: boolean;
  title?: string;
  submitLabel?: string;
  groups: string[];
  initialValue?: JobFormValue;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (value: JobFormValue) => Promise<void> | void;
}

const defaultValue: JobFormValue = {
  name: '',
  group_folder: 'main',
  prompt: '',
  interval_ms: 60 * 60 * 1000,
  status: 'active',
};

export function JobFormModal({
  open,
  title = 'Create Scheduled Job',
  submitLabel = 'Create',
  groups,
  initialValue,
  busy,
  onClose,
  onSubmit,
}: JobFormModalProps) {
  const [value, setValue] = useState<JobFormValue>(defaultValue);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue(initialValue || {
      ...defaultValue,
      group_folder: groups[0] || 'main',
    });
    setError(null);
  }, [groups, initialValue, open]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!value.name.trim()) {
      setError('Name is required');
      return;
    }
    if (!value.prompt.trim()) {
      setError('Prompt is required');
      return;
    }
    if (value.interval_ms < 60_000) {
      setError('Interval must be at least 1 minute');
      return;
    }
    setError(null);
    await onSubmit({
      ...value,
      name: value.name.trim(),
      prompt: value.prompt.trim(),
    });
  }

  return (
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2>{title}</h2>
        <form className={styles.form} onSubmit={handleSubmit}>
          <label>
            Name
            <input
              value={value.name}
              onChange={(e) => setValue((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Monitor NVDA"
              disabled={busy}
            />
          </label>

          <label>
            Group
            <select
              value={value.group_folder}
              onChange={(e) => setValue((prev) => ({ ...prev, group_folder: e.target.value }))}
              disabled={busy}
            >
              {groups.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
          </label>

          <label>
            Interval
            <IntervalPicker
              valueMs={value.interval_ms}
              onChange={(nextMs) => setValue((prev) => ({ ...prev, interval_ms: nextMs }))}
              disabled={busy}
            />
            <div className={styles.quickRow}>
              {[15, 30, 60, 360, 720, 1440].map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => setValue((prev) => ({ ...prev, interval_ms: minutes * 60 * 1000 }))}
                  disabled={busy}
                >
                  {minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`}
                </button>
              ))}
            </div>
          </label>

          <label>
            Prompt
            <textarea
              value={value.prompt}
              onChange={(e) => setValue((prev) => ({ ...prev, prompt: e.target.value }))}
              rows={6}
              placeholder="Describe what this scheduled task should do..."
              disabled={busy}
            />
          </label>

          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={value.status === 'active'}
              onChange={(e) => setValue((prev) => ({ ...prev, status: e.target.checked ? 'active' : 'paused' }))}
              disabled={busy}
            />
            Start immediately
          </label>

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.actions}>
            <button type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" disabled={busy}>
              {busy ? 'Saving...' : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

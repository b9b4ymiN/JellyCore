import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  cancelTask,
  getTask,
  pauseTask,
  resumeTask,
  runTaskNow,
  updateTask,
  type SchedulerTask,
  type TaskRunLog,
} from '../api/scheduler';
import { JobFormModal, type JobFormValue } from '../components/JobFormModal';
import { RunHistoryList } from '../components/RunHistoryList';
import styles from './JobDetailPage.module.css';

function parseIntervalMs(task: SchedulerTask): number {
  if (task.schedule_type !== 'interval') return 60 * 60 * 1000;
  const parsed = Number(task.schedule_value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60 * 60 * 1000;
}

export function JobDetailPage() {
  const params = useParams();
  const navigate = useNavigate();
  const taskId = params.id || '';
  const [task, setTask] = useState<SchedulerTask | null>(null);
  const [logs, setLogs] = useState<TaskRunLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const loadData = useCallback(async () => {
    if (!taskId) {
      setError('Missing task id');
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const data = await getTask(taskId);
      setTask(data.task);
      setLogs(data.recentRuns || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load task');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const editInitial = useMemo<JobFormValue | undefined>(() => {
    if (!task) return undefined;
    return {
      name: task.label || task.id,
      group_folder: task.group_folder,
      prompt: task.prompt,
      interval_ms: parseIntervalMs(task),
      status: task.status === 'active' ? 'active' : 'paused',
    };
  }, [task]);

  async function withAction(fn: () => Promise<void>): Promise<void> {
    if (!task) return;
    try {
      setBusy(true);
      setError(null);
      await fn();
      await loadData();
    } catch (err: any) {
      setError(err?.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleEditSubmit(value: JobFormValue): Promise<void> {
    if (!task) return;
    try {
      setBusy(true);
      await updateTask(task.id, {
        name: value.name,
        prompt: value.prompt,
        interval_ms: value.interval_ms,
        status: value.status,
      });
      setEditOpen(false);
      await loadData();
    } catch (err: any) {
      setError(err?.message || 'Failed to update task');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className={styles.container}>Loading task...</div>;
  }

  if (!task) {
    return (
      <div className={styles.container}>
        <p>{error || 'Task not found'}</p>
        <button type="button" onClick={() => navigate('/scheduler')}>Back</button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <Link to="/scheduler">← Back</Link>
        <h1>{task.label || task.id}</h1>
      </header>

      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.card}>
        <div className={styles.metaGrid}>
          <div><span>Status</span><strong>{task.status}</strong></div>
          <div><span>Group</span><strong>{task.group_folder}</strong></div>
          <div><span>Created</span><strong>{new Date(task.created_at).toLocaleString()}</strong></div>
          <div><span>Next Run</span><strong>{task.next_run ? new Date(task.next_run).toLocaleString() : 'none'}</strong></div>
        </div>

        <div className={styles.promptBox}>
          <h3>Prompt</h3>
          <pre>{task.prompt}</pre>
        </div>

        <div className={styles.actions}>
          {task.status === 'active' ? (
            <button type="button" onClick={() => void withAction(() => pauseTask(task.id))} disabled={busy}>
              Pause
            </button>
          ) : (
            <button type="button" onClick={() => void withAction(() => resumeTask(task.id))} disabled={busy}>
              Resume
            </button>
          )}
          <button type="button" onClick={() => void withAction(() => runTaskNow(task.id))} disabled={busy || task.status !== 'active'}>
            Run Now
          </button>
          <button type="button" onClick={() => setEditOpen(true)} disabled={busy}>
            Edit
          </button>
          <button type="button" onClick={() => void withAction(() => cancelTask(task.id))} disabled={busy}>
            Cancel
          </button>
        </div>
      </section>

      <section className={styles.card}>
        <h2>Run History</h2>
        <RunHistoryList logs={logs} />
      </section>

      <JobFormModal
        open={editOpen}
        title="Edit Scheduled Job"
        submitLabel="Save"
        groups={[task.group_folder]}
        initialValue={editInitial}
        busy={busy}
        onClose={() => setEditOpen(false)}
        onSubmit={handleEditSubmit}
      />
    </div>
  );
}

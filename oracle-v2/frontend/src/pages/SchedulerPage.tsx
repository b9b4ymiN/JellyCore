import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  cancelTask,
  createTask,
  getSchedulerStats,
  listTasks,
  pauseTask,
  resumeTask,
  runTaskNow,
  type SchedulerTask,
  type SchedulerStats,
} from '../api/scheduler';
import { JobCard } from '../components/JobCard';
import { JobFormModal, type JobFormValue } from '../components/JobFormModal';
import { SchedulerStats as SchedulerStatsBar } from '../components/SchedulerStats';
import styles from './SchedulerPage.module.css';

type StatusFilter = 'all' | 'active' | 'paused' | 'completed';

export function SchedulerPage() {
  const [tasks, setTasks] = useState<SchedulerTask[]>([]);
  const [stats, setStats] = useState<SchedulerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [taskRes, statsRes] = await Promise.all([
        listTasks({
          status: statusFilter === 'all' ? undefined : statusFilter,
          group: groupFilter === 'all' ? undefined : groupFilter,
        }),
        getSchedulerStats(),
      ]);
      setTasks(taskRes.tasks || []);
      setStats(statsRes);
    } catch (err: any) {
      setError(err?.message || 'Failed to load scheduler');
    } finally {
      setLoading(false);
    }
  }, [groupFilter, statusFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const timer = setInterval(() => {
      void loadData();
    }, 15_000);
    return () => clearInterval(timer);
  }, [loadData]);

  const groups = useMemo(() => {
    const uniq = new Set(tasks.map((task) => task.group_folder).filter(Boolean));
    return Array.from(uniq).sort();
  }, [tasks]);

  async function withTaskAction(taskId: string, action: () => Promise<void>): Promise<void> {
    try {
      setBusyTaskId(taskId);
      await action();
      await loadData();
    } catch (err: any) {
      setError(err?.message || 'Task action failed');
    } finally {
      setBusyTaskId(null);
    }
  }

  async function handleCreate(form: JobFormValue): Promise<void> {
    try {
      setSubmitting(true);
      setError(null);
      await createTask({
        name: form.name,
        group_folder: form.group_folder,
        prompt: form.prompt,
        interval_ms: form.interval_ms,
        status: form.status,
        category: 'custom',
      });
      setModalOpen(false);
      await loadData();
    } catch (err: any) {
      setError(err?.message || 'Failed to create task');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1>Scheduler Management</h1>
          <p>Manage recurring jobs and run tasks on demand.</p>
        </div>
        <button type="button" onClick={() => setModalOpen(true)}>
          + New Job
        </button>
      </header>

      {error && <div className={styles.error}>{error}</div>}

      <SchedulerStatsBar stats={stats} />

      <section className={styles.filters}>
        <label>
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">all</option>
            <option value="active">active</option>
            <option value="paused">paused</option>
            <option value="completed">completed</option>
          </select>
        </label>

        <label>
          Group
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
          >
            <option value="all">all</option>
            {groups.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </select>
        </label>

        <button type="button" onClick={() => void loadData()}>
          Refresh
        </button>
      </section>

      <section className={styles.list}>
        {loading && <div className={styles.empty}>Loading tasks...</div>}
        {!loading && tasks.length === 0 && (
          <div className={styles.empty}>No tasks for current filter.</div>
        )}
        {tasks.map((task) => (
          <JobCard
            key={task.id}
            task={task}
            busy={busyTaskId === task.id}
            onPause={(id) => void withTaskAction(id, () => pauseTask(id))}
            onResume={(id) => void withTaskAction(id, () => resumeTask(id))}
            onRunNow={(id) => void withTaskAction(id, () => runTaskNow(id))}
            onCancel={(id) => void withTaskAction(id, () => cancelTask(id))}
          />
        ))}
      </section>

      <JobFormModal
        open={modalOpen}
        groups={groups.length > 0 ? groups : ['main']}
        busy={submitting}
        onClose={() => {
          if (!submitting) setModalOpen(false);
        }}
        onSubmit={handleCreate}
      />
    </div>
  );
}

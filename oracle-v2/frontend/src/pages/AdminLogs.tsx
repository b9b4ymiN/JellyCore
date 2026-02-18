import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAdminToken, getLogs, type LogEntry } from '../api/admin';
import s from './Admin.module.css';

export function AdminLogs() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  if (!getAdminToken()) {
    navigate('/admin');
    return null;
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getLogs(200);
      setLogs(data.logs);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = filter
    ? logs.filter((l) =>
        l.type?.toLowerCase().includes(filter.toLowerCase()) ||
        l.query?.toLowerCase().includes(filter.toLowerCase()) ||
        JSON.stringify(l).toLowerCase().includes(filter.toLowerCase())
      )
    : logs;

  return (
    <div className={s.container}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1>Oracle Logs</h1>
        <button className={s.refreshBtn} onClick={load}>Refresh</button>
      </div>

      <div className={s.searchRow}>
        <input
          className={s.searchInput}
          type="text"
          placeholder="Filter by type or content..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className={s.muted}>{filtered.length} / {logs.length} entries</span>
      </div>

      {error && <div className={s.errorBanner}>{error}</div>}
      {loading && <div className={s.loading}>Loading logs...</div>}

      {!loading && filtered.length === 0 && (
        <div className={s.emptyState}>No log entries</div>
      )}

      <div className={s.logList}>
        {filtered.map((log) => (
          <div key={log.id} className={s.logEntry}>
            <span className={s.logTime}>
              {new Date(log.created_at).toLocaleTimeString()}
            </span>
            <span className={s.logType}>{log.type}</span>
            <span className={s.logContent}>
              {log.query || JSON.stringify(log, null, 0).slice(0, 200)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

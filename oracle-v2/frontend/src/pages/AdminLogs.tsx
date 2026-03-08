import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAdminToken, getLogs, type LogEntry } from '../api/admin';
import { useToast } from '../hooks/useToast';
import s from './Admin.module.css';

type SortField = 'created_at' | 'type' | 'query';
type SortDirection = 'asc' | 'desc';

function toCsv(rows: LogEntry[]): string {
  const headers = ['created_at', 'type', 'query', 'mode', 'results_count', 'search_time_ms', 'project'];
  const dataRows = rows.map((log) => [
    log.created_at || '',
    log.type || '',
    log.query || '',
    String(log.mode || ''),
    String(log.results_count || ''),
    String(log.search_time_ms || ''),
    String(log.project || ''),
  ]);

  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return [headers, ...dataRows]
    .map((row) => row.map((cell) => escape(cell)).join(','))
    .join('\n');
}

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function AdminLogs() {
  const navigate = useNavigate();
  const toast = useToast();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [queryFilter, setQueryFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!getAdminToken()) {
      navigate('/admin');
    }
  }, [navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getLogs(500);
      setLogs(data.logs);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const typeOptions = useMemo(() => {
    const set = new Set(logs.map((l) => l.type).filter(Boolean));
    return ['all', ...Array.from(set).sort()];
  }, [logs]);

  const filteredSorted = useMemo(() => {
    let next = [...logs];

    if (typeFilter !== 'all') {
      next = next.filter((l) => l.type === typeFilter);
    }

    if (queryFilter.trim()) {
      const q = queryFilter.toLowerCase();
      next = next.filter((l) => (
        l.type?.toLowerCase().includes(q)
        || l.query?.toLowerCase().includes(q)
        || JSON.stringify(l).toLowerCase().includes(q)
      ));
    }

    if (dateFrom) {
      const from = new Date(`${dateFrom}T00:00:00`).getTime();
      next = next.filter((l) => new Date(l.created_at).getTime() >= from);
    }

    if (dateTo) {
      const to = new Date(`${dateTo}T23:59:59`).getTime();
      next = next.filter((l) => new Date(l.created_at).getTime() <= to);
    }

    next.sort((a, b) => {
      const dir = sortDirection === 'asc' ? 1 : -1;
      if (sortField === 'created_at') {
        return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
      }
      const av = String(a[sortField] || '').toLowerCase();
      const bv = String(b[sortField] || '').toLowerCase();
      return av.localeCompare(bv) * dir;
    });

    return next;
  }, [logs, typeFilter, queryFilter, dateFrom, dateTo, sortField, sortDirection]);

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(filteredSorted.length / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const paged = filteredSorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function exportCsv() {
    const csv = toCsv(filteredSorted);
    downloadFile(`oracle-logs-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8;');
    toast.success('Exported logs as CSV');
  }

  function exportJson() {
    downloadFile(`oracle-logs-${Date.now()}.json`, JSON.stringify(filteredSorted, null, 2), 'application/json;charset=utf-8;');
    toast.success('Exported logs as JSON');
  }

  return (
    <div className={s.container}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h1>Oracle Logs</h1>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className={s.refreshBtn} onClick={() => void load()}>Refresh</button>
          <button className={s.searchBtn} onClick={exportCsv}>Export CSV</button>
          <button className={s.searchBtn} onClick={exportJson}>Export JSON</button>
        </div>
      </div>

      <div className={s.searchRow} style={{ marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <input
          className={s.searchInput}
          type="text"
          placeholder="Filter by type/query/content"
          value={queryFilter}
          onChange={(e) => {
            setQueryFilter(e.target.value);
            setPage(1);
          }}
        />

        <select
          className={s.searchInput}
          style={{ maxWidth: '180px' }}
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
        >
          {typeOptions.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>

        <input
          className={s.searchInput}
          style={{ maxWidth: '180px' }}
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
        />
        <input
          className={s.searchInput}
          style={{ maxWidth: '180px' }}
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
        />
      </div>

      <div className={s.searchRow} style={{ marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <select className={s.searchInput} style={{ maxWidth: '180px' }} value={sortField} onChange={(e) => setSortField(e.target.value as SortField)}>
          <option value="created_at">Sort: Timestamp</option>
          <option value="type">Sort: Type</option>
          <option value="query">Sort: Query</option>
        </select>
        <select className={s.searchInput} style={{ maxWidth: '140px' }} value={sortDirection} onChange={(e) => setSortDirection(e.target.value as SortDirection)}>
          <option value="desc">Desc</option>
          <option value="asc">Asc</option>
        </select>
        <span className={s.muted}>{filteredSorted.length} / {logs.length} entries</span>
      </div>

      {error && <div className={s.errorBanner}>{error}</div>}
      {loading && <div className={s.loading}>Loading logs...</div>}

      {!loading && filteredSorted.length === 0 && (
        <div className={s.emptyState}>No matching log entries</div>
      )}

      <div className={s.logList}>
        {paged.map((log, i) => (
          <div key={`${log.id || 'row'}-${i}`} className={s.logEntry}>
            <span className={s.logTime}>{new Date(log.created_at).toLocaleString()}</span>
            <span className={s.logType}>{log.type || 'unknown'}</span>
            <span className={s.logContent}>{log.query || JSON.stringify(log).slice(0, 240)}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.75rem', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button className={s.refreshBtn} disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
        <span className={s.muted}>Page {safePage} of {totalPages}</span>
        <button className={s.refreshBtn} disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
      </div>
    </div>
  );
}

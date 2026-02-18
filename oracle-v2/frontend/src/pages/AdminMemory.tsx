import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAdminToken,
  getUserModel,
  updateUserModel,
  deleteUserModel,
  getEpisodes,
  getProcedures,
  searchKnowledge,
  type Episode,
  type Procedure,
} from '../api/admin';
import s from './Admin.module.css';

type Tab = 'user-model' | 'episodic' | 'procedural' | 'knowledge';

export function AdminMemory() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('user-model');

  if (!getAdminToken()) {
    navigate('/admin');
    return null;
  }

  return (
    <div className={s.container}>
      <h1>Memory Manager</h1>
      <div className={s.tabs}>
        {(['user-model', 'episodic', 'procedural', 'knowledge'] as Tab[]).map((t) => (
          <button
            key={t}
            className={`${s.tab} ${tab === t ? s.tabActive : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'user-model' ? 'User Model' :
             t === 'episodic' ? 'Episodes' :
             t === 'procedural' ? 'Procedures' : 'Knowledge'}
          </button>
        ))}
      </div>

      {tab === 'user-model' && <UserModelTab />}
      {tab === 'episodic' && <EpisodicTab />}
      {tab === 'procedural' && <ProceduralTab />}
      {tab === 'knowledge' && <KnowledgeTab />}
    </div>
  );
}

// ---- User Model Tab ----
function UserModelTab() {
  const [json, setJson] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getUserModel();
      setJson(JSON.stringify(data.model ?? data, null, 2));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const parsed = JSON.parse(json);
      await updateUserModel(parsed);
      setSuccess('Saved!');
      setTimeout(() => setSuccess(''), 2000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete the entire user model? This cannot be undone.')) return;
    try {
      await deleteUserModel();
      setJson('{}');
      setSuccess('Deleted');
      setTimeout(() => setSuccess(''), 2000);
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (loading) return <div className={s.loading}>Loading user model...</div>;

  return (
    <div className={s.modelEditor}>
      {error && <div className={s.errorBanner}>{error}</div>}
      {success && <div style={{ color: '#4ade80', marginBottom: '0.5rem' }}>{success}</div>}
      <textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        spellCheck={false}
      />
      <div className={s.btnRow}>
        <button className={s.btnSave} onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button className={s.btnDanger} onClick={handleDelete}>Delete</button>
        <button className={s.refreshBtn} onClick={load}>Reload</button>
      </div>
    </div>
  );
}

// ---- Episodic Tab ----
function EpisodicTab() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getEpisodes(50);
      setEpisodes(data.episodes);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className={s.loading}>Loading episodes...</div>;
  if (error) return <div className={s.errorBanner}>{error}</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <span className={s.muted}>{episodes.length} episodes</span>
        <button className={s.refreshBtn} onClick={load}>Refresh</button>
      </div>
      {episodes.length === 0 ? (
        <div className={s.emptyState}>No episodic memories yet</div>
      ) : (
        episodes.map((ep) => (
          <div key={ep.id} className={s.listItem}>
            <h3>{ep.summary?.slice(0, 120) || 'Untitled episode'}</h3>
            {ep.key_topics && ep.key_topics.length > 0 && (
              <div className={s.tagList} style={{ marginBottom: '0.25rem' }}>
                {ep.key_topics.map((t) => <span key={t} className={s.tag}>{t}</span>)}
              </div>
            )}
            <div className={s.listMeta}>
              {ep.group && <span>Group: {ep.group} · </span>}
              {new Date(ep.created_at).toLocaleString()}
              {ep.expires_at && ` · Expires: ${new Date(ep.expires_at).toLocaleDateString()}`}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ---- Procedural Tab ----
function ProceduralTab() {
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getProcedures(50);
      setProcedures(data.procedures);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className={s.loading}>Loading procedures...</div>;
  if (error) return <div className={s.errorBanner}>{error}</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <span className={s.muted}>{procedures.length} procedures</span>
        <button className={s.refreshBtn} onClick={load}>Refresh</button>
      </div>
      {procedures.length === 0 ? (
        <div className={s.emptyState}>No procedural memories yet</div>
      ) : (
        procedures.map((p) => (
          <div key={p.id} className={s.listItem}>
            <h3>{p.name}</h3>
            <p>{p.description?.slice(0, 200)}</p>
            <div className={s.listMeta}>
              Confidence: {(p.confidence * 100).toFixed(0)}% · Used: {p.usage_count}x · {new Date(p.created_at).toLocaleString()}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ---- Knowledge (Semantic Search) Tab ----
function KnowledgeTab() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    setSearched(true);
    try {
      const data = await searchKnowledge(query);
      setResults(data.results || data.documents || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className={s.searchRow}>
        <input
          className={s.searchInput}
          type="text"
          placeholder="Search Oracle knowledge..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <button className={s.searchBtn} onClick={handleSearch} disabled={loading}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>
      {error && <div className={s.errorBanner}>{error}</div>}
      {searched && results.length === 0 && !loading && (
        <div className={s.emptyState}>No results found</div>
      )}
      {results.map((r, i) => (
        <div key={r.id || i} className={s.listItem}>
          <h3>{r.title || r.name || `Result ${i + 1}`}</h3>
          <p>{(r.content || r.text || r.summary || JSON.stringify(r)).slice(0, 300)}</p>
          {r.score != null && (
            <div className={s.listMeta}>Score: {(r.score * 100).toFixed(1)}%</div>
          )}
        </div>
      ))}
    </div>
  );
}

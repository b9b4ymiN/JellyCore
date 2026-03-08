import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { search } from '../api/oracle';
import type { Document } from '../api/oracle';
import { LogCard } from '../components/LogCard';
import { SidebarLayout } from '../components/SidebarLayout';
import { EmptyState, Skeleton } from '../components/ui';
import styles from './Search.module.css';

const DOC_TYPES = ['principle', 'pattern', 'learning', 'retro'] as const;
const LAYERS = ['semantic', 'procedural', 'episodic', 'user_model'] as const;

type SearchMode = 'hybrid' | 'fts' | 'vector';

function extractDate(doc: Document): Date | null {
  if (doc.created_at) {
    const date = new Date(doc.created_at);
    if (!Number.isNaN(date.getTime())) return date;
  }
  const source = doc.source_file || '';
  const iso = source.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso?.[1]) {
    const date = new Date(iso[1]);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

export function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [results, setResults] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [rawTotal, setRawTotal] = useState(0);

  const [selectedTypes, setSelectedTypes] = useState<string[]>(() => {
    const fromUrl = searchParams.get('types');
    if (!fromUrl) return [...DOC_TYPES];
    const parsed = fromUrl.split(',').filter(Boolean);
    return parsed.length > 0 ? parsed : [...DOC_TYPES];
  });
  const [searchMode, setSearchMode] = useState<SearchMode>(() => (searchParams.get('mode') as SearchMode) || 'hybrid');
  const [project, setProject] = useState(searchParams.get('project') || '');
  const [selectedLayers, setSelectedLayers] = useState<string[]>(() => {
    const fromUrl = searchParams.get('layers');
    return fromUrl ? fromUrl.split(',').filter(Boolean) : [];
  });
  const [dateFrom, setDateFrom] = useState(searchParams.get('from') || '');
  const [dateTo, setDateTo] = useState(searchParams.get('to') || '');
  const [page, setPage] = useState(Number(searchParams.get('page') || '1'));

  const availableProjects = useMemo(() => {
    const projects = new Set<string>();
    for (const doc of results) {
      if (doc.project) projects.add(doc.project);
    }
    return [...projects].sort();
  }, [results]);

  const filteredResults = useMemo(() => {
    let next = [...results];

    if (selectedTypes.length > 0 && selectedTypes.length < DOC_TYPES.length) {
      next = next.filter((doc) => selectedTypes.includes(doc.type));
    }

    if (dateFrom) {
      const from = new Date(`${dateFrom}T00:00:00`);
      next = next.filter((doc) => {
        const docDate = extractDate(doc);
        return docDate ? docDate >= from : true;
      });
    }

    if (dateTo) {
      const to = new Date(`${dateTo}T23:59:59`);
      next = next.filter((doc) => {
        const docDate = extractDate(doc);
        return docDate ? docDate <= to : true;
      });
    }

    return next;
  }, [results, selectedTypes, dateFrom, dateTo]);

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(filteredResults.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pagedResults = filteredResults.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    const q = searchParams.get('q');
    if (!q) return;
    setQuery(q);
    void runSearch(q, true);
  }, []);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  function syncUrl(nextQuery: string, nextPage: number) {
    const params = new URLSearchParams();
    params.set('q', nextQuery);
    params.set('page', String(nextPage));
    params.set('mode', searchMode);
    if (project) params.set('project', project);
    if (selectedLayers.length > 0) params.set('layers', selectedLayers.join(','));
    if (selectedTypes.length > 0 && selectedTypes.length < DOC_TYPES.length) {
      params.set('types', selectedTypes.join(','));
    }
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    setSearchParams(params);
  }

  async function runSearch(q: string, fromUrl = false): Promise<void> {
    if (!q.trim()) return;

    setLoading(true);
    setSearched(true);
    try {
      const backendType = selectedTypes.length === 1 ? selectedTypes[0] : 'all';
      const data = await search(q, {
        type: backendType,
        limit: 200,
        offset: 0,
        mode: searchMode,
        project: project || undefined,
        layer: selectedLayers.length > 0 ? (selectedLayers as any) : undefined,
      });
      setResults(data.results || []);
      setRawTotal(data.total || data.results.length);
      if (!fromUrl) {
        setPage(1);
        syncUrl(q, 1);
      }
    } finally {
      setLoading(false);
    }
  }

  function toggleType(type: string) {
    setSelectedTypes((prev) => {
      const next = prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type];
      return next.length === 0 ? [...DOC_TYPES] : next;
    });
  }

  function toggleLayer(layer: string) {
    setSelectedLayers((prev) => (prev.includes(layer) ? prev.filter((l) => l !== layer) : [...prev, layer]));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void runSearch(query);
  }

  return (
    <SidebarLayout
      activeType={selectedTypes.length === 1 ? selectedTypes[0] : 'all'}
      onTypeChange={(type) => {
        if (type === 'all') {
          setSelectedTypes([...DOC_TYPES]);
          return;
        }
        setSelectedTypes([type]);
      }}
    >
      <div className={styles.container}>
        <h1 className={styles.title}>Search Oracle</h1>

        <form onSubmit={submit} className={styles.form}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for patterns, principles, and learnings"
            className={styles.input}
            autoFocus
          />
          <button type="submit" className={styles.button}>Search</button>
        </form>

        <section className={styles.filters}>
          <div className={styles.filterGroup}>
            <label>Mode</label>
            <select value={searchMode} onChange={(e) => setSearchMode(e.target.value as SearchMode)}>
              <option value="hybrid">Hybrid</option>
              <option value="fts">FTS only</option>
              <option value="vector">Vector only</option>
            </select>
          </div>

          <div className={styles.filterGroup}>
            <label>Project</label>
            <input
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="github.com/org/repo"
              list="search-projects"
            />
            <datalist id="search-projects">
              {availableProjects.map((p) => <option key={p} value={p} />)}
            </datalist>
          </div>

          <div className={styles.filterGroup}>
            <label>Date range</label>
            <div className={styles.dateRow}>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>

          <div className={styles.filterGroup}>
            <label>Types</label>
            <div className={styles.checkboxRow}>
              {DOC_TYPES.map((type) => (
                <label key={type} className={styles.checkboxItem}>
                  <input type="checkbox" checked={selectedTypes.includes(type)} onChange={() => toggleType(type)} />
                  {type}
                </label>
              ))}
            </div>
          </div>

          <div className={styles.filterGroup}>
            <label>Memory layers</label>
            <div className={styles.checkboxRow}>
              {LAYERS.map((layer) => (
                <label key={layer} className={styles.checkboxItem}>
                  <input type="checkbox" checked={selectedLayers.includes(layer)} onChange={() => toggleLayer(layer)} />
                  {layer}
                </label>
              ))}
            </div>
          </div>
        </section>

        {loading && (
          <div className={styles.list}>
            {Array.from({ length: 3 }).map((_, idx) => (
              <div key={idx} className={styles.loading}>
                <Skeleton height={18} style={{ marginBottom: 8 }} />
                <Skeleton height={14} style={{ marginBottom: 8 }} />
                <Skeleton height={14} width="65%" />
              </div>
            ))}
          </div>
        )}

        {!loading && searched && (
          <div className={styles.results}>
            <p className={styles.meta}>
              {filteredResults.length} shown ({rawTotal} raw) for "{query}"
            </p>

            {pagedResults.length > 0 ? (
              <>
                <div className={styles.list}>
                  {pagedResults.map((doc) => (
                    <LogCard key={doc.id} doc={doc} />
                  ))}
                </div>
                <div className={styles.pagination}>
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => {
                      const next = Math.max(1, safePage - 1);
                      setPage(next);
                      syncUrl(query, next);
                    }}
                  >
                    Prev
                  </button>
                  <span>Page {safePage} of {totalPages}</span>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => {
                      const next = Math.min(totalPages, safePage + 1);
                      setPage(next);
                      syncUrl(query, next);
                    }}
                  >
                    Next
                  </button>
                </div>
              </>
            ) : (
              <EmptyState
                title="No results found"
                message="Try different keywords or broaden filters."
                action={
                  <div className={styles.suggestionRow}>
                    {['pattern', 'context', 'safety'].map((term) => (
                      <button
                        key={term}
                        type="button"
                        className={styles.suggestionBtn}
                        onClick={() => {
                          setQuery(term);
                          void runSearch(term);
                        }}
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                }
              />
            )}
          </div>
        )}
      </div>
    </SidebarLayout>
  );
}

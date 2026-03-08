import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { list } from '../api/oracle';
import type { Document } from '../api/oracle';
import { LogCard } from '../components/LogCard';
import { SidebarLayout } from '../components/SidebarLayout';
import { EmptyState, Skeleton } from '../components/ui';
import styles from './Feed.module.css';

export function Feed() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const type = searchParams.get('type') || 'all';

  function setType(newType: string) {
    if (newType === 'all') {
      setSearchParams({});
    } else {
      setSearchParams({ type: newType });
    }
  }

  useEffect(() => {
    loadDocs(true);
  }, [type]);

  async function loadDocs(reset = false) {
    setLoading(true);
    try {
      const newOffset = reset ? 0 : offset;
      const data = await list(type, 20, newOffset);
      if (reset) {
        setDocs(data.results);
        setOffset(20);
      } else {
        setDocs((prev) => [...prev, ...data.results]);
        setOffset((prev) => prev + 20);
      }
      setHasMore(data.results.length >= 20);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SidebarLayout activeType={type} onTypeChange={setType}>
      <h1 className={styles.title}>Knowledge Feed</h1>
      <p className={styles.subtitle}>
        Browse Oracle's indexed knowledge: principles, patterns, learnings, and retrospectives
      </p>

      {loading && docs.length === 0 ? (
        <div className={styles.feed}>
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className={styles.loading}>
              <Skeleton height={18} style={{ marginBottom: 8 }} />
              <Skeleton height={14} style={{ marginBottom: 8 }} />
              <Skeleton height={14} width="70%" />
            </div>
          ))}
        </div>
      ) : docs.length > 0 ? (
        <div className={styles.feed}>
          {docs.map((doc) => (
            <LogCard key={doc.id} doc={doc} />
          ))}
        </div>
      ) : (
        <EmptyState
          title={type === 'all' ? 'No documents yet' : `No ${type} documents yet`}
          message="Try another type filter or upload new knowledge."
          action={<a href="/search">Go to Search</a>}
        />
      )}

      {loading && docs.length > 0 && <div className={styles.loading}>Loading...</div>}

      {!loading && hasMore && (
        <button type="button" onClick={() => loadDocs(false)} className={styles.loadMore}>
          Load More
        </button>
      )}
    </SidebarLayout>
  );
}

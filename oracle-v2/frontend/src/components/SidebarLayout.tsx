import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import styles from './SidebarLayout.module.css';

const TYPES = [
  { key: 'all', label: 'All' },
  { key: 'principle', label: 'Principles' },
  { key: 'pattern', label: 'Patterns' },
  { key: 'learning', label: 'Learnings' },
  { key: 'retro', label: 'Retros' },
];

interface SidebarLayoutProps {
  children: React.ReactNode;
  activeType?: string;
  onTypeChange?: (type: string) => void;
}

export function SidebarLayout({ children, activeType = 'all', onTypeChange }: SidebarLayoutProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [activeType]);

  function closeDrawer() {
    setDrawerOpen(false);
  }

  return (
    <div className={styles.container}>
      <div className={styles.mobileFilterRow}>
        <button
          type="button"
          className={styles.mobileFilterBtn}
          onClick={() => setDrawerOpen(true)}
          aria-label="Open document type filters"
        >
          Filters
        </button>
      </div>

      {drawerOpen && <button type="button" className={styles.overlay} onClick={closeDrawer} aria-label="Close filters" />}

      <aside className={`${styles.sidebar} ${drawerOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.sidebarHeader}>
          <h3 className={styles.sidebarTitle}>Filter by Type</h3>
          <button type="button" className={styles.closeBtn} onClick={closeDrawer} aria-label="Close filter menu">
            Close
          </button>
        </div>
        <div className={styles.filters}>
          {TYPES.map((t) => (
            onTypeChange ? (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  onTypeChange(t.key);
                  closeDrawer();
                }}
                className={`${styles.filterBtn} ${activeType === t.key ? styles.active : ''}`}
              >
                {t.label}
              </button>
            ) : (
              <Link
                key={t.key}
                to={t.key === 'all' ? '/feed' : `/feed?type=${t.key}`}
                className={`${styles.filterBtn} ${activeType === t.key ? styles.active : ''}`}
                onClick={closeDrawer}
              >
                {t.label}
              </Link>
            )
          ))}
        </div>
      </aside>

      <main className={styles.main}>
        {children}
      </main>
    </div>
  );
}

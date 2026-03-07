import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import styles from './Header.module.css';

const navItems = [
  { path: '/', label: 'Overview' },
  { path: '/live', label: 'Live' },
  { path: '/chat', label: 'Chat' },
  { path: '/feed', label: 'Feed' },
  { path: '/graph', label: 'Graph' },
  { divider: true },
  { path: '/search', label: 'Search' },
  { path: '/activity?tab=searches', label: 'Activity' },
  { divider: true },
  { path: '/forum', label: 'Forum' },
] as const;

const toolsItems = [
  { path: '/scheduler', label: 'Scheduler' },
  { path: '/health', label: 'Health' },
  { path: '/heartbeat', label: 'Heartbeat' },
  { path: '/consult', label: 'Consult' },
  { path: '/decisions', label: 'Decisions' },
  { path: '/evolution', label: 'Evolution' },
  { path: '/traces', label: 'Traces' },
  { path: '/superseded', label: 'Superseded' },
  { path: '/handoff', label: 'Handoff' },
] as const;

interface SessionStats {
  searches: number;
  consultations: number;
  learnings: number;
  startTime: number;
}

export function Header() {
  const location = useLocation();
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sessionStartTime] = useState(() => {
    const stored = localStorage.getItem('jellycode_session_start')
      || localStorage.getItem('oracle_session_start');
    if (stored) return parseInt(stored, 10);
    const now = Date.now();
    localStorage.setItem('jellycode_session_start', String(now));
    return now;
  });

  useEffect(() => {
    void loadSessionStats();
    const interval = setInterval(() => void loadSessionStats(), 30000);
    return () => clearInterval(interval);
  }, [sessionStartTime]);

  useEffect(() => {
    setMobileMenuOpen(false);
    setToolsOpen(false);
  }, [location.pathname]);

  async function loadSessionStats() {
    try {
      const response = await fetch(`/api/session/stats?since=${sessionStartTime}`);
      if (!response.ok) return;
      const data = await response.json();
      setSessionStats({
        searches: data.searches,
        consultations: data.consultations,
        learnings: data.learnings,
        startTime: sessionStartTime,
      });
    } catch (error) {
      console.error('Failed to load session stats:', error);
      setSessionStats({
        searches: 0,
        consultations: 0,
        learnings: 0,
        startTime: sessionStartTime,
      });
    }
  }

  function formatDuration(ms: number): string {
    const minutes = Math.floor(ms / 60000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  }

  const duration = sessionStats
    ? formatDuration(Date.now() - sessionStats.startTime)
    : '0m';

  return (
    <header className={styles.header}>
      <div className={styles.brandRow}>
        <Link to="/" className={styles.logo}>
          Jellycode
          <span className={styles.version}>v{__APP_VERSION__}</span>
        </Link>
        <button
          type="button"
          className={styles.menuButton}
          onClick={() => setMobileMenuOpen((prev) => !prev)}
          aria-expanded={mobileMenuOpen}
          aria-label="Toggle navigation menu"
        >
          {mobileMenuOpen ? 'Close' : 'Menu'}
        </button>
      </div>

      <nav className={`${styles.nav} ${mobileMenuOpen ? styles.navOpen : ''}`}>
        {navItems.map((item, i) =>
          'divider' in item ? (
            <span key={i} className={styles.divider} />
          ) : (
            <Link
              key={item.path}
              to={item.path}
              className={`${styles.navLink} ${location.pathname === item.path.split('?')[0] ? styles.active : ''}`}
              onClick={() => setMobileMenuOpen(false)}
            >
              {item.label}
            </Link>
          ),
        )}
        <span className={styles.divider} />
        <div
          className={`${styles.dropdown} ${toolsOpen ? styles.dropdownOpen : ''}`}
          onMouseEnter={() => setToolsOpen(true)}
          onMouseLeave={() => setToolsOpen(false)}
        >
          <button
            type="button"
            className={`${styles.navLink} ${styles.dropdownTrigger} ${toolsItems.some((t) => location.pathname === t.path) ? styles.active : ''}`}
            onClick={() => setToolsOpen((prev) => !prev)}
            aria-expanded={toolsOpen}
          >
            Tools
          </button>
          {toolsOpen && (
            <div className={styles.dropdownMenu}>
              {toolsItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`${styles.dropdownItem} ${location.pathname === item.path ? styles.active : ''}`}
                  onClick={() => {
                    setToolsOpen(false);
                    setMobileMenuOpen(false);
                  }}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      </nav>

      <div className={styles.sessionStats}>
        <span className={styles.statItem}>Session: {duration}</span>
        <span className={styles.statItem}>{sessionStats?.searches || 0} searches</span>
        <span className={styles.statItem}>{sessionStats?.learnings || 0} learnings</span>
      </div>
    </header>
  );
}

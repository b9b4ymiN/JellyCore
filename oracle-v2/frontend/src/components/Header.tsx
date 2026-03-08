import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
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
  { path: '/admin', label: 'Admin' },
  { path: '/admin/memory', label: 'Memory' },
  { path: '/admin/logs', label: 'Logs' },
] as const;

interface SessionStats {
  searches: number;
  consultations: number;
  learnings: number;
  startTime: number;
}

export function Header() {
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
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

  function isPathActive(path: string): boolean {
    return location.pathname === path.split('?')[0];
  }

  function closeMenus() {
    setMobileMenuOpen(false);
    setToolsOpen(false);
  }

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
        <div className={styles.brandActions}>
          <button
            type="button"
            className={styles.themeButton}
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
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
      </div>

      {mobileMenuOpen && (
        <button
          type="button"
          className={styles.navOverlay}
          onClick={closeMenus}
          aria-label="Close navigation menu"
        />
      )}

      <nav className={`${styles.nav} ${mobileMenuOpen ? styles.navOpen : ''}`} aria-label="Primary">
        <div className={styles.navSection}>
          {navItems.map((item, i) => (
            'divider' in item ? (
              <span key={i} className={styles.divider} />
            ) : (
              <Link
                key={item.path}
                to={item.path}
                className={`${styles.navLink} ${isPathActive(item.path) ? styles.active : ''}`}
                onClick={closeMenus}
              >
                {item.label}
              </Link>
            )
          ))}
        </div>

        <div className={styles.mobileTools}>
          <p className={styles.sectionTitle}>Tools</p>
          <div className={styles.navSection}>
            {toolsItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`${styles.navLink} ${isPathActive(item.path) ? styles.active : ''}`}
                onClick={closeMenus}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
        <div className={styles.mobileStats}>
          <span className={styles.statItem}>Session: {duration}</span>
          <span className={styles.statItem}>{sessionStats?.searches || 0} searches</span>
          <span className={styles.statItem}>{sessionStats?.learnings || 0} learnings</span>
        </div>

        <div
          className={`${styles.dropdown} ${styles.desktopTools} ${toolsOpen ? styles.dropdownOpen : ''}`}
          onMouseEnter={() => setToolsOpen(true)}
          onMouseLeave={() => setToolsOpen(false)}
        >
          <button
            type="button"
            className={`${styles.navLink} ${styles.dropdownTrigger} ${toolsItems.some((t) => isPathActive(t.path)) ? styles.active : ''}`}
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
                  className={`${styles.dropdownItem} ${isPathActive(item.path) ? styles.active : ''}`}
                  onClick={closeMenus}
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

import { useState, useEffect, useCallback } from 'react';
import {
  getNanoClawStatus, getNanoClawHealth,
  getAdminToken, setAdminToken,
  type NanoClawStatus, type NanoClawHealth,
} from '../api/admin';
import styles from './Admin.module.css';

function LoginForm({ onLogin }: { onLogin: (token: string) => void }) {
  const [token, setToken] = useState('');
  return (
    <div className={styles.loginContainer}>
      <h2>🔐 Admin Login</h2>
      <p>Enter your ORACLE_AUTH_TOKEN to access the admin panel.</p>
      <form onSubmit={(e) => { e.preventDefault(); onLogin(token); }}>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Auth token..."
          className={styles.tokenInput}
        />
        <button type="submit" className={styles.loginBtn}>Login</button>
      </form>
    </div>
  );
}

export function Admin() {
  const [authed, setAuthed] = useState(!!getAdminToken());
  const [health, setHealth] = useState<NanoClawHealth | null>(null);
  const [status, setStatus] = useState<NanoClawStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [h, s] = await Promise.all([getNanoClawHealth(), getNanoClawStatus()]);
      setHealth(h);
      setStatus(s);
    } catch (err: any) {
      setError(err.message);
      if (err.message.includes('Unauthorized')) setAuthed(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authed) return;
    fetchData();
    const interval = setInterval(fetchData, 10000); // Auto-refresh 10s
    return () => clearInterval(interval);
  }, [authed, fetchData]);

  if (!authed) {
    return <LoginForm onLogin={(token) => { setAdminToken(token); setAuthed(true); }} />;
  }

  const uptime = status?.uptime ?? health?.uptime ?? 0;
  const uptimeStr = uptime > 86400
    ? `${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h`
    : uptime > 3600
      ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`
      : `${Math.floor(uptime / 60)}m`;

  const isUnreachable = health?.status === 'unreachable' || status?.status === 'unreachable';

  return (
    <div className={styles.container}>
      <h1>⚙️ NanoClaw Admin</h1>

      {error && <div className={styles.errorBanner}>{error}</div>}

      {loading ? (
        <p className={styles.loading}>Loading...</p>
      ) : (
        <>
          {/* Health Summary */}
          <div className={styles.grid}>
            <div className={`${styles.card} ${isUnreachable ? styles.cardError : styles.cardOk}`}>
              <div className={styles.cardLabel}>Status</div>
              <div className={styles.cardValue}>{isUnreachable ? '🔴 Unreachable' : '🟢 Online'}</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardLabel}>Uptime</div>
              <div className={styles.cardValue}>{uptimeStr}</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardLabel}>Version</div>
              <div className={styles.cardValue}>{health?.version || status?.version || '?'}</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardLabel}>Active Containers</div>
              <div className={styles.cardValue}>{status?.activeContainers ?? '?'}</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardLabel}>Queue Depth</div>
              <div className={styles.cardValue}>{status?.queueDepth ?? '?'}</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardLabel}>Max Containers</div>
              <div className={styles.cardValue}>{status?.resources?.currentMax ?? '?'}</div>
            </div>
          </div>

          {/* Resources */}
          {status?.resources && (
            <section className={styles.section}>
              <h2>Resources</h2>
              <div className={styles.grid}>
                <div className={styles.card}>
                  <div className={styles.cardLabel}>CPU Usage</div>
                  <div className={styles.cardValue}>
                    <span className={status.resources.cpuUsage > 80 ? styles.danger : ''}>
                      {status.resources.cpuUsage.toFixed(0)}%
                    </span>
                  </div>
                </div>
                <div className={styles.card}>
                  <div className={styles.cardLabel}>Free Memory</div>
                  <div className={styles.cardValue}>
                    <span className={status.resources.memoryFree < 20 ? styles.danger : ''}>
                      {status.resources.memoryFree.toFixed(0)}%
                    </span>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Registered Groups */}
          {status?.registeredGroups && status.registeredGroups.length > 0 && (
            <section className={styles.section}>
              <h2>Registered Groups ({status.registeredGroups.length})</h2>
              <div className={styles.tagList}>
                {status.registeredGroups.map((g, i) => (
                  <span key={i} className={styles.tag}>{g}</span>
                ))}
              </div>
            </section>
          )}

          {/* Recent Errors */}
          <section className={styles.section}>
            <h2>Recent Errors ({status?.recentErrors?.length ?? 0})</h2>
            {(status?.recentErrors?.length ?? 0) === 0 ? (
              <p className={styles.muted}>No recent errors 🎉</p>
            ) : (
              <div className={styles.errorList}>
                {status!.recentErrors.map((err, i) => (
                  <div key={i} className={styles.errorItem}>
                    <span className={styles.errorTime}>
                      {new Date(err.timestamp).toLocaleTimeString()}
                    </span>
                    {err.group && <span className={styles.errorGroup}>[{err.group}]</span>}
                    <span className={styles.errorMsg}>{err.message}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <button onClick={fetchData} className={styles.refreshBtn}>🔄 Refresh</button>
        </>
      )}
    </div>
  );
}

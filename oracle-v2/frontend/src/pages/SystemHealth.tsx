import { useCallback, useEffect, useState } from 'react';
import { getNanoClawHealth, getNanoClawStatus, type NanoClawStatus } from '../api/admin';
import { ResourceChart, type ResourcePoint } from '../components/ResourceChart';
import { ServiceCard } from '../components/ServiceCard';
import styles from './SystemHealth.module.css';

interface OracleHealthPayload {
  status?: string;
  server?: string;
  port?: string | number;
}

export function SystemHealth() {
  const [oracleHealth, setOracleHealth] = useState<OracleHealthPayload | null>(null);
  const [nanoclawStatus, setNanoclawStatus] = useState<NanoClawStatus | null>(null);
  const [lastCheckAt, setLastCheckAt] = useState<number | null>(null);
  const [resourcePoints, setResourcePoints] = useState<ResourcePoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [oracleRes, nanoHealth, nanoStatus] = await Promise.all([
        fetch('/api/health'),
        getNanoClawHealth(),
        getNanoClawStatus(),
      ]);

      const oracle = (await oracleRes.json()) as OracleHealthPayload;
      setOracleHealth(oracle);
      setNanoclawStatus(nanoStatus);
      setLastCheckAt(Date.now());

      if (nanoHealth.status === 'unreachable') {
        setError('NanoClaw unreachable. Check ORACLE_AUTH_TOKEN and service connectivity.');
      }

      if (nanoStatus.resources) {
        const point: ResourcePoint = {
          time: new Date().toLocaleTimeString(),
          cpu: Number(nanoStatus.resources.cpuUsage || 0),
          memory: Number(100 - Number(nanoStatus.resources.memoryFree || 0)),
        };
        setResourcePoints((prev) => [...prev, point].slice(-20));
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load health data');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
    }, 10_000);
    return () => clearInterval(timer);
  }, [load]);

  const dockerStatus = nanoclawStatus?.docker && typeof nanoclawStatus.docker === 'object'
    && 'healthy' in nanoclawStatus.docker
    ? (nanoclawStatus.docker.healthy ? 'healthy' : 'warn')
    : 'healthy';

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>System Health</h1>
        <div>
          Last check:{' '}
          {lastCheckAt ? new Date(lastCheckAt).toLocaleTimeString() : 'waiting'}
        </div>
      </header>

      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.grid}>
        <ServiceCard
          name="Oracle"
          status={oracleHealth?.status === 'ok' ? 'healthy' : 'warn'}
          detail={oracleHealth?.status || 'unknown'}
          port={oracleHealth?.port ? String(oracleHealth.port) : '47778'}
        />
        <ServiceCard
          name="NanoClaw"
          status={nanoclawStatus?.status === 'unreachable' ? 'error' : 'healthy'}
          detail={nanoclawStatus?.status === 'unreachable' ? 'unreachable' : 'healthy'}
          port="47779"
        />
        <ServiceCard
          name="Docker"
          status={dockerStatus}
          detail={dockerStatus === 'healthy' ? 'runtime healthy' : 'runtime has warnings'}
        />
        <ServiceCard
          name="Queue"
          status={(nanoclawStatus?.queueDepth || 0) > 5 ? 'warn' : 'healthy'}
          detail={`depth ${nanoclawStatus?.queueDepth ?? 0}`}
        />
      </section>

      <section className={styles.panel}>
        <h2>NanoClaw Status</h2>
        <div className={styles.kv}>
          <div>Active Containers: <strong>{nanoclawStatus?.activeContainers ?? '-'}</strong></div>
          <div>Queue Depth: <strong>{nanoclawStatus?.queueDepth ?? '-'}</strong></div>
          <div>Registered Groups: <strong>{nanoclawStatus?.registeredGroups?.length ?? '-'}</strong></div>
          <div>Uptime: <strong>{nanoclawStatus?.uptime ?? '-'}s</strong></div>
        </div>
      </section>

      <section className={styles.panel}>
        <h2>Resource Usage</h2>
        <ResourceChart points={resourcePoints} />
      </section>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import {
  getHeartbeatConfig,
  patchHeartbeatConfig,
  pingHeartbeat,
  type HeartbeatConfig,
} from '../api/heartbeat';
import { DurationPicker } from '../components/DurationPicker';
import { ToggleSwitch } from '../components/ToggleSwitch';
import styles from './HeartbeatConfigPage.module.css';

export function HeartbeatConfigPage() {
  const [config, setConfig] = useState<HeartbeatConfig | null>(null);
  const [draft, setDraft] = useState<HeartbeatConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await getHeartbeatConfig();
      setConfig(data);
      setDraft(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load heartbeat config');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || !draft) {
    return <div className={styles.container}>Loading heartbeat config...</div>;
  }

  async function save(): Promise<void> {
    if (!draft) return;
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      const res = await patchHeartbeatConfig(draft);
      setConfig(res.config);
      setDraft(res.config);
      setSuccess('Heartbeat config saved');
    } catch (err: any) {
      setError(err?.message || 'Failed to save config');
    } finally {
      setSaving(false);
    }
  }

  async function pingNow(): Promise<void> {
    try {
      setError(null);
      setSuccess(null);
      await pingHeartbeat();
      setSuccess('Heartbeat ping triggered');
    } catch (err: any) {
      setError(err?.message || 'Failed to trigger ping');
    }
  }

  const dirty = config ? JSON.stringify(config) !== JSON.stringify(draft) : false;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Heartbeat Configuration</h1>
      </header>

      {error && <div className={styles.error}>{error}</div>}
      {success && <div className={styles.success}>{success}</div>}

      <section className={styles.card}>
        <h2>Engine</h2>
        <div className={styles.row}>
          <ToggleSwitch
            checked={draft.enabled}
            onChange={(enabled) => setDraft((prev) => prev ? ({ ...prev, enabled }) : prev)}
            label="Heartbeat enabled"
            disabled={saving}
          />
          <ToggleSwitch
            checked={!draft.deliveryMuted}
            onChange={(on) => setDraft((prev) => prev ? ({ ...prev, deliveryMuted: !on }) : prev)}
            label="Delivery enabled"
            disabled={saving}
          />
        </div>
      </section>

      <section className={styles.card}>
        <h2>Timing</h2>
        <div className={styles.grid}>
          <label>
            Main interval
            <DurationPicker
              valueMs={draft.intervalMs}
              onChange={(intervalMs) => setDraft((prev) => prev ? ({ ...prev, intervalMs }) : prev)}
              disabled={saving}
            />
          </label>
          <label>
            Silence threshold
            <DurationPicker
              valueMs={draft.silenceThresholdMs}
              onChange={(silenceThresholdMs) => setDraft((prev) => prev ? ({ ...prev, silenceThresholdMs }) : prev)}
              disabled={saving}
            />
          </label>
          <label>
            Alert cooldown (minutes)
            <input
              type="number"
              min={0}
              value={Math.round(draft.alertRepeatCooldownMs / 60_000)}
              disabled={saving}
              onChange={(e) => {
                const min = Math.max(0, Number(e.target.value) || 0);
                setDraft((prev) => prev ? ({ ...prev, alertRepeatCooldownMs: min * 60_000 }) : prev);
              }}
            />
          </label>
        </div>
      </section>

      <section className={styles.card}>
        <h2>Alerts</h2>
        <div className={styles.row}>
          <ToggleSwitch
            checked={draft.showOk}
            onChange={(showOk) => setDraft((prev) => prev ? ({ ...prev, showOk }) : prev)}
            label="Show OK messages"
            disabled={saving}
          />
          <ToggleSwitch
            checked={draft.showAlerts}
            onChange={(showAlerts) => setDraft((prev) => prev ? ({ ...prev, showAlerts }) : prev)}
            label="Show alert messages"
            disabled={saving}
          />
          <ToggleSwitch
            checked={draft.useIndicator}
            onChange={(useIndicator) => setDraft((prev) => prev ? ({ ...prev, useIndicator }) : prev)}
            label="Use indicator prefix"
            disabled={saving}
          />
        </div>
        <div className={styles.grid}>
          <label>
            Escalate after errors
            <input
              type="number"
              min={1}
              value={draft.escalateAfterErrors}
              disabled={saving}
              onChange={(e) => {
                const escalateAfterErrors = Math.max(1, Number(e.target.value) || 1);
                setDraft((prev) => prev ? ({ ...prev, escalateAfterErrors }) : prev);
              }}
            />
          </label>
          <label>
            Ack max chars
            <input
              type="number"
              min={50}
              max={4000}
              value={draft.ackMaxChars}
              disabled={saving}
              onChange={(e) => {
                const ackMaxChars = Math.max(50, Math.min(4000, Number(e.target.value) || 50));
                setDraft((prev) => prev ? ({ ...prev, ackMaxChars }) : prev);
              }}
            />
          </label>
        </div>
      </section>

      <section className={styles.card}>
        <h2>Heartbeat Prompt</h2>
        <textarea
          value={draft.heartbeatPrompt}
          disabled={saving}
          onChange={(e) => setDraft((prev) => prev ? ({ ...prev, heartbeatPrompt: e.target.value }) : prev)}
          rows={8}
        />
      </section>

      <div className={styles.actions}>
        <button type="button" onClick={() => setDraft(config)} disabled={saving || !dirty}>
          Reset
        </button>
        <button type="button" onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        <button type="button" onClick={() => void pingNow()} disabled={saving}>
          Ping Now
        </button>
      </div>
    </div>
  );
}

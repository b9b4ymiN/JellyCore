import { beforeEach, describe, expect, it } from 'vitest';

import { getHeartbeatConfig, patchHeartbeatConfig } from './heartbeat-config.js';
import {
  parseHeartbeatOutput,
  shouldDeliverHeartbeatResult,
} from './heartbeat-reporter.js';

function resetHeartbeatConfig(): void {
  patchHeartbeatConfig({
    enabled: true,
    intervalMs: 3_600_000,
    silenceThresholdMs: 7_200_000,
    mainChatJid: 'main@g.us',
    escalateAfterErrors: 3,
    showOk: false,
    showAlerts: true,
    useIndicator: true,
    deliveryMuted: false,
    alertRepeatCooldownMs: 3_600_000,
    heartbeatPrompt: 'HEARTBEAT',
    ackMaxChars: 220,
  });
}

describe('parseHeartbeatOutput', () => {
  it('returns ok=true for exact HEARTBEAT_OK token', () => {
    const parsed = parseHeartbeatOutput('  HEARTBEAT_OK  ', 220);
    expect(parsed.ok).toBe(true);
    expect(parsed.summary).toBe('HEARTBEAT_OK');
  });

  it('returns ok=false for alert text', () => {
    const parsed = parseHeartbeatOutput('ALERT: Oracle unreachable', 220);
    expect(parsed.ok).toBe(false);
    expect(parsed.summary).toContain('Oracle unreachable');
  });

  it('truncates long alert text based on ackMaxChars', () => {
    const longText = `ALERT: ${'x'.repeat(500)}`;
    const parsed = parseHeartbeatOutput(longText, 120);
    expect(parsed.ok).toBe(false);
    expect(parsed.summary.length).toBeLessThanOrEqual(123); // includes "..."
  });
});

describe('shouldDeliverHeartbeatResult', () => {
  it('follows showOk for healthy heartbeat', () => {
    expect(
      shouldDeliverHeartbeatResult(
        { ok: true, summary: 'HEARTBEAT_OK' },
        { showOk: true, showAlerts: true, deliveryMuted: false },
      ),
    ).toBe(true);

    expect(
      shouldDeliverHeartbeatResult(
        { ok: true, summary: 'HEARTBEAT_OK' },
        { showOk: false, showAlerts: true, deliveryMuted: false },
      ),
    ).toBe(false);
  });

  it('follows showAlerts for alert heartbeat', () => {
    expect(
      shouldDeliverHeartbeatResult(
        { ok: false, summary: 'Oracle unreachable' },
        { showOk: true, showAlerts: true, deliveryMuted: false },
      ),
    ).toBe(true);

    expect(
      shouldDeliverHeartbeatResult(
        { ok: false, summary: 'Oracle unreachable' },
        { showOk: true, showAlerts: false, deliveryMuted: false },
      ),
    ).toBe(false);
  });

  it('always suppresses delivery when muted', () => {
    expect(
      shouldDeliverHeartbeatResult(
        { ok: true, summary: 'HEARTBEAT_OK' },
        { showOk: true, showAlerts: true, deliveryMuted: true },
      ),
    ).toBe(false);
    expect(
      shouldDeliverHeartbeatResult(
        { ok: false, summary: 'alert' },
        { showOk: true, showAlerts: true, deliveryMuted: true },
      ),
    ).toBe(false);
  });
});

describe('patchHeartbeatConfig validation', () => {
  beforeEach(() => {
    resetHeartbeatConfig();
  });

  it('ignores invalid interval values', () => {
    const before = getHeartbeatConfig().intervalMs;
    patchHeartbeatConfig({ intervalMs: 0 });
    expect(getHeartbeatConfig().intervalMs).toBe(before);
  });

  it('clamps ackMaxChars to upper bound', () => {
    patchHeartbeatConfig({ ackMaxChars: 99999 });
    expect(getHeartbeatConfig().ackMaxChars).toBe(4000);
  });
});

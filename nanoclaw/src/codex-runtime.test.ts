import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execSyncMock } = vi.hoisted(() => ({
  execSyncMock: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: execSyncMock,
}));

vi.mock('./config.js', () => ({
  CONTAINER_IMAGE: 'nanoclaw-agent:latest',
}));

import {
  classifyCodexFailure,
  codexFallbackMessage,
  evaluateCodexRuntimeStatus,
} from './codex-runtime.js';

describe('codex runtime status', () => {
  beforeEach(() => {
    execSyncMock.mockReset();
  });

  it('returns image_not_found when image inspect fails', () => {
    execSyncMock.mockImplementation(() => {
      throw new Error('No such image: nanoclaw-agent:latest');
    });

    const status = evaluateCodexRuntimeStatus({ force: true });
    expect(status.ready).toBe(false);
    expect(status.reason).toBe('image_not_found');
  });

  it('returns blocked when skip-git flag probe fails', () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith('docker image inspect')) {
        return JSON.stringify([
          {
            Id: 'sha256:test',
            Created: '2026-03-03T00:00:00Z',
            Config: { Labels: { 'org.opencontainers.image.revision': 'abc123' } },
          },
        ]);
      }
      if (cmd.startsWith('git rev-parse')) return 'abc123';
      if (cmd.includes('--skip-git-repo-check')) throw new Error('grep failed');
      return '';
    });

    const status = evaluateCodexRuntimeStatus({ force: true });
    expect(status.ready).toBe(false);
    expect(status.reason).toBe('runner_missing_skip_git_repo_check');
  });

  it('returns ready when probes pass', () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith('docker image inspect')) {
        return JSON.stringify([
          {
            Id: 'sha256:test',
            Created: '2026-03-03T00:00:00Z',
            Config: { Labels: { 'org.opencontainers.image.revision': 'abc123' } },
          },
        ]);
      }
      if (cmd.startsWith('git rev-parse')) return 'abc123';
      if (cmd.startsWith('docker run')) return '';
      return '';
    });

    const status = evaluateCodexRuntimeStatus({ force: true });
    expect(status.ready).toBe(true);
    expect(status.reason).toBeUndefined();
    expect(status.imageRevision).toBe('abc123');
  });
});

describe('codex failure classifier', () => {
  it('maps auth blocked', () => {
    expect(classifyCodexFailure('codex_auth_blocked:missing_auth_file')).toBe('codex_auth_blocked');
  });

  it('maps trust blocked', () => {
    expect(classifyCodexFailure('Not inside a trusted directory')).toBe('codex_repo_trust_blocked');
  });

  it('maps parse failure', () => {
    expect(classifyCodexFailure('codex_output_parse_error:empty_json_stream')).toBe('codex_output_parse_error');
  });

  it('returns actionable fallback messages', () => {
    expect(codexFallbackMessage('codex_repo_trust_blocked')).toContain('codex_repo_trust_blocked');
    expect(codexFallbackMessage('codex_runtime_unavailable')).toContain('codex_runtime_unavailable');
  });
});

import fs from 'fs';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GROUPS_DIR } from './config.js';
import {
  buildTelegramOutboundPayloadFromGroupFile,
  cleanupTelegramMediaFiles,
  parseTelegramMediaDirectives,
  resolveGroupRelativePath,
} from './telegram-media.js';
import { getTelegramMediaConfig, patchTelegramMediaConfig } from './telegram-media-config.js';

describe('telegram-media helpers', () => {
  const original = getTelegramMediaConfig();
  const groupFolder = 'tg-media-test';
  const groupDir = path.join(GROUPS_DIR, groupFolder);
  const mediaDir = path.join(groupDir, '.tgmedia-cache');

  beforeEach(() => {
    fs.mkdirSync(groupDir, { recursive: true });
    patchTelegramMediaConfig({
      enabled: true,
      downloadEnabled: true,
      maxDownloadBytes: 1024 * 1024,
      maxSendBytes: 1024 * 1024,
      mediaDir,
    });
  });

  afterEach(() => {
    patchTelegramMediaConfig(original);
    fs.rmSync(groupDir, { recursive: true, force: true });
  });

  it('parses valid tg-media directives and strips them from text', () => {
    const input = [
      'hello',
      '<tg-media>{"kind":"document","path":"notes/a.txt","caption":"A"}</tg-media>',
      'world',
    ].join('\n');
    const parsed = parseTelegramMediaDirectives(input);
    expect(parsed.cleanText).toContain('hello');
    expect(parsed.cleanText).toContain('world');
    expect(parsed.directives).toHaveLength(1);
    expect(parsed.directives[0].kind).toBe('document');
    expect(parsed.directives[0].path).toBe('notes/a.txt');
    expect(parsed.errors).toHaveLength(0);
  });

  it('collects errors for invalid tg-media JSON', () => {
    const parsed = parseTelegramMediaDirectives('<tg-media>not-json</tg-media>');
    expect(parsed.directives).toHaveLength(0);
    expect(parsed.errors.length).toBeGreaterThan(0);
  });

  it('blocks path traversal outside group workspace', () => {
    const resolved = resolveGroupRelativePath(groupFolder, '../secret.txt');
    expect(resolved.ok).toBe(false);
  });

  it('builds document payload from a valid group-relative file', () => {
    const filePath = path.join(groupDir, 'notes', 'report.txt');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'ok');

    const result = buildTelegramOutboundPayloadFromGroupFile(
      groupFolder,
      'document',
      'notes/report.txt',
      'report',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.kind).toBe('document');
      if (result.payload.kind === 'document') {
        expect(result.payload.filePath).toBe(filePath);
      }
    }
  });

  it('rejects photo payload when extension is not image-like', () => {
    const filePath = path.join(groupDir, 'docs', 'report.txt');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'text');

    const result = buildTelegramOutboundPayloadFromGroupFile(
      groupFolder,
      'photo',
      'docs/report.txt',
    );
    expect(result.ok).toBe(false);
  });

  it('cleans old media files by age', () => {
    fs.mkdirSync(mediaDir, { recursive: true });
    const oldFile = path.join(mediaDir, 'old.bin');
    const newFile = path.join(mediaDir, 'new.bin');
    fs.writeFileSync(oldFile, Buffer.alloc(10));
    fs.writeFileSync(newFile, Buffer.alloc(10));

    const oldTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldFile, oldTime, oldTime);

    const result = cleanupTelegramMediaFiles(7);
    expect(result.deleted).toBe(1);
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(newFile)).toBe(true);
  });
});

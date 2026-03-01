import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from './config.js';
import { getTelegramMediaConfig } from './telegram-media-config.js';
import type { OutboundPayload } from './types.js';

export type TelegramMediaKind = 'photo' | 'document';

export interface TelegramMediaDirective {
  kind: TelegramMediaKind;
  path: string;
  caption?: string;
}

export interface ParseDirectiveResult {
  cleanText: string;
  directives: TelegramMediaDirective[];
  errors: string[];
}

const TG_MEDIA_TAG_REGEX = /<tg-media>([\s\S]*?)<\/tg-media>/gi;
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function sanitizeCaption(input?: string): string | undefined {
  const text = (input || '').trim();
  return text ? text.slice(0, 1024) : undefined;
}

export function parseTelegramMediaDirectives(text: string): ParseDirectiveResult {
  const directives: TelegramMediaDirective[] = [];
  const errors: string[] = [];

  const cleanText = text.replace(TG_MEDIA_TAG_REGEX, (_full, inner: string) => {
    try {
      const parsed = JSON.parse(inner.trim()) as {
        kind?: string;
        path?: string;
        file?: string;
        caption?: string;
      };
      const kind = parsed.kind?.toLowerCase();
      const relPath = (parsed.path || parsed.file || '').trim();
      if (kind !== 'photo' && kind !== 'document') {
        errors.push('Invalid tg-media kind (use photo|document).');
        return '';
      }
      if (!relPath) {
        errors.push('Invalid tg-media path (missing path).');
        return '';
      }
      directives.push({
        kind,
        path: relPath,
        caption: sanitizeCaption(parsed.caption),
      });
      return '';
    } catch {
      errors.push('Invalid tg-media JSON payload.');
      return '';
    }
  });

  return {
    cleanText: cleanText.trim(),
    directives,
    errors,
  };
}

export function resolveGroupRelativePath(
  groupFolder: string,
  relativePath: string,
): { ok: true; absPath: string } | { ok: false; error: string } {
  const trimmed = relativePath.trim();
  if (!trimmed) return { ok: false, error: 'Path is required.' };

  if (path.isAbsolute(trimmed)) {
    return { ok: false, error: 'Absolute paths are not allowed.' };
  }

  const normalizedRel = path.normalize(trimmed);
  if (normalizedRel.startsWith('..') || normalizedRel.includes(`..${path.sep}`)) {
    return { ok: false, error: 'Path traversal is not allowed.' };
  }

  const groupRoot = path.resolve(GROUPS_DIR, groupFolder);
  const absPath = path.resolve(groupRoot, normalizedRel);
  const relToRoot = path.relative(groupRoot, absPath);
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
    return { ok: false, error: 'Path escapes group workspace.' };
  }

  return { ok: true, absPath };
}

export function buildTelegramOutboundPayloadFromGroupFile(
  groupFolder: string,
  kind: TelegramMediaKind,
  relativePath: string,
  caption?: string,
):
  | { ok: true; payload: OutboundPayload }
  | { ok: false; error: string } {
  const cfg = getTelegramMediaConfig();
  if (!cfg.enabled) {
    return { ok: false, error: 'Telegram media is disabled.' };
  }

  const resolved = resolveGroupRelativePath(groupFolder, relativePath);
  if (!resolved.ok) return resolved;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved.absPath);
  } catch {
    return { ok: false, error: 'File not found.' };
  }
  if (!stat.isFile()) {
    return { ok: false, error: 'Target path is not a file.' };
  }
  if (stat.size > cfg.maxSendBytes) {
    return {
      ok: false,
      error: `File is too large (${stat.size} bytes > ${cfg.maxSendBytes} bytes).`,
    };
  }

  const normalizedCaption = sanitizeCaption(caption);
  if (kind === 'photo') {
    const ext = path.extname(resolved.absPath).toLowerCase();
    if (ext && !IMAGE_EXTENSIONS.has(ext)) {
      return { ok: false, error: 'Photo command requires an image file extension.' };
    }
    return {
      ok: true,
      payload: {
        kind: 'photo',
        filePath: resolved.absPath,
        caption: normalizedCaption,
      },
    };
  }

  return {
    ok: true,
    payload: {
      kind: 'document',
      filePath: resolved.absPath,
      caption: normalizedCaption,
      fileName: path.basename(resolved.absPath),
    },
  };
}

export function cleanupTelegramMediaFiles(days: number): {
  deleted: number;
  kept: number;
  bytesFreed: number;
  dir: string;
} {
  const cfg = getTelegramMediaConfig();
  const cutoffMs = Date.now() - Math.max(0, days) * 24 * 60 * 60 * 1000;
  const dir = cfg.mediaDir;

  if (!fs.existsSync(dir)) {
    return { deleted: 0, kept: 0, bytesFreed: 0, dir };
  }

  let deleted = 0;
  let kept = 0;
  let bytesFreed = 0;
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (stat.mtimeMs <= cutoffMs) {
      try {
        fs.unlinkSync(fullPath);
        deleted += 1;
        bytesFreed += stat.size;
      } catch {
        kept += 1;
      }
    } else {
      kept += 1;
    }
  }

  return { deleted, kept, bytesFreed, dir };
}

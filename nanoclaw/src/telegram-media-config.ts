import {
  TELEGRAM_MEDIA_DIR,
  TELEGRAM_MEDIA_DOWNLOAD_ENABLED,
  TELEGRAM_MEDIA_ENABLED,
  TELEGRAM_MEDIA_MAX_BYTES,
  TELEGRAM_MEDIA_SEND_MAX_BYTES,
} from './config.js';

export interface TelegramMediaRuntimeConfig {
  enabled: boolean;
  downloadEnabled: boolean;
  maxDownloadBytes: number;
  maxSendBytes: number;
  mediaDir: string;
}

let runtimeConfig: TelegramMediaRuntimeConfig = {
  enabled: TELEGRAM_MEDIA_ENABLED,
  downloadEnabled: TELEGRAM_MEDIA_DOWNLOAD_ENABLED,
  maxDownloadBytes: TELEGRAM_MEDIA_MAX_BYTES,
  maxSendBytes: TELEGRAM_MEDIA_SEND_MAX_BYTES,
  mediaDir: TELEGRAM_MEDIA_DIR,
};

export function getTelegramMediaConfig(): TelegramMediaRuntimeConfig {
  return { ...runtimeConfig };
}

export function patchTelegramMediaConfig(
  patch: Partial<TelegramMediaRuntimeConfig>,
): TelegramMediaRuntimeConfig {
  const next = { ...runtimeConfig, ...patch };
  if (next.maxDownloadBytes <= 0) throw new Error('maxDownloadBytes must be > 0');
  if (next.maxSendBytes <= 0) throw new Error('maxSendBytes must be > 0');
  if (!next.mediaDir?.trim()) throw new Error('mediaDir cannot be empty');
  runtimeConfig = {
    enabled: Boolean(next.enabled),
    downloadEnabled: Boolean(next.downloadEnabled),
    maxDownloadBytes: Math.round(next.maxDownloadBytes),
    maxSendBytes: Math.round(next.maxSendBytes),
    mediaDir: next.mediaDir,
  };
  return getTelegramMediaConfig();
}

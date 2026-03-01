/**
 * Telegram Channel - grammY long-polling bot
 *
 * JID format: tg:{chatId}
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { Bot, Context, InputFile } from 'grammy';

import { messageBus } from '../message-bus.js';
import { logger } from '../logger.js';
import { getTelegramMediaConfig } from '../telegram-media-config.js';
import {
  Channel,
  MessageAttachment,
  OnChatMetadata,
  OnInboundMessage,
  OutboundPayload,
  RegisteredGroup,
} from '../types.js';
import { toTelegramMarkdownV2, stripMarkdown } from './telegram-format.js';

const TG_MAX_MSG_LENGTH = 4096;
const TG_DOWNLOAD_BASE_URL = 'https://api.telegram.org/file/bot';

export interface TelegramChannelOpts {
  token: string;
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
  /** Called when a new Telegram chat sends first message and is not registered yet */
  onAutoRegister?: (jid: string, chatName: string) => void;
}

export class TelegramChannel implements Channel {
  name = 'telegram';
  prefixAssistantName = false;

  private bot: Bot;
  private connected = false;
  private opts: TelegramChannelOpts;
  private pollingHealthTimer?: ReturnType<typeof setInterval>;
  private lastUpdateTime = Date.now();

  constructor(opts: TelegramChannelOpts) {
    this.opts = opts;
    this.bot = new Bot(opts.token);
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.bot.on('message', async (ctx: Context) => {
      const msg = (ctx.message || null) as any;
      if (!msg) return;

      const chatId = msg.chat?.id;
      if (chatId === undefined || chatId === null) return;

      const jid = `tg:${chatId}`;
      const timestamp = new Date(Number(msg.date || Date.now() / 1000) * 1000).toISOString();

      const chatName =
        msg.chat?.type === 'group' || msg.chat?.type === 'supergroup'
          ? msg.chat?.title || `TG Group ${chatId}`
          : msg.from?.first_name || `TG User ${chatId}`;

      this.opts.onChatMetadata(jid, timestamp, chatName);

      const groups = this.opts.registeredGroups();
      if (!groups[jid] && this.opts.onAutoRegister) {
        this.opts.onAutoRegister(jid, chatName);
      }

      const sender = msg.from ? `tg:${msg.from.id}` : `tg:${chatId}`;
      const senderName = msg.from
        ? msg.from.first_name + (msg.from.last_name ? ` ${msg.from.last_name}` : '')
        : 'Unknown';
      const isFromMe = msg.from?.id === this.bot.botInfo?.id;

      let attachments: MessageAttachment[] = [];
      try {
        attachments = await this.extractAttachments(msg);
      } catch (err) {
        logger.warn({ err, jid, messageId: msg.message_id }, 'Failed to extract Telegram attachments');
      }

      const content = this.extractContentText(msg, attachments);
      const message = {
        id: String(msg.message_id),
        chat_jid: jid,
        sender,
        sender_name: senderName,
        content,
        timestamp,
        is_from_me: isFromMe,
        attachments: attachments.length > 0 ? attachments : undefined,
      };
      this.opts.onMessage(jid, message);

      if (!isFromMe && (content || attachments.length > 0)) {
        messageBus.emitMessage({
          chatJid: jid,
          text: content,
          sender: senderName,
          timestamp: Number(msg.date || Date.now() / 1000),
          messageId: String(msg.message_id),
          attachments: attachments.length > 0 ? attachments : undefined,
        });
      }
    });

    this.bot.catch((err) => {
      logger.error({ err: err.error, ctx: err.ctx?.update?.update_id }, 'Telegram bot error');
    });
  }

  async connect(): Promise<void> {
    await this.bot.init();
    logger.info(
      { username: this.bot.botInfo?.username, id: this.bot.botInfo?.id },
      'Telegram bot initialized',
    );

    try {
      const { TELEGRAM_COMMANDS } = await import('../inline-handler.js');
      const commands = this.sanitizeTelegramCommands(TELEGRAM_COMMANDS);
      await this.bot.api.setMyCommands(commands);
      logger.info(
        { count: commands.length, dropped: TELEGRAM_COMMANDS.length - commands.length },
        'Telegram commands registered',
      );
    } catch (err) {
      logger.warn({ err }, 'Failed to register Telegram commands');
    }

    this.bot.start({
      onStart: () => {
        this.connected = true;
        this.lastUpdateTime = Date.now();
        logger.info('Telegram bot polling started');
      },
      drop_pending_updates: true,
    });

    this.pollingHealthTimer = setInterval(async () => {
      try {
        await this.bot.api.getMe();
        this.lastUpdateTime = Date.now();
        if (!this.connected) {
          this.connected = true;
          logger.info('Telegram bot reconnected successfully');
        }
      } catch (err) {
        const silentMs = Date.now() - this.lastUpdateTime;
        logger.warn({ err, silentMs }, 'Telegram health check failed');
        if (silentMs > 120_000) {
          logger.error('Telegram bot appears dead, attempting auto-reconnect...');
          this.connected = false;
          try {
            await this.bot.stop();
          } catch {
            // ignore stop errors
          }

          this.bot = new Bot(this.opts.token);
          this.setupHandlers();
          await this.bot.init();
          this.bot.start({
            onStart: () => {
              this.connected = true;
              this.lastUpdateTime = Date.now();
              logger.info('Telegram bot polling restarted after auto-reconnect');
            },
            drop_pending_updates: false,
          });
        }
      }
    }, 60_000);
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const chatId = this.extractChatId(jid);
    if (!chatId) {
      logger.warn({ jid }, 'Invalid Telegram JID');
      return;
    }

    const rawChunks = this.splitMessage(text);
    for (const raw of rawChunks) {
      let sent = false;

      try {
        const formatted = toTelegramMarkdownV2(raw);
        await this.bot.api.sendMessage(chatId, formatted, { parse_mode: 'MarkdownV2' });
        sent = true;
      } catch (err: any) {
        const errMsg = err?.message || err?.description || '';
        if (errMsg.includes("can't parse") || errMsg.includes('Bad Request')) {
          logger.warn({ jid }, 'MarkdownV2 parse failed, falling back to plain text');
        } else {
          logger.error({ jid, err }, 'Failed to send Telegram message');
          throw err;
        }
      }

      if (!sent) {
        const plain = stripMarkdown(raw);
        await this.bot.api.sendMessage(chatId, plain);
      }
    }
  }

  async sendPayload(jid: string, payload: OutboundPayload): Promise<void> {
    const chatId = this.extractChatId(jid);
    if (!chatId) {
      throw new Error(`Invalid Telegram JID: ${jid}`);
    }

    if (payload.kind === 'text') {
      await this.sendMessage(jid, payload.text);
      return;
    }

    const cfg = getTelegramMediaConfig();
    if (!cfg.enabled) {
      throw new Error('Telegram media is disabled.');
    }

    if (!fs.existsSync(payload.filePath)) {
      throw new Error(`Media file not found: ${payload.filePath}`);
    }
    const stat = fs.statSync(payload.filePath);
    if (!stat.isFile()) {
      throw new Error(`Media path is not a file: ${payload.filePath}`);
    }
    if (stat.size > cfg.maxSendBytes) {
      throw new Error(`Media file exceeds max size (${stat.size} > ${cfg.maxSendBytes})`);
    }

    const file = new InputFile(payload.filePath);
    if (payload.kind === 'photo') {
      await this.bot.api.sendPhoto(chatId, file, {
        caption: payload.caption,
      });
      return;
    }

    await this.bot.api.sendDocument(chatId, file, {
      caption: payload.caption,
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('tg:');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.pollingHealthTimer) {
      clearInterval(this.pollingHealthTimer);
      this.pollingHealthTimer = undefined;
    }
    await this.bot.stop();
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!isTyping) return;
    const chatId = this.extractChatId(jid);
    if (!chatId) return;
    try {
      await this.bot.api.sendChatAction(chatId, 'typing');
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send typing indicator');
    }
  }

  private extractChatId(jid: string): number | null {
    const match = jid.match(/^tg:(-?\d+)$/);
    return match ? Number(match[1]) : null;
  }

  private splitMessage(text: string): string[] {
    if (text.length <= TG_MAX_MSG_LENGTH) return [text];

    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= TG_MAX_MSG_LENGTH) {
        chunks.push(remaining);
        break;
      }

      let splitAt = remaining.lastIndexOf('\n', TG_MAX_MSG_LENGTH);
      if (splitAt < TG_MAX_MSG_LENGTH * 0.5) {
        splitAt = remaining.lastIndexOf(' ', TG_MAX_MSG_LENGTH);
      }
      if (splitAt < TG_MAX_MSG_LENGTH * 0.3) {
        splitAt = TG_MAX_MSG_LENGTH;
      }
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }
    return chunks;
  }

  private sanitizeTelegramCommands(
    commands: Array<{ command: string; description: string }>,
  ): Array<{ command: string; description: string }> {
    const seen = new Set<string>();
    const out: Array<{ command: string; description: string }> = [];

    for (const item of commands) {
      const command = (item.command || '').trim().toLowerCase();
      const description = (item.description || '').trim();
      if (!/^[a-z0-9_]{1,32}$/.test(command)) continue;
      if (!description) continue;
      if (seen.has(command)) continue;
      seen.add(command);
      out.push({ command, description: description.slice(0, 256) });
    }
    return out;
  }

  private extractContentText(msg: any, attachments: MessageAttachment[]): string {
    const text = (msg.text || msg.caption || '').trim();
    if (text) return text;

    if (msg.photo || attachments.some((a) => a.kind === 'photo')) return '[Photo]';
    if (msg.document || attachments.some((a) => a.kind === 'document')) {
      const document = msg.document || attachments.find((a) => a.kind === 'document');
      const name = document?.file_name || document?.fileName || 'unnamed';
      return `[Document: ${name}]`;
    }
    if (msg.video || attachments.some((a) => a.kind === 'video')) return '[Video]';
    if (msg.voice || attachments.some((a) => a.kind === 'voice')) return '[Voice]';
    if (msg.audio || attachments.some((a) => a.kind === 'audio')) return '[Audio]';

    return '';
  }

  private async extractAttachments(msg: any): Promise<MessageAttachment[]> {
    const out: MessageAttachment[] = [];
    const caption = (msg.caption || '').trim() || null;

    if (Array.isArray(msg.photo) && msg.photo.length > 0) {
      const photo = [...msg.photo].sort((a, b) => (b.file_size || 0) - (a.file_size || 0))[0];
      const local = await this.maybeDownloadFile(
        photo.file_id,
        `photo_${msg.message_id}.jpg`,
        photo.file_size,
      );
      out.push({
        id: `photo:${photo.file_unique_id || photo.file_id}`,
        kind: 'photo',
        mimeType: 'image/jpeg',
        fileName: `photo_${msg.message_id}.jpg`,
        fileSize: photo.file_size || null,
        telegramFileId: photo.file_id,
        telegramFileUniqueId: photo.file_unique_id || null,
        caption,
        width: photo.width || null,
        height: photo.height || null,
        localPath: local,
      });
    }

    if (msg.document?.file_id) {
      const document = msg.document;
      const fileName = document.file_name || `document_${msg.message_id}`;
      const local = await this.maybeDownloadFile(
        document.file_id,
        fileName,
        document.file_size,
      );
      out.push({
        id: `document:${document.file_unique_id || document.file_id}`,
        kind: 'document',
        mimeType: document.mime_type || null,
        fileName,
        fileSize: document.file_size || null,
        telegramFileId: document.file_id,
        telegramFileUniqueId: document.file_unique_id || null,
        caption,
        localPath: local,
      });
    }

    if (msg.video?.file_id) {
      const video = msg.video;
      const local = await this.maybeDownloadFile(
        video.file_id,
        `video_${msg.message_id}.mp4`,
        video.file_size,
      );
      out.push({
        id: `video:${video.file_unique_id || video.file_id}`,
        kind: 'video',
        mimeType: video.mime_type || 'video/mp4',
        fileName: `video_${msg.message_id}.mp4`,
        fileSize: video.file_size || null,
        telegramFileId: video.file_id,
        telegramFileUniqueId: video.file_unique_id || null,
        caption,
        width: video.width || null,
        height: video.height || null,
        durationSec: video.duration || null,
        localPath: local,
      });
    }

    if (msg.voice?.file_id) {
      const voice = msg.voice;
      const local = await this.maybeDownloadFile(
        voice.file_id,
        `voice_${msg.message_id}.ogg`,
        voice.file_size,
      );
      out.push({
        id: `voice:${voice.file_unique_id || voice.file_id}`,
        kind: 'voice',
        mimeType: voice.mime_type || 'audio/ogg',
        fileName: `voice_${msg.message_id}.ogg`,
        fileSize: voice.file_size || null,
        telegramFileId: voice.file_id,
        telegramFileUniqueId: voice.file_unique_id || null,
        durationSec: voice.duration || null,
        localPath: local,
      });
    }

    if (msg.audio?.file_id) {
      const audio = msg.audio;
      const ext = (audio.file_name && path.extname(audio.file_name)) || '.mp3';
      const fileName = audio.file_name || `audio_${msg.message_id}${ext}`;
      const local = await this.maybeDownloadFile(audio.file_id, fileName, audio.file_size);
      out.push({
        id: `audio:${audio.file_unique_id || audio.file_id}`,
        kind: 'audio',
        mimeType: audio.mime_type || null,
        fileName,
        fileSize: audio.file_size || null,
        telegramFileId: audio.file_id,
        telegramFileUniqueId: audio.file_unique_id || null,
        durationSec: audio.duration || null,
        localPath: local,
      });
    }

    return out;
  }

  private async maybeDownloadFile(
    fileId: string,
    fileName: string,
    fileSize?: number,
  ): Promise<string | null> {
    const cfg = getTelegramMediaConfig();
    if (!cfg.enabled || !cfg.downloadEnabled) return null;
    if (fileSize && fileSize > cfg.maxDownloadBytes) {
      logger.info({ fileId, fileSize, max: cfg.maxDownloadBytes }, 'Skipping Telegram media download (too large)');
      return null;
    }

    try {
      fs.mkdirSync(cfg.mediaDir, { recursive: true });
      const file = await this.bot.api.getFile(fileId);
      const filePath = (file as any)?.file_path as string | undefined;
      if (!filePath) return null;

      const ext = path.extname(fileName);
      const base = path.basename(fileName, ext).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
      const hash = crypto.createHash('sha1').update(fileId).digest('hex').slice(0, 10);
      const localName = `${Date.now()}_${base || 'file'}_${hash}${ext || ''}`;
      const targetPath = path.join(cfg.mediaDir, localName);

      const res = await fetch(`${TG_DOWNLOAD_BASE_URL}${this.opts.token}/${filePath}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > cfg.maxDownloadBytes) {
        logger.info({ fileId, bytes: buf.length, max: cfg.maxDownloadBytes }, 'Downloaded Telegram media exceeds configured limit');
        return null;
      }
      fs.writeFileSync(targetPath, buf);
      return targetPath;
    } catch (err) {
      logger.warn({ err, fileId }, 'Telegram media download failed');
      return null;
    }
  }
}

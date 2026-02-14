/**
 * Telegram Channel — grammY long-polling bot
 *
 * JID format:  tg:{chatId}       e.g. tg:123456789 (personal), tg:-100123456 (group)
 * ownsJid:     jid.startsWith('tg:')
 *
 * Telegram bots already show their name, so prefixAssistantName = false.
 * Messages longer than 4096 chars are split automatically.
 */

import { Bot, Context } from 'grammy';

import { messageBus } from '../message-bus.js';
import { logger } from '../logger.js';
import { Channel, OnInboundMessage, OnChatMetadata, RegisteredGroup } from '../types.js';
import { toTelegramMarkdownV2, stripMarkdown } from './telegram-format.js';

const TG_MAX_MSG_LENGTH = 4096;

export interface TelegramChannelOpts {
  token: string;
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
  /** Called when a new Telegram chat sends its first message and isn't registered yet */
  onAutoRegister?: (jid: string, chatName: string) => void;
}

export class TelegramChannel implements Channel {
  name = 'telegram';
  prefixAssistantName = false;

  private bot: Bot;
  private connected = false;
  private opts: TelegramChannelOpts;

  constructor(opts: TelegramChannelOpts) {
    this.opts = opts;
    this.bot = new Bot(opts.token);
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Handle all text messages (private + group)
    this.bot.on('message:text', async (ctx: Context) => {
      const msg = ctx.message!;
      const chatId = msg.chat.id;
      const jid = `tg:${chatId}`;
      const timestamp = new Date(msg.date * 1000).toISOString();

      // Chat name: group title or user first name
      const chatName =
        msg.chat.type === 'group' || msg.chat.type === 'supergroup'
          ? (msg.chat as any).title || `TG Group ${chatId}`
          : msg.from?.first_name || `TG User ${chatId}`;

      // Always notify metadata for group discovery
      this.opts.onChatMetadata(jid, timestamp, chatName);

      // Auto-register this chat if not yet registered (Telegram convenience)
      const groups = this.opts.registeredGroups();
      if (!groups[jid] && this.opts.onAutoRegister) {
        this.opts.onAutoRegister(jid, chatName);
      }

      // Sender info
      const sender = msg.from
        ? `tg:${msg.from.id}`
        : `tg:${chatId}`;
      const senderName = msg.from
        ? msg.from.first_name + (msg.from.last_name ? ` ${msg.from.last_name}` : '')
        : 'Unknown';

      const content = msg.text || '';
      const isFromMe = msg.from?.id === this.bot.botInfo?.id;

      // Deliver message
      this.opts.onMessage(jid, {
        id: String(msg.message_id),
        chat_jid: jid,
        sender,
        sender_name: senderName,
        content,
        timestamp,
        is_from_me: isFromMe,
      });

      // Emit for immediate event-driven processing
      if (!isFromMe && content) {
        messageBus.emitMessage({
          chatJid: jid,
          text: content,
          sender: senderName,
          timestamp: msg.date,
          messageId: String(msg.message_id),
        });
      }
    });

    // Error handler
    this.bot.catch((err) => {
      logger.error({ err: err.error, ctx: err.ctx?.update?.update_id }, 'Telegram bot error');
    });
  }

  async connect(): Promise<void> {
    // Call getMe to populate botInfo
    await this.bot.init();
    logger.info(
      { username: this.bot.botInfo?.username, id: this.bot.botInfo?.id },
      'Telegram bot initialized',
    );

    // Register slash commands in Telegram's menu
    try {
      const { TELEGRAM_COMMANDS } = await import('../inline-handler.js');
      await this.bot.api.setMyCommands(TELEGRAM_COMMANDS);
      logger.info({ count: TELEGRAM_COMMANDS.length }, 'Telegram commands registered');
    } catch (err) {
      logger.warn({ err }, 'Failed to register Telegram commands');
    }

    // Start long-polling (non-blocking)
    this.bot.start({
      onStart: () => {
        this.connected = true;
        logger.info('Telegram bot polling started');
      },
      drop_pending_updates: true,
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const chatId = this.extractChatId(jid);
    if (!chatId) {
      logger.warn({ jid }, 'Invalid Telegram JID');
      return;
    }

    // Split the original text first (before formatting), then format each chunk.
    // This avoids splitting in the middle of MarkdownV2 formatting tokens.
    const rawChunks = this.splitMessage(text);

    for (const raw of rawChunks) {
      let sent = false;

      // Try MarkdownV2
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

      // Fallback: plain text (strip all markdown)
      if (!sent) {
        const plain = stripMarkdown(raw);
        await this.bot.api.sendMessage(chatId, plain);
      }
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('tg:');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    await this.bot.stop();
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!isTyping) return; // Telegram doesn't have a "stop typing" action
    const chatId = this.extractChatId(jid);
    if (!chatId) return;
    try {
      await this.bot.api.sendChatAction(chatId, 'typing');
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send typing indicator');
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────

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
      // Try to split at newline
      let splitAt = remaining.lastIndexOf('\n', TG_MAX_MSG_LENGTH);
      if (splitAt < TG_MAX_MSG_LENGTH * 0.5) {
        // No good newline break — split at space
        splitAt = remaining.lastIndexOf(' ', TG_MAX_MSG_LENGTH);
      }
      if (splitAt < TG_MAX_MSG_LENGTH * 0.3) {
        // No good break point — hard split
        splitAt = TG_MAX_MSG_LENGTH;
      }
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }
    return chunks;
  }
}

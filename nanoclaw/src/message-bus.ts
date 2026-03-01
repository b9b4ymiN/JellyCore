/**
 * Message Bus — Event-driven message handling
 *
 * Replaces 2s SQLite polling with immediate EventEmitter events.
 * WhatsApp channel emits 'message' when Baileys receives; router consumes immediately.
 */

import { EventEmitter } from 'events';
import type { MessageAttachment } from './types.js';

export interface IncomingMessage {
  chatJid: string;
  text: string;
  sender: string;
  timestamp: number;
  messageId?: string;
  attachments?: MessageAttachment[];
}

class MessageBus extends EventEmitter {
  private _eventCount = 0;

  constructor() {
    super();
    // Prevent crash on emitted 'error' events from listeners
    this.on('error', (err) => {
      // Imported lazily to avoid circular dependency at module load
      try {
        const { logger: log } = require('./logger.js');
        log.error({ err }, 'MessageBus error event');
      } catch {
        console.error('MessageBus error:', err);
      }
    });
    // Allow many groups to attach without warning
    this.setMaxListeners(50);
  }

  emitMessage(msg: IncomingMessage): void {
    this._eventCount++;
    this.emit('message', msg);
  }

  onMessage(listener: (msg: IncomingMessage) => void): this {
    return this.on('message', listener);
  }

  get eventCount(): number {
    return this._eventCount;
  }
}

export const messageBus = new MessageBus();

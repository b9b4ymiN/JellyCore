/**
 * Message Bus — Event-driven message handling
 *
 * Replaces 2s SQLite polling with immediate EventEmitter events.
 * WhatsApp channel emits 'message' when Baileys receives; router consumes immediately.
 */

import { EventEmitter } from 'events';

export interface IncomingMessage {
  chatJid: string;
  text: string;
  sender: string;
  timestamp: number;
  messageId?: string;
}

class MessageBus extends EventEmitter {
  private _eventCount = 0;

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

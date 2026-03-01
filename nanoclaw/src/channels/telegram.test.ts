import fs from 'fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type TelegramTestState = {
  botInstances: any[];
  emittedMessages: any[];
  sendPhotoCalls: any[];
  sendDocumentCalls: any[];
};

function ensureState(): TelegramTestState {
  const g = globalThis as typeof globalThis & {
    __telegramTestState?: TelegramTestState;
  };
  if (!g.__telegramTestState) {
    g.__telegramTestState = {
      botInstances: [],
      emittedMessages: [],
      sendPhotoCalls: [],
      sendDocumentCalls: [],
    };
  }
  return g.__telegramTestState;
}

vi.mock('grammy', () => {
  const state = ensureState();

  class FakeBot {
    handlers = new Map<string, Array<(ctx: any) => Promise<void> | void>>();
    catchHandler: ((err: any) => void) | null = null;
    botInfo = { id: 999, username: 'test_bot' };
    api = {
      setMyCommands: async () => undefined,
      getMe: async () => ({ id: 999, username: 'test_bot' }),
      sendMessage: async () => undefined,
      sendPhoto: async (...args: any[]) => {
        state.sendPhotoCalls.push(args);
      },
      sendDocument: async (...args: any[]) => {
        state.sendDocumentCalls.push(args);
      },
      sendChatAction: async () => undefined,
      getFile: async () => ({ file_path: 'abc/file.jpg' }),
    };

    constructor() {
      state.botInstances.push(this);
    }

    on(event: string, handler: (ctx: any) => Promise<void> | void) {
      const current = this.handlers.get(event) || [];
      current.push(handler);
      this.handlers.set(event, current);
    }

    catch(handler: (err: any) => void) {
      this.catchHandler = handler;
    }

    async init() {}
    start() {}
    async stop() {}

    async emit(event: string, payload: any) {
      const handlers = this.handlers.get(event) || [];
      for (const h of handlers) {
        await h(payload);
      }
    }
  }

  class FakeInputFile {
    path: string;
    constructor(path: string) {
      this.path = path;
    }
  }

  return {
    Bot: FakeBot,
    InputFile: FakeInputFile,
  };
});

vi.mock('../message-bus.js', () => ({
  messageBus: {
    emitMessage: (msg: any) => {
      ensureState().emittedMessages.push(msg);
    },
  },
}));

vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { TelegramChannel } from './telegram.js';

describe('TelegramChannel', () => {
  const tempDir = `${process.cwd().replace(/\\/g, '/')}/tmp-telegram-test`;

  beforeEach(() => {
    const state = ensureState();
    state.botInstances.length = 0;
    state.emittedMessages.length = 0;
    state.sendPhotoCalls.length = 0;
    state.sendDocumentCalls.length = 0;
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createChannel() {
    const onMessage = vi.fn();
    const onChatMetadata = vi.fn();
    const channel = new TelegramChannel({
      token: 'test-token',
      onMessage,
      onChatMetadata,
      registeredGroups: () => ({
        'tg:123': {
          name: 'Chat',
          folder: 'main',
          trigger: '@Andy',
          added_at: '2024-01-01T00:00:00.000Z',
        },
      }),
    });
    const bot = ensureState().botInstances[0];
    return { channel, onMessage, onChatMetadata, bot };
  }

  it('handles inbound text message', async () => {
    const { onMessage, onChatMetadata, bot } = createChannel();

    await bot.emit('message', {
      message: {
        message_id: 1,
        date: 1700000000,
        chat: { id: 123, type: 'private' },
        from: { id: 111, first_name: 'Alice' },
        text: 'hello',
      },
    });

    expect(onChatMetadata).toHaveBeenCalledWith('tg:123', expect.any(String), 'Alice');
    expect(onMessage).toHaveBeenCalledWith(
      'tg:123',
      expect.objectContaining({
        content: 'hello',
        attachments: undefined,
      }),
    );
    expect(ensureState().emittedMessages.length).toBe(1);
  });

  it('handles inbound photo with caption and attachment metadata', async () => {
    const { onMessage, bot } = createChannel();

    await bot.emit('message', {
      message: {
        message_id: 2,
        date: 1700000001,
        chat: { id: 123, type: 'private' },
        from: { id: 222, first_name: 'Bob' },
        caption: 'see this',
        photo: [
          {
            file_id: 'small',
            file_unique_id: 'u-small',
            file_size: 100,
            width: 100,
            height: 100,
          },
          {
            file_id: 'large',
            file_unique_id: 'u-large',
            file_size: 500,
            width: 300,
            height: 300,
          },
        ],
      },
    });

    expect(onMessage).toHaveBeenCalledWith(
      'tg:123',
      expect.objectContaining({
        content: 'see this',
        attachments: expect.arrayContaining([
          expect.objectContaining({
            kind: 'photo',
            telegramFileId: 'large',
          }),
        ]),
      }),
    );
  });

  it('uses placeholder content for document with no caption', async () => {
    const { onMessage, bot } = createChannel();

    await bot.emit('message', {
      message: {
        message_id: 3,
        date: 1700000002,
        chat: { id: 123, type: 'private' },
        from: { id: 333, first_name: 'Cara' },
        document: {
          file_id: 'doc1',
          file_unique_id: 'udoc1',
          file_name: 'report.pdf',
          file_size: 1234,
          mime_type: 'application/pdf',
        },
      },
    });

    expect(onMessage).toHaveBeenCalledWith(
      'tg:123',
      expect.objectContaining({
        content: '[Document: report.pdf]',
        attachments: expect.arrayContaining([
          expect.objectContaining({
            kind: 'document',
            fileName: 'report.pdf',
          }),
        ]),
      }),
    );
  });

  it('sendPayload sends photo and document through Telegram API', async () => {
    const { channel, bot } = createChannel();
    const photoPath = `${tempDir}/a.jpg`;
    const docPath = `${tempDir}/b.pdf`;
    fs.writeFileSync(photoPath, Buffer.from('a'));
    fs.writeFileSync(docPath, Buffer.from('b'));

    await channel.sendPayload?.('tg:123', {
      kind: 'photo',
      filePath: photoPath,
      caption: 'A',
    });
    await channel.sendPayload?.('tg:123', {
      kind: 'document',
      filePath: docPath,
      caption: 'B',
    });

    expect(ensureState().sendPhotoCalls.length).toBe(1);
    expect(ensureState().sendDocumentCalls.length).toBe(1);
  });
});

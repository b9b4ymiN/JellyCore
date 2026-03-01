import { describe, it, expect, beforeEach } from 'vitest';

import {
  _initTestDatabase,
  createTask,
  deleteTask,
  getAllChats,
  getRecoverableReceipts,
  getStableUserId,
  getMessagesSince,
  getMessageAttachments,
  getNewMessages,
  getSession,
  getSessionAge,
  getTaskById,
  ensureMessageReceipt,
  clearSession,
  setSession,
  storeChatMetadata,
  storeMessage,
  transitionMessageStatus,
  updateTask,
} from './db.js';

beforeEach(() => {
  _initTestDatabase();
});

// Helper to store a message using the normalized NewMessage interface
function store(overrides: {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
}) {
  storeMessage({
    id: overrides.id,
    chat_jid: overrides.chat_jid,
    sender: overrides.sender,
    sender_name: overrides.sender_name,
    content: overrides.content,
    timestamp: overrides.timestamp,
    is_from_me: overrides.is_from_me ?? false,
  });
}

describe('stable user identity mapping', () => {
  it('returns a deterministic userId per chat_jid', () => {
    const chatA = 'tg:123456';
    const chatB = 'tg:999999';

    const a1 = getStableUserId(chatA);
    const a2 = getStableUserId(chatA);
    const b1 = getStableUserId(chatB);

    expect(a1).toBe(a2);
    expect(a1).not.toBe(b1);
    expect(a1.startsWith('u_')).toBe(true);

    _initTestDatabase();
    const a3 = getStableUserId(chatA);
    expect(a3).toBe(a1);
  });
});

// --- storeMessage (NewMessage format) ---

describe('storeMessage', () => {
  it('stores a message and retrieves it', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'msg-1',
      chat_jid: 'group@g.us',
      sender: '123@s.whatsapp.net',
      sender_name: 'Alice',
      content: 'hello world',
      timestamp: '2024-01-01T00:00:01.000Z',
    });

    const messages = getMessagesSince('group@g.us', '2024-01-01T00:00:00.000Z', 'BotName');
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('msg-1');
    expect(messages[0].sender).toBe('123@s.whatsapp.net');
    expect(messages[0].sender_name).toBe('Alice');
    expect(messages[0].content).toBe('hello world');
  });

  it('stores empty content', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'msg-2',
      chat_jid: 'group@g.us',
      sender: '111@s.whatsapp.net',
      sender_name: 'Dave',
      content: '',
      timestamp: '2024-01-01T00:00:04.000Z',
    });

    const messages = getMessagesSince('group@g.us', '2024-01-01T00:00:00.000Z', 'BotName');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('');
  });

  it('stores is_from_me flag', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'msg-3',
      chat_jid: 'group@g.us',
      sender: 'me@s.whatsapp.net',
      sender_name: 'Me',
      content: 'my message',
      timestamp: '2024-01-01T00:00:05.000Z',
      is_from_me: true,
    });

    // Message is stored (we can retrieve it — is_from_me doesn't affect retrieval)
    const messages = getMessagesSince('group@g.us', '2024-01-01T00:00:00.000Z', 'BotName');
    expect(messages).toHaveLength(1);
  });

  it('upserts on duplicate id+chat_jid', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'msg-dup',
      chat_jid: 'group@g.us',
      sender: '123@s.whatsapp.net',
      sender_name: 'Alice',
      content: 'original',
      timestamp: '2024-01-01T00:00:01.000Z',
    });

    store({
      id: 'msg-dup',
      chat_jid: 'group@g.us',
      sender: '123@s.whatsapp.net',
      sender_name: 'Alice',
      content: 'updated',
      timestamp: '2024-01-01T00:00:01.000Z',
    });

    const messages = getMessagesSince('group@g.us', '2024-01-01T00:00:00.000Z', 'BotName');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('updated');
  });

  it('stores and retrieves message attachments', () => {
    storeChatMetadata('tg:100', '2024-01-01T00:00:00.000Z');

    storeMessage({
      id: 'tg-msg-1',
      chat_jid: 'tg:100',
      sender: 'tg:777',
      sender_name: 'Alice',
      content: '[Photo]',
      timestamp: '2024-01-01T00:00:10.000Z',
      is_from_me: false,
      attachments: [
        {
          id: 'photo:abc',
          kind: 'photo',
          mimeType: 'image/jpeg',
          fileName: 'image.jpg',
          fileSize: 2048,
          telegramFileId: 'f1',
          telegramFileUniqueId: 'u1',
          width: 100,
          height: 200,
        },
      ],
    });

    const rows = getMessageAttachments('tg-msg-1', 'tg:100');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('photo:abc');
    expect(rows[0].kind).toBe('photo');
    expect(rows[0].telegramFileId).toBe('f1');
  });
});

// --- getMessagesSince ---

describe('getMessagesSince', () => {
  beforeEach(() => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    const msgs = [
      { id: 'm1', content: 'first', ts: '2024-01-01T00:00:01.000Z', sender: 'Alice' },
      { id: 'm2', content: 'second', ts: '2024-01-01T00:00:02.000Z', sender: 'Bob' },
      { id: 'm3', content: 'Andy: bot reply', ts: '2024-01-01T00:00:03.000Z', sender: 'Bot' },
      { id: 'm4', content: 'third', ts: '2024-01-01T00:00:04.000Z', sender: 'Carol' },
    ];
    for (const m of msgs) {
      store({
        id: m.id,
        chat_jid: 'group@g.us',
        sender: `${m.sender}@s.whatsapp.net`,
        sender_name: m.sender,
        content: m.content,
        timestamp: m.ts,
      });
    }
  });

  it('returns messages after the given timestamp', () => {
    const msgs = getMessagesSince('group@g.us', '2024-01-01T00:00:02.000Z', 'Andy');
    // Should exclude m1, m2 (before/at timestamp), m3 (bot message)
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('third');
  });

  it('excludes messages from the assistant (content prefix)', () => {
    const msgs = getMessagesSince('group@g.us', '2024-01-01T00:00:00.000Z', 'Andy');
    const botMsgs = msgs.filter((m) => m.content.startsWith('Andy:'));
    expect(botMsgs).toHaveLength(0);
  });

  it('returns all messages when sinceTimestamp is empty', () => {
    const msgs = getMessagesSince('group@g.us', '', 'Andy');
    // 3 user messages (bot message excluded)
    expect(msgs).toHaveLength(3);
  });
});

// --- getNewMessages ---

describe('getNewMessages', () => {
  beforeEach(() => {
    storeChatMetadata('group1@g.us', '2024-01-01T00:00:00.000Z');
    storeChatMetadata('group2@g.us', '2024-01-01T00:00:00.000Z');

    const msgs = [
      { id: 'a1', chat: 'group1@g.us', content: 'g1 msg1', ts: '2024-01-01T00:00:01.000Z' },
      { id: 'a2', chat: 'group2@g.us', content: 'g2 msg1', ts: '2024-01-01T00:00:02.000Z' },
      { id: 'a3', chat: 'group1@g.us', content: 'Andy: reply', ts: '2024-01-01T00:00:03.000Z' },
      { id: 'a4', chat: 'group1@g.us', content: 'g1 msg2', ts: '2024-01-01T00:00:04.000Z' },
    ];
    for (const m of msgs) {
      store({
        id: m.id,
        chat_jid: m.chat,
        sender: 'user@s.whatsapp.net',
        sender_name: 'User',
        content: m.content,
        timestamp: m.ts,
      });
    }
  });

  it('returns new messages across multiple groups', () => {
    const { messages, newTimestamp } = getNewMessages(
      ['group1@g.us', 'group2@g.us'],
      '2024-01-01T00:00:00.000Z',
      'Andy',
    );
    // Excludes 'Andy: reply', returns 3 messages
    expect(messages).toHaveLength(3);
    expect(newTimestamp).toBe('2024-01-01T00:00:04.000Z');
  });

  it('filters by timestamp', () => {
    const { messages } = getNewMessages(
      ['group1@g.us', 'group2@g.us'],
      '2024-01-01T00:00:02.000Z',
      'Andy',
    );
    // Only g1 msg2 (after ts, not bot)
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('g1 msg2');
  });

  it('returns empty for no registered groups', () => {
    const { messages, newTimestamp } = getNewMessages([], '', 'Andy');
    expect(messages).toHaveLength(0);
    expect(newTimestamp).toBe('');
  });

  it('lists only recoverable receipts (RECEIVED/QUEUED/RUNNING)', () => {
    store({
      id: 'r1',
      chat_jid: 'group1@g.us',
      sender: 'user@s.whatsapp.net',
      sender_name: 'User',
      content: 'one',
      timestamp: '2024-01-01T00:00:01.000Z',
    });
    store({
      id: 'r2',
      chat_jid: 'group1@g.us',
      sender: 'user@s.whatsapp.net',
      sender_name: 'User',
      content: 'two',
      timestamp: '2024-01-01T00:00:02.000Z',
    });
    store({
      id: 'r3',
      chat_jid: 'group1@g.us',
      sender: 'user@s.whatsapp.net',
      sender_name: 'User',
      content: 'three',
      timestamp: '2024-01-01T00:00:03.000Z',
    });
    store({
      id: 'r4',
      chat_jid: 'group1@g.us',
      sender: 'user@s.whatsapp.net',
      sender_name: 'User',
      content: 'four',
      timestamp: '2024-01-01T00:00:04.000Z',
    });

    const t1 = ensureMessageReceipt('group1@g.us', 'r1');
    const t2 = ensureMessageReceipt('group1@g.us', 'r2');
    const t3 = ensureMessageReceipt('group1@g.us', 'r3');
    const t4 = ensureMessageReceipt('group1@g.us', 'r4');

    transitionMessageStatus(t2.trace_id, 'QUEUED');
    transitionMessageStatus(t3.trace_id, 'RUNNING');
    transitionMessageStatus(t4.trace_id, 'REPLIED');

    const recoverable = getRecoverableReceipts();
    expect(recoverable.map((r) => r.external_message_id)).toEqual([
      'r1',
      'r2',
      'r3',
    ]);
  });
});

// --- storeChatMetadata ---

describe('storeChatMetadata', () => {
  it('stores chat with JID as default name', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');
    const chats = getAllChats();
    expect(chats).toHaveLength(1);
    expect(chats[0].jid).toBe('group@g.us');
    expect(chats[0].name).toBe('group@g.us');
  });

  it('stores chat with explicit name', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z', 'My Group');
    const chats = getAllChats();
    expect(chats[0].name).toBe('My Group');
  });

  it('updates name on subsequent call with name', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');
    storeChatMetadata('group@g.us', '2024-01-01T00:00:01.000Z', 'Updated Name');
    const chats = getAllChats();
    expect(chats).toHaveLength(1);
    expect(chats[0].name).toBe('Updated Name');
  });

  it('preserves newer timestamp on conflict', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:05.000Z');
    storeChatMetadata('group@g.us', '2024-01-01T00:00:01.000Z');
    const chats = getAllChats();
    expect(chats[0].last_message_time).toBe('2024-01-01T00:00:05.000Z');
  });
});

// --- Task CRUD ---

describe('task CRUD', () => {
  it('creates and retrieves a task', () => {
    createTask({
      id: 'task-1',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'do something',
      schedule_type: 'once',
      schedule_value: '2024-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: '2024-06-01T00:00:00.000Z',
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    const task = getTaskById('task-1');
    expect(task).toBeDefined();
    expect(task!.prompt).toBe('do something');
    expect(task!.status).toBe('active');
  });

  it('updates task status', () => {
    createTask({
      id: 'task-2',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'test',
      schedule_type: 'once',
      schedule_value: '2024-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    updateTask('task-2', { status: 'paused' });
    expect(getTaskById('task-2')!.status).toBe('paused');
  });

  it('deletes a task and its run logs', () => {
    createTask({
      id: 'task-3',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'delete me',
      schedule_type: 'once',
      schedule_value: '2024-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    deleteTask('task-3');
    expect(getTaskById('task-3')).toBeUndefined();
  });
});

// --- getMessagesSince LIMIT ---

describe('getMessagesSince LIMIT', () => {
  beforeEach(() => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    // Insert 100 messages with sortable timestamps (using milliseconds for clean ordering)
    for (let i = 1; i <= 100; i++) {
      const ts = `2024-01-01T00:00:00.${String(i).padStart(3, '0')}Z`;
      store({
        id: `msg-${i}`,
        chat_jid: 'group@g.us',
        sender: 'user@s.whatsapp.net',
        sender_name: 'User',
        content: `message #${i}`,
        timestamp: ts,
      });
    }
  });

  it('returns at most 50 messages by default', () => {
    const msgs = getMessagesSince('group@g.us', '', 'BotName');
    expect(msgs).toHaveLength(50);
  });

  it('returns the NEWEST 50 messages, not oldest', () => {
    const msgs = getMessagesSince('group@g.us', '', 'BotName');
    // Should have messages 51-100 (the newest 50)
    expect(msgs[0].content).toBe('message #51');
    expect(msgs[49].content).toBe('message #100');
  });

  it('returns messages in ascending order (oldest first within window)', () => {
    const msgs = getMessagesSince('group@g.us', '', 'BotName');
    for (let i = 1; i < msgs.length; i++) {
      expect(msgs[i].timestamp >= msgs[i - 1].timestamp).toBe(true);
    }
  });

  it('respects custom limit parameter', () => {
    const msgs = getMessagesSince('group@g.us', '', 'BotName', 10);
    expect(msgs).toHaveLength(10);
    // Should be the newest 10
    expect(msgs[0].content).toBe('message #91');
    expect(msgs[9].content).toBe('message #100');
  });

  it('returns all when fewer than limit exist', () => {
    // Timestamp .095 → only messages #96-#100 are after it
    const msgs = getMessagesSince('group@g.us', '2024-01-01T00:00:00.095Z', 'BotName');
    expect(msgs.length).toBeLessThanOrEqual(50);
    expect(msgs.length).toBe(5);
  });
});

// --- Session rotation ---

describe('session rotation', () => {
  it('setSession records session_started_at timestamp', () => {
    setSession('main', 'sess-abc');
    const age = getSessionAge('main');
    expect(age).not.toBeNull();
    // Should be very recent (in milliseconds)
    expect(age!).toBeLessThan(5000);
  });

  it('setSession preserves original timestamp when same sessionId is re-stored', () => {
    setSession('main', 'sess-abc');
    const age1 = getSessionAge('main');

    // Re-store same session ID
    setSession('main', 'sess-abc');
    const age2 = getSessionAge('main');

    // Age should be approximately the same (original timestamp preserved)
    expect(Math.abs(age2! - age1!)).toBeLessThan(1000);
  });

  it('setSession updates timestamp when sessionId changes', () => {
    setSession('main', 'sess-old');
    const session1 = getSession('main');
    expect(session1).toBe('sess-old');

    // New session ID → new timestamp
    setSession('main', 'sess-new');
    const session2 = getSession('main');
    expect(session2).toBe('sess-new');
    const age = getSessionAge('main');
    expect(age).not.toBeNull();
    expect(age!).toBeLessThan(5000);
  });

  it('clearSession removes the session entirely', () => {
    setSession('main', 'sess-xyz');
    expect(getSession('main')).toBe('sess-xyz');

    clearSession('main');
    expect(getSession('main')).toBeUndefined();
    expect(getSessionAge('main')).toBeNull();
  });

  it('getSessionAge returns null for non-existent session', () => {
    expect(getSessionAge('nonexistent')).toBeNull();
  });
});

---
name: telegram-automation
description: Telegram Bot API automation - build bots, manage chats, handle webhooks, and automate messaging workflows
---

# Telegram Automation Expert

Comprehensive skill for building and automating Telegram bots using the Telegram Bot API.

## When to Activate

- Building Telegram bots from scratch
- Implementing webhook vs polling strategies
- Creating inline keyboards and interactive UIs
- Automating message sending and notifications
- Managing group chats and channels
- Handling media (photos, videos, documents)
- Implementing payment flows
- Setting up bot commands and menus

## Getting Started

### Create a Bot

1. Message [@BotFather](https://t.me/botfather) on Telegram
2. Send `/newbot` command
3. Choose a name and username
4. Receive bot token: `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`

### Basic Bot Setup (Node.js)

```typescript
// bot.ts
import TelegramBot from 'node-telegram-bot-api';

const token = process.env.TELEGRAM_BOT_TOKEN!;
const bot = new TelegramBot(token, { polling: true });

// Listen for /start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Welcome! I am your bot.');
});

// Listen for any message
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  console.log(`Message from ${msg.from?.username}: ${msg.text}`);
});

console.log('Bot is running...');
```

## Polling vs Webhooks

### Polling (Development)

```typescript
// Simple polling - good for development
const bot = new TelegramBot(token, { polling: true });
```

**Pros:**
- Easy to set up
- No server configuration needed
- Good for local development

**Cons:**
- Less efficient
- Higher latency
- Not suitable for production

### Webhooks (Production)

```typescript
// webhook.ts
import express from 'express';
import TelegramBot from 'node-telegram-bot-api';

const app = express();
const token = process.env.TELEGRAM_BOT_TOKEN!;
const webhookUrl = process.env.WEBHOOK_URL!; // https://yourdomain.com/webhook

const bot = new TelegramBot(token);

// Set webhook
bot.setWebHook(`${webhookUrl}/${token}`);

app.use(express.json());

// Webhook endpoint
app.post(`/webhook/${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Handle messages
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, 'Received via webhook!');
});

app.listen(3000, () => {
  console.log('Webhook server running on port 3000');
});
```

## Message Types

### Text Messages

```typescript
// Simple text
await bot.sendMessage(chatId, 'Hello, World!');

// Markdown formatting
await bot.sendMessage(chatId, '*Bold* _Italic_ `Code`', {
  parse_mode: 'Markdown',
});

// HTML formatting
await bot.sendMessage(chatId, '<b>Bold</b> <i>Italic</i> <code>Code</code>', {
  parse_mode: 'HTML',
});

// Disable link preview
await bot.sendMessage(chatId, 'Check https://example.com', {
  disable_web_page_preview: true,
});
```

### Media Messages

```typescript
// Photo
await bot.sendPhoto(chatId, 'path/to/photo.jpg', {
  caption: 'Beautiful photo!',
});

// Photo from URL
await bot.sendPhoto(chatId, 'https://example.com/photo.jpg');

// Document
await bot.sendDocument(chatId, 'path/to/document.pdf', {
  caption: 'Report',
});

// Video
await bot.sendVideo(chatId, 'path/to/video.mp4');

// Audio
await bot.sendAudio(chatId, 'path/to/audio.mp3');

// Location
await bot.sendLocation(chatId, 13.7563, 100.5018); // Bangkok
```

## Inline Keyboards

### Reply Keyboard

```typescript
// Simple keyboard
await bot.sendMessage(chatId, 'Choose an option:', {
  reply_markup: {
    keyboard: [
      ['Option 1', 'Option 2'],
      ['Option 3'],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
  },
});

// Remove keyboard
await bot.sendMessage(chatId, 'Keyboard removed', {
  reply_markup: {
    remove_keyboard: true,
  },
});
```

### Inline Keyboard (Callback Buttons)

```typescript
// Inline buttons with callbacks
await bot.sendMessage(chatId, 'Choose an action:', {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '✅ Approve', callback_data: 'approve' },
        { text: '❌ Reject', callback_data: 'reject' },
      ],
      [
        { text: '🔗 Visit Website', url: 'https://example.com' },
      ],
    ],
  },
});

// Handle callback queries
bot.on('callback_query', async (query) => {
  const chatId = query.message!.chat.id;
  const data = query.callback_data;

  if (data === 'approve') {
    await bot.answerCallbackQuery(query.id, { text: 'Approved!' });
    await bot.editMessageText('✅ Request approved', {
      chat_id: chatId,
      message_id: query.message!.message_id,
    });
  } else if (data === 'reject') {
    await bot.answerCallbackQuery(query.id, { text: 'Rejected!' });
    await bot.editMessageText('❌ Request rejected', {
      chat_id: chatId,
      message_id: query.message!.message_id,
    });
  }
});
```

### Inline Keyboard Pagination

```typescript
function createPaginationKeyboard(page: number, totalPages: number) {
  const buttons = [];
  
  if (page > 1) {
    buttons.push({ text: '◀️ Previous', callback_data: `page:${page - 1}` });
  }
  
  buttons.push({ text: `📄 ${page}/${totalPages}`, callback_data: 'current' });
  
  if (page < totalPages) {
    buttons.push({ text: 'Next ▶️', callback_data: `page:${page + 1}` });
  }
  
  return {
    inline_keyboard: [buttons],
  };
}

// Usage
await bot.sendMessage(chatId, `Page ${page} content...`, {
  reply_markup: createPaginationKeyboard(page, totalPages),
});
```

## Commands

### Register Commands

```typescript
// Set bot commands (shows in menu)
await bot.setMyCommands([
  { command: 'start', description: 'Start the bot' },
  { command: 'help', description: 'Show help message' },
  { command: 'settings', description: 'Configure settings' },
  { command: 'status', description: 'Check bot status' },
]);

// Command handlers
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Welcome!');
});

bot.onText(/\/help/, (msg) => {
  const helpText = `
Available commands:
/start - Start the bot
/help - Show this message
/settings - Configure settings
  `;
  bot.sendMessage(msg.chat.id, helpText);
});

// Command with parameters
bot.onText(/\/search (.+)/, (msg, match) => {
  const query = match![1];
  bot.sendMessage(msg.chat.id, `Searching for: ${query}`);
});
```

## Advanced Features

### Conversation State Management

```typescript
// Simple state management
const userStates = new Map<number, string>();

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const state = userStates.get(chatId);

  if (msg.text === '/register') {
    userStates.set(chatId, 'waiting_name');
    await bot.sendMessage(chatId, 'Please enter your name:');
    return;
  }

  if (state === 'waiting_name') {
    const name = msg.text;
    userStates.set(chatId, 'waiting_age');
    await bot.sendMessage(chatId, `Nice to meet you, ${name}! How old are you?`);
    return;
  }

  if (state === 'waiting_age') {
    const age = msg.text;
    userStates.delete(chatId);
    await bot.sendMessage(chatId, `Registration complete! Name: ${name}, Age: ${age}`);
    return;
  }
});
```

### Typing Indicator

```typescript
// Show "typing..." indicator
await bot.sendChatAction(chatId, 'typing');

// Simulate processing
await new Promise((resolve) => setTimeout(resolve, 2000));

await bot.sendMessage(chatId, 'Done processing!');
```

### Edit Messages

```typescript
// Send a message
const sentMessage = await bot.sendMessage(chatId, 'Processing...');

// Edit it later
await bot.editMessageText('Complete!', {
  chat_id: chatId,
  message_id: sentMessage.message_id,
});
```

### Delete Messages

```typescript
// Delete a message
await bot.deleteMessage(chatId, messageId);
```

### Forward Messages

```typescript
// Forward message to another chat
await bot.forwardMessage(targetChatId, fromChatId, messageId);
```

## Group Chat Management

### Admin Functions

```typescript
// Get chat administrators
const admins = await bot.getChatAdministrators(chatId);

// Kick user
await bot.kickChatMember(chatId, userId);

// Unban user
await bot.unbanChatMember(chatId, userId);

// Restrict user (mute)
await bot.restrictChatMember(chatId, userId, {
  can_send_messages: false,
  until_date: Math.floor(Date.now() / 1000) + 3600, // 1 hour
});

// Promote user to admin
await bot.promoteChatMember(chatId, userId, {
  can_change_info: true,
  can_delete_messages: true,
  can_invite_users: true,
});
```

### Handle New Members

```typescript
bot.on('new_chat_members', (msg) => {
  const newMembers = msg.new_chat_members!;
  const chatId = msg.chat.id;

  newMembers.forEach((member) => {
    bot.sendMessage(
      chatId,
      `Welcome ${member.first_name}! Please read the rules.`
    );
  });
});

bot.on('left_chat_member', (msg) => {
  const member = msg.left_chat_member!;
  const chatId = msg.chat.id;
  
  bot.sendMessage(chatId, `Goodbye ${member.first_name}!`);
});
```

## Channel Management

```typescript
// Post to channel
await bot.sendMessage('@mychannel', 'New post!');

// Get channel info
const chat = await bot.getChat('@mychannel');

// Pin message
await bot.pinChatMessage(channelId, messageId);

// Unpin message
await bot.unpinChatMessage(channelId, messageId);
```

## Error Handling

```typescript
// Global error handler
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

// Handle specific errors
bot.on('message', async (msg) => {
  try {
    await someOperation();
  } catch (error) {
    if (error.response?.statusCode === 403) {
      // Bot was blocked by user
      console.log('Bot blocked by user');
    } else if (error.response?.statusCode === 429) {
      // Rate limit exceeded
      console.log('Rate limit hit, waiting...');
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } else {
      console.error('Unexpected error:', error);
    }
  }
});
```

## Rate Limiting

```typescript
// Telegram limits: 30 messages per second to different chats
// 1 message per second to the same chat

class RateLimiter {
  private queues = new Map<number, Promise<void>>();

  async sendMessage(chatId: number, text: string) {
    const queue = this.queues.get(chatId) || Promise.resolve();
    
    const newQueue = queue.then(async () => {
      await bot.sendMessage(chatId, text);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    });
    
    this.queues.set(chatId, newQueue);
    return newQueue;
  }
}

const limiter = new RateLimiter();
```

## Inline Queries

```typescript
// Handle inline queries (like @botname search term)
bot.on('inline_query', async (query) => {
  const results = [
    {
      type: 'article',
      id: '1',
      title: 'Result 1',
      input_message_content: {
        message_text: 'Content for result 1',
      },
    },
    {
      type: 'article',
      id: '2',
      title: 'Result 2',
      input_message_content: {
        message_text: 'Content for result 2',
      },
    },
  ];

  await bot.answerInlineQuery(query.id, results);
});
```

## File Upload/Download

```typescript
// Download file sent by user
bot.on('document', async (msg) => {
  const fileId = msg.document!.file_id;
  const file = await bot.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  
  // Download file
  const response = await fetch(fileUrl);
  const buffer = await response.arrayBuffer();
  
  // Save to disk
  await fs.writeFile(`downloads/${msg.document!.file_name}`, Buffer.from(buffer));
});
```

## Best Practices

1. **Use Webhooks in Production** - More reliable than polling
2. **Handle Errors Gracefully** - Don't crash on API errors
3. **Respect Rate Limits** - Queue messages if needed
4. **Validate User Input** - Never trust user data
5. **Use Callback Data Wisely** - Max 64 bytes per button
6. **Log All Actions** - Essential for debugging
7. **Test in Private** - Create a test bot before going public
8. **Secure Your Token** - Never commit to git, use env vars
9. **Handle Long Messages** - Split if > 4096 characters
10. **Use Bot Commands** - Makes bot discoverable

## Security Tips

```typescript
// ✅ Validate chat/user IDs
const ALLOWED_CHAT_IDS = [123456789, 987654321];

bot.on('message', (msg) => {
  if (!ALLOWED_CHAT_IDS.includes(msg.chat.id)) {
    return; // Ignore unauthorized chats
  }
  // Process message
});

// ✅ Sanitize input
function sanitizeInput(text: string): string {
  return text.replace(/[<>]/g, '');
}

// ✅ Use HTTPS webhooks only
// ✅ Verify webhook requests (use secret token)
```

## Useful Libraries

- **node-telegram-bot-api** - Node.js wrapper
- **telegraf** - Modern Telegram bot framework
- **grammy** - Type-safe bot framework
- **bottleneck** - Rate limiting
- **redis** - State management

## References

- [Telegram Bot API](https://core.telegram.org/bots/api)
- [BotFather Commands](https://core.telegram.org/bots#botfather)
- [Telegram Bot Features](https://core.telegram.org/bots/features)

---

**Pro Tips:**
- Test with yourself before releasing
- Use inline keyboards for better UX
- Implement /help command always
- Handle all error cases
- Monitor bot health with logging
- Keep tokens in environment variables only

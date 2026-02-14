# 4.12 — Rich Telegram UI

> แก้จุดอ่อน: W15 (Telegram UI ยังเป็น plain text ไม่มี interactive elements)

**Status:** ⬜ Not Started  
**Effort:** Small  
**Priority:** 🟡 Medium  
**Depends on:** Item 4.2 (Telegram Channel), Item 4.9 (Response Streaming)

---

## 📋 ปัญหาเดิม

- Telegram bot ส่งแค่ plain text
- ไม่มี inline buttons, menus, หรือ interactive elements
- User ต้องพิมพ์ command ทุกอย่าง (ไม่มี shortcut)
- ไม่มี feedback mechanism (like/dislike)

---

## 🎯 เป้าหมาย

1. Inline keyboards: buttons สำหรับ actions ที่ใช้บ่อย
2. Feedback buttons: 👍👎 ทุก response
3. Status messages: loading indicators ระหว่างประมวลผล
4. Rich formatting: bold, italic, code blocks, links

---

## ✅ Checklist

### Inline Keyboard System

- [ ] สร้าง `src/channels/telegram/keyboards.ts`:
  ```typescript
  import { InlineKeyboardMarkup, InlineKeyboardButton } from 'telegraf/types';
  
  // Feedback keyboard — appended to every AI response
  function feedbackKeyboard(responseId: string): InlineKeyboardMarkup {
    return {
      inline_keyboard: [[
        { text: '👍 ดี', callback_data: `feedback:${responseId}:positive` },
        { text: '👎 ปรับปรุง', callback_data: `feedback:${responseId}:negative` },
        { text: '📝 เพิ่มเติม', callback_data: `followup:${responseId}` },
      ]],
    };
  }
  
  // Knowledge actions — shown when AI references knowledge
  function knowledgeKeyboard(docIds: number[]): InlineKeyboardMarkup {
    const buttons: InlineKeyboardButton[][] = [
      [
        { text: '📚 ดู Sources', callback_data: `sources:${docIds.join(',')}` },
        { text: '🔄 ค้นหาเพิ่ม', callback_data: `search_more` },
      ],
    ];
    return { inline_keyboard: buttons };
  }
  
  // Quick actions menu
  function quickActionsKeyboard(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: '📊 Status', callback_data: 'action:status' },
          { text: '🧠 Memory Stats', callback_data: 'action:memory' },
        ],
        [
          { text: '📝 Learn', callback_data: 'action:learn' },
          { text: '🔍 Search', callback_data: 'action:search' },
        ],
        [
          { text: '⚙️ Settings', callback_data: 'action:settings' },
        ],
      ],
    };
  }
  ```

### Callback Query Handler

- [ ] Handle inline button presses:
  ```typescript
  // Register callback query handlers
  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (!data) return;
    
    const [action, ...params] = data.split(':');
    
    switch (action) {
      case 'feedback':
        await handleFeedback(ctx, params[0], params[1] as 'positive' | 'negative');
        break;
      case 'followup':
        await handleFollowUp(ctx, params[0]);
        break;
      case 'sources':
        await handleShowSources(ctx, params[0].split(',').map(Number));
        break;
      case 'action':
        await handleQuickAction(ctx, params[0]);
        break;
    }
    
    await ctx.answerCbQuery(); // Acknowledge button press
  });
  
  async function handleFeedback(ctx, responseId: string, type: string): Promise<void> {
    await saveFeedback(responseId, type);
    await ctx.answerCbQuery(type === 'positive' ? '✅ ขอบคุณ!' : '📝 จะปรับปรุง');
    
    // Remove feedback buttons after selection
    await ctx.editMessageReplyMarkup(undefined);
  }
  ```

### Rich Formatting

- [ ] Markdown formatting helper:
  ```typescript
  function formatResponse(response: AIResponse): string {
    let text = response.answer;
    
    // Format code blocks
    text = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
      return `\`\`\`${lang || ''}\n${code}\`\`\``;
    });
    
    // Add source attribution
    if (response.sources?.length > 0) {
      text += '\n\n📚 *Sources:*\n';
      for (const source of response.sources.slice(0, 3)) {
        text += `• _${source.title}_ (${Math.round(source.relevance * 100)}%)\n`;
      }
    }
    
    // Add confidence indicator
    const confidence = response.reflection?.confidence || 0;
    if (confidence < 0.5) {
      text += '\n\n⚠️ _ความมั่นใจต่ำ — อาจต้องตรวจสอบเพิ่ม_';
    }
    
    return text;
  }
  ```

### Bot Commands

- [ ] Register Telegram bot commands:
  ```typescript
  bot.telegram.setMyCommands([
    { command: 'start', description: '🏠 เริ่มต้นใช้งาน' },
    { command: 'menu', description: '📋 เมนูหลัก' },
    { command: 'learn', description: '📝 สอนข้อมูลใหม่' },
    { command: 'search', description: '🔍 ค้นหาข้อมูล' },
    { command: 'status', description: '📊 สถานะระบบ' },
    { command: 'memory', description: '🧠 สถิติ Memory' },
    { command: 'help', description: '❓ วิธีใช้งาน' },
  ]);
  
  bot.command('menu', async (ctx) => {
    await ctx.reply('🤖 *JellyCore Menu*\nเลือก action:', {
      parse_mode: 'MarkdownV2',
      reply_markup: quickActionsKeyboard(),
    });
  });
  ```

### ทดสอบ

- [ ] ส่งคำถาม → response มี 👍👎 buttons
- [ ] กด 👍 → feedback saved, buttons removed
- [ ] กด 📝 เพิ่มเติม → prompt for follow-up
- [ ] /menu → inline keyboard แสดง quick actions
- [ ] Code block ใน response → formatted properly
- [ ] Source attribution แสดงถูกต้อง

---

## 🧪 Definition of Done

1. ทุก AI response มี feedback inline buttons
2. Quick actions keyboard ทำงาน
3. Bot commands registered and functional
4. Code blocks, bold, italic render ถูกต้อง
5. Source attribution appended to knowledge-based responses
6. Callback queries handled without error

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `src/channels/telegram/keyboards.ts` | NanoClaw | **Create** — keyboard builders |
| `src/channels/telegram/callbacks.ts` | NanoClaw | **Create** — callback handlers |
| `src/channels/telegram/formatter.ts` | NanoClaw | **Create** — rich text formatting |
| `src/channels/telegram/bot.ts` | NanoClaw | Modify — register commands, callbacks |

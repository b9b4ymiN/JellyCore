# 4.2 — Telegram Channel

> เพิ่ม Telegram เป็น channel ที่สอง + ใช้เป็น alert/admin channel

**Status:** ⬜ Not Started  
**Effort:** Large  
**Priority:** 🟠 High

---

## 🎯 เป้าหมาย

Telegram bot ที่:
- รับ/ส่ง messages เหมือน WhatsApp channel
- ใช้เป็น admin channel (alerts, QR codes, commands)
- Webhook mode (reliable, ไม่ต้อง maintain connection)

---

## ✅ Checklist

### Setup Telegram Bot

- [ ] สร้าง bot ผ่าน @BotFather:
  - `/newbot` → ตั้งชื่อ → ได้ `TELEGRAM_BOT_TOKEN`
  - `/setcommands` → register commands: `status`, `health`, `tasks`
- [ ] เพิ่ม env var: `TELEGRAM_BOT_TOKEN`
- [ ] เพิ่ม env var: `TELEGRAM_ADMIN_CHAT_ID` (สำหรับ alerts)

### Install Dependencies

- [ ] `npm install telegraf` (official Telegram bot framework)

### Implement Channel Interface

- [ ] สร้าง `src/channels/telegram.ts`:
  ```typescript
  import { Telegraf } from 'telegraf';
  
  export class TelegramChannel implements Channel {
    name = 'telegram';
    private bot: Telegraf;
    
    async connect(): Promise<void> {
      this.bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
      
      // Webhook mode (via Caddy reverse proxy)
      await this.bot.telegram.setWebhook(`https://${DOMAIN}/telegram/webhook`);
      // OR: polling mode for dev
      // await this.bot.launch();
    }
    
    async sendMessage(chatId: string, text: string): Promise<void> {
      // Telegram max message = 4096 chars → split if longer
      const chunks = splitMessage(text, 4096);
      for (const chunk of chunks) {
        await this.bot.telegram.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
      }
    }
    
    isConnected(): boolean { ... }
    ownsJid(jid: string): boolean { return jid.startsWith('tg:'); }
    async disconnect(): Promise<void> { ... }
  }
  ```

### Message Handling

- [ ] Handle incoming messages:
  ```typescript
  this.bot.on('text', async (ctx) => {
    const msg: IncomingMessage = {
      chatJid: `tg:${ctx.chat.id}`,
      sender: ctx.from.username || ctx.from.first_name,
      content: ctx.message.text,
      timestamp: ctx.message.date * 1000,
      channel: 'telegram',
    };
    messageBus.emit('message', msg);
  });
  ```

### Media Support

- [ ] Photo: download → describe (future: vision API)
- [ ] Document: download → extract text
- [ ] Voice: download → transcribe (future: Whisper API)
- [ ] Sticker: log sticker emoji

### Admin Commands

- [ ] `/status` → system status summary
  ```
  🤖 JellyCore Status
  WhatsApp: ✅ Connected
  Telegram: ✅ Connected
  Oracle: ✅ Healthy
  Containers: 2/5 active
  Queue: 0 waiting
  Uptime: 3d 14h
  ```
- [ ] `/health` → detailed health check (from health-monitor)
- [ ] `/tasks` → list scheduled tasks + statuses
- [ ] `/enable-task {id}` → re-enable disabled task
- [ ] `/backup` → trigger manual backup

### JID Format

- [ ] Telegram chat IDs: prefix with `tg:` เพื่อแยกจาก WhatsApp JIDs
  - Personal: `tg:123456789`
  - Group: `tg:-100123456789`
- [ ] ปรับ router ให้ handle `tg:` prefix

### Webhook Setup (via Caddy)

- [ ] เพิ่มใน Caddyfile:
  ```
  yourdomain.com {
    handle /telegram/webhook {
      reverse_proxy nanoclaw:3001
    }
  }
  ```
- [ ] NanoClaw internal HTTP server (from health-monitor) → handle `/telegram/webhook`

### Channel Registration

- [ ] แก้ `src/index.ts`:
  ```typescript
  const channels: Channel[] = [
    new WhatsAppChannel(),
    new TelegramChannel(),
  ];
  
  for (const channel of channels) {
    await channel.connect();
    channelManager.register(channel);
  }
  ```

### ทดสอบ

- [ ] ส่ง message ผ่าน Telegram → agent response ถูกต้อง
- [ ] `/status` → ได้ system status
- [ ] Alert (WhatsApp down) → Telegram notification received
- [ ] Long message (>4096 chars) → split correctly
- [ ] Group message → trigger pattern works
- [ ] Photo → handled (download at least)

---

## 🧪 Definition of Done

1. Telegram bot receives + responds to messages
2. Admin commands work (`/status`, `/health`, `/tasks`)
3. Alerts sent via Telegram
4. Webhook mode operational (via Caddy)
5. Messages integrated with NanoClaw message bus

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `src/channels/telegram.ts` | NanoClaw | **Create** — Telegram channel |
| `src/index.ts` | NanoClaw | Register Telegram channel |
| `src/config.ts` | NanoClaw | Add Telegram config |
| `package.json` | NanoClaw | Add telegraf dependency |
| `Caddyfile` | JellyCore | Add webhook route |

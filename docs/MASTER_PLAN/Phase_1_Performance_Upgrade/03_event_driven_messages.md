# 1.3 — Event-Driven Message Handling

> แก้จุดอ่อน: P4 (2-Second Polling Message Loop)

**Status:** ✅ Complete  
**Effort:** Medium  
**Priority:** 🟡 Medium

---

## 📋 ปัญหาเดิม

Messages ถูกตรวจพบผ่าน SQLite polling ทุก 2 วินาที → latency 0-2s ต่อ message

**ที่มา:** NanoClaw `src/config.ts` (`POLL_INTERVAL = 2000`), `src/index.ts` (message loop)

---

## 🎯 เป้าหมาย

เปลี่ยนเป็น **EventEmitter pattern** — channel emit event ทันทีเมื่อ receive message → router process ทันที  
เก็บ polling เป็น fallback (30s interval) สำหรับ catch missed events

---

## ✅ Checklist

### สร้าง MessageBus

- [ ] สร้าง `src/message-bus.ts`:
  ```typescript
  import { EventEmitter } from 'events';
  
  class MessageBus extends EventEmitter {
    emit(event: 'message', data: IncomingMessage): boolean;
    on(event: 'message', listener: (msg: IncomingMessage) => void): this;
  }
  
  export const messageBus = new MessageBus();
  ```

### ปรับ WhatsApp Channel

- [ ] แก้ `src/channels/whatsapp.ts`:
  - เมื่อ Baileys receive message → `messageBus.emit('message', parsedMsg)` ทันที
  - ยังเขียนลง SQLite ด้วย (สำหรับ persistence + history)
  - ไม่ต้องรอ poll cycle

### ปรับ Telegram Channel (เตรียมไว้)

- [ ] Design `src/channels/telegram.ts` ให้ emit event เช่นเดียวกัน
  - Telegram webhook → parse message → `messageBus.emit('message', parsedMsg)`

### ปรับ Message Loop

- [ ] แก้ `src/index.ts` → `startMessageLoop()`:
  ```typescript
  // Event-driven: process immediately
  messageBus.on('message', async (msg) => {
    await processMessage(msg);
  });
  
  // Fallback poll: catch missed events (every 30s)
  setInterval(async () => {
    const missed = await checkForMissedMessages();
    for (const msg of missed) {
      await processMessage(msg);
    }
  }, 30000);
  ```

### ปรับ Config

- [ ] แก้ `src/config.ts`:
  - `POLL_INTERVAL` → เปลี่ยนจาก `2000` เป็น `30000` (fallback only)
  - เพิ่ม `MESSAGE_MODE: 'event' | 'poll'` → default `'event'`

### ทดสอบ

- [ ] ส่ง WhatsApp message → process ภายใน <100ms (ไม่ต้องรอ 2s poll)
- [ ] ส่ง 10 messages รวดเร็ว → ทุก message ถูก process (ไม่ miss)
- [ ] Kill event listener → fallback poll ยังจับ messages ได้ (ภายใน 30s)
- [ ] Measure: average latency (receive → route to queue) before vs after

---

## 🧪 Definition of Done

1. Message latency (receive → route): <100ms (ลดจาก 0-2s)
2. Fallback poll ทำงาน (30s) สำหรับ missed events
3. ไม่มี message loss ระหว่าง transition

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `src/message-bus.ts` | NanoClaw | **Create** — EventEmitter hub |
| `src/channels/whatsapp.ts` | NanoClaw | Emit events on message receive |
| `src/index.ts` | NanoClaw | Event-driven + fallback poll |
| `src/config.ts` | NanoClaw | Change POLL_INTERVAL to 30s |

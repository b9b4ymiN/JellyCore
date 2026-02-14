# 4.13 — Status Indicators

> ปรับปรุง UX: แสดงสถานะการประมวลผลแบบ real-time ให้ user

**Status:** ⬜ Not Started  
**Effort:** Small  
**Priority:** 🟡 Medium  
**Depends on:** Item 4.2 (Telegram Channel), Item 4.9 (Response Streaming)

---

## 📋 ปัญหาเดิม

- User ส่งข้อความแล้วไม่รู้ว่าเกิดอะไรขึ้น
- ไม่รู้ว่า AI กำลังค้นหา, คิด, หรือ generate
- ข้อความยาว → user คิดว่า bot ค้าง

---

## 🎯 เป้าหมาย

1. Processing status flow: 📥 → 🔍 → 🤔 → ✅
2. Update status message แบบ real-time
3. แสดง stage ที่กำลังทำ + estimated time

---

## ✅ Checklist

### Status Flow

- [ ] Define processing stages:
  ```typescript
  enum ProcessingStage {
    RECEIVED = 'received',      // 📥 รับข้อความแล้ว
    CLASSIFYING = 'classifying', // 🏷️ วิเคราะห์ประเภทคำถาม
    SEARCHING = 'searching',     // 🔍 ค้นหาข้อมูล
    THINKING = 'thinking',       // 🤔 กำลังคิดคำตอบ
    GENERATING = 'generating',   // ✍️ กำลังเขียนคำตอบ
    REFLECTING = 'reflecting',   // 🪞 ตรวจสอบคุณภาพ
    COMPLETE = 'complete',       // ✅ เสร็จสิ้น
    ERROR = 'error',             // ❌ เกิดข้อผิดพลาด
  }
  
  const STAGE_LABELS: Record<ProcessingStage, string> = {
    received: '📥 รับข้อความแล้ว',
    classifying: '🏷️ วิเคราะห์ประเภทคำถาม...',
    searching: '🔍 กำลังค้นหาข้อมูล...',
    thinking: '🤔 กำลังคิดคำตอบ...',
    generating: '✍️ กำลังเขียนคำตอบ...',
    reflecting: '🪞 ตรวจสอบคุณภาพ...',
    complete: '✅ เสร็จสิ้น',
    error: '❌ เกิดข้อผิดพลาด',
  };
  ```

### Status Manager

- [ ] สร้าง `src/status/manager.ts`:
  ```typescript
  class StatusManager {
    private statusMessages: Map<string, StatusState> = new Map();
    
    async updateStatus(
      conversationId: string, 
      stage: ProcessingStage,
      channel: ChannelAdapter
    ): Promise<void> {
      const state = this.statusMessages.get(conversationId);
      const label = STAGE_LABELS[stage];
      const elapsed = state ? Date.now() - state.startedAt : 0;
      
      const statusText = this.buildStatusText(stage, elapsed);
      
      if (!state) {
        // Send initial status message
        const msgId = await channel.sendStatus(statusText);
        this.statusMessages.set(conversationId, {
          messageId: msgId,
          stage,
          startedAt: Date.now(),
        });
      } else {
        // Edit existing status message
        await channel.editStatus(state.messageId, statusText);
        state.stage = stage;
      }
      
      // Clean up on completion
      if (stage === 'complete' || stage === 'error') {
        // Delete status message after 2s (replaced by actual response)
        setTimeout(() => {
          channel.deleteMessage(state?.messageId || '');
          this.statusMessages.delete(conversationId);
        }, 2000);
      }
    }
    
    private buildStatusText(stage: ProcessingStage, elapsed: number): string {
      const progress = this.getProgressBar(stage);
      const time = elapsed > 0 ? ` (${(elapsed / 1000).toFixed(1)}s)` : '';
      return `${progress}\n${STAGE_LABELS[stage]}${time}`;
    }
    
    private getProgressBar(stage: ProcessingStage): string {
      const stages = ['received', 'classifying', 'searching', 'thinking', 'generating', 'reflecting', 'complete'];
      const current = stages.indexOf(stage);
      const total = stages.length - 1;
      const filled = '▓'.repeat(current);
      const empty = '░'.repeat(total - current);
      return `[${filled}${empty}] ${Math.round((current / total) * 100)}%`;
    }
  }
  ```

### Channel Adapters

- [ ] Telegram status adapter:
  ```typescript
  class TelegramStatusAdapter implements ChannelAdapter {
    constructor(private ctx: Context) {}
    
    async sendStatus(text: string): Promise<string> {
      const msg = await this.ctx.reply(text);
      return msg.message_id.toString();
    }
    
    async editStatus(messageId: string, text: string): Promise<void> {
      try {
        await this.ctx.telegram.editMessageText(
          this.ctx.chat!.id,
          parseInt(messageId),
          undefined,
          text
        );
      } catch {
        // Message may have been deleted or rate limited
      }
    }
    
    async deleteMessage(messageId: string): Promise<void> {
      try {
        await this.ctx.telegram.deleteMessage(
          this.ctx.chat!.id,
          parseInt(messageId)
        );
      } catch {
        // Message may already be deleted
      }
    }
  }
  ```

- [ ] WhatsApp status adapter:
  ```typescript
  class WhatsAppStatusAdapter implements ChannelAdapter {
    constructor(private sock: WASocket, private jid: string) {}
    
    async sendStatus(text: string): Promise<string> {
      // WhatsApp: use presence update (composing)
      await this.sock.sendPresenceUpdate('composing', this.jid);
      // Can also send a reaction or status message
      return ''; // WhatsApp doesn't support edit
    }
    
    async editStatus(messageId: string, text: string): Promise<void> {
      // WhatsApp doesn't support editing — keep composing
      await this.sock.sendPresenceUpdate('composing', this.jid);
    }
    
    async deleteMessage(messageId: string): Promise<void> {
      await this.sock.sendPresenceUpdate('available', this.jid);
    }
  }
  ```

### Integration

- [ ] Hook status updates into processing pipeline:
  ```typescript
  async function processMessage(message: IncomingMessage): Promise<void> {
    const status = new StatusManager();
    const channel = createChannelAdapter(message.channel, message.ctx);
    const convId = message.conversationId;
    
    // Stage 1: Received
    await status.updateStatus(convId, 'received', channel);
    
    // Stage 2: Classify
    await status.updateStatus(convId, 'classifying', channel);
    const classification = await classifyQuery(message.text);
    
    // Stage 3: Search (if needed)
    if (classification.needsSearch) {
      await status.updateStatus(convId, 'searching', channel);
      const context = await searchKnowledge(message.text);
    }
    
    // Stage 4: Generate
    await status.updateStatus(convId, 'generating', channel);
    const response = await generateResponse(message.text, context);
    
    // Stage 5: Reflect (if needed)
    if (shouldReflect(classification)) {
      await status.updateStatus(convId, 'reflecting', channel);
      await reflect(message.text, response);
    }
    
    // Complete
    await status.updateStatus(convId, 'complete', channel);
    
    // Send actual response
    await channel.sendResponse(response);
  }
  ```

### ทดสอบ

- [ ] ส่งข้อความ → เห็น status message ทันที
- [ ] Status เปลี่ยน stages: 📥 → 🔍 → 🤔 → ✅
- [ ] Progress bar อัปเดตตาม stage
- [ ] Status message ถูกลบหลังส่งคำตอบจริง
- [ ] WhatsApp: composing indicator ระหว่างประมวลผล
- [ ] Error case → ❌ status แสดง

---

## 🧪 Definition of Done

1. Status message แสดงทันทีหลังรับข้อความ
2. Progress bar + stage label อัปเดต real-time
3. Status message ถูกลบเมื่อส่งคำตอบจริง
4. ทำงานทั้ง Telegram (edit message) และ WhatsApp (presence)
5. Error status แสดงเมื่อเกิดปัญหา

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `src/status/manager.ts` | NanoClaw | **Create** — status manager |
| `src/status/types.ts` | NanoClaw | **Create** — stage definitions |
| `src/channels/telegram/status.ts` | NanoClaw | **Create** — Telegram adapter |
| `src/channels/whatsapp/status.ts` | NanoClaw | **Create** — WhatsApp adapter |
| `src/pipeline/processor.ts` | NanoClaw | Modify — integrate status hooks |

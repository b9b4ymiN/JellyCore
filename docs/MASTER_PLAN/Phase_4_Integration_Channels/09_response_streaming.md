# 4.9 — Response Streaming

> แก้จุดอ่อน: W4 (การตอบกลับข้อความยาวต้องรอจนเสร็จ)

**Status:** ⬜ Not Started  
**Effort:** Medium  
**Priority:** 🟠 High  
**Depends on:** Item 2.7 (IPC Upgrade), Item 1.3 (Event-Driven Messages)

---

## 📋 ปัญหาเดิม

- NanoClaw / Container ต้องรอ Claude response ทั้ง message ก่อน forward ให้ user
- Response ยาว (>1000 chars) ทำให้ user รอ 10-30 วินาทีโดยไม่เห็นอะไร
- Timeout ง่ายเมื่อ response ยาวมาก

---

## 🎯 เป้าหมาย

1. Stream response จาก Claude Agent → Container → NanoClaw → User ทีละ chunk
2. User เห็น text ขึ้นเรื่อยๆ เหมือนพิมพ์สด
3. Telegram: ใช้ `editMessageText` อัปเดต message ทุก ~500ms
4. WhatsApp: ใช้ presence ("typing...") + ส่ง text เป็น chunk

---

## ✅ Checklist

### Streaming Pipeline

- [ ] Container → IPC streaming file:
  ```typescript
  // Container side: write chunks to IPC stream file
  import { appendFileSync } from 'fs';
  
  const IPC_STREAM = '/app/ipc/stream.jsonl';
  const IPC_DONE = '/app/ipc/stream.done';
  
  async function streamToIPC(agentStream: AsyncIterable<string>): Promise<void> {
    let chunkIndex = 0;
    for await (const chunk of agentStream) {
      const line = JSON.stringify({
        index: chunkIndex++,
        text: chunk,
        timestamp: Date.now(),
      });
      appendFileSync(IPC_STREAM, line + '\n');
    }
    // Signal completion
    writeFileSync(IPC_DONE, JSON.stringify({ 
      totalChunks: chunkIndex,
      completedAt: Date.now(),
    }));
  }
  ```

- [ ] NanoClaw: FS watcher อ่าน stream.jsonl:
  ```typescript
  // NanoClaw side: watch for new chunks
  import { watchFile, readFileSync } from 'fs';
  
  async function* readIPCStream(ipcDir: string): AsyncGenerator<string> {
    const streamFile = path.join(ipcDir, 'stream.jsonl');
    const doneFile = path.join(ipcDir, 'stream.done');
    let lastLine = 0;
    
    while (true) {
      // Read new lines
      const lines = readFileSync(streamFile, 'utf-8').split('\n').filter(Boolean);
      for (let i = lastLine; i < lines.length; i++) {
        const chunk = JSON.parse(lines[i]);
        yield chunk.text;
      }
      lastLine = lines.length;
      
      // Check if done
      if (existsSync(doneFile)) break;
      
      // Poll interval
      await sleep(200);
    }
  }
  ```

### Telegram Streaming

- [ ] Telegram: initial message + progressive edit:
  ```typescript
  // Telegram streaming handler
  async function streamToTelegram(
    ctx: Context,
    chunks: AsyncGenerator<string>
  ): Promise<void> {
    let fullText = '';
    let messageId: number | null = null;
    let lastEditTime = 0;
    const EDIT_INTERVAL = 500; // ms between edits
    const MIN_CHUNK_SIZE = 50; // chars before first edit
    
    for await (const chunk of chunks) {
      fullText += chunk;
      
      const now = Date.now();
      
      if (!messageId && fullText.length >= MIN_CHUNK_SIZE) {
        // Send initial message
        const msg = await ctx.reply(fullText + ' ▌');
        messageId = msg.message_id;
        lastEditTime = now;
      } else if (messageId && now - lastEditTime >= EDIT_INTERVAL) {
        // Edit with accumulated text
        try {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            messageId,
            undefined,
            fullText + ' ▌', // cursor indicator
            { parse_mode: 'Markdown' }
          );
          lastEditTime = now;
        } catch (e) {
          // Telegram throttle — skip this edit
        }
      }
    }
    
    // Final edit (remove cursor)
    if (messageId) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        messageId,
        undefined,
        fullText,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply(fullText);
    }
  }
  ```

### WhatsApp Streaming

- [ ] WhatsApp: presence + chunked send:
  ```typescript
  // WhatsApp streaming (Baileys)
  async function streamToWhatsApp(
    sock: WASocket,
    jid: string,
    chunks: AsyncGenerator<string>
  ): Promise<void> {
    let fullText = '';
    let chunkCount = 0;
    
    // Show typing indicator
    await sock.presenceSubscribe(jid);
    await sock.sendPresenceUpdate('composing', jid);
    
    for await (const chunk of chunks) {
      fullText += chunk;
      chunkCount++;
    }
    
    // Send complete message (WhatsApp doesn't support edit)
    await sock.sendMessage(jid, { text: fullText });
    await sock.sendPresenceUpdate('available', jid);
  }
  ```

### Timeout Protection

- [ ] Streaming heartbeat ป้องกัน timeout:
  ```typescript
  // Heartbeat: ถ้าไม่มี chunk ใหม่ > 30s → timeout
  const STREAM_TIMEOUT = 30000;
  let lastChunkTime = Date.now();
  
  const timeoutCheck = setInterval(() => {
    if (Date.now() - lastChunkTime > STREAM_TIMEOUT) {
      clearInterval(timeoutCheck);
      throw new Error('Stream timeout: no data for 30s');
    }
  }, 5000);
  ```

### Edge Cases

- [ ] Handle connection drop mid-stream → retry from last chunk
- [ ] Handle Telegram rate limit (30 edits/minute) → adaptive interval
- [ ] Handle markdown rendering issues during streaming
- [ ] Handle empty stream → fallback to non-streaming response
- [ ] Clean up IPC stream files after completion

### ทดสอบ

- [ ] Short response (<100 chars) → ส่งปกติไม่ stream
- [ ] Long response (>500 chars) → stream ทีละ chunk
- [ ] Telegram: message อัปเดตทุก ~500ms (ดูได้ว่ากำลังพิมพ์)
- [ ] WhatsApp: แสดง "composing" ระหว่างรอ
- [ ] Stream timeout 30s → error message ส่งให้ user
- [ ] Chunk rate < 200ms → อ่าน IPC ทัน

---

## 🧪 Definition of Done

1. Claude response streamed ผ่าน IPC → NanoClaw → Channel
2. Telegram user เห็น text ขึ้นแบบ progressive
3. WhatsApp แสดง typing indicator
4. Timeout protection ทำงาน
5. ไม่มี resource leak (IPC files cleaned up)

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| Container agent-runner | NanoClaw | Modify — stream to IPC file |
| `src/ipc/stream-reader.ts` | NanoClaw | **Create** — FS watcher |
| `src/channels/telegram/stream.ts` | NanoClaw | **Create** — Telegram streaming |
| `src/channels/whatsapp/stream.ts` | NanoClaw | **Create** — WhatsApp streaming |

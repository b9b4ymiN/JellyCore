# 3.1 — WhatsApp Connection Resilience

> แก้จุดอ่อน: R1 (WhatsApp Connection Fragility — process.exit on loggedOut)

**Status:** ⬜ Not Started  
**Effort:** Medium  
**Priority:** 🟠 High

---

## 📋 ปัญหาเดิม

WhatsApp `loggedOut` event → `process.exit(1)` → ทั้งระบบล่ม  
ต้อง scan QR ใหม่ด้วยมือ — service offline จนมนุษย์ intervene

**ที่มา:** NanoClaw `src/channels/whatsapp.ts`

---

## ✅ Checklist

### Connection State Machine

- [ ] แก้ `src/channels/whatsapp.ts` → implement state machine:
  ```
  States: connecting → connected → disconnected → reconnecting → degraded → logged_out
  
  Transitions:
  connected → disconnected:    auto-reconnect
  disconnected → reconnecting: exponential backoff (5s → 10s → 30s → 60s → 5min)
  reconnecting → connected:    success → reset retry count
  reconnecting → degraded:     max retries (5) reached → switch to Telegram-only
  connected → logged_out:      session invalidated → alert + degraded mode (ไม่ exit)
  ```

### Remove process.exit on loggedOut

- [ ] แก้ `loggedOut` handler:
  ```typescript
  // BEFORE:
  process.exit(1);
  
  // AFTER:
  this.state = 'logged_out';
  this.emit('critical_auth_failure');
  // Continue running with Telegram channel only
  ```

### Auto-Reconnect

- [ ] Implement exponential backoff reconnect:
  ```typescript
  async reconnect(): Promise<void> {
    const delays = [5000, 10000, 30000, 60000, 300000]; // 5s → 5min
    
    for (let attempt = 0; attempt < delays.length; attempt++) {
      this.state = 'reconnecting';
      log.info(`WhatsApp reconnect attempt ${attempt + 1}/${delays.length}`);
      
      try {
        await this.connect();
        this.state = 'connected';
        log.info('WhatsApp reconnected successfully');
        return;
      } catch (err) {
        log.warn(`Reconnect failed: ${err.message}`);
        await sleep(delays[attempt]);
      }
    }
    
    this.state = 'degraded';
    this.emit('enter_degraded_mode');
  }
  ```

### Degraded Mode

- [ ] เมื่อ WhatsApp unavailable:
  - System ยังทำงานได้ผ่าน Telegram
  - WhatsApp messages queue ใน SQLite (จะ process เมื่อ reconnect)
  - Health monitor report: "WhatsApp: DEGRADED"
  - Alert admin ทุก 1 ชั่วโมงจนกว่าจะ fix

### Remote QR Re-Auth (Optional)

- [ ] เมื่อ session invalidated → generate QR code → ส่งเป็นรูปผ่าน Telegram:
  ```typescript
  onQrCode(qr: string) {
    const qrImage = await qrcodeToBuffer(qr);
    await telegramBot.sendPhoto(ADMIN_CHAT_ID, qrImage, {
      caption: '📱 Scan QR เพื่อ reconnect WhatsApp'
    });
  }
  ```
  - Admin scan QR จาก Telegram → WhatsApp reconnect

### ทดสอบ

- [ ] Simulate network disconnect → auto-reconnect ภายใน 30s
- [ ] Simulate 5 failed reconnects → enter degraded mode (ไม่ crash)
- [ ] Simulate loggedOut → alert sent + system continues
- [ ] Reconnect success → queued messages processed
- [ ] Health check → reports correct WhatsApp state

---

## 🧪 Definition of Done

1. WhatsApp disconnect → auto-reconnect (max 5 retries)
2. `loggedOut` → degraded mode + alert (ไม่ exit process)
3. System continues via Telegram when WhatsApp down
4. Admin alerted with recovery instructions

---

## 📎 Files to Modify

| File | Repo | Action |
|------|------|--------|
| `src/channels/whatsapp.ts` | NanoClaw | State machine + remove process.exit |
| `src/index.ts` | NanoClaw | Handle degraded mode event |
| `src/health-monitor.ts` | NanoClaw | Report WhatsApp state |

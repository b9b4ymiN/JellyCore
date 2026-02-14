# 3.2 — Partial Output Recovery

> แก้จุดอ่อน: R2 (Partial Output Error Recovery Gaps)

**Status:** ⬜ Not Started  
**Effort:** Small  
**Priority:** 🟡 Medium

---

## 📋 ปัญหาเดิม

Container crash mid-stream → user เห็น truncated response + message marked processed → ไม่ retry

**ที่มา:** NanoClaw `src/index.ts`

---

## ✅ Checklist

### Detect Incomplete Response

- [ ] ตรวจ response completeness:
  ```typescript
  // Container output framed with markers
  const hasEndMarker = output.includes('---NANOCLAW_OUTPUT_END---');
  
  if (!hasEndMarker && output.length > 0) {
    // Partial output detected
    handlePartialOutput(chatJid, output, originalMessage);
  }
  ```

### Handle Partial Output

- [ ] สร้าง recovery flow:
  ```typescript
  async function handlePartialOutput(chatJid, partialOutput, originalMessage) {
    // 1. Notify user
    await channel.sendMessage(chatJid, 
      '⚠️ ขออภัย เกิดข้อผิดพลาดระหว่างประมวลผล กำลังลองใหม่...'
    );
    
    // 2. Auto-retry (max 1 retry)
    const retryCount = getRetryCount(chatJid, originalMessage.id);
    if (retryCount < 1) {
      incrementRetryCount(chatJid, originalMessage.id);
      await enqueueMessage(chatJid, originalMessage, 'high');  // priority retry
    } else {
      // 3. Give up after 1 retry
      await channel.sendMessage(chatJid,
        '❌ ไม่สามารถประมวลผลได้ กรุณาลองส่งข้อความใหม่'
      );
      await alertAdmin(`Partial output failure for ${chatJid}`);
    }
  }
  ```

### Container Exit Code Handling

- [ ] ตรวจ container exit code:
  ```
  Exit 0 + end marker = success
  Exit 0 + no end marker = partial (stream cut off)
  Exit non-zero = error
  Exit 137 (SIGKILL) = OOM or timeout
  ```

### ทดสอบ

- [ ] Simulate container crash mid-output → user gets "กำลังลองใหม่..."
- [ ] Retry succeeds → user gets complete response
- [ ] Retry fails → user gets error message + admin alerted
- [ ] Complete response → no retry triggered

---

## 🧪 Definition of Done

1. Partial output detected via missing end marker
2. User notified + auto-retry (1 attempt)
3. Retry failure → error message + admin alert
4. Normal responses unaffected

---

## 📎 Files to Modify

| File | Repo | Action |
|------|------|--------|
| `src/index.ts` or `src/group-queue.ts` | NanoClaw | Detect + handle partial output |
| `src/container-runner.ts` | NanoClaw | Parse exit code |

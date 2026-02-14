# 2.6 — Rate Limiter

> แก้จุดอ่อน: A6 (No Rate Limiting on User Messages)

**Status:** ⬜ Not Started  
**Effort:** Small  
**Priority:** 🟡 Medium

---

## 📋 ปัญหาเดิม

ทุก incoming message trigger pipeline เต็มรูปแบบ ไม่มี throttle  
Message flood = exhaust container slots + multiply API costs

**ที่มา:** NanoClaw `src/index.ts`, `src/group-queue.ts`

---

## ✅ Checklist

### สร้าง Rate Limiter Module

- [ ] สร้าง `src/rate-limiter.ts`:
  ```typescript
  interface RateLimitConfig {
    perUser: { maxPerMinute: number; maxPerHour: number };
    perGroup: { maxPerMinute: number };
    global: { maxPerMinute: number };
  }
  
  const DEFAULT_CONFIG: RateLimitConfig = {
    perUser: { maxPerMinute: 10, maxPerHour: 50 },
    perGroup: { maxPerMinute: 30 },
    global: { maxPerMinute: 100 },
  };
  ```

### Sliding Window Implementation

- [ ] Implement ด้วย SQLite (persist across restarts):
  ```sql
  CREATE TABLE IF NOT EXISTS rate_limit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,     -- 'user:{jid}' | 'group:{jid}' | 'global'
    timestamp INTEGER NOT NULL
  );
  CREATE INDEX idx_rate_limit ON rate_limit_events(scope, timestamp);
  ```
  
- [ ] `checkRateLimit(scope, limit, windowMs)`:
  ```typescript
  function checkRateLimit(scope: string, limit: number, windowMs: number): boolean {
    const count = db.prepare(
      'SELECT COUNT(*) as c FROM rate_limit_events WHERE scope = ? AND timestamp > ?'
    ).get(scope, Date.now() - windowMs);
    return count.c < limit;
  }
  ```

### Integrate with Message Router

- [ ] แก้ `src/index.ts` → message processing:
  ```typescript
  // Check rate limits before processing
  const userScope = `user:${message.sender}`;
  const groupScope = `group:${message.chatJid}`;
  
  if (!checkRateLimit(userScope, config.perUser.maxPerMinute, 60000)) {
    await channel.sendMessage(chatJid, '⏳ ส่งข้อความเร็วเกินไป กรุณารอสักครู่');
    return; // Drop message
  }
  if (!checkRateLimit(groupScope, config.perGroup.maxPerMinute, 60000)) {
    return; // Silent drop for group flood
  }
  if (!checkRateLimit('global', config.global.maxPerMinute, 60000)) {
    return; // Silent drop
  }
  
  // Record event
  recordRateLimitEvent(userScope);
  recordRateLimitEvent(groupScope);
  recordRateLimitEvent('global');
  ```

### Configurable Per-Group

- [ ] Main group → higher limits (เช่น 30/min)
- [ ] Registered groups → default limits
- [ ] เก็บ limit config ใน `registered_groups` table (override per group)

### Cleanup

- [ ] Periodic cleanup (ทุก 1 ชั่วโมง):
  ```sql
  DELETE FROM rate_limit_events WHERE timestamp < ?  -- older than 2 hours
  ```

### ทดสอบ

- [ ] ส่ง 10 messages ใน 1 นาที → ทั้งหมด processed
- [ ] ส่ง message ที่ 11 → ได้ "ส่งเร็วเกินไป" + message dropped
- [ ] รอ 1 นาที → ส่งได้อีก
- [ ] Main group → higher limit (30/min) ทำงาน
- [ ] Restart → rate limit state persisted

---

## 🧪 Definition of Done

1. Per-user: 10 msg/min enforced
2. Exceeded → user gets feedback message
3. Per-group + global limits enforced
4. State persisted across restarts
5. Main group has higher limits

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `src/rate-limiter.ts` | NanoClaw | **Create** — sliding window rate limiter |
| `src/db.ts` | NanoClaw | Add rate_limit_events table |
| `src/index.ts` | NanoClaw | Integrate rate limit checks |
| `src/config.ts` | NanoClaw | Add rate limit config |

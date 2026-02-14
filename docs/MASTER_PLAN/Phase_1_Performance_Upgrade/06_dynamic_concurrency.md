# 1.6 — Dynamic Concurrency + Backpressure

> แก้จุดอ่อน: P7 (Fixed Concurrency Limit, No Backpressure)

**Status:** ✅ Complete  
**Effort:** Medium  
**Priority:** 🟢 Low-Medium

---

## 📋 ปัญหาเดิม

- Concurrency limit hardcoded 5 → ไม่ปรับตาม system resources
- Overflow → unbounded in-memory array → user ไม่รู้ว่า message queued
- ไม่มี priority system

**ที่มา:** NanoClaw `src/config.ts`, `src/group-queue.ts`

---

## ✅ Checklist

### Dynamic Concurrency

- [ ] สร้าง `src/resource-monitor.ts`:
  - Monitor CPU usage (`os.loadavg()`)
  - Monitor memory (`os.freemem() / os.totalmem()`)
  - Calculate optimal concurrency:
    ```
    base = MAX_CONCURRENT_CONTAINERS (from env, default 5)
    if CPU load > 80%: reduce by 1
    if free memory < 20%: reduce by 1
    min: 1, max: base
    ```

### Priority Queue

- [ ] แก้ `src/group-queue.ts`:
  - Priority levels: `high` (main group) > `normal` (registered) > `low` (new)
  - Sorted insertion ใน waiting queue

### Queue Size Limit

- [ ] เพิ่ม max queue size: 20 (configurable via `MAX_QUEUE_SIZE`)
- [ ] เมื่อ queue เต็ม → reject ด้วย message:
  ```
  "ระบบยุ่งมาก กรุณาลองใหม่ในอีกสักครู่"
  ```

### Backpressure Notification

- [ ] เมื่อ message ถูก queue (ไม่ process ทันที):
  - ส่ง feedback ทันที: "📋 ข้อความของคุณอยู่ในคิว (ลำดับที่ {n}) กำลังรอ..."
  - เมื่อถึงคิว: process ปกติ

### ทดสอบ

- [ ] 5 containers active + message ใหม่ → ได้ "อยู่ในคิว" feedback
- [ ] Queue เต็ม (20) + message → ได้ "ระบบยุ่ง" rejection
- [ ] High CPU → concurrency ลดลงอัตโนมัติ
- [ ] Main group message → priority สูงกว่า → ได้ process ก่อน

---

## 🧪 Definition of Done

1. User ได้ feedback เมื่อ message ถูก queue
2. Queue มี size limit + rejection message
3. Priority queue ทำงาน (main > registered > new)

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `src/resource-monitor.ts` | NanoClaw | **Create** — CPU/memory monitor |
| `src/group-queue.ts` | NanoClaw | Priority queue + size limit + backpressure |
| `src/config.ts` | NanoClaw | Add MAX_QUEUE_SIZE |

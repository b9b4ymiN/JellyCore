# Phase 6 — Scheduler Hardening + Heartbeat System

**สร้าง:** 19 กุมภาพันธ์ 2026  
**Priority:** High  
**Scope:** Lean — แก้ bugs จริง, เพิ่ม features ที่จำเป็น, ไม่ bloat

---

## 🔍 วิเคราะห์ปัญหาที่พบจริง

จาก log การสนทนาบน Telegram และการเปรียบเทียบระบบ OpenClaw:

### Bug ที่ยืนยันแล้ว

| # | ปัญหา | Root Cause | Impact |
|---|-------|-----------|--------|
| B1 | Next run time แสดงผิด | `next_run` คำนวณด้วย `Date.toISOString()` (UTC) แต่แสดงผลไม่ตรง timezone | ผู้ใช้สับสน ตั้งเวลาผิด |
| B2 | Task ที่ cancel ยังแสดงอยู่ | DB `status = 'paused'` ไม่ใช่ `'cancelled'` — ไม่มี status นี้ใน enum | Agent เห็น tasks เก่า |
| B3 | Scheduler drift ±60s | Poll loop 60 วิ — task ที่ควรรันตอนนี้ อาจรอ 60 วิ | งานสำคัญล่าช้า |
| B4 | Tasks ซ้ำกัน | ไม่มี duplicate guard เมื่อ create task | รัน 2 ครั้ง waste resources |
| B5 | ไม่มี retry | Task fail → log error → รอ next scheduled time | งานล้มเหลวเงียบๆ |
| B6 | ไม่มี task timeout | Container อาจค้างตลอดกาล | Resource leak |

### ช่องว่างเมื่อเทียบ OpenClaw

```
OpenClaw ✅          NanoClaw ❌ (missing)
─────────────────────────────────────────
Per-job timezone    → Host TZ only
Retry backoff       → No retry
Top-of-hour stagger → No stagger  
Heartbeat/health    → No visibility
Duplicate guard     → Create duplicates
```

---

## 🎯 เป้าหมาย Phase 6

> **ลีน**: Fix bugs จริง + เพิ่ม Heartbeat + ปรับ Scheduler ให้แม่นยำ  
> **ไม่เพิ่ม**: Webhook delivery, Discord/Signal, complex session targeting (ไว้ Phase อื่น)

---

## 📋 แผนงาน

### Sprint 1 — Bug Fixes (วันนี้)

#### 1.1 เพิ่ม `cancelled` status + fix enum

**File:** `nanoclaw/src/types.ts`

```typescript
// Before
status: 'active' | 'paused' | 'completed';

// After
status: 'active' | 'paused' | 'completed' | 'cancelled';
```

**File:** `nanoclaw/src/db.ts` — migration
```sql
-- ไม่ต้อง ALTER TABLE เพราะ SQLite TEXT column รับ any value
-- แค่ update business logic ใน code
```

Agent ที่ list tasks ต้องไม่แสดง `cancelled` tasks  
IPC delete → set `status = 'cancelled'` แทน hard delete เพื่อ audit trail

---

#### 1.2 Fix timezone display + validate cron expression ตอน create

**File:** `nanoclaw/src/task-scheduler.ts`

ปัญหา: `next_run` เก็บเป็น ISO UTC string แต่ agents/UI แสดงแบบ UTC ทำให้สับสน

**Fix:** เพิ่ม human-readable `next_run_local` ใน task snapshot ที่ส่งให้ agent

```typescript
// writeTasksSnapshot ต้องเพิ่ม field
{
  id: t.id,
  next_run: t.next_run,                         // UTC ISO (ไว้ sort/compare)
  next_run_local: t.next_run                     // แปลงเป็น TZ ของระบบสำหรับแสดงผล
    ? new Date(t.next_run).toLocaleString('th-TH', { 
        timeZone: TIMEZONE,
        dateStyle: 'short',
        timeStyle: 'short'
      })
    : null,
  timezone: TIMEZONE,                            // บอก agent ว่า TZ คืออะไร
  ...
}
```

---

#### 1.3 Duplicate task guard

**File:** `nanoclaw/src/db.ts`

```typescript
export function findDuplicateTask(
  groupFolder: string,
  scheduleValue: string,
  promptHash: string,
): ScheduledTask | undefined {
  return db.prepare(`
    SELECT * FROM scheduled_tasks
    WHERE group_folder = ?
      AND schedule_value = ?
      AND hex(substr(prompt, 1, 100)) = ?
      AND status IN ('active', 'paused')
    LIMIT 1
  `).get(groupFolder, scheduleValue, promptHash) as ScheduledTask | undefined;
}
```

IPC `create_task` ต้อง check ก่อน create

---

### Sprint 2 — Scheduler Precision  

#### 2.1 ลด Poll Interval จาก 60s → 10s

**File:** `nanoclaw/src/config.ts`

```typescript
// Before
export const SCHEDULER_POLL_INTERVAL = 60000; // 60s drift

// After  
export const SCHEDULER_POLL_INTERVAL = parseInt(
  process.env.SCHEDULER_POLL_INTERVAL || '10000',
  10,
); // 10s — ±10s drift แทน ±60s
```

**Impact:** CPU เพิ่มขึ้นน้อยมาก (10ms/10s = 0.1%) แต่ได้ความแม่นยำ 6x ดีขึ้น

---

#### 2.2 เพิ่ม Retry Logic (Simple — ไม่ exponential ซับซ้อน)

**File:** `nanoclaw/src/types.ts`

```typescript
export interface ScheduledTask {
  // ... existing fields ...
  retry_count: number;       // consecutive failures
  max_retries: number;       // 0 = no retry
  retry_delay_ms: number;    // ms ระหว่าง retry (default 300000 = 5 min)
}
```

**File:** `nanoclaw/src/task-scheduler.ts`

```typescript
// หลังจาก runTask fail:
if (error && task.max_retries > 0 && task.retry_count < task.max_retries) {
  const retryAt = new Date(Date.now() + task.retry_delay_ms).toISOString();
  updateTask(task.id, { 
    next_run: retryAt,
    // increment retry_count ใน DB
  });
  logger.warn({ taskId: task.id, retryAt, retryCount: task.retry_count + 1 }, 'Task failed, scheduled retry');
} else if (error) {
  // หมด retry หรือ max_retries = 0
  logTaskRun({ ...error case... });
}
```

**DB Migration:**
```sql
ALTER TABLE scheduled_tasks ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE scheduled_tasks ADD COLUMN max_retries INTEGER DEFAULT 0;
ALTER TABLE scheduled_tasks ADD COLUMN retry_delay_ms INTEGER DEFAULT 300000;
```

---

#### 2.3 Task Timeout

เพิ่ม `task_timeout_ms` ใน ScheduledTask — ถ้า container ไม่ตอบภายใน timeout → force kill + log error

```typescript
// task-scheduler.ts runTask()
const taskTimeout = task.task_timeout_ms || CONTAINER_TIMEOUT;
const timeoutGuard = setTimeout(() => {
  logger.error({ taskId: task.id }, 'Task hard timeout reached, aborting');
  deps.queue.closeStdin(task.chat_jid);
  // force stop container via queue
}, taskTimeout);

try {
  await runContainerAgent(...)
} finally {
  clearTimeout(timeoutGuard);
}
```

---

### Sprint 3 — Heartbeat System ❤️

สิ่งที่ขาดที่สุดคือ **visibility** — ไม่รู้ว่าระบบยังทำงานอยู่ไหม

#### 3.1 Design: Heartbeat คืออะไร

```
Heartbeat = ping ที่ระบบส่งมาบอกว่า "ยังอยู่นะ" ทุก N นาที

ส่งผ่าน Telegram ถ้าไม่มีกิจกรรม > X นาที
รายงาน:
  - สถานะ containers
  - Queue depth
  - Tasks due ใน 24h
  - Errors ล่าสุด
  - Memory/CPU
```

#### 3.2 Implementation

**File ใหม่:** `nanoclaw/src/heartbeat.ts`

```typescript
import { logger } from './logger.js';
import { recentErrors } from './health-server.js';
import { getDueTasks, getAllTasks } from './db.js';
import { TIMEZONE } from './config.js';

export interface HeartbeatConfig {
  intervalMs: number;          // ส่งทุก N ms (default: 6h)
  silenceThresholdMs: number;  // ส่ง heartbeat ถ้าเงียบนาน (default: 30 min)
  sendMessage: (jid: string, text: string) => Promise<void>;
  getStatus: () => {
    activeContainers: number;
    queueDepth: number;
    registeredGroups: string[];
  };
  mainGroupJid: string;        // ส่งไปที่ main group
}

let lastActivityTime = Date.now();

// เรียกนี้ทุกครั้งที่มี activity (message, task run, etc.)
export function recordActivity(): void {
  lastActivityTime = Date.now();
}

export function startHeartbeat(config: HeartbeatConfig): () => void {
  const sendHeartbeat = async (reason: 'scheduled' | 'silence') => {
    try {
      const status = config.getStatus();
      const now = new Date();
      const timeLabel = now.toLocaleString('th-TH', {
        timeZone: TIMEZONE,
        dateStyle: 'short',
        timeStyle: 'short'
      });

      // Tasks due in next 24h
      const allTasks = getAllTasks().filter(t => t.status === 'active');
      const dueSoon = allTasks.filter(t => {
        if (!t.next_run) return false;
        const diff = new Date(t.next_run).getTime() - Date.now();
        return diff > 0 && diff < 24 * 60 * 60 * 1000;
      });

      const errors = recentErrors.slice(-3);
      const errorText = errors.length > 0
        ? `\n⚠️ ข้อผิดพลาดล่าสุด:\n${errors.map(e => `  • ${e.message.slice(0, 60)}`).join('\n')}`
        : '';

      const taskText = dueSoon.length > 0
        ? `\n📅 Tasks ใน 24h: ${dueSoon.length} รายการ`
        : '\n📅 ไม่มี tasks ที่จะรันใน 24h';

      const msg = [
        reason === 'silence' ? '💤 Silence Heartbeat' : '💓 Heartbeat',
        `🕐 ${timeLabel}`,
        `🐳 Containers: ${status.activeContainers} active | Queue: ${status.queueDepth}`,
        `📡 Groups: ${status.registeredGroups.length} registered`,
        taskText,
        errorText,
        `\n✅ ระบบทำงานปกติ`,
      ].filter(Boolean).join('\n');

      await config.sendMessage(config.mainGroupJid, msg);
      logger.info({ reason }, 'Heartbeat sent');
    } catch (err) {
      logger.warn({ err }, 'Heartbeat send failed');
    }
  };

  // Scheduled heartbeat (every N hours)
  const scheduledTimer = setInterval(() => {
    sendHeartbeat('scheduled');
  }, config.intervalMs);

  // Silence heartbeat (ถ้าเงียบนาน)
  const silenceTimer = setInterval(() => {
    const silentMs = Date.now() - lastActivityTime;
    if (silentMs > config.silenceThresholdMs) {
      sendHeartbeat('silence');
      lastActivityTime = Date.now(); // reset เพื่อไม่ส่งซ้ำ
    }
  }, Math.min(config.silenceThresholdMs / 2, 10 * 60 * 1000));

  // Cleanup
  return () => {
    clearInterval(scheduledTimer);
    clearInterval(silenceTimer);
  };
}
```

#### 3.3 ตัวอย่าง Heartbeat message

```
💓 Heartbeat
🕐 19/2/2569 18:00
🐳 Containers: 0 active | Queue: 0
📡 Groups: 2 registered
📅 Tasks ใน 24h: 3 รายการ

✅ ระบบทำงานปกติ
```

```
💤 Silence Heartbeat  
🕐 19/2/2569 22:30
🐳 Containers: 0 active | Queue: 0
📡 Groups: 2 registered
📅 ไม่มี tasks ที่จะรันใน 24h
⚠️ ข้อผิดพลาดล่าสุด:
  • Container spawn timeout (task-abc123)

✅ ระบบทำงานปกติ (ไม่มีกิจกรรม 2 ชม.)
```

#### 3.4 Config (env vars)

```env
# heartbeat ทุก 6 ชม. (default)
HEARTBEAT_INTERVAL_HOURS=6
# ถ้าเงียบ 2 ชม. ให้ส่ง silence heartbeat  
HEARTBEAT_SILENCE_THRESHOLD_HOURS=2
# ปิด heartbeat
HEARTBEAT_ENABLED=true
```

---

### Sprint 4 — IPC & Agent UX

#### 4.1 fix IPC task management

Agent ต้องสั่งได้:
- `list_tasks` → แสดงเฉพาะ `active` + `paused` (ไม่แสดง `cancelled`)
- `cancel_task` → set `status = 'cancelled'` (ไม่ delete ทิ้ง)
- `pause_task` / `resume_task` → toggle `active`/`paused`
- `run_task_now` → trigger immediate run (bypass schedule)

**File:** `nanoclaw/src/ipc.ts` — เพิ่ม IPC commands

```typescript
// เพิ่ม case ใหม่
case 'run_task_now': {
  const task = getTaskById(data.task_id);
  if (!task || task.status !== 'active') {
    writeIpcResponse(file, { success: false, error: 'Task not found or not active' });
    return;
  }
  // force next_run = now
  updateTask(task.id, { next_run: new Date().toISOString() });
  writeIpcResponse(file, { success: true });
  break;
}

case 'cancel_task': {
  updateTask(data.task_id, { status: 'cancelled' });
  writeIpcResponse(file, { success: true });
  break;
}
```

---

## 📊 สรุปไฟล์ที่ต้องแก้ไข

```
nanoclaw/src/
├── config.ts           ← SCHEDULER_POLL_INTERVAL: 60000 → 10000
│                          HEARTBEAT_INTERVAL_HOURS, HEARTBEAT_SILENCE_THRESHOLD_HOURS
├── types.ts            ← ScheduledTask: เพิ่ม cancelled status, retry fields, task_timeout_ms
├── db.ts               ← migration: retry columns, findDuplicateTask(), hard cancel
├── task-scheduler.ts   ← retry logic, task timeout guard, next_run_local
├── ipc.ts              ← run_task_now, cancel_task, pause/resume
├── index.ts            ← integrate heartbeat, recordActivity() on messages/tasks
└── heartbeat.ts        ← NEW: Heartbeat system
```

---

## 📈 Expected Outcomes

| Metric | Before | After |
|--------|--------|-------|
| Scheduler drift | ±60s | ±10s |
| Task visibility | ❌ ไม่รู้สถานะ | ✅ Heartbeat แจ้งทุก 6h |
| Failed task retry | ❌ ไม่มี | ✅ configurable |
| Duplicate tasks | ✅ สร้างซ้ำได้ | ❌ blocked |
| Cancel clarity | ❌ ไม่ clear | ✅ status = cancelled |
| Next run display | ❌ UTC confusing | ✅ local TH time |
| Task hung forever | ✅ เป็นได้ | ❌ timeout guard |

---

## 🚫 สิ่งที่ไม่ทำใน Phase นี้ (Keep Lean)

- ~~Webhook delivery~~ — ไม่มี use case ตอนนี้
- ~~Per-job timezone~~ — Host TZ เดียวพอสำหรับทีมเดียว
- ~~Stagger calculator~~ — Tasks ไม่ได้ top-of-hour flood

---

## Implementation Order

```
Day 1: Bug fixes (B1-B5) — ไม่ต้อง deploy ใหม่มาก
  └─ types.ts cancelled status
  └─ config.ts poll 10s  
  └─ db.ts duplicate guard
  └─ task-scheduler.ts next_run_local + retry

Day 2: Heartbeat
  └─ heartbeat.ts (new file)
  └─ index.ts integration
  └─ config.ts env vars

Day 3: IPC improvements
  └─ ipc.ts cancel/pause/resume/run_now
  └─ test end-to-end
```

# 3.3 — Task Scheduler Circuit Breaker

> แก้จุดอ่อน: R5 (Task Scheduler Has No Circuit Breaker)

**Status:** ⬜ Not Started  
**Effort:** Small  
**Priority:** 🟢 Low-Medium

---

## 📋 ปัญหาเดิม

Failed scheduled tasks retry ทุก scheduled interval → consume containers + API credits ไม่มีที่สิ้นสุด

**ที่มา:** NanoClaw `src/task-scheduler.ts`

---

## ✅ Checklist

### Add Failure Tracking

- [ ] เพิ่ม columns ใน `scheduled_tasks` table (via migration):
  ```sql
  ALTER TABLE scheduled_tasks ADD COLUMN consecutive_failures INTEGER DEFAULT 0;
  ALTER TABLE scheduled_tasks ADD COLUMN disabled_at TEXT;
  ALTER TABLE scheduled_tasks ADD COLUMN disable_reason TEXT;
  ```

### Implement Circuit Breaker

- [ ] แก้ `src/task-scheduler.ts` → `runTask()`:
  ```typescript
  async function runTask(task: ScheduledTask): Promise<void> {
    // Check if disabled
    if (task.disabled_at) {
      return; // Skip
    }
    
    // Check circuit breaker
    if (task.consecutive_failures >= 3) {
      disableTask(task.id, 'Circuit breaker: 3 consecutive failures');
      await alertAdmin(`Task "${task.prompt.slice(0, 50)}" disabled after 3 failures`);
      return;
    }
    
    try {
      await executeTask(task);
      resetFailureCount(task.id);  // Success → reset counter
    } catch (err) {
      incrementFailureCount(task.id);
      logTaskError(task.id, err);
    }
  }
  ```

### Exponential Backoff Between Retries

- [ ] ถ้า task fail → next run delay ด้วย backoff:
  ```
  Normal interval × 2^(failure_count - 1)
  e.g., 1 hour interval: 1h → 2h → 4h → disabled
  ```

### Admin Commands for Task Management

- [ ] IPC command: `enable_task {id}` → reset failures + re-enable
- [ ] IPC command: `disable_task {id}` → manual disable
- [ ] IPC command: `list_tasks` → show all tasks with status + failure count

### ทดสอบ

- [ ] Task succeeds → consecutive_failures = 0
- [ ] Task fails 1x → consecutive_failures = 1, still runs next interval
- [ ] Task fails 3x → disabled + admin alert
- [ ] Enable disabled task via IPC → runs again
- [ ] Backoff: verify delay increases exponentially

---

## 🧪 Definition of Done

1. 3 consecutive failures → task auto-disabled + alert
2. Exponential backoff between retry attempts
3. Admin can re-enable via IPC command
4. No infinite retry loops

---

## 📎 Files to Modify

| File | Repo | Action |
|------|------|--------|
| `src/task-scheduler.ts` | NanoClaw | Circuit breaker + backoff |
| `src/db.ts` | NanoClaw | Add failure tracking columns (migration) |
| `src/ipc.ts` | NanoClaw | Add enable/disable task commands |

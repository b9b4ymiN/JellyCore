# 2.3 — Container Lifecycle Manager

> แก้จุดอ่อน: A3 (Shutdown Detaches, Doesn't Kill Containers), R3 (30-min Timeout)

**Status:** ⬜ Not Started  
**Effort:** Medium  
**Priority:** 🟠 High  
**Depends on:** Item 2.2 (Queue Persistence)

---

## 📋 ปัญหาเดิม

- Shutdown แค่ detach containers → orphans ทำงานต่อด้วย API credits (30 นาที)
- ไม่มี heartbeat → stuck containers undetectable
- ไม่มี startup scan สำหรับ orphan cleanup

**ที่มา:** NanoClaw `src/group-queue.ts` → `shutdown()`

---

## ✅ Checklist

### Container Heartbeat System

- [ ] สร้าง `src/container-lifecycle.ts`:
  - **Register:** เมื่อ spawn container → บันทึก:
    ```sql
    INSERT INTO container_registry (container_id, group_id, started_at, last_heartbeat, status)
    ```
  - **Heartbeat:** container เขียน heartbeat file ทุก 60s → host ตรวจ
  - **Stuck detection:** ไม่มี heartbeat > 3 นาที → mark stuck

### Container Registry Table

- [ ] เพิ่ม table ใน `src/db.ts`:
  ```sql
  CREATE TABLE IF NOT EXISTS container_registry (
    container_id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    last_heartbeat INTEGER,
    status TEXT DEFAULT 'running',  -- 'running' | 'stuck' | 'stopped'
    docker_label TEXT               -- for Docker label filtering
  );
  ```

### Docker Labeling

- [ ] แก้ `src/container-runner.ts` → เพิ่ม Docker labels เมื่อ spawn:
  ```
  docker run --label jellycore.managed=true --label jellycore.group={groupId} ...
  ```
- [ ] ใช้ labels สำหรับ orphan scan

### Startup Orphan Scan

- [ ] เพิ่ม `cleanupOrphans()` ใน `src/container-lifecycle.ts`:
  ```typescript
  async function cleanupOrphans(): Promise<void> {
    // Find all containers with jellycore.managed=true label
    const containers = execSync(
      'docker ps -q --filter label=jellycore.managed=true'
    ).toString().trim().split('\n');
    
    for (const containerId of containers) {
      if (!isTrackedByQueue(containerId)) {
        // Orphan: kill it
        execSync(`docker stop -t 10 ${containerId}`);
        log.warn(`Killed orphan container: ${containerId}`);
      }
    }
  }
  ```
- [ ] เรียก `cleanupOrphans()` ใน `main()` ก่อน start

### Graceful Shutdown Fix

- [ ] แก้ `src/group-queue.ts` → `shutdown()`:
  ```typescript
  async shutdown(timeoutMs: number): Promise<void> {
    this.shuttingDown = true;
    
    // 1. Stop accepting new messages
    // 2. Send SIGTERM to all active containers
    for (const [groupId, state] of this.activeContainers) {
      try {
        execSync(`docker stop -t 10 ${state.containerId}`);
        log.info(`Stopped container for ${groupId}`);
      } catch (err) {
        execSync(`docker kill ${state.containerId}`);
        log.warn(`Force killed container for ${groupId}`);
      }
    }
    
    // 3. Update queue_state for waiting messages (will be recovered on restart)
  }
  ```

### Reduced Timeouts

- [ ] ปรับ config:
  - `CONTAINER_TIMEOUT`: 30 min → **10 min** (configurable)
  - `IDLE_TIMEOUT`: 30 min → **10 min**
  - Container heartbeat interval: 60s
  - Stuck detection threshold: 3 min (no heartbeat)

### Stuck Container Handler

- [ ] ทุก 2 นาที ตรวจ container_registry:
  ```typescript
  // Find containers with no heartbeat for 3 minutes
  const stuck = db.prepare(
    'SELECT * FROM container_registry WHERE status = ? AND last_heartbeat < ?'
  ).all('running', Date.now() - 3 * 60 * 1000);
  
  for (const container of stuck) {
    execSync(`docker stop -t 10 ${container.container_id}`);
    updateQueueState(container.group_id, 'failed', 'Container stuck (no heartbeat)');
    // Re-enqueue if retry count < max
  }
  ```

### Container-Side Heartbeat Writer

- [ ] แก้ `container/agent-runner/src/index.ts`:
  - เพิ่ม heartbeat loop:
    ```typescript
    setInterval(() => {
      fs.writeFileSync('/workspace/ipc/heartbeat', Date.now().toString());
    }, 60000);
    ```

### ทดสอบ

- [ ] Spawn container → registry entry exists
- [ ] Container heartbeat → `last_heartbeat` updated
- [ ] Stop heartbeat (simulate stuck) → container killed after 3 min
- [ ] Shutdown NanoClaw → all containers stopped (not orphaned)
- [ ] Restart NanoClaw → orphan scan kills untracked containers
- [ ] Normal operation → containers complete + registry cleaned

---

## 🧪 Definition of Done

1. `docker ps --filter label=jellycore.managed=true` → 0 orphans after shutdown
2. Stuck containers killed within 3 minutes
3. Startup cleans up any orphans from previous run
4. Container timeout reduced to 10 minutes

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `src/container-lifecycle.ts` | NanoClaw | **Create** — registry, heartbeat, cleanup |
| `src/db.ts` | NanoClaw | Add container_registry table |
| `src/container-runner.ts` | NanoClaw | Add Docker labels |
| `src/group-queue.ts` | NanoClaw | Fix shutdown (stop, not detach) |
| `src/config.ts` | NanoClaw | Reduce timeouts |
| `src/index.ts` | NanoClaw | Call cleanupOrphans() on startup |
| `container/agent-runner/src/index.ts` | NanoClaw | Add heartbeat writer |

# 1.9 — Container Warm Pool

> แก้จุดอ่อน: W3 (Container Cold Start ทุก Query)

**Status:** ✅ Complete  
**Effort:** Large  
**Priority:** 🔴 High — ลด latency จาก 3s → <300ms

---

## 📋 ปัญหาเดิม

แม้ prebuilt container image (Item 1.5) จะลด cold start จาก 10s → 3s แต่ยังต้อง spawn + initialize container ทุกครั้ง → ช้าสำหรับ conversational flow ที่ user ส่ง messages ต่อเนื่อง

**ที่มา:** NanoClaw `src/container-runner.ts` → `spawnContainer()` ทุก query

---

## 🎯 เป้าหมาย

- Maintain pool ของ pre-warmed containers พร้อมใช้
- First message latency: 3s → <300ms
- Follow-up messages: ใช้ container เดิม (session persistence)

---

## ✅ Checklist

### สร้าง Container Pool Manager

- [ ] สร้าง `src/container-pool.ts`:
  ```typescript
  interface PooledContainer {
    id: string;
    containerId: string;
    status: 'warming' | 'ready' | 'in-use' | 'draining';
    createdAt: Date;
    lastUsedAt: Date;
    groupId?: string;
    sessionId?: string;
  }

  class ContainerPool {
    private pool: Map<string, PooledContainer> = new Map();
    private config: PoolConfig;
    
    constructor(config: PoolConfig) { ... }
    
    // Acquire a ready container (or wait for one)
    async acquire(groupId: string): Promise<PooledContainer>;
    
    // Release container back to pool (or destroy)
    async release(id: string, keepAlive: boolean): Promise<void>;
    
    // Pre-warm containers to meet min pool size
    async warmUp(): Promise<void>;
    
    // Cleanup idle containers
    async cleanup(): Promise<void>;
    
    // Get pool stats
    getStats(): PoolStats;
  }
  ```

### Pool Configuration

- [ ] เพิ่มใน `src/config.ts`:
  ```typescript
  export const POOL_CONFIG = {
    MIN_SIZE: parseInt(process.env.POOL_MIN_SIZE || '1'),
    MAX_SIZE: parseInt(process.env.POOL_MAX_SIZE || '5'),
    IDLE_TIMEOUT: parseInt(process.env.POOL_IDLE_TIMEOUT || '300000'), // 5 min
    SESSION_TIMEOUT: parseInt(process.env.POOL_SESSION_TIMEOUT || '600000'), // 10 min
    WARMUP_INTERVAL: parseInt(process.env.POOL_WARMUP_INTERVAL || '30000'), // 30s check
    MAX_REUSE_COUNT: parseInt(process.env.POOL_MAX_REUSE || '10'), // max reuses before recycle
  };
  ```

### Container Pre-Warming

- [ ] Implement warm-up process:
  ```typescript
  async function warmContainer(): Promise<PooledContainer> {
    // 1. Spawn container with prebuilt image
    const containerId = await docker.createContainer({
      Image: 'nanoclaw-agent:latest',
      Cmd: ['node', 'agent-runner.js', '--standby'],  // standby mode
      NetworkMode: 'jellycore-internal',
      Env: [
        `ORACLE_API_URL=${ORACLE_URL}`,
        `ORACLE_AUTH_TOKEN=${AUTH_TOKEN}`,
      ],
      // Volume mounts prepared but group-specific
      HostConfig: {
        Memory: 512 * 1024 * 1024, // 512MB
        CpuPeriod: 100000,
        CpuQuota: 50000, // 50% CPU
      },
    });
    
    // 2. Start container
    await docker.startContainer(containerId);
    
    // 3. Wait for MCP bridge ready signal
    await waitForReady(containerId, 10000); // 10s timeout
    
    return { id: uuid(), containerId, status: 'ready', ... };
  }
  ```

### Standby Mode ใน Agent Runner

- [ ] แก้ `container/agent-runner/src/index.ts`:
  ```typescript
  if (process.argv.includes('--standby')) {
    // Initialize all MCP connections
    await initMCPServers();
    
    // Signal ready
    console.log('NANOCLAW_CONTAINER_READY');
    
    // Wait for work assignment via IPC
    watchForAssignment('/workspace/ipc/assignment.json', async (task) => {
      await processTask(task);
      console.log('NANOCLAW_TASK_COMPLETE');
    });
  }
  ```

### Session Persistence

- [ ] Implement session-aware acquisition:
  ```typescript
  async acquire(groupId: string): Promise<PooledContainer> {
    // 1. Check for existing session container
    const existingSession = this.findActiveSession(groupId);
    if (existingSession && existingSession.status === 'ready') {
      existingSession.status = 'in-use';
      existingSession.lastUsedAt = new Date();
      return existingSession;
    }
    
    // 2. Get any ready container from pool
    const ready = this.findReadyContainer();
    if (ready) {
      ready.status = 'in-use';
      ready.groupId = groupId;
      ready.sessionId = generateSessionId();
      // Mount group-specific volumes dynamically
      await this.mountGroupVolumes(ready.containerId, groupId);
      return ready;
    }
    
    // 3. If pool exhausted → spawn new (bypass pool)
    if (this.pool.size < this.config.MAX_SIZE) {
      const warm = await warmContainer();
      warm.status = 'in-use';
      warm.groupId = groupId;
      this.pool.set(warm.id, warm);
      return warm;
    }
    
    // 4. Pool full → wait or fallback to cold spawn
    throw new PoolExhaustedError('Container pool exhausted');
  }
  ```

### Release & Keep-Alive

- [ ] หลัง task เสร็จ → ไม่ destroy ทันที:
  ```typescript
  async release(id: string, keepAlive: boolean = true): Promise<void> {
    const container = this.pool.get(id);
    if (!container) return;
    
    if (keepAlive && container.reuseCount < this.config.MAX_REUSE_COUNT) {
      // Return to pool for reuse
      container.status = 'ready';
      container.reuseCount++;
      container.lastUsedAt = new Date();
      
      // Clear session state but keep MCP connections alive
      await this.clearSessionState(container.containerId);
    } else {
      // Destroy and replace
      container.status = 'draining';
      await docker.removeContainer(container.containerId, { force: true });
      this.pool.delete(id);
      
      // Replenish pool
      if (this.pool.size < this.config.MIN_SIZE) {
        await this.warmUp();
      }
    }
  }
  ```

### Cleanup Loop

- [ ] Background cleanup ทุก 30 วินาที:
  ```typescript
  setInterval(async () => {
    for (const [id, container] of this.pool) {
      if (container.status === 'ready') {
        const idleTime = Date.now() - container.lastUsedAt.getTime();
        if (idleTime > this.config.IDLE_TIMEOUT) {
          // Idle too long → destroy
          await docker.removeContainer(container.containerId, { force: true });
          this.pool.delete(id);
        }
      }
    }
    
    // Ensure min pool size
    while (this.getReadyCount() < this.config.MIN_SIZE) {
      try {
        const warm = await warmContainer();
        this.pool.set(warm.id, warm);
      } catch (err) {
        break; // Resource limit reached
      }
    }
  }, 30000);
  ```

### Integrate with Container Runner

- [ ] แก้ `src/container-runner.ts`:
  ```typescript
  // Before: always cold spawn
  // After: try pool first
  async function runInContainer(task: Task): Promise<string> {
    let container: PooledContainer;
    
    try {
      container = await containerPool.acquire(task.groupId);
    } catch (err) {
      // Pool exhausted → cold spawn fallback
      return coldSpawn(task);
    }
    
    try {
      const result = await assignTask(container, task);
      await containerPool.release(container.id, true); // keep alive
      return result;
    } catch (err) {
      await containerPool.release(container.id, false); // destroy on error
      throw err;
    }
  }
  ```

### Pool Stats Endpoint

- [ ] เพิ่มใน health server:
  ```json
  GET /api/pool/stats
  {
    "total": 3,
    "ready": 1,
    "inUse": 2,
    "warming": 0,
    "maxSize": 3,
    "avgAcquireTimeMs": 45,
    "reusedCount": 127,
    "coldSpawnFallbacks": 3
  }
  ```

### ทดสอบ

- [ ] System start → MIN_SIZE containers warmed within 30s
- [ ] First message → acquire from pool <300ms (ไม่ใช่ 3s cold start)
- [ ] Follow-up message (same group) → reuse container <100ms
- [ ] Pool idle 5min → containers cleaned up
- [ ] Pool exhausted → fallback to cold spawn (ไม่ crash)
- [ ] Container error → removed from pool, new one warmed
- [ ] Memory stable after 100 acquire/release cycles (ไม่ leak)

---

## 🧪 Definition of Done

1. Pool maintains MIN_SIZE warm containers at all times
2. Container acquisition <300ms (vs 3s cold start)
3. Session reuse works for follow-up messages
4. Automatic cleanup of idle containers
5. Graceful fallback to cold spawn when pool exhausted
6. Pool stats endpoint available

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `src/container-pool.ts` | NanoClaw | **Create** — pool manager |
| `container/agent-runner/src/index.ts` | NanoClaw | Add standby mode |
| `src/container-runner.ts` | NanoClaw | Integrate pool |
| `src/config.ts` | NanoClaw | Add pool config |
| `src/health-server.ts` | NanoClaw | Add pool stats endpoint |

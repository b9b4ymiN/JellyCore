# 2.4 — Health Monitor + Alert System

> แก้จุดอ่อน: A4 (No Health Monitoring or Self-Healing)

**Status:** ⬜ Not Started  
**Effort:** Large  
**Priority:** 🟠 High  
**Depends on:** Item 2.1 (PM2 for restart actions)

---

## 📋 ปัญหาเดิม

ไม่มี liveness probes, watchdog, heartbeats, connection monitoring — failures เงียบ ไม่มี alert

**ที่มา:** ทั้ง 2 repositories ไม่มี health check infrastructure

---

## ✅ Checklist

### สร้าง Health Monitor Module

- [ ] สร้าง `src/health-monitor.ts`:
  ```typescript
  interface HealthCheck {
    name: string;
    check: () => Promise<{ healthy: boolean; message: string }>;
    critical: boolean;   // true = trigger alert
    selfHeal?: () => Promise<void>;  // optional auto-fix
  }
  ```

### Implement Health Checks

- [ ] **WhatsApp Connection:**
  ```typescript
  { name: 'whatsapp', check: () => whatsapp.isConnected(), critical: true,
    selfHeal: () => whatsapp.reconnect() }
  ```

- [ ] **Telegram Bot** (เตรียมไว้):
  ```typescript
  { name: 'telegram', check: () => telegram.isConnected(), critical: false }
  ```

- [ ] **Oracle HTTP API:**
  ```typescript
  { name: 'oracle', check: async () => {
    const res = await fetch('http://oracle:47778/api/health');
    return { healthy: res.ok, message: res.statusText };
  }, critical: true, selfHeal: () => pm2RestartApp('oracle-v2') }
  ```

- [ ] **ChromaDB:**
  ```typescript
  { name: 'chromadb', check: async () => {
    const res = await fetch('http://chromadb:8000/api/v1/heartbeat', { headers: authHeaders });
    return { healthy: res.ok, message: 'ChromaDB heartbeat' };
  }, critical: false, selfHeal: () => exec('docker restart chromadb') }
  ```

- [ ] **SQLite Database:**
  ```typescript
  { name: 'sqlite', check: () => {
    db.prepare('SELECT 1').get();
    return { healthy: true, message: 'SQLite OK' };
  }, critical: true }
  ```

- [ ] **Docker Daemon:**
  ```typescript
  { name: 'docker', check: async () => {
    exec('docker info');
    return { healthy: true, message: 'Docker daemon running' };
  }, critical: true }
  ```

- [ ] **Disk Space:**
  ```typescript
  { name: 'disk', check: () => {
    const free = diskFreePercent('/');
    return { healthy: free > 10, message: `${free}% free` };
  }, critical: free < 5 }
  ```

- [ ] **Memory Usage:**
  ```typescript
  { name: 'memory', check: () => {
    const used = process.memoryUsage().heapUsed / 1024 / 1024;
    return { healthy: used < 800, message: `${used.toFixed(0)}MB used` };
  }, critical: false }
  ```

- [ ] **Container Count:**
  ```typescript
  { name: 'containers', check: () => {
    const count = activeContainerCount();
    return { healthy: count <= MAX_CONCURRENT, message: `${count} active` };
  }, critical: false }
  ```

### Health Check Loop

- [ ] Run ทุก 30 วินาที:
  ```typescript
  setInterval(async () => {
    for (const check of healthChecks) {
      const result = await check.check().catch(err => ({ healthy: false, message: err.message }));
      
      if (!result.healthy) {
        failureCount[check.name] = (failureCount[check.name] || 0) + 1;
        
        if (failureCount[check.name] >= 3) {  // 3 consecutive failures
          // Self-heal if available
          if (check.selfHeal) {
            await check.selfHeal();
            log.warn(`Self-healed: ${check.name}`);
          }
          
          // Alert if critical
          if (check.critical) {
            await sendAlert(check.name, result.message);
          }
        }
      } else {
        failureCount[check.name] = 0;  // reset
      }
    }
  }, 30000);
  ```

### Alert System

- [ ] สร้าง `src/alert.ts`:
  - Primary: ส่ง Telegram message ไปที่ admin chat
  - Fallback: เขียน log file (ถ้า Telegram down)
  - Rate limit alerts: max 1 alert per check per 5 minutes (ป้องกัน spam)
  - Alert format:
    ```
    ⚠️ JellyCore Health Alert
    
    Service: {name}
    Status: UNHEALTHY
    Message: {message}
    Consecutive Failures: {count}
    Self-Heal: {attempted/not available}
    Time: {timestamp}
    ```

### Self-Healing Actions

- [ ] WhatsApp disconnect → reconnect (max 5 retries, exponential backoff)
- [ ] Oracle down → restart via `docker restart oracle` or PM2 API
- [ ] ChromaDB down → `docker restart chromadb`
- [ ] Disk > 90% full → trigger emergency log cleanup + alert

### Internal Health Endpoint

- [ ] เพิ่ม internal HTTP server ใน NanoClaw (port 3001):
  - `GET /health` → aggregate health status JSON
  - `GET /health/{check}` → individual check status
  - ใช้สำหรับ Docker healthcheck + external monitoring

### ทดสอบ

- [ ] All checks passing → no alerts
- [ ] Stop Oracle → 3 failures → Telegram alert + auto-restart
- [ ] Disconnect WhatsApp → auto-reconnect attempted
- [ ] Disk simulation (fill temp) → alert sent
- [ ] `GET /health` → JSON with all check statuses
- [ ] Self-heal Oracle → Oracle back online → alert cleared

---

## 🧪 Definition of Done

1. Health checks run every 30s for all subsystems
2. 3 consecutive failures → Telegram alert to admin
3. Self-healing works for WhatsApp, Oracle, ChromaDB
4. `/health` endpoint returns aggregate status
5. Alert rate-limited (no spam)

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `src/health-monitor.ts` | NanoClaw | **Create** — health check loop |
| `src/alert.ts` | NanoClaw | **Create** — alert system |
| `src/index.ts` | NanoClaw | Start health monitor |
| `src/config.ts` | NanoClaw | Add ADMIN_TELEGRAM_CHAT_ID |

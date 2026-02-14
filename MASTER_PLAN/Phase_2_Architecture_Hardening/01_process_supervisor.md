# 2.1 — Process Supervisor (PM2)

> แก้จุดอ่อน: A1 (Single Process, Single Point of Failure)

**Status:** ⬜ Not Started  
**Effort:** Medium  
**Priority:** 🔴 Critical

---

## 📋 ปัญหาเดิม

ทั้งระบบ (WhatsApp, SQLite, Router, Container Manager, IPC, Scheduler) อยู่ใน **Node.js process เดียว**  
Exception ที่ไหนก็ตาม = **ทั้งระบบล่ม**

**ที่มา:** NanoClaw `src/index.ts` → `main()`

---

## 🎯 เป้าหมาย

ใช้ **PM2** ครอบทั้ง NanoClaw + Oracle V2 → auto-restart เมื่อ crash, memory limit, log rotation

---

## ✅ Checklist

### Install PM2

- [ ] Install ใน Docker image: `npm install -g pm2`
- [ ] หรือ install บน host: `npm install -g pm2`

### สร้าง PM2 Configuration

- [ ] สร้าง `ecosystem.config.js` (project root):
  ```javascript
  module.exports = {
    apps: [
      {
        name: 'nanoclaw',
        script: 'dist/index.js',       // compiled JS
        cwd: './nanoclaw',
        interpreter: 'node',
        instances: 1,                   // single instance (stateful)
        max_memory_restart: '1G',
        max_restarts: 10,
        min_uptime: '10s',             // ต้องอยู่ >10s ถึงนับว่า stable
        restart_delay: 5000,            // wait 5s before restart
        exp_backoff_restart_delay: 1000,// exponential backoff
        env: {
          NODE_ENV: 'production',
        },
        error_file: '/var/log/jellycore/nanoclaw-error.log',
        out_file: '/var/log/jellycore/nanoclaw-out.log',
        merge_logs: true,
        log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      },
      {
        name: 'oracle-v2',
        script: 'src/server.ts',
        cwd: './oracle-v2',
        interpreter: 'bun',
        instances: 1,
        max_memory_restart: '512M',
        max_restarts: 10,
        restart_delay: 3000,
        env: {
          ORACLE_PORT: '47778',
        },
        error_file: '/var/log/jellycore/oracle-error.log',
        out_file: '/var/log/jellycore/oracle-out.log',
        merge_logs: true,
        log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      }
    ]
  };
  ```

### Log Rotation

- [ ] Install PM2 log rotate: `pm2 install pm2-logrotate`
- [ ] Configure:
  ```
  pm2 set pm2-logrotate:max_size 50M
  pm2 set pm2-logrotate:retain 7
  pm2 set pm2-logrotate:compress true
  ```

### Startup Script

- [ ] `pm2 startup` → generate systemd service สำหรับ auto-start on boot
- [ ] `pm2 save` → persist process list

### Graceful Shutdown Integration

- [ ] ตรวจสอบ NanoClaw SIGTERM handler → ต้อง:
  - Drain queue (wait max 10s)
  - Disconnect WhatsApp gracefully
  - Close SQLite
  - Exit 0
- [ ] PM2 จะส่ง SIGINT แล้วรอ `kill_timeout` (default 1600ms) → ปรับเป็น 15000ms:
  ```javascript
  kill_timeout: 15000,  // 15s for graceful shutdown
  ```

### Docker Integration (Alternative)

- [ ] ถ้าใช้ Docker Compose แทน PM2:
  - `restart: unless-stopped` ใน docker-compose.yml
  - `healthcheck` per service
  - Docker handles restart + logging
  - **เลือกอย่างใดอย่างหนึ่ง**: PM2 inside container หรือ Docker Compose restart policy

### ทดสอบ

- [ ] `pm2 start ecosystem.config.js` → ทั้ง 2 apps online
- [ ] Kill nanoclaw process → PM2 restart ภายใน 5s
- [ ] Kill oracle process → PM2 restart ภายใน 3s
- [ ] `pm2 monit` → เห็น CPU/memory usage
- [ ] `pm2 logs` → เห็น structured logs
- [ ] Memory > 1GB → NanoClaw auto-restart
- [ ] Reboot server → PM2 auto-start ทั้ง 2 apps

---

## 🧪 Definition of Done

1. NanoClaw crash → auto-restart ภายใน 5s
2. Oracle crash → auto-restart ภายใน 3s
3. Logs rotated (50MB max, 7 days retain)
4. Auto-start on server boot
5. `pm2 status` → ทั้ง 2 apps "online"

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `ecosystem.config.js` | JellyCore | **Create** — PM2 config |
| `src/index.ts` | NanoClaw | Verify SIGTERM handler |
| `docker-compose.yml` | JellyCore | Add restart policy (if Docker approach) |

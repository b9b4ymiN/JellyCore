# 5.3 — Monitoring & Health Endpoints

> รู้สถานะระบบแบบ real-time — health checks, metrics, alerts

**Status:** ⬜ Not Started  
**Effort:** Medium  
**Priority:** 🟡 Medium  
**Weakness Ref:** A4 (No Health Monitor), R4 (No Auto Backup check)

---

## 🎯 เป้าหมาย

ทุก service มี `/health` endpoint, NanoClaw มี `/metrics`, alert เมื่อ service down

---

## ✅ Checklist

### NanoClaw Health Endpoint

- [ ] สร้าง `src/health-server.ts`:
  ```typescript
  import { createServer } from 'http';
  
  interface HealthStatus {
    status: 'healthy' | 'degraded' | 'unhealthy';
    uptime: number;
    services: {
      oracle: 'up' | 'down' | 'degraded';
      whatsapp: 'connected' | 'disconnected' | 'reconnecting';
      telegram: 'connected' | 'disconnected';
      chromadb: 'up' | 'down';
    };
    stats: {
      activeContainers: number;
      queuedMessages: number;
      processedToday: number;
      memoryUsageMB: number;
      lastMessageAt: string | null;
    };
  }
  
  export function startHealthServer(port = 3000) {
    const server = createServer(async (req, res) => {
      if (req.url === '/health') {
        const health = await getHealthStatus();
        const code = health.status === 'healthy' ? 200 :
                     health.status === 'degraded' ? 207 : 503;
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(health));
      } else if (req.url === '/metrics') {
        const metrics = await getMetrics();
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(metrics); // Prometheus-compatible format
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(port);
  }
  ```

### Oracle Health Endpoint

- [ ] ตรวจสอบ/เพิ่ม health endpoint ใน Oracle:
  ```typescript
  // oracle-v2/src/server.ts
  app.get('/health', async (c) => {
    const dbOk = await checkDbConnection();
    const chromaOk = await checkChromaConnection();
    
    return c.json({
      status: dbOk && chromaOk ? 'healthy' : 'degraded',
      db: dbOk ? 'ok' : 'error',
      chromadb: chromaOk ? 'ok' : 'error',
      documentCount: await getDocumentCount(),
      uptime: process.uptime(),
    });
  });
  ```

### Prometheus-Compatible Metrics

- [ ] NanoClaw `/metrics` endpoint:
  ```
  # HELP jellycore_messages_total Total messages processed
  # TYPE jellycore_messages_total counter
  jellycore_messages_total{channel="whatsapp"} 1234
  jellycore_messages_total{channel="telegram"} 567
  
  # HELP jellycore_active_containers Currently running containers
  # TYPE jellycore_active_containers gauge
  jellycore_active_containers 3
  
  # HELP jellycore_queue_depth Messages waiting in queue
  # TYPE jellycore_queue_depth gauge
  jellycore_queue_depth 2
  
  # HELP jellycore_response_time_seconds Response time histogram
  # TYPE jellycore_response_time_seconds histogram
  jellycore_response_time_seconds_bucket{le="1"} 100
  jellycore_response_time_seconds_bucket{le="3"} 250
  jellycore_response_time_seconds_bucket{le="5"} 290
  jellycore_response_time_seconds_bucket{le="+Inf"} 300
  
  # HELP jellycore_oracle_latency_ms Oracle query latency
  # TYPE jellycore_oracle_latency_ms gauge
  jellycore_oracle_latency_ms 45
  
  # HELP jellycore_memory_usage_bytes Memory usage
  # TYPE jellycore_memory_usage_bytes gauge
  jellycore_memory_usage_bytes 134217728
  ```

### Health Check Script (Cron)

- [ ] สร้าง `scripts/health-check.sh`:
  ```bash
  #!/bin/bash
  
  WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
  
  check_service() {
    local name=$1 url=$2
    local status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url")
    
    if [ "$status" != "200" ] && [ "$status" != "207" ]; then
      echo "❌ $name is DOWN (HTTP $status)"
      if [ -n "$WEBHOOK_URL" ]; then
        curl -s -X POST "$WEBHOOK_URL" \
          -H "Content-Type: application/json" \
          -d "{\"text\":\"🚨 JellyCore Alert: $name is DOWN (HTTP $status)\"}"
      fi
      return 1
    fi
    echo "✅ $name is UP"
    return 0
  }
  
  echo "=== JellyCore Health Check $(date) ==="
  check_service "NanoClaw" "http://localhost:3000/health"
  check_service "Oracle" "http://localhost:47778/health"
  check_service "ChromaDB" "http://localhost:8000/api/v1/heartbeat"
  
  # Check disk space
  DISK_USAGE=$(df /data/jellycore --output=pcent | tail -1 | tr -d ' %')
  if [ "$DISK_USAGE" -gt 85 ]; then
    echo "⚠️ Disk usage: ${DISK_USAGE}%"
  fi
  
  # Check memory
  MEM_USAGE=$(free | awk '/Mem/{printf("%.0f"), $3/$2*100}')
  if [ "$MEM_USAGE" -gt 90 ]; then
    echo "⚠️ Memory usage: ${MEM_USAGE}%"
  fi
  ```

### Cron Setup

- [ ] เพิ่ม cron:
  ```bash
  # Every 5 minutes
  */5 * * * * /opt/jellycore/scripts/health-check.sh >> /var/log/jellycore-health.log 2>&1
  ```

### Docker Health Checks

- [ ] ตรวจสอบ Docker health checks ใน `docker-compose.yml`:
  - NanoClaw: `/health` endpoint
  - Oracle: `/health` endpoint
  - ChromaDB: `/api/v1/heartbeat`
  - Dashboard: HTTP 200 on `/:5173`

### ทดสอบ

- [ ] `curl localhost:3000/health` → valid JSON
- [ ] `curl localhost:3000/metrics` → Prometheus format
- [ ] `curl localhost:47778/health` → Oracle status
- [ ] Stop Oracle → NanoClaw health = "degraded"
- [ ] Health check script detects down services
- [ ] Alert fires when service is down (if webhook configured)
- [ ] `docker compose ps` shows health status

---

## 🧪 Definition of Done

1. All 4 services have health endpoints
2. NanoClaw exposes Prometheus metrics
3. Cron health check runs every 5min
4. Alerts fire on service down
5. Docker health checks integrated

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `src/health-server.ts` | NanoClaw | **Create** |
| `src/metrics.ts` | NanoClaw | **Create** |
| `src/server.ts` | Oracle V2 | Add health endpoint |
| `scripts/health-check.sh` | JellyCore | **Create** |
| `docker-compose.yml` | JellyCore | Add health checks |

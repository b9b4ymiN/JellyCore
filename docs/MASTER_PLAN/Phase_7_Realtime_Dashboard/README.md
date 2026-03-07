# Phase 7 — Real-Time AI Operations Dashboard

> **JellyCore Control Center** — หน้าเว็บสำหรับดู Real-Time สถานะระบบ AI, จัดการ Heartbeat/Schedule Jobs, และควบคุมการทำงานทั้งหมดจากที่เดียว

---

## 🎯 เป้าหมาย

สร้างหน้าเว็บ Dashboard แบบ Real-Time ที่:

1. **Live Operations View** — เห็นทันทีว่า Claude Code / Codex กำลังรัน/ประมวลผลอะไรอยู่ตอนนี้
2. **Heartbeat & Scheduler Management** — ตั้งค่า สร้าง แก้ไข เปิด/ปิด Job ได้จาก UI
3. **System Health Monitoring** — ดูสถานะทุก service แบบ Real-Time
4. **Job History & Logs** — ดูประวัติการรันและ debug ปัญหาได้

---

## 📐 สถาปัตยกรรมภาพรวม

```
┌────────────────────────────────────────────────────┐
│                  BROWSER (React)                    │
│                                                     │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │Live Ops │ │Scheduler │ │Heartbeat │ │System  │ │
│  │Terminal │ │Manager   │ │Config    │ │Health  │ │
│  └────┬────┘ └────┬─────┘ └────┬─────┘ └───┬────┘ │
│       │           │            │            │       │
│       └───────────┴────────────┴────────────┘       │
│                        │                             │
│                   EventSource                        │
│                   (SSE Stream)                       │
│                   + REST API                         │
└────────────────────────┬────────────────────────────┘
                         │
              ┌──────────▼──────────┐
              │   Oracle Backend    │
              │   (Hono.js / Bun)   │
              │                     │
              │  /api/live/*  (SSE) │
              │  /api/scheduler/*   │
              │  /api/heartbeat/*   │
              └──────────┬──────────┘
                         │  Proxy
              ┌──────────▼──────────┐
              │  NanoClaw Internal  │
              │  Port 47779         │
              │                     │
              │  /scheduler/tasks/* │
              │  /heartbeat/*       │
              │  /health            │
              │  /status            │
              └─────────────────────┘
```

---

## 🏗️ แผนการพัฒนา — 4 Sub-Phases

### Phase 7.0 — SSE Infrastructure (Real-Time Foundation)
### Phase 7.1 — Live Operations Terminal
### Phase 7.2 — Scheduler & Job Management UI
### Phase 7.3 — System Health Dashboard

---

## Phase 7.0 — SSE Infrastructure (Real-Time Foundation)

> ระบบปัจจุบันใช้ Polling → เพิ่ม Server-Sent Events (SSE) สำหรับ Real-Time

### ทำไมต้อง SSE (ไม่ใช่ WebSocket)

| เกณฑ์ | SSE | WebSocket |
|-------|-----|-----------|
| ทิศทาง | Server → Client (พอดีกับ use case) | Bi-directional (เกินความจำเป็น) |
| Reconnect | Built-in auto-reconnect | ต้อง implement เอง |
| HTTP Compatible | ใช้ HTTP ปกติ ผ่าน proxy ได้ | ต้อง Upgrade protocol |
| Complexity | ต่ำ | สูงกว่า |
| Hono.js Support | Native `c.stream()` | ต้องเพิ่ม adapter |

### 7.0.1 — NanoClaw: Event Emitter Hub

**ไฟล์ใหม่:** `nanoclaw/src/event-bus.ts`

```typescript
import { EventEmitter } from 'node:events';

export type LiveEvent =
  | { type: 'container:start'; data: ContainerStartEvent }
  | { type: 'container:output'; data: ContainerOutputEvent }
  | { type: 'container:end'; data: ContainerEndEvent }
  | { type: 'task:enqueue'; data: TaskEnqueueEvent }
  | { type: 'task:start'; data: TaskStartEvent }
  | { type: 'task:complete'; data: TaskCompleteEvent }
  | { type: 'heartbeat:tick'; data: HeartbeatTickEvent }
  | { type: 'heartbeat:job:start'; data: JobStartEvent }
  | { type: 'heartbeat:job:end'; data: JobEndEvent }
  | { type: 'health:change'; data: HealthChangeEvent };

interface ContainerStartEvent {
  containerId: string;
  group: string;
  provider: string;    // 'claude' | 'codex' | 'ollama'
  prompt: string;       // truncated first 200 chars
  startedAt: string;
}

interface ContainerOutputEvent {
  containerId: string;
  chunk: string;        // streaming output chunk
  timestamp: string;
}

interface ContainerEndEvent {
  containerId: string;
  exitCode: number;
  durationMs: number;
  resultSummary: string; // truncated first 500 chars
}

class EventBus extends EventEmitter {
  emit(event: 'live', payload: LiveEvent): boolean;
  on(event: 'live', listener: (payload: LiveEvent) => void): this;
}

export const eventBus = new EventBus();
eventBus.setMaxListeners(50); // support multiple SSE clients
```

**เชื่อมต่อ:** Hook event bus เข้ากับ:
- Container runner (emit `container:start/output/end`)
- Task scheduler (emit `task:*`)
- Heartbeat system (emit `heartbeat:*`)

### 7.0.2 — NanoClaw: SSE Endpoint

**เพิ่มใน:** `nanoclaw/src/health-server.ts`

```typescript
// GET /events/live — SSE stream for real-time updates
app.get('/events/live', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',  // nginx compatibility
  });

  // Send keepalive every 30s
  const keepalive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 30_000);

  const handler = (event: LiveEvent) => {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event.data)}\n\n`);
  };

  eventBus.on('live', handler);

  req.on('close', () => {
    clearInterval(keepalive);
    eventBus.off('live', handler);
  });
});
```

### 7.0.3 — Oracle: SSE Proxy Route

**ไฟล์ใหม่:** `oracle-v2/src/server/routes/live-proxy.ts`

```typescript
// GET /api/live/events — Proxy SSE from NanoClaw to browser
app.get('/api/live/events', adminAuth, async (c) => {
  const upstream = await fetch(`${NANOCLAW_URL}/events/live`);

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});
```

### 7.0.4 — Frontend: SSE Hook

**ไฟล์ใหม่:** `oracle-v2/frontend/src/hooks/useLiveEvents.ts`

```typescript
export function useLiveEvents(
  onEvent: (event: LiveEvent) => void,
  enabled: boolean = true,
) {
  useEffect(() => {
    if (!enabled) return;

    const es = new EventSource('/api/live/events');

    const eventTypes = [
      'container:start', 'container:output', 'container:end',
      'task:enqueue', 'task:start', 'task:complete',
      'heartbeat:tick', 'heartbeat:job:start', 'heartbeat:job:end',
      'health:change',
    ];

    for (const type of eventTypes) {
      es.addEventListener(type, (e) => {
        onEvent({ type, data: JSON.parse(e.data) });
      });
    }

    es.onerror = () => {
      // EventSource auto-reconnects; just log
      console.warn('[SSE] Connection lost, reconnecting...');
    };

    return () => es.close();
  }, [enabled, onEvent]);
}
```

---

## Phase 7.1 — Live Operations Terminal

> หน้าจอหลักที่แสดง Real-Time ว่า Claude / Codex กำลังทำอะไรอยู่ตอนนี้

### 7.1.1 — UI Design

```
┌─────────────────────────────────────────────────────────┐
│ 🟢 LIVE OPERATIONS                           ⏱ 1h 23m  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─ Active Tasks ─────────────────────────────────────┐ │
│  │                                                     │ │
│  │  🔵 Claude Code — "วิเคราะห์ code refactor..."    │ │
│  │     ├─ Container: abc123  │ Group: main             │ │
│  │     ├─ Running: 2m 34s   │ Provider: claude         │ │
│  │     └─ Output ▼                                     │ │
│  │       ┌─────────────────────────────────────────┐   │ │
│  │       │ > Analyzing file structure...           │   │ │
│  │       │ > Found 3 modules to refactor           │   │ │
│  │       │ > Processing src/utils/helpers.ts...    │   │ │
│  │       │ █ (streaming...)                        │   │ │
│  │       └─────────────────────────────────────────┘   │ │
│  │                                                     │ │
│  │  🟡 Codex — "Generate test cases for..."          │ │
│  │     ├─ Container: def456  │ Group: main             │ │
│  │     ├─ Running: 45s      │ Provider: codex          │ │
│  │     └─ Output ▼ (collapsed)                         │ │
│  │                                                     │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ Queue (3 pending) ────────────────────────────────┐ │
│  │  ⏳ "ตรวจสอบ log files" — main — queued 30s ago   │ │
│  │  ⏳ "สรุปรายงาน weekly" — main — queued 1m ago    │ │
│  │  ⏳ "แปลเอกสาร API" — smoke — queued 2m ago      │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ Recent Completed (last 1h) ───────────────────────┐ │
│  │  ✅ "Health check" — 12s — 5 min ago               │ │
│  │  ✅ "Monitor NVDA" — 1m 5s — 15 min ago            │ │
│  │  ❌ "Generate report" — Error — 30 min ago         │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 7.1.2 — React Components

**Page:** `oracle-v2/frontend/src/pages/LiveOps.tsx`

```
LiveOps/
├── LiveOps.tsx              — Main page (state management)
├── LiveOps.module.css       — Styles
├── ActiveTaskCard.tsx       — Running container card with output stream
├── OutputTerminal.tsx       — Terminal-like output display (monospace, auto-scroll)
├── QueueList.tsx            — Pending tasks list
├── CompletedList.tsx        — Recent completed tasks
└── LiveStatusBadge.tsx      — Connection status indicator (🟢 Connected / 🔴 Disconnected)
```

**State Management:**

```typescript
interface LiveOpsState {
  activeTasks: Map<string, ActiveTask>;    // containerId → task
  queue: QueuedTask[];
  completed: CompletedTask[];              // ring buffer, last 50
  connectionStatus: 'connected' | 'reconnecting' | 'disconnected';
}

interface ActiveTask {
  containerId: string;
  group: string;
  provider: 'claude' | 'codex' | 'ollama';
  prompt: string;
  startedAt: Date;
  outputLines: string[];    // streaming output buffer
  expanded: boolean;        // UI toggle
}
```

**Key Features:**
- **Streaming output** — ผลลัพธ์ของ Claude/Codex ไหลเข้ามาแบบ real-time ใน terminal view
- **Auto-scroll** — scroll ตามผลลัพธ์ใหม่อัตโนมัติ (toggle ได้)
- **Elapsed timer** — นับเวลารันแบบ live (อัพเดททุก 1 วินาที)
- **Connection indicator** — แสดงสถานะ SSE connection (มี auto-reconnect)
- **Sound notification** — เสียงเมื่อ task สำเร็จ/ล้มเหลว (optional)

### 7.1.3 — NanoClaw: Hook Container Events

**แก้ไข:** `nanoclaw/src/container-runner.ts`

```typescript
// At container start
eventBus.emit('live', {
  type: 'container:start',
  data: {
    containerId: container.id,
    group: groupFolder,
    provider: llmProvider,
    prompt: prompt.slice(0, 200),
    startedAt: new Date().toISOString(),
  },
});

// During output capture (IPC watcher callback)
eventBus.emit('live', {
  type: 'container:output',
  data: {
    containerId: container.id,
    chunk: outputChunk,
    timestamp: new Date().toISOString(),
  },
});

// At container end
eventBus.emit('live', {
  type: 'container:end',
  data: {
    containerId: container.id,
    exitCode,
    durationMs: Date.now() - startTime,
    resultSummary: result.slice(0, 500),
  },
});
```

---

## Phase 7.2 — Scheduler & Job Management UI

> CRUD Interface สำหรับจัดการ Heartbeat Jobs ทั้งหมดจาก Browser

### 7.2.1 — API Routes (Oracle Proxy)

**ไฟล์ใหม่:** `oracle-v2/src/server/routes/scheduler-proxy.ts`

NanoClaw มี API ครบแล้วที่ port 47779 → Oracle proxy ไปยัง browser:

```typescript
// List all jobs
GET  /api/scheduler/tasks?status=active&group=main

// Get job detail + recent logs
GET  /api/scheduler/tasks/:id

// Create new job
POST /api/scheduler/tasks
Body: { name, group_folder, prompt, category, interval_ms, status }

// Pause/Resume/Cancel
POST /api/scheduler/tasks/:id/pause
POST /api/scheduler/tasks/:id/resume
POST /api/scheduler/tasks/:id/cancel

// Trigger immediate run
POST /api/scheduler/tasks/:id/run

// Scheduler statistics
GET  /api/scheduler/stats

// Heartbeat config
GET    /api/heartbeat/config
PATCH  /api/heartbeat/config
POST   /api/heartbeat/ping
```

### 7.2.2 — UI Design: Job List

```
┌─────────────────────────────────────────────────────────┐
│ 📋 SCHEDULER MANAGEMENT                    + New Job    │
├──────────┬──────────────────────────────────────────────┤
│ Filters  │                                              │
│          │  ┌─ Jobs ─────────────────────────────────┐  │
│ Status:  │  │                                         │  │
│ ● All    │  │  📚 Monitor NVDA Stock                 │  │
│ ○ Active │  │  ├─ Category: monitor │ Status: 🟢 Active│  │
│ ○ Paused │  │  ├─ Interval: 1h     │ Last: 5m ago    │  │
│ ○ Done   │  │  ├─ Last Result: "NVDA $892, +2.3%"    │  │
│          │  │  └─ [⏸ Pause] [▶ Run Now] [✏️ Edit]    │  │
│ Category:│  │                                         │  │
│ ☑ learning│ │  🏥 System Health Check                │  │
│ ☑ monitor│  │  ├─ Category: health │ Status: 🟢 Active│  │
│ ☑ health │  │  ├─ Interval: 30m    │ Last: 12m ago   │  │
│ ☑ custom │  │  ├─ Last Result: "HEARTBEAT_OK"        │  │
│          │  │  └─ [⏸ Pause] [▶ Run Now] [✏️ Edit]    │  │
│ Group:   │  │                                         │  │
│ ☑ main   │  │  📊 Weekly Report (paused)             │  │
│ ☑ smoke  │  │  ├─ Category: custom │ Status: ⏸ Paused │  │
│          │  │  ├─ Interval: 7d     │ Last: 3d ago     │  │
│ ─────────│  │  └─ [▶ Resume] [🗑 Cancel] [✏️ Edit]   │  │
│          │  │                                         │  │
│ Stats:   │  └─────────────────────────────────────────┘  │
│ Total: 5 │                                              │
│ Active: 3│  ┌─ Scheduler Summary ─────────────────────┐  │
│ Due: 1   │  │  Total: 5 │ Active: 3 │ Paused: 1      │  │
│ Overdue:0│  │  Due Soon: 1 │ Overdue: 0 │ Errors: 0  │  │
│          │  └─────────────────────────────────────────┘  │
└──────────┴──────────────────────────────────────────────┘
```

### 7.2.3 — UI Design: Create/Edit Job Modal

```
┌─────────────────────────────────────────────┐
│ ✨ Create New Scheduled Job                  │
├─────────────────────────────────────────────┤
│                                             │
│  Label *                                    │
│  ┌─────────────────────────────────────────┐│
│  │ Monitor NVDA Stock Price                ││
│  └─────────────────────────────────────────┘│
│                                             │
│  Category                                   │
│  ┌──────────────────────────┐               │
│  │ 📊 monitor           ▼  │               │
│  └──────────────────────────┘               │
│  (learning | monitor | health | custom)     │
│                                             │
│  Target Group                               │
│  ┌──────────────────────────┐               │
│  │ main                 ▼  │               │
│  └──────────────────────────┘               │
│                                             │
│  Interval                                   │
│  ┌────┐ ┌──────────┐                       │
│  │ 1  │ │ hours ▼  │  (= 3,600,000 ms)    │
│  └────┘ └──────────┘                       │
│  Quick: [15m] [30m] [1h] [6h] [12h] [24h] │
│                                             │
│  Prompt *                                   │
│  ┌─────────────────────────────────────────┐│
│  │ ตรวจสอบราคาหุ้น NVDA วันนี้            ││
│  │ รายงานการเปลี่ยนแปลงที่สำคัญ           ││
│  │ เทียบกับราคาเมื่อวาน                   ││
│  │                                         ││
│  └─────────────────────────────────────────┘│
│  (Supports multi-line, Thai & English)      │
│                                             │
│  ☑ Start immediately (status: active)       │
│                                             │
│  ┌──────────┐ ┌──────────┐                 │
│  │  Cancel   │ │ Create ✓ │                 │
│  └──────────┘ └──────────┘                 │
│                                             │
└─────────────────────────────────────────────┘
```

### 7.2.4 — UI Design: Job Detail + Run History

```
┌─────────────────────────────────────────────────────────┐
│ ← Back │ 📚 Monitor NVDA Stock                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Status: 🟢 Active   │ Category: monitor                │
│  Created: 2026-03-01 │ Created by: main                 │
│  Interval: 1h        │ Next run: ~15 min                │
│                                                         │
│  Prompt:                                                │
│  ┌─────────────────────────────────────────────────────┐│
│  │ ตรวจสอบราคาหุ้น NVDA วันนี้                        ││
│  │ รายงานการเปลี่ยนแปลงที่สำคัญ เทียบกับราคาเมื่อวาน ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
│  [⏸ Pause] [▶ Run Now] [✏️ Edit] [🗑 Cancel]           │
│                                                         │
│  ┌─ Run History ──────────────────────────────────────┐ │
│  │                                                     │ │
│  │  #15 │ ✅ OK  │ 45s │ 5 min ago                    │ │
│  │  "NVDA $892.50, +2.3% จากเมื่อวาน..."             │ │
│  │                                                     │ │
│  │  #14 │ ✅ OK  │ 38s │ 1h 5m ago                    │ │
│  │  "NVDA $873.20, -0.5% จากเมื่อวาน..."             │ │
│  │                                                     │ │
│  │  #13 │ ❌ ERR │ 10m │ 2h 5m ago                    │ │
│  │  "Error: Heartbeat job timed out after 10 min"      │ │
│  │                                                     │ │
│  │  #12 │ ✅ OK  │ 52s │ 3h 5m ago                    │ │
│  │  "NVDA $878.10, +1.1% จากเมื่อวาน..."             │ │
│  │                                                     │ │
│  └─────────────────────────────────────────────────────┘ │
│  [Load more...]                                         │
│                                                         │
│  ┌─ Success Rate Chart (24h) ─────────────────────────┐ │
│  │  ██████████████████████░░  92% success (12/13)      │ │
│  │  Avg duration: 43s │ Timeouts: 1                    │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 7.2.5 — React Components

```
Scheduler/
├── SchedulerPage.tsx           — Main page with job list
├── SchedulerPage.module.css
├── JobCard.tsx                 — Job summary card with actions
├── JobDetailPage.tsx           — Full job detail + history
├── JobDetailPage.module.css
├── JobFormModal.tsx            — Create/Edit job modal
├── JobFormModal.module.css
├── RunHistoryList.tsx          — Run history timeline
├── IntervalPicker.tsx          — Interval input (value + unit dropdown)
├── SchedulerStats.tsx          — Summary statistics bar
└── CategoryBadge.tsx           — Category emoji + label
```

### 7.2.6 — Frontend API Client

**เพิ่มใน:** `oracle-v2/frontend/src/api/scheduler.ts`

```typescript
const API = '/api/scheduler';

export async function listTasks(params?: {
  status?: string;
  group?: string;
}): Promise<{ tasks: SchedulerTask[] }>

export async function getTask(id: string): Promise<{
  task: SchedulerTask;
  logs: TaskRunLog[];
}>

export async function createTask(data: {
  name: string;
  group_folder: string;
  prompt: string;
  category: 'learning' | 'monitor' | 'health' | 'custom';
  interval_ms: number;
  status?: 'active' | 'paused';
}): Promise<{ task: SchedulerTask }>

export async function pauseTask(id: string): Promise<void>
export async function resumeTask(id: string): Promise<void>
export async function cancelTask(id: string): Promise<void>
export async function runTaskNow(id: string): Promise<void>
export async function getSchedulerStats(): Promise<SchedulerStats>
```

---

## Phase 7.3 — Heartbeat Config & System Health

### 7.3.1 — Heartbeat Configuration UI

```
┌─────────────────────────────────────────────────────────┐
│ ❤️ HEARTBEAT CONFIGURATION                              │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  🔌 Heartbeat Engine                                    │
│  ┌──────────────────────────────────────────┐           │
│  │  Enabled    ○──────────── [ON]           │           │
│  │  Delivery   ○──────────── [ON]  (muted?) │           │
│  └──────────────────────────────────────────┘           │
│                                                         │
│  ⏱ Timing                                               │
│  ┌──────────────────────────────────────────┐           │
│  │  Main Interval:    [1] [hours ▼]         │           │
│  │  Silence Threshold: [2] [hours ▼]        │           │
│  │  Alert Cooldown:   [30] [minutes ▼]      │           │
│  └──────────────────────────────────────────┘           │
│                                                         │
│  🔔 Alerts                                              │
│  ┌──────────────────────────────────────────┐           │
│  │  Show OK Messages:    [ON]               │           │
│  │  Show Alert Messages: [ON]               │           │
│  │  Use Indicator Prefix: [ON]              │           │
│  │  Escalate After Errors: [3]              │           │
│  │  Ack Max Chars: [500]                    │           │
│  └──────────────────────────────────────────┘           │
│                                                         │
│  📝 Heartbeat Prompt                                    │
│  ┌─────────────────────────────────────────────────────┐│
│  │ You are a system health monitor...                  ││
│  │ Check all services and report HEARTBEAT_OK          ││
│  │ if everything is fine, otherwise report the issue.  ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
│  ┌──────────┐ ┌──────────────┐ ┌────────────┐          │
│  │ Reset    │ │ Save Changes │ │ Ping Now ❤ │          │
│  └──────────┘ └──────────────┘ └────────────┘          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 7.3.2 — System Health Dashboard

```
┌─────────────────────────────────────────────────────────┐
│ 🏥 SYSTEM HEALTH                    Last check: 10s ago │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐      │
│  │ 🟢      │ │ 🟢      │ │ 🟢      │ │ 🟡      │      │
│  │ Oracle  │ │ NanoClaw│ │ ChromaDB│ │ Docker  │      │
│  │ healthy │ │ healthy │ │ healthy │ │ 2 warn  │      │
│  │ 47778   │ │ 47779   │ │ 8000    │ │ proxy   │      │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘      │
│                                                         │
│  ┌─ NanoClaw Status ──────────────────────────────────┐ │
│  │  Uptime: 3d 4h 12m                                 │ │
│  │  Active Containers: 2 / 10 max                     │ │
│  │  Queue Depth: 3                                    │ │
│  │  Registered Groups: main, smoke                    │ │
│  │  Memory: 487MB / 1GB                               │ │
│  │  DLQ: 0 open                                       │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ Oracle Status ────────────────────────────────────┐ │
│  │  Total Documents: 5,523                            │ │
│  │  FTS5 Index: ✅ healthy                            │ │
│  │  ChromaDB: ✅ connected (384-dim)                  │ │
│  │  Cache Hit Rate: 67%                               │ │
│  │  Last Index: 2 min ago                             │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ Resource Usage Timeline (1h) ─────────────────────┐ │
│  │  CPU ▁▂▃▂▁▂▅█▅▃▂▁▁▂▃▂▁                            │ │
│  │  MEM ▃▃▃▃▃▃▃▄▅▄▃▃▃▃▃▃▃                            │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 7.3.3 — React Components

```
SystemHealth/
├── SystemHealth.tsx             — Main health dashboard
├── SystemHealth.module.css
├── ServiceCard.tsx              — Per-service health card
├── NanoClawPanel.tsx            — Detailed NanoClaw stats
├── OraclePanel.tsx              — Detailed Oracle stats
├── ResourceChart.tsx            — CPU/Memory sparklines (Recharts)
└── HealthIndicator.tsx          — 🟢🟡🔴 status dot component

HeartbeatConfig/
├── HeartbeatConfigPage.tsx      — Config editor page
├── HeartbeatConfigPage.module.css
├── ToggleSwitch.tsx             — On/Off toggle component
├── DurationPicker.tsx           — Value + unit dropdown
└── PromptEditor.tsx             — Multi-line prompt editor
```

---

## 🗂️ Navigation Integration

### Updated Navigation Structure

```typescript
// Header.tsx — Updated nav items
const navItems = [
  { path: '/', label: 'Overview' },
  { path: '/live', label: '🟢 Live', highlight: true },  // ← NEW
  { path: '/feed', label: 'Feed' },
  { path: '/graph', label: 'Graph' },
  { divider: true },
  { path: '/search', label: 'Search' },
  { path: '/activity?tab=searches', label: 'Activity' },
  { divider: true },
  { path: '/forum', label: 'Forum' },
];

const toolsItems = [
  { path: '/scheduler', label: 'Scheduler' },      // ← NEW
  { path: '/health', label: 'Health' },             // ← NEW
  { path: '/heartbeat', label: 'Heartbeat' },       // ← NEW
  { divider: true },
  { path: '/consult', label: 'Consult' },
  { path: '/decisions', label: 'Decisions' },
  { path: '/evolution', label: 'Evolution' },
  { path: '/traces', label: 'Traces' },
  { path: '/superseded', label: 'Superseded' },
  { path: '/handoff', label: 'Handoff' },
];
```

### Updated Routes

```typescript
// App.tsx — New routes
<Route path="/live" element={<LiveOps />} />
<Route path="/scheduler" element={<SchedulerPage />} />
<Route path="/scheduler/:id" element={<JobDetailPage />} />
<Route path="/health" element={<SystemHealth />} />
<Route path="/heartbeat" element={<HeartbeatConfigPage />} />
```

---

## 📋 Implementation Checklist

### Phase 7.0 — SSE Infrastructure
- [ ] Create `nanoclaw/src/event-bus.ts` — EventEmitter hub
- [ ] Add `/events/live` SSE endpoint to `nanoclaw/src/health-server.ts`
- [ ] Hook event bus into container runner, task scheduler, heartbeat system
- [ ] Create `oracle-v2/src/server/routes/live-proxy.ts` — SSE proxy
- [ ] Register live proxy route in `oracle-v2/src/server.ts`
- [ ] Create `oracle-v2/frontend/src/hooks/useLiveEvents.ts` — SSE client hook
- [ ] Test SSE connection + auto-reconnect

### Phase 7.1 — Live Operations Terminal
- [ ] Create `LiveOps.tsx` page + CSS module
- [ ] Implement `ActiveTaskCard.tsx` with streaming output
- [ ] Implement `OutputTerminal.tsx` (monospace, auto-scroll, ANSI color support)
- [ ] Implement `QueueList.tsx` + `CompletedList.tsx`
- [ ] Implement `LiveStatusBadge.tsx` (SSE connection indicator)
- [ ] Add route `/live` to App.tsx
- [ ] Add "Live" nav item to Header.tsx
- [ ] Hook `container:output` events from NanoClaw container runner
- [ ] Test with real container execution

### Phase 7.2 — Scheduler Management
- [ ] Create `oracle-v2/src/server/routes/scheduler-proxy.ts` — proxy all scheduler routes
- [ ] Create `oracle-v2/frontend/src/api/scheduler.ts` — API client
- [ ] Create `SchedulerPage.tsx` — job list with filters
- [ ] Create `JobCard.tsx` — job summary with quick actions
- [ ] Create `JobFormModal.tsx` — create/edit form
- [ ] Create `IntervalPicker.tsx` — human-friendly interval input
- [ ] Create `JobDetailPage.tsx` — detail view + run history
- [ ] Create `RunHistoryList.tsx` — timeline of runs with status
- [ ] Create `SchedulerStats.tsx` — summary bar
- [ ] Add routes `/scheduler` and `/scheduler/:id`
- [ ] Test CRUD operations end-to-end
- [ ] Test pause/resume/run-now actions

### Phase 7.3 — Health & Heartbeat Config
- [ ] Create `oracle-v2/src/server/routes/heartbeat-proxy.ts` — proxy heartbeat config
- [ ] Create `oracle-v2/frontend/src/api/heartbeat.ts` — API client
- [ ] Create `SystemHealth.tsx` — multi-service health view
- [ ] Create `ServiceCard.tsx` — per-service card with status dot
- [ ] Create `ResourceChart.tsx` — CPU/Memory sparklines
- [ ] Create `HeartbeatConfigPage.tsx` — config editor
- [ ] Create `ToggleSwitch.tsx`, `DurationPicker.tsx` — form components
- [ ] Add routes `/health` and `/heartbeat`
- [ ] Test config changes propagate to NanoClaw
- [ ] Test manual heartbeat ping

---

## 🔒 Security Considerations

1. **Authentication** — ทุก route ต้องผ่าน `adminAuth` middleware (Bearer token)
2. **SSE Auth** — SSE endpoint ต้อง verify token ก่อนส่ง stream
3. **Input Validation** — Validate interval_ms (min 60s, max 30d), prompt length (max 10,000 chars)
4. **Rate Limiting** — Job creation: max 10/min, Run Now: max 5/min
5. **Output Sanitization** — Container output ที่แสดงใน terminal ต้อง escape HTML
6. **CORS** — ยังคง restrict origins เหมือนเดิม

---

## 📊 Technology Summary

| Component | Technology | Notes |
|-----------|-----------|-------|
| Real-time transport | SSE (Server-Sent Events) | Auto-reconnect, HTTP compatible |
| Frontend framework | React 19 + React Router 7 | ใช้ของเดิม |
| Styling | CSS Modules | ใช้แบบเดียวกับหน้าอื่น |
| Charts | Recharts 3 | มีอยู่แล้วในโปรเจค |
| Backend proxy | Hono.js (Bun) | เพิ่ม proxy routes ใหม่ |
| State management | React useState + useReducer | ไม่ต้องเพิ่ม library ใหม่ |
| Terminal output | Custom component (monospace pre) | Lightweight, no xterm.js needed |

---

## 🚀 Priority Order

```
Phase 7.0 (SSE Infrastructure)    ←── ทำก่อน เป็นพื้นฐานของทุกอย่าง
    ↓
Phase 7.2 (Scheduler Management)  ←── Practical value สูงสุด ใช้งานได้ทันที
    ↓
Phase 7.1 (Live Operations)       ←── ต้องรอ event hooks พร้อม
    ↓
Phase 7.3 (System Health)         ←── Nice to have, ข้อมูลส่วนใหญ่มีแล้ว
```

**เหตุผลที่ 7.2 ก่อน 7.1:** Scheduler Management ใช้ REST API ที่มีอยู่แล้วใน NanoClaw (CRUD endpoints ครบ) → implement ได้เลยแม้ SSE ยังไม่สมบูรณ์ ส่วน Live Ops ต้องรอ event bus และ container hooks ซึ่งซับซ้อนกว่า

---

## Estimated File Changes

### New Files (~20 files)

**NanoClaw:**
- `nanoclaw/src/event-bus.ts`

**Oracle Backend:**
- `oracle-v2/src/server/routes/live-proxy.ts`
- `oracle-v2/src/server/routes/scheduler-proxy.ts`
- `oracle-v2/src/server/routes/heartbeat-proxy.ts`

**Oracle Frontend — Hooks:**
- `oracle-v2/frontend/src/hooks/useLiveEvents.ts`

**Oracle Frontend — API:**
- `oracle-v2/frontend/src/api/scheduler.ts`
- `oracle-v2/frontend/src/api/heartbeat.ts`

**Oracle Frontend — Pages:**
- `oracle-v2/frontend/src/pages/LiveOps.tsx` + `.module.css`
- `oracle-v2/frontend/src/pages/SchedulerPage.tsx` + `.module.css`
- `oracle-v2/frontend/src/pages/JobDetailPage.tsx` + `.module.css`
- `oracle-v2/frontend/src/pages/SystemHealth.tsx` + `.module.css`
- `oracle-v2/frontend/src/pages/HeartbeatConfigPage.tsx` + `.module.css`

**Oracle Frontend — Components:**
- `oracle-v2/frontend/src/components/OutputTerminal.tsx`
- `oracle-v2/frontend/src/components/ActiveTaskCard.tsx`
- `oracle-v2/frontend/src/components/JobCard.tsx`
- `oracle-v2/frontend/src/components/JobFormModal.tsx`
- `oracle-v2/frontend/src/components/IntervalPicker.tsx`
- `oracle-v2/frontend/src/components/ServiceCard.tsx`
- `oracle-v2/frontend/src/components/ToggleSwitch.tsx`

### Modified Files (~5 files)
- `oracle-v2/frontend/src/App.tsx` — Add new routes
- `oracle-v2/frontend/src/components/Header.tsx` — Add nav items
- `oracle-v2/src/server.ts` — Register proxy routes
- `nanoclaw/src/health-server.ts` — Add SSE endpoint
- `nanoclaw/src/container-runner.ts` — Hook event bus

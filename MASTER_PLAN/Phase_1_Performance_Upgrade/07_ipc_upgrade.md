# 1.7 — IPC Upgrade (fs.watch)

> แก้จุดอ่อน: P8 (Filesystem IPC Polling Overhead)

**Status:** ✅ Complete  
**Effort:** Small  
**Priority:** 🟢 Low

---

## 📋 ปัญหาเดิม

Host polls `data/ipc/` ทุก 1s, container polls ทุก 500ms ด้วย `readdir` → overhead สะสม

**ที่มา:** NanoClaw `src/ipc.ts`, `container/agent-runner/src/index.ts`

---

## ✅ Checklist

### Host Side — fs.watch

- [ ] แก้ `src/ipc.ts`:
  - แทนที่ `setInterval` + `readdir` ด้วย `fs.watch()` (inotify on Linux):
    ```typescript
    fs.watch(ipcDir, { recursive: true }, (eventType, filename) => {
      if (filename && filename.endsWith('.json')) {
        processIpcFile(path.join(ipcDir, filename));
      }
    });
    ```
  - เก็บ fallback poll (30s interval) สำหรับ fs.watch ที่ miss events
  - Debounce: 100ms (ป้องกัน create + rename ที่มาเร็วเกินไป)

### Container Side — fs.watch

- [ ] แก้ `container/agent-runner/src/index.ts`:
  - แทนที่ 500ms poll ด้วย `fs.watch()` สำหรับ input directory
  - Fallback: 5s poll

### ทดสอบ

- [ ] IPC message ถูก process ภายใน <200ms (ลดจาก 500ms-1s)
- [ ] fs.watch event triggered → file processed ทันที
- [ ] Fallback poll ยังทำงานเมื่อ fs.watch fail

---

## 🧪 Definition of Done

1. IPC latency <200ms (ลดจาก 500ms-1s)
2. CPU usage ลดลง (ไม่มี constant readdir)
3. Fallback poll ยังทำงาน

---

## 📎 Files to Modify

| File | Repo | Action |
|------|------|--------|
| `src/ipc.ts` | NanoClaw | Use fs.watch + 30s fallback |
| `container/agent-runner/src/index.ts` | NanoClaw | Use fs.watch + 5s fallback |

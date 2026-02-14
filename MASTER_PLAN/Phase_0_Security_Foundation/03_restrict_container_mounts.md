# 0.3 — ตัด Project Root Mount (Restrict Container Mounts)

> แก้จุดอ่อน: S1 (Container Permission Bypass), S3 (Main Group Gets Full Project Root R/W)

**Status:** ✅ Done  
**Effort:** Small  
**Priority:** 🔴 High — Security critical

---

## 📋 ปัญหาเดิม

Main group container ได้ mount **project root ทั้งหมด** (R/W):
```
mounts.push({ hostPath: projectRoot, containerPath: '/workspace', readOnly: false });
```

ทำให้ agent เข้าถึง:
- `store/auth/` → WhatsApp credentials (signal keys)
- `.env` → API keys, tokens
- `src/` → application source code
- `data/ipc/` → IPC command channel

**ที่มา:** NanoClaw `src/container-runner.ts` → `buildVolumeMounts()`

---

## 🎯 เป้าหมาย

Container mount เฉพาะ directory ที่จำเป็น:
- ✅ `groups/{name}/` → group workspace (R/W)
- ✅ `data/ipc/{name}/` → IPC namespace (R/W)
- ✅ Claude session dir → session resume
- ❌ `store/auth/` → ไม่ mount
- ❌ `.env` → ไม่ mount
- ❌ `src/` → ไม่ mount
- ❌ project root → ไม่ mount

---

## ✅ Checklist

### ปรับ Volume Mounts

- [ ] แก้ `src/container-runner.ts` → `buildVolumeMounts()`:
  - **ลบ:** project root mount สำหรับ main group
  - **เพิ่ม:** explicit mounts เฉพาะที่จำเป็น:
    ```
    Main group:
    ├── groups/main/             → /workspace/group     (R/W)
    ├── data/ipc/main/           → /workspace/ipc       (R/W)
    ├── .claude/sessions/main/   → /home/node/.claude   (R/W)
    └── shared/tools/            → /workspace/tools     (R/O, optional)

    Other groups:
    ├── groups/{name}/           → /workspace/group     (R/W)
    ├── data/ipc/{name}/         → /workspace/ipc       (R/W)
    └── .claude/sessions/{name}/ → /home/node/.claude   (R/W)
    ```

- [ ] ตรวจสอบ `mount-security.ts` → ปรับ allowlist ให้สอดคล้อง
- [ ] ลบ additional mounts ที่อนุญาต project-internal paths

### ปรับ Agent Runner

- [ ] ตรวจสอบ `container/agent-runner/src/index.ts`:
  - CLAUDE.md loading → อ้าง `/workspace/group/CLAUDE.md` แทน `/workspace/project/CLAUDE.md`
  - Session directory → ต้องอยู่ใน mounted path
- [ ] ตรวจสอบว่า skills (`.claude/skills/`) ยัง accessible หรือต้อง mount แยก

### ทำ Main Group Workspace Migration

- [ ] ถ้า main group เคยใช้ `/workspace/project` เป็น workspace → migrate:
  - ย้ายไฟล์ที่ agent สร้างไว้ไปที่ `groups/main/`
  - ปรับ CLAUDE.md ใน main group ให้ reference paths ถูกต้อง

### ทดสอบ

- [ ] Spawn main group container → `ls /workspace/` → เห็นเฉพาะ `group/` `ipc/`
- [ ] ลอง access `../../store/auth/` จากใน container → Permission denied / ไม่มี path
- [ ] ลอง access `../../.env` → ไม่มี path
- [ ] Agent ยังทำงานได้ปกติ (สร้างไฟล์, อ่านไฟล์, IPC)
- [ ] Other group container → ตรวจสอบ isolation เช่นกัน

---

## 🧪 Definition of Done

1. `docker exec container ls /` → ไม่เห็น project root structure
2. Agent ใน main group ไม่สามารถอ่าน `store/auth/` หรือ `.env`
3. Agent ยังทำงานได้ปกติ (read/write files, IPC, session resume)
4. Mount allowlist ปรับตามแล้ว

---

## 📎 Files to Modify

| File | Repo | Action |
|------|------|--------|
| `src/container-runner.ts` | NanoClaw | Restrict volume mounts |
| `src/mount-security.ts` | NanoClaw | Update allowlist |
| `container/agent-runner/src/index.ts` | NanoClaw | Update path references |
| `groups/main/CLAUDE.md` | NanoClaw | Update workspace paths |

# 0.5 — IPC Integrity Signing (HMAC)

> แก้จุดอ่อน: S4 (IPC Files Lack Integrity Verification)

**Status:** ✅ Done  
**Effort:** Small  
**Priority:** 🟡 Medium

---

## 📋 ปัญหาเดิม

IPC ใช้ JSON files ใน `data/ipc/` — อ่าน, parse, ลบ ไม่มี integrity check:
```typescript
const content = fs.readFileSync(filePath, 'utf-8');
const data = JSON.parse(content);
fs.unlinkSync(filePath);
```

ใครก็ตามที่เขียนไฟล์ใน `data/ipc/` ได้ = inject commands ได้ (schedule tasks, register groups, send messages)

**ที่มา:** NanoClaw `src/ipc.ts`

---

## 🎯 เป้าหมาย

ทุก IPC message ต้องมี **HMAC-SHA256** signature → Host verify ก่อน process → reject ถ้าไม่ valid

---

## ✅ Checklist

### สร้าง IPC Signing Module

- [ ] สร้าง `src/ipc-signing.ts`:
  - `signIpcMessage(payload: object, secret: string): string`
    - `hmac = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex')`
    - Return: `JSON.stringify({ ...payload, _hmac: hmac })`
  - `verifyIpcMessage(content: string, secret: string): { valid: boolean, data: object }`
    - Parse JSON → extract `_hmac` → compute expected HMAC on remaining fields → compare
    - Use `crypto.timingSafeEqual()` เพื่อป้องกัน timing attack

### Generate Shared Secret

- [ ] เพิ่มใน `src/config.ts`:
  - `IPC_SECRET` → อ่านจาก `JELLYCORE_IPC_SECRET` env var
  - ถ้าไม่มี → auto-generate ด้วย `crypto.randomBytes(32).toString('hex')` → save ใน `store/.ipc-secret`
  - Load from saved file on restart

### ปรับ IPC Writer (Container Side)

- [ ] แก้ `container/agent-runner/src/ipc-mcp-stdio.ts`:
  - Import/implement signing function
  - ทุก IPC file ที่เขียน → sign ด้วย shared secret (ส่งผ่าน container env var)
  - รวม: sendMessage, createTask, registerGroup, etc.

### ปรับ IPC Reader (Host Side)

- [ ] แก้ `src/ipc.ts`:
  - ทุก IPC file ที่อ่าน → verify HMAC ก่อน process
  - ถ้า HMAC invalid หรือไม่มี:
    - Log warning: `"IPC message rejected: invalid signature" + filename`
    - Delete file (ไม่ process)
    - Increment counter สำหรับ monitoring
  - ถ้า HMAC valid → process ปกติ

### Pass Secret to Containers

- [ ] แก้ `src/container-runner.ts`:
  - เพิ่ม `JELLYCORE_IPC_SECRET` ใน container env vars
  - ส่งผ่าน `--env` flag (ไม่ใช่ volume mount)

### ทดสอบ

- [ ] Container ส่ง IPC message → Host verify สำเร็จ → process ปกติ
- [ ] สร้าง fake IPC file (ไม่มี HMAC) ด้วยมือ → ถูก reject + log warning
- [ ] สร้าง fake IPC file (HMAC ผิด) → ถูก reject
- [ ] ตรวจสอบว่า IPC ทำงานปกติหลังเพิ่ม signing (sendMessage, createTask)

---

## 🧪 Definition of Done

1. IPC files ที่ไม่มี valid HMAC ถูก reject 100%
2. Legitimate IPC messages (จาก container) ผ่าน verification ปกติ
3. Warning log เมื่อ reject
4. Secret ถูก generate/load อัตโนมัติ (zero config)

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `src/ipc-signing.ts` | NanoClaw | **Create** — HMAC sign/verify |
| `src/ipc.ts` | NanoClaw | Add verification before processing |
| `src/config.ts` | NanoClaw | Add IPC_SECRET config |
| `src/container-runner.ts` | NanoClaw | Pass secret to containers |
| `container/agent-runner/src/ipc-mcp-stdio.ts` | NanoClaw | Sign outgoing IPC |

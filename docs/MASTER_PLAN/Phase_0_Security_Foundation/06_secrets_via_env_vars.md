# 0.6 — Secrets via Environment Variables Only

> แก้จุดอ่อน: S7 (Secrets Briefly Written to Disk in Container)

**Status:** ✅ Done  
**Effort:** Small  
**Priority:** 🟢 Low-Medium

---

## 📋 ปัญหาเดิม

Container entry point อ่าน JSON (มี `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`) จาก stdin → เขียน `/tmp/input.json` → อ่าน → ลบ  
มีช่วงเวลาสั้นๆ ที่ secrets อยู่บน disk ใน container

**ที่มา:** NanoClaw `container/agent-runner/src/index.ts`

---

## 🎯 เป้าหมาย

Secrets ส่งผ่าน Docker `--env` flags เท่านั้น → อยู่ใน process memory ตลอด → ไม่เขียน disk เลย

---

## ✅ Checklist

### ปรับ Container Runner (Host Side)

- [ ] แก้ `src/container-runner.ts`:
  - แทนที่ stdin JSON ด้วย `--env` flags:
    ```
    docker run \
      --env ANTHROPIC_API_KEY=xxx \
      --env CLAUDE_CODE_OAUTH_TOKEN=xxx \
      --env AGENT_PROMPT="..." \
      --env GROUP_NAME="..." \
      --env SESSION_ID="..." \
      ... ไม่ส่ง stdin อีกต่อไป
    ```
  - สำหรับ prompt/message ที่ยาว → ใช้ `--env-file` กับ temp file ที่ลบทันที
  - หรือส่ง prompt ผ่าน IPC directory (ไม่มี secrets) แทน stdin

### ปรับ Agent Runner (Container Side)

- [ ] แก้ `container/agent-runner/src/index.ts`:
  - อ่าน config จาก `process.env` แทน stdin JSON:
    ```typescript
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const prompt = process.env.AGENT_PROMPT;
    const groupName = process.env.GROUP_NAME;
    ```
  - ลบ stdin reading + `/tmp/input.json` logic ทั้งหมด
  - ลบ `fs.writeFileSync('/tmp/input.json', ...)` 
  - ลบ `fs.unlinkSync('/tmp/input.json')`

### Handle Long Prompts

- [ ] ถ้า prompt ยาวเกิน Docker env var limit (~128KB):
  - เขียน prompt file ใน IPC directory (ไม่มี secrets)
  - Agent อ่าน prompt จาก `/workspace/ipc/prompt.txt`
  - Secrets ยังอยู่ใน env vars

### ทดสอบ

- [ ] Spawn container → `docker inspect --format='{{.Config.Env}}'` → เห็น ANTHROPIC_API_KEY
- [ ] ภายใน container → `ls /tmp/` → ไม่มี input.json
- [ ] Agent ทำงานปกติ (query Claude, execute tools)
- [ ] Long prompt (>10KB) → ทำงานได้ผ่าน IPC file

---

## 🧪 Definition of Done

1. ไม่มี secret ถูกเขียน disk ภายใน container (ไม่มี `/tmp/input.json`)
2. Agent ยังทำงานได้ปกติ
3. Prompt ยาวๆ ยัง pass ได้

---

## 📎 Files to Modify

| File | Repo | Action |
|------|------|--------|
| `src/container-runner.ts` | NanoClaw | Use --env instead of stdin |
| `container/agent-runner/src/index.ts` | NanoClaw | Read from process.env |

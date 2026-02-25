# NanoClaw Agent Tools Update Plan

## Objective

ทำให้ AI agent ใช้เครื่องมือได้ "ครบ ใช้จริง และตรวจสอบได้" ใน 4 เป้าหมายหลัก:

1. Memory 5 ชั้นใช้งานได้ครบตามเจตนา
2. เวลาและ timezone แม่นยำและสอดคล้องทั้งระบบ
3. Oracle tools ใช้งานได้ครบฟังก์ชันอย่างมี governance
4. agent-browser ใช้งานได้จริงพร้อม fallback

---

## Prioritization Method

เรียงลำดับงานตาม:

1. แก้ไขง่ายก่อน (Effort ต่ำ)
2. ในงานที่ effort ใกล้กัน ให้ทำงานที่ Impact สูงก่อน

ระดับคะแนน:

- Effort: S (0.5-1 วัน), M (1-2 วัน), L (2-4 วัน)
- Impact: High / Medium / Low

---

## Ordered Execution Backlog

### 1) Time Contract Alignment (S, High)

สถานะ: `DONE (2026-02-25)`

เป้าหมาย:

- ทำให้ข้อความ/คู่มือ schedule time เป็นกติกาเดียวกันทั้งหมด (local time, no `Z` สำหรับ `once`)

เหตุผล:

- เป็น quick win ที่ลดความสับสนผู้ใช้และลด task พลาดเวลาได้ทันที

ไฟล์หลัก:

- `nanoclaw/container/agent-runner/src/ipc-mcp-stdio.ts`
- `groups/global/CLAUDE.md`
- `groups/main/CLAUDE.md`
- `nanoclaw/docs/DEBUG_CHECKLIST.md`

Done เมื่อ:

- ไม่มีคำอธิบายเวลาแบบขัดกันใน tool descriptions และ docs
- มีตัวอย่างเดียวกันทั้งระบบ (local timestamp เช่น `2026-03-01T09:30:00`)

---

### 2) Runtime Tool Inventory Endpoint (S, High)

สถานะ: `DONE (2026-02-25)`

เป้าหมาย:

- เพิ่ม endpoint สรุปว่า runtime นี้เปิดใช้ tools/skills/mcps อะไรอยู่จริง

เหตุผล:

- ช่วย debug "ทำไม agent ใช้เครื่องมือนี้ไม่ได้" ได้เร็วมาก

ไฟล์หลัก:

- `nanoclaw/src/health-server.ts`
- `nanoclaw/container/agent-runner/src/index.ts` (ส่งข้อมูล capability)
- `nanoclaw/container/config/mcps.json`

Done เมื่อ:

- มี endpoint เช่น `GET /ops/tools`
- แสดงอย่างน้อย: built-in tools, nanoclaw MCP tools, oracle MCP tools, external MCP active/inactive + reason

---

### 3) Startup/Periodic Capability Smoke Checks (S, High)

สถานะ: `DONE (2026-02-25)`

เป้าหมาย:

- เพิ่ม self-check ตอน startup และ periodic check สำหรับเครื่องมือสำคัญ

เหตุผล:

- ป้องกันอาการ "ระบบดูปกติแต่ใช้ tool ไม่ได้" ก่อนกระทบผู้ใช้

เช็คขั้นต่ำ:

- Oracle health/API auth
- MCP bridge process up
- `agent-browser` command callable
- external MCP ที่ required env ครบต้อง start ได้

ไฟล์หลัก:

- `nanoclaw/src/index.ts`
- `nanoclaw/src/docker-resilience.ts`
- `nanoclaw/src/health-server.ts`

Done เมื่อ:

- `/status` ระบุ capability health ได้
- มี log/alert เมื่อ check ล้มเหลวต่อเนื่อง

---

### 4) PromptBuilder: Add Procedural Layer to Auto Context (M, High)

สถานะ: `DONE (2026-02-25)`

เป้าหมาย:

- จากเดิม inject แค่ user/recent/knowledge ให้เพิ่ม procedural context ใน `<ctx>`

เหตุผล:

- เพิ่มความฉลาดเชิง workflow โดยไม่ต้องให้ผู้ใช้ย้ำขั้นตอนเดิมทุกครั้ง

ไฟล์หลัก:

- `nanoclaw/src/prompt-builder.ts`
- `nanoclaw/src/index.ts`

Done เมื่อ:

- `<ctx>` มี section procedural (เมื่อมีข้อมูล)
- token budget ยังไม่เกินเพดาน
- มี test กรณี Oracle down แล้วยัง degrade ได้

---

### 5) Stable User Identity Mapping for Memory APIs (M, High)

สถานะ: `DONE (2026-02-25)`

เป้าหมาย:

- map `chat_jid -> userId` ให้คงที่ เพื่อให้ `oracle_user_model` ไม่ปนกัน

เหตุผล:

- ทำให้ Layer 1 ใช้งานแม่นขึ้น โดยเฉพาะหลายกลุ่ม/หลาย user

ไฟล์หลัก:

- `nanoclaw/src/db.ts`
- `nanoclaw/src/index.ts`
- `nanoclaw/src/prompt-builder.ts`

Done เมื่อ:

- ทุก call ที่เกี่ยวกับ user model ส่ง userId ที่เสถียร
- มี migration/lookup ที่ปลอดภัยย้อนหลัง

---

### 6) Oracle Write Governance (L, High)

สถานะ: `DONE (2026-02-25)`

เป้าหมาย:

- เปลี่ยนจาก read-only แบบเหมารวม เป็นสิทธิ์รายกลุ่ม/ราย tool

เหตุผล:

- ได้ "ครบฟังก์ชัน" โดยไม่เสี่ยงให้ทุกกลุ่มเขียนความจำได้เท่ากันหมด

ไฟล์หลัก:

- `nanoclaw/container/agent-runner/src/index.ts`
- `nanoclaw/container/agent-runner/src/oracle-mcp-http.ts`
- `nanoclaw/src/container-runner.ts`
- `groups/*/CLAUDE.md`

Done เมื่อ:

- กำหนด policy matrix ได้ (เช่น main=full, others=read+selected writes)
- มี audit trail ว่าใครเรียก write tools

---

### 7) Agent-Browser Hardening + Fallback Path (M, Medium-High)

สถานะ: `DONE (2026-02-25)`

เป้าหมาย:

- เพิ่ม fallback ไป python+playwright เมื่อ `agent-browser` ใช้ไม่ได้

เหตุผล:

- ลด single-point-of-failure ด้าน browser automation

ไฟล์หลัก:

- `nanoclaw/container/skills/agent-browser/SKILL.md`
- `nanoclaw/container/skills/python/SKILL.md`
- `groups/global/CLAUDE.md`

Done เมื่อ:

- มี guideline fallback ที่ชัดเจน
- มี smoke test ที่พิสูจน์ fallback path ใช้งานได้

---

### 8) End-to-End Acceptance Suite (M, High)

สถานะ: `DONE (2026-02-25)`

เป้าหมาย:

- เพิ่มชุดทดสอบใช้งานจริงแบบ end-to-end ตาม 4 เป้าหมาย

สถานการณ์ขั้นต่ำ:

1. Memory 5 ชั้นถูกเรียกตาม policy
2. คำถามเวลา/สร้างตารางงานไม่ผิด timezone
3. Oracle tools ใช้งานได้ครบตามสิทธิ์
4. browser task สำเร็จหรือ fallback สำเร็จ

ไฟล์หลัก:

- `nanoclaw/src/*test.ts`
- (ถ้าต้องมี) e2e harness ใหม่ใน `nanoclaw/tests/`

Done เมื่อ:

- มีผลทดสอบผ่านใน CI/local
- มี regression checklist สำหรับ release

---

## Suggested Delivery Waves

### Wave A (Quick Wins, 2-3 วัน)

1. Time Contract Alignment
2. Runtime Tool Inventory Endpoint
3. Capability Smoke Checks

ผลลัพธ์:

- ผู้ดูแลระบบเห็นปัญหาได้เร็ว
- ผู้ใช้เจอปัญหาเวลา/เครื่องมือน้อยลงทันที

### Wave B (Core Intelligence, 3-4 วัน)

1. PromptBuilder Procedural Layer
2. Stable User Identity Mapping
3. Agent-Browser Hardening + Fallback

ผลลัพธ์:

- agent ตอบฉลาดขึ้นและเสถียรขึ้นในงานจริง

### Wave C (Governance + Quality Gate, 3-4 วัน)

1. Oracle Write Governance
2. End-to-End Acceptance Suite

ผลลัพธ์:

- พร้อมใช้งาน production ระยะยาวแบบควบคุมความเสี่ยงได้

---

## Start-Now Checklist

เริ่มทำได้ทันทีตามลำดับนี้:

1. ปิดงาน Wave A ก่อนทั้งหมด
2. Deploy แบบ canary กับกลุ่มหลัก 24-48 ชั่วโมง
3. วัด metrics: tool availability, schedule error rate, oracle timeout rate, browser task success rate
4. ผ่านเกณฑ์แล้วค่อยเปิด Wave B เต็ม

---

## Decision

Completed: Wave A + Wave B + Wave C implementation baseline is in place.

งานถัดไปคือ canary rollout + monitor ตาม `AGENT_TOOLS_REGRESSION_CHECKLIST.md`.

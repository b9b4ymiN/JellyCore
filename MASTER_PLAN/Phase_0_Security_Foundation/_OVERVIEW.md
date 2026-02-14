# Phase 0: Security Foundation

> สัปดาห์ที่ 1 — วางรากฐานความปลอดภัยของระบบทั้งหมด

**Status:** ⬜ Not Started  
**แก้ไขจุดอ่อน:** S1, S2, S3, S4, S5, S7, S8 (7 จุด)  
**Prerequisites:** None (เริ่มที่นี่)

---

## 🎯 เป้าหมาย

ทำให้ระบบปลอดภัยตั้งแต่ layer ล่างสุด — encrypted storage, restricted container mounts, authenticated services, signed IPC — ก่อนที่จะเริ่ม build features ใดๆ

---

## 📁 Items ใน Phase นี้

| # | Item | แก้จุดอ่อน | ไฟล์ |
|---|------|-----------|------|
| 0.1 | แยก Oracle V2 เป็น Independent Service | A8, P5, P6 | [01_oracle_independent_service.md](01_oracle_independent_service.md) |
| 0.2 | สร้าง MCP-HTTP Bridge | A8 | [02_mcp_http_bridge.md](02_mcp_http_bridge.md) |
| 0.3 | ตัด Project Root Mount | S1, S3 | [03_restrict_container_mounts.md](03_restrict_container_mounts.md) |
| 0.4 | Encrypt WhatsApp Auth | S2 | [04_encrypt_whatsapp_auth.md](04_encrypt_whatsapp_auth.md) |
| 0.5 | IPC Integrity Signing | S4 | [05_ipc_integrity_signing.md](05_ipc_integrity_signing.md) |
| 0.6 | Secrets via Env Vars Only | S7 | [06_secrets_via_env_vars.md](06_secrets_via_env_vars.md) |
| 0.7 | Knowledge Base Public/Private Split | S8 | [07_knowledge_base_split.md](07_knowledge_base_split.md) |
| 0.8 | ChromaDB Authentication | S5 | [08_chromadb_authentication.md](08_chromadb_authentication.md) |

---

## 🔗 Dependency Graph

```
0.1 Oracle Independent ──► 0.2 MCP-HTTP Bridge
                           ──► 0.8 ChromaDB Auth (Oracle connects to authed ChromaDB)

0.3 Restrict Mounts ──► (independent)
0.4 Encrypt Auth    ──► (independent)
0.5 IPC Signing     ──► (independent)
0.6 Secrets Env     ──► (independent)
0.7 KB Split        ──► (independent)
```

**ทำ parallel ได้:** 0.3, 0.4, 0.5, 0.6, 0.7 ไม่ขึ้นกัน  
**ต้องทำก่อน:** 0.1 ก่อน 0.2 และ 0.8

---

## ✅ Phase Completion Criteria

- [ ] Oracle V2 run เป็น Docker service แยก ตอบ `/api/health` ได้
- [ ] Agent container เรียก Oracle ผ่าน HTTP ได้ (ไม่ใช่ subprocess)
- [ ] Container mount ไม่เห็น `store/auth/`, `.env`, `src/`
- [ ] WhatsApp auth files encrypted ด้วย AES-256-GCM
- [ ] IPC files ที่ไม่มี HMAC ถูก reject
- [ ] Secrets ไม่ถูกเขียน disk ใน container
- [ ] `ψ/memory/private/` ไม่อยู่ใน Git
- [ ] ChromaDB ปฏิเสธ connection ที่ไม่มี auth token

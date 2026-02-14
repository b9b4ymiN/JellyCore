# 0.4 — Encrypt WhatsApp Auth at Rest

> แก้จุดอ่อน: S2 (WhatsApp Auth Stored Unencrypted)

**Status:** ✅ Done  
**Effort:** Medium  
**Priority:** 🟠 High

---

## 📋 ปัญหาเดิม

Baileys auth state (session keys, identity, signal protocol keys) เก็บเป็น **plain JSON** ใน `store/auth/`:
```typescript
const { state, saveCreds } = await useMultiFileAuthState(authDir);
```

ใครก็ตามที่อ่าน filesystem ได้ = ขโมย WhatsApp session ได้

**ที่มา:** NanoClaw `src/channels/whatsapp.ts` line ~55

---

## 🎯 เป้าหมาย

Auth files ถูก encrypt ด้วย **AES-256-GCM** ก่อนเขียน disk → decrypt on read  
ต้องมี `JELLYCORE_AUTH_PASSPHRASE` env var เพื่อ unlock

---

## ✅ Checklist

### สร้าง Encryption Layer

- [ ] สร้างไฟล์ `src/encrypted-auth.ts`:
  - Function: `createEncryptedAuthState(authDir, passphrase)`
  - Key derivation: `crypto.scryptSync(passphrase, salt, 32)` → AES-256 key
  - Salt: generate ครั้งแรก → save ใน `store/auth/.salt` (ไม่ encrypt)
  - Encrypt: `crypto.createCipheriv('aes-256-gcm', key, iv)`
  - IV: random 16 bytes per file (prepend to ciphertext)
  - Auth tag: append 16 bytes to ciphertext
  - File format: `[IV 16 bytes][ciphertext][auth tag 16 bytes]`

- [ ] Implement `saveCreds` wrapper:
  ```
  Original JSON → JSON.stringify → encrypt → writeFile (binary)
  ```

- [ ] Implement `state` loader wrapper:
  ```
  readFile (binary) → decrypt → JSON.parse → return state object
  ```

- [ ] Handle backward compatibility:
  - ตรวจสอบว่าไฟล์เป็น JSON หรือ encrypted
  - ถ้าเป็น JSON (old format) → อ่านได้ปกติ + encrypt ทับเมื่อ save
  - First run: auto-migrate plain → encrypted

### เพิ่ม Config

- [ ] เพิ่ม env var: `JELLYCORE_AUTH_PASSPHRASE` (required)
- [ ] Validation: ถ้าไม่มี passphrase → error ตอน startup + ไม่ start
- [ ] Minimum passphrase length: 16 characters
- [ ] `.env.example` → เพิ่ม `JELLYCORE_AUTH_PASSPHRASE=`

### ปรับ WhatsApp Channel

- [ ] แก้ `src/channels/whatsapp.ts`:
  - แทนที่ `useMultiFileAuthState(authDir)` ด้วย `createEncryptedAuthState(authDir, passphrase)`
  - Import passphrase จาก config/env
- [ ] ตรวจสอบว่า Baileys reconnect/save cycle ยังทำงานถูกต้อง

### ทดสอบ

- [ ] Start ด้วย passphrase → auth files เป็น binary (ไม่ใช่ readable JSON)
- [ ] `cat store/auth/creds.json` → binary/encrypted data
- [ ] Restart ด้วย passphrase เดิม → reconnect สำเร็จ (ไม่ต้อง QR ใหม่)
- [ ] Restart ด้วย passphrase ผิด → error "Invalid passphrase" + ไม่ start
- [ ] Restart โดยไม่มี passphrase → error "JELLYCORE_AUTH_PASSPHRASE required"
- [ ] Migration test: ใส่ plain JSON auth → start → auth ถูก encrypt ทับ → restart → ยัง connect ได้

---

## 🧪 Definition of Done

1. Auth files ใน `store/auth/` อ่านไม่ได้ด้วย `cat` หรือ text editor
2. ต้องมี passphrase เพื่อ start service
3. Passphrase ผิด → ไม่ start + error message ชัดเจน
4. Backward compatible กับ existing plain auth files
5. WhatsApp reconnect ทำงานปกติหลัง restart

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `src/encrypted-auth.ts` | NanoClaw | **Create** — encryption layer |
| `src/channels/whatsapp.ts` | NanoClaw | Use encrypted auth state |
| `src/config.ts` | NanoClaw | Add JELLYCORE_AUTH_PASSPHRASE |
| `.env.example` | JellyCore | Add passphrase template |

# JellyCore เริ่มต้นใช้งาน (ภาษาไทย)

เอกสารนี้เป็นฉบับภาษาไทยของ `docs/QUICKSTART.md`

## 1) สิ่งที่ต้องมี

- Docker Desktop เปิดอยู่
- Node.js 20+
- Bun 1.3+
- Git

## 2) ตั้งค่า `.env`

```powershell
Copy-Item .env.example .env
```

ค่าที่สำคัญ:

- `AGENT_FULL_ACCESS=false` (ค่าแนะนำเพื่อความปลอดภัย)
- ตั้ง `ORACLE_AUTH_TOKEN` สำหรับ endpoint ที่ต้องยืนยันตัวตน
- ตั้ง `ORACLE_ALLOWED_ORIGINS` ถ้าต้องจำกัด CORS เพิ่ม

## 3) สตาร์ตบริการหลัก

```powershell
docker compose up -d chromadb oracle docker-socket-proxy nanoclaw
docker compose ps
```

ตรวจสุขภาพบริการ:

```powershell
curl http://127.0.0.1:47778/api/health
curl http://127.0.0.1:47779/health
curl http://127.0.0.1:47779/metrics
curl http://127.0.0.1:47778/metrics
```

## 4) รันเทสหลัก

```powershell
cd nanoclaw; npm test
cd ../oracle-v2; bun test src/integration/http.test.ts
cd ../oracle-v2; bun test src/integration/security-http.test.ts
cd ../oracle-v2; bun run test:e2e
cd ../oracle-v2/frontend; bun run build
cd ../../thai-nlp-sidecar; pytest tests -q
```

## 5) เปิด Thai NLP sidecar (ถ้าต้องการ)

```powershell
docker compose --profile thai-nlp up -d thai-nlp
```

ถ้า sidecar ไม่พร้อม Oracle ยังทำงานต่อได้ (fallback)

## 6) สำรองข้อมูลและกู้คืน

```powershell
./scripts/backup.sh --dry-run
./scripts/backup.sh
./scripts/verify-backup.sh backups/<snapshot>.tar.gz
./scripts/restore.sh backups/<snapshot>.tar.gz --dry-run
```

ขั้นตอนกู้คืนเต็ม: `docs/RECOVERY.md`

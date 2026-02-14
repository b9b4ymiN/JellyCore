# JellyCore Quick Start - Local Development

> คำแนะนำ: เริ่มใช้งานทดสอบบน Windows/macOS ด้วย Docker Desktop

## กำเอ็จ

1. **Docker Desktop** ถูกติดตั้งอยู่
2. **Node.js 18+** สำหรับ NanoClaw host
3. **Git** สำหรับ clone repositories

---

## 🚀 Step 1: ตรวจสอบ Environment

```powershell
# ตรวจสอบ Docker
docker --version

# ตรวจสอบ Node.js
node --version
```

---

## 📦 Step 2: Clone Repositories

```powershell
# ถ้ายังไม่ได้ clone ให้
cd c:\Programing\PersonalAI\jellycore

# Clone Oracle V2 (ถ้ายังไม่มี)
git clone https://github.com/Soul-Brews-Studio/oracle-v2.git oracle-v2

# Clone NanoClaw (ถ้ายังไม่มี)
git clone https://github.com/qwibitai/nanoclaw.git nanoclaw
```

---

## 🔐 Step 3: สร้าง Environment File

สร้างไฟล์ `.env` สำหรับ development:

```powershell
# Windows PowerShell
@"
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TELEGRAM_BOT_TOKEN=123456:ABC-DEF-123456789abc
ORACLE_AUTH_TOKEN=dev-token-123
CHROMA_AUTH_TOKEN=dev-chromadb-123
DATA_DIR=C:\data\jellycore
GROUPS_DIR=C:\data\jellycore\groups
"@

# หรือใช้ Command Prompt
set ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
set TELEGRAM_BOT_TOKEN=123456:ABC-DEF-123456789abc
set ORACLE_AUTH_TOKEN=dev-token-123
set CHROMA_AUTH_TOKEN=dev-chromadb-123
set DATA_DIR=C:\data\jellycore
set GROUPS_DIR=C:\data\jellycore\groups
```

---

## 🏗️ Step 4: เริ่ม Oracle V2 (Development Mode)

```powershell
cd oracle-v2

# Install dependencies
bun install

# Run Oracle V2 ใน development mode
bun run src/server.ts
```

Oracle V2 จะรันบน:
- HTTP API: http://localhost:47778
- Dashboard: http://localhost:47778

---

## 📱 Step 5: เริ่ม NanoClaw Host

```powershell
cd nanoclaw

# Install dependencies
npm install

# สร้าง groups directory
mkdir groups

# รัน NanoClaw host
npm start
```

NanoClaw จะรันบน:
- Host API: http://localhost:3000
- Container spawning: Apple Container (Linux VM)

---

## 🧪 Step 6: ตรวจสอบ Health

```powershell
# ตรวจสอบ Oracle V2
curl http://localhost:47778/api/health

# ตรวจสอบ NanoClaw host
curl http://localhost:3000/health

# ตรวจสอบ logs
docker compose logs
```

---

## 📝 ข้อจำกัด (Windows/macOS)

1. **Container isolation**
   - Apple Container ใช้ Linux VM → path แตกต่างกว่า Windows
   - แต่ใช้ Docker volume สำหรับ data sharing

2. **Performance**
   - Containers บน Windows ช้ากกว่า Linux
   - ใช้ WSL2 (Windows Subsystem for Linux 2) แทน

3. **WhatsApp Authentication**
   - ต้องรัน `/setup` คำสั่ง QR code
   - QR code แสดงใน terminal
   - สแกน QR ด้วย WhatsApp手机

---

## 🔧 การแก้ไข Configuration

### แก้ไข Data Directory (Windows)

```powershell
# แก้ไข .env สำหรับ Windows paths
set DATA_DIR=C:\jellycore\data
set GROUPS_DIR=C:\jellycore\groups
```

### แก้ไข docker-compose.yml สำหรับ Windows

```yaml
services:
  oracle:
    volumes:
      # Windows paths
      - C:\\jellycore\\oracle-data:/data/oracle
      - C:\\jellycore\\oracle-knowledge:/data/knowledge
```

---

## 🎯 ถัดไป

1. เริ่ม Oracle V2 → ใช้ `/api/learn` เพื่อเก็บ knowledge
2. เริ่ม NanoClaw → ส่งข้อความ
3. เชื่อมต่อร container → ดู logs: `docker compose logs nanoclaw`

---

## 📚 Documentation

เอกสารสำหรับ:
- **Oracle V2**: `oracle-v2/README.md`
- **NanoClaw**: `nanoclaw/README.md`
- **Master Plan**: `MASTER_PLAN/README.md`

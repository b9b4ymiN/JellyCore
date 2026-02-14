# JellyCore Deployment Guide

> คำแนะนำ: เอกสารสำหรับการ deploy JellyCore บน Linux VPS

## 📋 ก่อนกำเสร็จ

1. **Clone repositories** ✅
   - Oracle V2: `oracle-v2/`
   - NanoClaw: `nanoclaw/`

2. **Phase 0: Security Foundation** ✅
   - Docker Compose config
   - MCP-HTTP Bridge
   - PM2 ecosystem config

3. **Phase 1-3: Performance, Architecture, Resilience** ✅
   - WhatsApp Resilience
   - Prompt Builder
   - Production Docker Compose

4. **Phase 4-5: Intelligence & Production** 🔄
   - Context-aware prompts
   - Production deployment config

---

## 🖥️ ตำแหน่ง Deploy: Linux VPS

JellyCore ถูกออกแบบมาสำหรับ **Linux VPS** ดังนี้:
- Docker & Docker Compose
- Systemd/PM2 สำหรับ process management
- แต่ละใช้บน local Windows/macOS machine

### ข้อจำกัด

1. **Windows/macOS ไม่รองรับกับ Docker Compose**
   - Volume paths ไม่ถูกต้อง (`/data/jellycore` vs `C:\data`)
   - File permissions issues
   - Network differences

2. **แนะนำ Linux VPS**
   - ซื้อ/สำัง VPS ที่รองรับ Docker
   - ติดตั้ง Ubuntu 22.04 หรือ Debian 12
   - อย่างอย่าง 2GB RAM ขั้นต่ำ
   - 20GB disk space ขั้นต่ำ

---

## 🚀 วิธี Deploy บน Linux VPS

### 1. เตรียม Server

```bash
# อัปเดต system
sudo apt update && sudo apt upgrade -y

# ติดตั้ง Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# ติดตั้ง Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-uname -m" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### 2. ติดตั้ง Firewall

```bash
# เปิด ports ที่จำเป็นใช้
sudo ufw allow 3000/tcp  # NanoClaw
sudo ufw allow 47778/tcp   # Oracle V2
sudo ufw allow 5173/tcp    # Dashboard (optional)
sudo ufw allow 443/tcp    # HTTPS (Caddy later)

# หรือปดด firewall ทั้งหมด (เฉพาะใน VPC)
sudo ufw disable
```

### 3. Upload Files

```bash
# สร้าง directory บน server
mkdir -p ~/jellycore
cd ~/jellycore

# Upload files (จาก local machine)
scp -r c:/Programing/PersonalAI/jellycore/* user@your-vps-ip:~/jellycore/

# หรือใช้ git
git clone https://github.com/yourusername/jellycore.git
```

### 4. สร้าง Environment Variables

```bash
cat > .env << 'EOF'
# === API Keys ===
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# === Telegram ===
TELEGRAM_BOT_TOKEN=123456:ABC-DEF-123456789abc

# === Oracle ===
ORACLE_AUTH_TOKEN=$(openssl rand -hex 16)
CHROMA_AUTH_TOKEN=$(openssl rand -hex 16)

# === Paths ===
DATA_DIR=/home/$(whoami)/jellycore/data
GROUPS_DIR=/home/$(whoami)/jellycore/groups
EOF

chmod 600 .env
```

### 5. สร้าง Data Directories

```bash
mkdir -p $DATA_DIR
mkdir -p $GROUPS_DIR
mkdir -p $DATA_DIR/oracle
mkdir -p $DATA_DIR/chromadb
```

### 6. Build Docker Images

```bash
# Build Oracle V2
cd ~/jellycore/oracle-v2
docker build -t jellycore-oracle:latest .

# Build NanoClaw (ถ้าจำเป็น)
cd ~/jellycore/nanoclaw/container
docker build -t jellycore-nanoclaw:latest .
```

### 7. Start Services

```bash
cd ~/jellycore
docker compose -f docker-compose.production.yml up -d
```

### 8. ตรวจสอบ Health

```bash
# ตรวจสอบ services
docker compose ps

# ตรวจสอบ Oracle
curl http://localhost:47778/api/health

# ตรวจสอบ NanoClaw logs
docker compose logs -f nanoclaw
```

---

## 🐳 Docker Compose vs PM2

### Docker Compose (แนะนำ)

**ข้อดี:**
- ✅ Auto-restart on crash
- ✅ Health checks
- ✅ Resource limits
- ✅ Easy deployment (`docker compose up`)

**ข้อเสีย:**
- ❌ ไม่มี auto-build ก่อนอื่น
- ❌ ไม่มี native clustering

### PM2 (production)

**ข้อดี:**
- ✅ Allข้อดีของ Docker Compose และมากกว่า
- ✅ Built-in clustering
- ✅ Zero-downtime reload (`pm2 reload`)
- ✅ Log management
- ✅ Monitoring (`pm2 monit`)

**ข้อเสีย:**
- ❌ ซับซ้อน
- ❌ต้องการ config แยกกว่า Docker Compose

---

## 📊 สรุปสถานะการ Deploy หลังจากทั้งหมด

| สิ่งที่ | สถานะ | ไฟล์ |
|----------|---------|------|
| 1. Clone repos | ✅ | oracle-v2/, nanoclaw/ |
| 2. Build Docker images | ⏳ | - |
| 3. Upload to VPS | ⏳ | - |
| 4. Configure environment | ⏳ | .env |
| 5. Start services | ⏳ | docker compose up |
| 6. Health checks | ⏳ | curl |
| 7. Connect WhatsApp | ⏳ | /setup |
| 8. Connect Telegram | ⏳ | BotFather |
| 9. Test full system | ⏳ | - |

---

## 🎯 ถัดไป

ถ้าคุณมี **Linux VPS** พร้อม:
1. ให้ IP address หรือ SSH key
2. ข้อมูลสำหรับการเข้าถึง (username/password)
3. ผมจะสร้าง deployment scripts ให้คุณ

ถ้าคุณต้องการใช้ **Local Deployment**:
- ให้คำแนะนำสำหรับ Docker Desktop on Windows
- แต่จะจำกัดข้อจำกัดกว่า volume paths

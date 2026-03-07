# JellyCore Deployment Guide

> à¸„à¸³à¹à¸™à¸°à¸™à¸³: à¹€à¸­à¸à¸ªà¸²à¸£à¸ªà¸³à¸«à¸£à¸±à¸šà¸à¸²à¸£ deploy JellyCore à¸šà¸™ Linux VPS

## ðŸ“‹ à¸à¹ˆà¸­à¸™à¸à¸³à¹€à¸ªà¸£à¹‡à¸ˆ

1. **Clone repositories** âœ…
   - Oracle V2: `oracle-v2/`
   - NanoClaw: `nanoclaw/`

2. **Phase 0: Security Foundation** âœ…
   - Docker Compose config
   - MCP-HTTP Bridge
   - PM2 ecosystem config

3. **Phase 1-3: Performance, Architecture, Resilience** âœ…
   - WhatsApp Resilience
   - Prompt Builder
   - Production Docker Compose

4. **Phase 4-5: Intelligence & Production** ðŸ”„
   - Context-aware prompts
   - Production deployment config

---

## ðŸ–¥ï¸ à¸•à¸³à¹à¸«à¸™à¹ˆà¸‡ Deploy: Linux VPS

JellyCore à¸–à¸¹à¸à¸­à¸­à¸à¹à¸šà¸šà¸¡à¸²à¸ªà¸³à¸«à¸£à¸±à¸š **Linux VPS** à¸”à¸±à¸‡à¸™à¸µà¹‰:
- Docker & Docker Compose
- Systemd/PM2 à¸ªà¸³à¸«à¸£à¸±à¸š process management
- à¹à¸•à¹ˆà¸¥à¸°à¹ƒà¸Šà¹‰à¸šà¸™ local Windows/macOS machine

### à¸‚à¹‰à¸­à¸ˆà¸³à¸à¸±à¸”

1. **Windows/macOS à¹„à¸¡à¹ˆà¸£à¸­à¸‡à¸£à¸±à¸šà¸à¸±à¸š Docker Compose**
   - Volume paths à¹„à¸¡à¹ˆà¸–à¸¹à¸à¸•à¹‰à¸­à¸‡ (`/data/jellycore` vs `C:\data`)
   - File permissions issues
   - Network differences

2. **à¹à¸™à¸°à¸™à¸³ Linux VPS**
   - à¸‹à¸·à¹‰à¸­/à¸ªà¸³à¸±à¸‡ VPS à¸—à¸µà¹ˆà¸£à¸­à¸‡à¸£à¸±à¸š Docker
   - à¸•à¸´à¸”à¸•à¸±à¹‰à¸‡ Ubuntu 22.04 à¸«à¸£à¸·à¸­ Debian 12
   - à¸­à¸¢à¹ˆà¸²à¸‡à¸­à¸¢à¹ˆà¸²à¸‡ 2GB RAM à¸‚à¸±à¹‰à¸™à¸•à¹ˆà¸³
   - 20GB disk space à¸‚à¸±à¹‰à¸™à¸•à¹ˆà¸³

---

## ðŸš€ à¸§à¸´à¸˜à¸µ Deploy à¸šà¸™ Linux VPS

### 1. à¹€à¸•à¸£à¸µà¸¢à¸¡ Server

```bash
# à¸­à¸±à¸›à¹€à¸”à¸• system
sudo apt update && sudo apt upgrade -y

# à¸•à¸´à¸”à¸•à¸±à¹‰à¸‡ Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# à¸•à¸´à¸”à¸•à¸±à¹‰à¸‡ Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-uname -m" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### 2. à¸•à¸´à¸”à¸•à¸±à¹‰à¸‡ Firewall

```bash
# à¹€à¸›à¸´à¸” ports à¸—à¸µà¹ˆà¸ˆà¸³à¹€à¸›à¹‡à¸™à¹ƒà¸Šà¹‰
sudo ufw allow 3000/tcp  # NanoClaw
sudo ufw allow 47778/tcp   # Oracle V2
sudo ufw allow 5173/tcp    # Dashboard (optional)
sudo ufw allow 443/tcp    # HTTPS (Caddy later)

# à¸«à¸£à¸·à¸­à¸›à¸”à¸” firewall à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸” (à¹€à¸‰à¸žà¸²à¸°à¹ƒà¸™ VPC)
sudo ufw disable
```

### 3. Upload Files

```bash
# à¸ªà¸£à¹‰à¸²à¸‡ directory à¸šà¸™ server
mkdir -p ~/jellycore
cd ~/jellycore

# Upload files (à¸ˆà¸²à¸ local machine)
scp -r c:/Programing/PersonalAI/jellycore/* user@your-vps-ip:~/jellycore/

# à¸«à¸£à¸·à¸­à¹ƒà¸Šà¹‰ git
git clone https://github.com/yourusername/jellycore.git
```

### 4. à¸ªà¸£à¹‰à¸²à¸‡ Environment Variables

```bash
cat > .env << 'EOF'
# === API Keys ===
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# === Telegram ===
TELEGRAM_BOT_TOKEN=123456:ABC-DEF-123456789abc

# === Oracle ===
ORACLE_AUTH_TOKEN=$(openssl rand -hex 16)
CHROMA_AUTH_TOKEN=$(openssl rand -hex 16)
ORACLE_ALLOWED_ORIGINS=http://localhost:47778,http://127.0.0.1:47778
ORACLE_RATE_LIMIT_WINDOW_MS=60000
ORACLE_RATE_LIMIT_READ_LIMIT=60
ORACLE_RATE_LIMIT_WRITE_LIMIT=30

# === NanoClaw security defaults ===
AGENT_FULL_ACCESS=false
LLM_PROVIDER=claude
# OPENAI_BASE_URL=https://api.openai.com
# OPENAI_API_KEY=
# OPENAI_MODEL=gpt-4.1
# OLLAMA_BASE_URL=http://host.containers.internal:11434
# OLLAMA_MODEL=llama3.1

# === Backup automation ===
BACKUP_DIR=./backups
BACKUP_RETENTION_DAYS=14
# RCLONE_REMOTE=remote:bucket/jellycore

# === Optional host-port overrides ===
# ORACLE_HOST_PORT=47778
# NANOCLAW_HOST_PORT=47779

# === Paths ===
DATA_DIR=/home/$(whoami)/jellycore/data
GROUPS_DIR=/home/$(whoami)/jellycore/groups
EOF

chmod 600 .env
```

### 5. à¸ªà¸£à¹‰à¸²à¸‡ Data Directories

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

# Build agent runtime image (full)
cd ~/jellycore/nanoclaw/container
docker build -t nanoclaw-agent:latest -f Dockerfile .

# Optional: lite variant (no Chromium)
docker build -t nanoclaw-agent-lite:latest -f Dockerfile.lite .
```

### 7. Start Services

```bash
cd ~/jellycore
docker compose -f docker-compose.production.yml up -d

# Optional: enable Thai NLP sidecar profile
# docker compose -f docker-compose.production.yml --profile thai-nlp up -d
```

### 8. à¸•à¸£à¸§à¸ˆà¸ªà¸­à¸š Health

```bash
# à¸•à¸£à¸§à¸ˆà¸ªà¸­à¸š services
docker compose ps

# à¸•à¸£à¸§à¸ˆà¸ªà¸­à¸š Oracle
curl http://localhost:47778/api/health

# ตรวจสอบ metrics
curl http://localhost:47778/metrics
curl http://localhost:47779/metrics

# à¸•à¸£à¸§à¸ˆà¸ªà¸­à¸š NanoClaw logs
docker compose logs -f nanoclaw
```

### 9. Backup Validation (Recommended)

```bash
./scripts/backup.sh --dry-run
./scripts/backup.sh
./scripts/verify-backup.sh backups/jellycore-backup-<UTC_TIMESTAMP>.tar.gz
```

Recovery guide: [`docs/RECOVERY.md`](RECOVERY.md)

---

## ðŸ³ Docker Compose vs PM2

### Docker Compose (à¹à¸™à¸°à¸™à¸³)

**à¸‚à¹‰à¸­à¸”à¸µ:**
- âœ… Auto-restart on crash
- âœ… Health checks
- âœ… Resource limits
- âœ… Easy deployment (`docker compose up`)

**à¸‚à¹‰à¸­à¹€à¸ªà¸µà¸¢:**
- âŒ à¹„à¸¡à¹ˆà¸¡à¸µ auto-build à¸à¹ˆà¸­à¸™à¸­à¸·à¹ˆà¸™
- âŒ à¹„à¸¡à¹ˆà¸¡à¸µ native clustering

### PM2 (production)

**à¸‚à¹‰à¸­à¸”à¸µ:**
- âœ… Allà¸‚à¹‰à¸­à¸”à¸µà¸‚à¸­à¸‡ Docker Compose à¹à¸¥à¸°à¸¡à¸²à¸à¸à¸§à¹ˆà¸²
- âœ… Built-in clustering
- âœ… Zero-downtime reload (`pm2 reload`)
- âœ… Log management
- âœ… Monitoring (`pm2 monit`)

**à¸‚à¹‰à¸­à¹€à¸ªà¸µà¸¢:**
- âŒ à¸‹à¸±à¸šà¸‹à¹‰à¸­à¸™
- âŒà¸•à¹‰à¸­à¸‡à¸à¸²à¸£ config à¹à¸¢à¸à¸à¸§à¹ˆà¸² Docker Compose

---

## ðŸ“Š à¸ªà¸£à¸¸à¸›à¸ªà¸–à¸²à¸™à¸°à¸à¸²à¸£ Deploy à¸«à¸¥à¸±à¸‡à¸ˆà¸²à¸à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸”

| à¸ªà¸´à¹ˆà¸‡à¸—à¸µà¹ˆ | à¸ªà¸–à¸²à¸™à¸° | à¹„à¸Ÿà¸¥à¹Œ |
|----------|---------|------|
| 1. Clone repos | âœ… | oracle-v2/, nanoclaw/ |
| 2. Build Docker images | â³ | - |
| 3. Upload to VPS | â³ | - |
| 4. Configure environment | â³ | .env |
| 5. Start services | â³ | docker compose up |
| 6. Health checks | â³ | curl |
| 7. Connect WhatsApp | â³ | /setup |
| 8. Connect Telegram | â³ | BotFather |
| 9. Test full system | â³ | - |

---

## ðŸŽ¯ à¸–à¸±à¸”à¹„à¸›

à¸–à¹‰à¸²à¸„à¸¸à¸“à¸¡à¸µ **Linux VPS** à¸žà¸£à¹‰à¸­à¸¡:
1. à¹ƒà¸«à¹‰ IP address à¸«à¸£à¸·à¸­ SSH key
2. à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸ªà¸³à¸«à¸£à¸±à¸šà¸à¸²à¸£à¹€à¸‚à¹‰à¸²à¸–à¸¶à¸‡ (username/password)
3. à¸œà¸¡à¸ˆà¸°à¸ªà¸£à¹‰à¸²à¸‡ deployment scripts à¹ƒà¸«à¹‰à¸„à¸¸à¸“

à¸–à¹‰à¸²à¸„à¸¸à¸“à¸•à¹‰à¸­à¸‡à¸à¸²à¸£à¹ƒà¸Šà¹‰ **Local Deployment**:
- à¹ƒà¸«à¹‰à¸„à¸³à¹à¸™à¸°à¸™à¸³à¸ªà¸³à¸«à¸£à¸±à¸š Docker Desktop on Windows
- à¹à¸•à¹ˆà¸ˆà¸°à¸ˆà¸³à¸à¸±à¸”à¸‚à¹‰à¸­à¸ˆà¸³à¸à¸±à¸”à¸à¸§à¹ˆà¸² volume paths




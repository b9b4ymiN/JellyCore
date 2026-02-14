# 5.4 — Deployment Script

> One-command deploy — `./scripts/deploy.sh` → ระบบพร้อมใช้งานบน VPS

**Status:** ⬜ Not Started  
**Effort:** Medium  
**Priority:** 🟡 Medium  
**Weakness Ref:** —

---

## 🎯 เป้าหมาย

Script เดียวสำหรับ: fresh install, update, rollback — ใช้งานง่ายแม้ไม่มี DevOps background

---

## ✅ Checklist

### Main Deploy Script

- [ ] สร้าง `scripts/deploy.sh`:
  ```bash
  #!/bin/bash
  set -euo pipefail
  
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
  DATA_DIR="${DATA_DIR:-/data/jellycore}"
  
  # Colors
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
  
  log() { echo -e "${GREEN}[DEPLOY]${NC} $1"; }
  warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
  error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
  
  # === Pre-flight Checks ===
  preflight() {
    log "Running pre-flight checks..."
    
    command -v docker >/dev/null || error "Docker not installed"
    command -v docker compose >/dev/null 2>&1 || error "Docker Compose not installed"
    
    [ -f "$PROJECT_DIR/.env" ] || error ".env file not found. Copy from .env.example"
    
    # Check required env vars
    source "$PROJECT_DIR/.env"
    [ -n "${ANTHROPIC_API_KEY:-}" ] || error "ANTHROPIC_API_KEY not set in .env"
    
    # Check data volume
    if [ ! -d "$DATA_DIR" ]; then
      warn "Data directory not found. Run setup-encryption.sh first?"
      read -p "Continue without encryption? (y/N) " -n 1 -r
      echo
      [[ $REPLY =~ ^[Yy]$ ]] || exit 1
      mkdir -p "$DATA_DIR"/{db,whatsapp-auth,chromadb,backups,logs}
    fi
    
    log "✅ Pre-flight checks passed"
  }
  
  # === Fresh Install ===
  install() {
    log "Starting fresh installation..."
    preflight
    
    cd "$PROJECT_DIR"
    
    # Clone submodules if needed
    if [ ! -d "nanoclaw/.git" ]; then
      log "Cloning NanoClaw..."
      git clone https://github.com/qwibitai/nanoclaw.git nanoclaw
    fi
    
    if [ ! -d "oracle-v2/.git" ]; then
      log "Cloning Oracle V2..."
      git clone https://github.com/Soul-Brews-Studio/oracle-v2.git oracle-v2
    fi
    
    # Build and start
    log "Building Docker images..."
    docker compose build --no-cache
    
    log "Starting services..."
    docker compose up -d
    
    # Wait for health
    log "Waiting for services to be healthy..."
    sleep 10
    check_health
    
    log "🎉 Installation complete!"
  }
  
  # === Update ===
  update() {
    log "Starting update..."
    preflight
    
    cd "$PROJECT_DIR"
    
    # Backup before update
    log "Creating pre-update backup..."
    "$SCRIPT_DIR/backup.sh" pre-update
    
    # Pull latest code
    log "Pulling latest code..."
    git pull origin main
    (cd nanoclaw && git pull origin main)
    (cd oracle-v2 && git pull origin main)
    
    # Rebuild and restart
    log "Rebuilding images..."
    docker compose build
    
    log "Rolling restart..."
    docker compose up -d --remove-orphans
    
    sleep 10
    check_health
    
    log "🎉 Update complete!"
  }
  
  # === Rollback ===
  rollback() {
    local backup_name="${1:-}"
    [ -n "$backup_name" ] || error "Usage: deploy.sh rollback <backup-name>"
    
    log "Rolling back to $backup_name..."
    
    docker compose down
    
    # Restore from backup
    "$SCRIPT_DIR/restore.sh" "$backup_name"
    
    docker compose up -d
    sleep 10
    check_health
    
    log "🎉 Rollback complete!"
  }
  
  # === Health Check ===
  check_health() {
    local all_ok=true
    
    for service in "NanoClaw:3000" "Oracle:47778"; do
      IFS=: read -r name port <<< "$service"
      status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:$port/health" 2>/dev/null || echo "000")
      
      if [ "$status" = "200" ] || [ "$status" = "207" ]; then
        log "✅ $name: healthy"
      else
        warn "❌ $name: unhealthy (HTTP $status)"
        all_ok=false
      fi
    done
    
    $all_ok || warn "Some services are unhealthy. Check: docker compose logs"
  }
  
  # === Main ===
  case "${1:-help}" in
    install)  install ;;
    update)   update ;;
    rollback) rollback "${2:-}" ;;
    health)   check_health ;;
    logs)     docker compose logs -f --tail 50 "${2:-}" ;;
    restart)  docker compose restart "${2:-}" ;;
    stop)     docker compose down ;;
    start)    docker compose up -d ;;
    *)
      echo "Usage: deploy.sh {install|update|rollback|health|logs|restart|stop|start}"
      echo ""
      echo "  install          Fresh installation"
      echo "  update           Pull latest & rebuild"
      echo "  rollback <name>  Rollback to backup"
      echo "  health           Check service health"
      echo "  logs [service]   View logs (tail)"
      echo "  restart [svc]    Restart service(s)"
      echo "  stop             Stop all services"
      echo "  start            Start all services"
      ;;
  esac
  ```

### Backup Script

- [ ] สร้าง `scripts/backup.sh`:
  ```bash
  #!/bin/bash
  set -euo pipefail
  
  DATA_DIR="${DATA_DIR:-/data/jellycore}"
  BACKUP_DIR="$DATA_DIR/backups"
  BACKUP_NAME="${1:-$(date +%Y%m%d_%H%M%S)}"
  BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"
  MAX_BACKUPS=30
  
  mkdir -p "$BACKUP_PATH"
  
  # SQLite backup (online, safe)
  sqlite3 "$DATA_DIR/db/oracle.db" ".backup '$BACKUP_PATH/oracle.db'"
  
  # ChromaDB snapshot
  cp -r "$DATA_DIR/chromadb" "$BACKUP_PATH/chromadb"
  
  # WhatsApp auth
  cp -r "$DATA_DIR/whatsapp-auth" "$BACKUP_PATH/whatsapp-auth"
  
  # Compress
  tar -czf "$BACKUP_PATH.tar.gz" -C "$BACKUP_DIR" "$BACKUP_NAME"
  rm -rf "$BACKUP_PATH"
  
  # Rotate old backups
  ls -t "$BACKUP_DIR"/*.tar.gz 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs -r rm
  
  echo "✅ Backup created: $BACKUP_PATH.tar.gz"
  ```

### Restore Script

- [ ] สร้าง `scripts/restore.sh`:
  ```bash
  #!/bin/bash
  set -euo pipefail
  
  DATA_DIR="${DATA_DIR:-/data/jellycore}"
  BACKUP_FILE="$DATA_DIR/backups/$1.tar.gz"
  
  [ -f "$BACKUP_FILE" ] || { echo "Backup not found: $BACKUP_FILE"; exit 1; }
  
  echo "⚠️  This will overwrite current data. Continue? (y/N)"
  read -r confirm
  [ "$confirm" = "y" ] || exit 0
  
  TEMP_DIR=$(mktemp -d)
  tar -xzf "$BACKUP_FILE" -C "$TEMP_DIR"
  BACKUP_NAME=$(ls "$TEMP_DIR")
  
  cp "$TEMP_DIR/$BACKUP_NAME/oracle.db" "$DATA_DIR/db/oracle.db"
  rm -rf "$DATA_DIR/chromadb" && cp -r "$TEMP_DIR/$BACKUP_NAME/chromadb" "$DATA_DIR/chromadb"
  cp -r "$TEMP_DIR/$BACKUP_NAME/whatsapp-auth" "$DATA_DIR/whatsapp-auth"
  
  rm -rf "$TEMP_DIR"
  echo "✅ Restored from: $1"
  ```

### Backup Cron

- [ ] Auto backup schedule:
  ```bash
  # Every 6 hours
  0 */6 * * * /opt/jellycore/scripts/backup.sh >> /var/log/jellycore-backup.log 2>&1
  ```

### ทดสอบ

- [ ] `./scripts/deploy.sh install` → fresh install works
- [ ] `./scripts/deploy.sh health` → shows all service status
- [ ] `./scripts/deploy.sh update` → pulls latest + rebuilds
- [ ] `./scripts/backup.sh` → creates backup successfully
- [ ] `./scripts/restore.sh <name>` → restores data
- [ ] `./scripts/deploy.sh rollback <name>` → full rollback works
- [ ] `./scripts/deploy.sh logs oracle` → shows Oracle logs
- [ ] Old backups auto-rotated (keeps last 30)

---

## 🧪 Definition of Done

1. `deploy.sh install` → zero to running in 1 command
2. `deploy.sh update` → safe update with pre-backup
3. `deploy.sh rollback` → revert to any backup
4. Backup runs every 6 hours automatically
5. Old backups rotated (max 30)

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `scripts/deploy.sh` | JellyCore | **Create** |
| `scripts/backup.sh` | JellyCore | **Create** |
| `scripts/restore.sh` | JellyCore | **Create** |

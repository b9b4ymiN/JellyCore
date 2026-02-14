# 3.5 — Automated Backup System

> แก้จุดอ่อน: R4 (No Automated Database Backup)

**Status:** ⬜ Not Started  
**Effort:** Large  
**Priority:** 🟡 Medium

---

## 📋 ปัญหาเดิม

- NanoClaw DB: **ไม่มี backup เลย**
- Oracle DB: backup เฉพาะก่อน re-index เท่านั้น
- ChromaDB: ไม่มี backup
- Knowledge base: ไม่มี periodic backup

**ที่มา:** NanoClaw `src/db.ts`, Oracle V2 `src/indexer.ts`

---

## ✅ Checklist

### สร้าง Backup Script

- [ ] สร้าง `scripts/backup.sh`:
  ```bash
  #!/bin/bash
  set -euo pipefail
  
  BACKUP_DIR="/backups/$(date +%Y%m%d_%H%M%S)"
  mkdir -p "$BACKUP_DIR"
  
  echo "=== JellyCore Backup: $(date) ==="
  
  # 1. SQLite Databases (online backup, consistent snapshot)
  echo "Backing up NanoClaw DB..."
  sqlite3 /data/nanoclaw/messages.db ".backup '$BACKUP_DIR/nanoclaw.db'"
  
  echo "Backing up Oracle DB..."
  sqlite3 /data/oracle/oracle.db ".backup '$BACKUP_DIR/oracle.db'"
  
  # 2. ChromaDB (API export)
  echo "Backing up ChromaDB..."
  curl -s -H "Authorization: Bearer $CHROMA_AUTH_TOKEN" \
    "http://chromadb:8000/api/v1/collections" > "$BACKUP_DIR/chromadb-collections.json"
  # Note: Full ChromaDB backup = copy persistent directory
  cp -r /data/chromadb/ "$BACKUP_DIR/chromadb/"
  
  # 3. Knowledge Base
  echo "Backing up Knowledge Base..."
  tar czf "$BACKUP_DIR/knowledge.tar.gz" -C /data/knowledge .
  
  # 4. WhatsApp Auth (encrypted)
  echo "Backing up WhatsApp Auth..."
  tar czf "$BACKUP_DIR/auth.tar.gz" -C /data/nanoclaw/auth .
  
  # 5. Config & State
  cp /data/nanoclaw/.ipc-secret "$BACKUP_DIR/" 2>/dev/null || true
  
  echo "Backup complete: $BACKUP_DIR"
  du -sh "$BACKUP_DIR"
  ```

### Backup Docker Service

- [ ] เพิ่มใน `docker-compose.yml`:
  ```yaml
  backup-agent:
    image: alpine:latest
    volumes:
      - nanoclaw-store:/data/nanoclaw:ro
      - oracle-data:/data/oracle:ro
      - oracle-knowledge:/data/knowledge:ro
      - chroma-data:/data/chromadb:ro
      - backup-storage:/backups
      - ./scripts/backup.sh:/scripts/backup.sh:ro
    entrypoint: /bin/sh
    command: |
      -c "
      apk add --no-cache sqlite curl rclone &&
      echo '0 */6 * * * /scripts/backup.sh >> /var/log/backup.log 2>&1' | crontab - &&
      crond -f
      "
    networks:
      - jellycore-internal
    restart: unless-stopped
  ```

### Backup Rotation

- [ ] สร้าง `scripts/rotate-backups.sh`:
  ```bash
  # Keep last 7 days of local backups
  find /backups -maxdepth 1 -type d -mtime +7 -exec rm -rf {} \;
  ```
- [ ] เรียกหลัง backup ทุกครั้ง

### Off-Site Sync (Daily)

- [ ] สร้าง `scripts/offsite-sync.sh`:
  ```bash
  # Sync latest backup to S3-compatible storage
  rclone sync /backups/latest/ remote:jellycore-backups/$(date +%Y%m%d)/ \
    --transfers 4 \
    --checkers 8 \
    --log-file /var/log/rclone.log
  ```
- [ ] Configure rclone for off-site storage:
  - Option A: Backblaze B2 (cheapest)
  - Option B: AWS S3
  - Option C: DigitalOcean Spaces
  - Option D: Local NAS (rsync)

### Backup Verification

- [ ] สร้าง `scripts/verify-backup.sh`:
  ```bash
  # Test restore to temp directory
  TEMP_DIR=$(mktemp -d)
  
  # Verify SQLite integrity
  sqlite3 "$BACKUP_DIR/nanoclaw.db" "PRAGMA integrity_check;"
  sqlite3 "$BACKUP_DIR/oracle.db" "PRAGMA integrity_check;"
  
  # Verify tar archives
  tar tzf "$BACKUP_DIR/knowledge.tar.gz" > /dev/null
  tar tzf "$BACKUP_DIR/auth.tar.gz" > /dev/null
  
  # Verify ChromaDB data
  test -d "$BACKUP_DIR/chromadb/"
  
  rm -rf "$TEMP_DIR"
  echo "Backup verification: PASSED"
  ```
- [ ] Run verification หลัง backup ทุกครั้ง
- [ ] ถ้า verification fail → alert admin

### Restore Script

- [ ] สร้าง `scripts/restore.sh`:
  ```bash
  #!/bin/bash
  # Usage: ./restore.sh <backup-dir>
  
  BACKUP_DIR=$1
  
  echo "⚠️  This will restore from: $BACKUP_DIR"
  echo "    Current data will be OVERWRITTEN."
  read -p "Continue? (yes/no) " confirm
  
  if [ "$confirm" != "yes" ]; then exit 1; fi
  
  # 1. Stop services
  docker compose stop nanoclaw oracle
  
  # 2. Restore databases
  cp "$BACKUP_DIR/nanoclaw.db" /data/nanoclaw/messages.db
  cp "$BACKUP_DIR/oracle.db" /data/oracle/oracle.db
  
  # 3. Restore ChromaDB
  rm -rf /data/chromadb/*
  cp -r "$BACKUP_DIR/chromadb/"* /data/chromadb/
  
  # 4. Restore knowledge base
  tar xzf "$BACKUP_DIR/knowledge.tar.gz" -C /data/knowledge/
  
  # 5. Restart services
  docker compose up -d
  
  echo "Restore complete. Verifying..."
  sleep 10
  curl -sf http://localhost:47778/api/health && echo "Oracle: OK" || echo "Oracle: FAIL"
  ```

### Backup Documentation

- [ ] สร้าง `docs/RECOVERY.md`:
  - Backup schedule: ทุก 6 ชั่วโมง
  - Backup contents: what's backed up, what's not
  - Restore procedure: step-by-step
  - Recovery time objective (RTO): <15 minutes
  - Recovery point objective (RPO): <6 hours
  - Disaster scenarios: disk failure, data corruption, accidental delete

### ทดสอบ

- [ ] Run backup script → all files created
- [ ] Verification → PASSED
- [ ] Corrupt database → restore from backup → service runs
- [ ] Off-site sync → files appear in remote storage
- [ ] Rotation → backups older than 7 days deleted
- [ ] Cron schedule → backup runs every 6 hours automatically

---

## 🧪 Definition of Done

1. Backup runs automatically every 6 hours
2. Backup includes: SQLite DBs, ChromaDB, knowledge base, auth
3. Backup verified after each run
4. Daily off-site sync configured
5. Restore script tested and documented
6. Backups rotated (7 days local)

---

## 📎 Files to Create

| File | Repo | Action |
|------|------|--------|
| `scripts/backup.sh` | JellyCore | **Create** — main backup script |
| `scripts/rotate-backups.sh` | JellyCore | **Create** — rotation |
| `scripts/offsite-sync.sh` | JellyCore | **Create** — remote sync |
| `scripts/verify-backup.sh` | JellyCore | **Create** — integrity check |
| `scripts/restore.sh` | JellyCore | **Create** — restore procedure |
| `docs/RECOVERY.md` | JellyCore | **Create** — recovery playbook |
| `docker-compose.yml` | JellyCore | Add backup-agent service |

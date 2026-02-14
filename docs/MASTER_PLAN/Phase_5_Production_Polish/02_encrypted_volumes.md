# 5.2 — Encrypted Docker Volumes (LUKS)

> Data at rest encryption — ข้อมูลทั้งหมดเข้ารหัสบน disk

**Status:** ⬜ Not Started  
**Effort:** Medium  
**Priority:** 🔴 High  
**Weakness Ref:** S4 (Unencrypted Auth), S6 (Secrets on Disk), S7 (KB in Git)

---

## 🎯 เป้าหมาย

ข้อมูลทุกอย่าง (DB, auth, secrets, knowledge) เก็บบน LUKS encrypted volume — ถ้า VPS โดน compromise ข้อมูลยังปลอดภัย

---

## ✅ Checklist

### LUKS Volume Setup Script

- [ ] สร้าง `scripts/setup-encryption.sh`:
  ```bash
  #!/bin/bash
  set -euo pipefail
  
  VOLUME_SIZE="${1:-10G}"
  VOLUME_PATH="/data/jellycore.img"
  MOUNT_POINT="/data/jellycore"
  
  echo "=== JellyCore Encrypted Volume Setup ==="
  
  # Create volume file
  if [ ! -f "$VOLUME_PATH" ]; then
    echo "Creating ${VOLUME_SIZE} volume..."
    fallocate -l "$VOLUME_SIZE" "$VOLUME_PATH"
  fi
  
  # Setup LUKS (will prompt for passphrase)
  echo "Setting up LUKS encryption..."
  sudo cryptsetup luksFormat "$VOLUME_PATH"
  
  # Open volume
  sudo cryptsetup luksOpen "$VOLUME_PATH" jellycore-data
  
  # Create filesystem
  sudo mkfs.ext4 /dev/mapper/jellycore-data
  
  # Mount
  sudo mkdir -p "$MOUNT_POINT"
  sudo mount /dev/mapper/jellycore-data "$MOUNT_POINT"
  
  # Create directory structure
  sudo mkdir -p "$MOUNT_POINT"/{db,whatsapp-auth,chromadb,backups,logs}
  sudo chown -R $(whoami):$(whoami) "$MOUNT_POINT"
  
  echo "✅ Encrypted volume mounted at $MOUNT_POINT"
  ```

### Mount/Unmount Scripts

- [ ] สร้าง `scripts/mount-data.sh`:
  ```bash
  #!/bin/bash
  set -euo pipefail
  
  VOLUME_PATH="/data/jellycore.img"
  MOUNT_POINT="/data/jellycore"
  
  # Open LUKS (prompt passphrase or use keyfile)
  if [ ! -e /dev/mapper/jellycore-data ]; then
    sudo cryptsetup luksOpen "$VOLUME_PATH" jellycore-data
  fi
  
  # Mount if not already mounted
  if ! mountpoint -q "$MOUNT_POINT"; then
    sudo mount /dev/mapper/jellycore-data "$MOUNT_POINT"
  fi
  
  echo "✅ Data volume mounted at $MOUNT_POINT"
  ```

- [ ] สร้าง `scripts/unmount-data.sh`:
  ```bash
  #!/bin/bash
  set -euo pipefail
  
  MOUNT_POINT="/data/jellycore"
  
  # Stop services first
  docker compose down 2>/dev/null || true
  
  # Unmount
  sudo umount "$MOUNT_POINT" 2>/dev/null || true
  sudo cryptsetup luksClose jellycore-data 2>/dev/null || true
  
  echo "✅ Data volume unmounted and locked"
  ```

### Keyfile Option (Auto-Unlock)

- [ ] สร้าง `scripts/setup-keyfile.sh`:
  ```bash
  #!/bin/bash
  set -euo pipefail
  
  KEYFILE="/root/.jellycore-key"
  VOLUME_PATH="/data/jellycore.img"
  
  # Generate random keyfile
  sudo dd if=/dev/urandom of="$KEYFILE" bs=4096 count=1
  sudo chmod 400 "$KEYFILE"
  
  # Add keyfile to LUKS (passphrase still works as backup)
  sudo cryptsetup luksAddKey "$VOLUME_PATH" "$KEYFILE"
  
  echo "✅ Keyfile created at $KEYFILE"
  echo "⚠️  Keep this file secure — it can unlock all data"
  ```

### Systemd Auto-Mount (Boot)

- [ ] สร้าง `scripts/jellycore-data.service`:
  ```ini
  [Unit]
  Description=Mount JellyCore Encrypted Volume
  Before=docker.service
  After=local-fs.target
  
  [Service]
  Type=oneshot
  RemainAfterExit=yes
  ExecStart=/bin/bash -c 'cryptsetup luksOpen /data/jellycore.img jellycore-data --key-file /root/.jellycore-key && mount /dev/mapper/jellycore-data /data/jellycore'
  ExecStop=/bin/bash -c 'umount /data/jellycore && cryptsetup luksClose jellycore-data'
  
  [Install]
  WantedBy=multi-user.target
  ```

### Directory Structure on Encrypted Volume

- [ ] Verify structure:
  ```
  /data/jellycore/
  ├── db/
  │   └── oracle.db          # SQLite database (WAL mode)
  ├── whatsapp-auth/
  │   └── creds.json.enc     # WhatsApp auth (double encrypted)
  ├── chromadb/
  │   └── ...                # ChromaDB persistence
  ├── backups/
  │   ├── daily/
  │   └── offsite/
  └── logs/
      └── ...                # Application logs
  ```

### Docker Volume Mapping Update

- [ ] Update `docker-compose.yml` volumes:
  ```yaml
  volumes:
    encrypted-data:
      driver: local
      driver_opts:
        type: none
        o: bind
        device: /data/jellycore
  ```

### ทดสอบ

- [ ] Setup script creates encrypted volume successfully
- [ ] Mount/unmount scripts work correctly
- [ ] Data persists across mount/unmount cycles
- [ ] Docker Compose uses encrypted volume
- [ ] `lsblk` shows LUKS device
- [ ] Without keyfile/passphrase → data inaccessible
- [ ] Reboot → auto-mount via systemd (if keyfile enabled)

---

## 🧪 Definition of Done

1. All data stored on LUKS encrypted volume
2. Volume mountable via passphrase or keyfile
3. Auto-mount on boot (optional, with keyfile)
4. Docker Compose bound to encrypted mount point
5. `rawdisk` → unreadable without key

---

## 📎 Files to Create/Modify

| File | Repo | Action |
|------|------|--------|
| `scripts/setup-encryption.sh` | JellyCore | **Create** |
| `scripts/mount-data.sh` | JellyCore | **Create** |
| `scripts/unmount-data.sh` | JellyCore | **Create** |
| `scripts/setup-keyfile.sh` | JellyCore | **Create** |
| `scripts/jellycore-data.service` | JellyCore | **Create** |
| `docker-compose.yml` | JellyCore | Update volume config |

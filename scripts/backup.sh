#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/backup.sh [--dry-run]

Environment variables:
  BACKUP_DIR              Destination directory for backup artifacts (default: ./backups)
  BACKUP_RETENTION_DAYS   Days to keep old backup archives (default: 14)
  RCLONE_REMOTE           Optional rclone destination (e.g. remote:bucket/path)
  NANOCLAW_DATA_VOLUME    Docker volume name (default: jellycore_nanoclaw-data)
  NANOCLAW_STORE_VOLUME   Docker volume name (default: jellycore_nanoclaw-store)
  ORACLE_DATA_VOLUME      Docker volume name (default: jellycore_oracle-data)
  GROUPS_DIR              Directory to back up (default: groups)
  ORACLE_MEMORY_DIR       Directory to back up (default: auto-detect oracle-v2/*/memory)
EOF
}

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
elif [[ -n "${1:-}" ]]; then
  usage
  exit 1
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[backup] missing required command: $1" >&2
    exit 1
  fi
}

docker_host_path() {
  local p="$1"
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$p"
    return
  fi
  echo "$p"
}

run() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[dry-run] $*"
    return 0
  fi
  "$@"
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

# Normalize backup directory to absolute path for reliable Docker bind mounts.
if [[ "$BACKUP_DIR" != /* ]]; then
  BACKUP_DIR="$REPO_ROOT/${BACKUP_DIR#./}"
fi

NANOCLAW_DATA_VOLUME="${NANOCLAW_DATA_VOLUME:-jellycore_nanoclaw-data}"
NANOCLAW_STORE_VOLUME="${NANOCLAW_STORE_VOLUME:-jellycore_nanoclaw-store}"
ORACLE_DATA_VOLUME="${ORACLE_DATA_VOLUME:-jellycore_oracle-data}"
GROUPS_DIR="${GROUPS_DIR:-groups}"
ORACLE_MEMORY_DIR="${ORACLE_MEMORY_DIR:-}"
if [[ -z "$ORACLE_MEMORY_DIR" ]]; then
  ORACLE_MEMORY_DIR="$(cd "$REPO_ROOT" && ls -d oracle-v2/*/memory 2>/dev/null | grep -Ev '^oracle-v2/(src|dist)/' | head -n 1 || true)"
  ORACLE_MEMORY_DIR="${ORACLE_MEMORY_DIR:-oracle-v2/memory}"
fi

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SNAPSHOT_NAME="jellycore-backup-${TIMESTAMP}"
SNAPSHOT_DIR="$BACKUP_DIR/$SNAPSHOT_NAME"
ARCHIVE_PATH="$BACKUP_DIR/${SNAPSHOT_NAME}.tar.gz"

require_cmd docker
require_cmd tar

mkdir -p "$BACKUP_DIR"
run mkdir -p "$SNAPSHOT_DIR/volumes" "$SNAPSHOT_DIR/files"

backup_volume() {
  local volume_name="$1"
  local output_name="$2"
  local backup_mount
  backup_mount="$(docker_host_path "$SNAPSHOT_DIR/volumes")"

  if ! docker volume inspect "$volume_name" >/dev/null 2>&1; then
    echo "[backup] warning: docker volume not found, skipping: $volume_name"
    return 0
  fi

  run docker run --rm \
    -v "$volume_name:/source:ro" \
    -v "$backup_mount:/backup" \
    alpine:3.20 \
    sh -lc "cd /source && tar -czf /backup/$output_name ."
}

backup_path() {
  local rel_path="$1"
  local output_name="$2"
  local abs_path="$REPO_ROOT/$rel_path"

  if [[ ! -e "$abs_path" ]]; then
    echo "[backup] warning: path not found, skipping: $rel_path"
    return 0
  fi

  run tar -czf "$SNAPSHOT_DIR/files/$output_name" -C "$REPO_ROOT" "$rel_path"
}

backup_volume "$NANOCLAW_DATA_VOLUME" "nanoclaw-data.tar.gz"
backup_volume "$NANOCLAW_STORE_VOLUME" "nanoclaw-store.tar.gz"
backup_volume "$ORACLE_DATA_VOLUME" "oracle-data.tar.gz"

backup_path "$ORACLE_MEMORY_DIR" "oracle-memory.tar.gz"
backup_path "$GROUPS_DIR" "groups.tar.gz"

if [[ "$DRY_RUN" == "false" ]]; then
  cat > "$SNAPSHOT_DIR/metadata.json" <<EOF
{
  "created_at_utc": "$TIMESTAMP",
  "backup_name": "$SNAPSHOT_NAME",
  "volumes": {
    "nanoclaw_data": "$NANOCLAW_DATA_VOLUME",
    "nanoclaw_store": "$NANOCLAW_STORE_VOLUME",
    "oracle_data": "$ORACLE_DATA_VOLUME"
  },
  "paths": {
    "oracle_memory": "$ORACLE_MEMORY_DIR",
    "groups": "$GROUPS_DIR"
  },
  "notes": "ChromaDB is intentionally excluded (rebuildable)."
}
EOF
fi

run tar -czf "$ARCHIVE_PATH" -C "$BACKUP_DIR" "$SNAPSHOT_NAME"

if [[ "$DRY_RUN" == "false" ]]; then
  rm -rf "$SNAPSHOT_DIR"
fi

if [[ "$DRY_RUN" == "false" && -n "$RCLONE_REMOTE" ]]; then
  if command -v rclone >/dev/null 2>&1; then
    run rclone copy "$ARCHIVE_PATH" "$RCLONE_REMOTE"
  else
    echo "[backup] warning: RCLONE_REMOTE is set but rclone is not installed"
  fi
fi

if [[ "$DRY_RUN" == "false" ]]; then
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$ARCHIVE_PATH" > "$ARCHIVE_PATH.sha256"
  fi

  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'jellycore-backup-*.tar.gz' -mtime "+$BACKUP_RETENTION_DAYS" -delete
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'jellycore-backup-*.tar.gz.sha256' -mtime "+$BACKUP_RETENTION_DAYS" -delete
fi

echo "[backup] complete: $ARCHIVE_PATH"

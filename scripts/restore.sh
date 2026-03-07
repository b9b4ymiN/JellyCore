#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/restore.sh <backup-archive-or-directory> [--dry-run]

Environment variables:
  NANOCLAW_DATA_VOLUME   Docker volume name (default: jellycore_nanoclaw-data)
  NANOCLAW_STORE_VOLUME  Docker volume name (default: jellycore_nanoclaw-store)
  ORACLE_DATA_VOLUME     Docker volume name (default: jellycore_oracle-data)
  GROUPS_DIR             Directory to restore (default: groups)
  ORACLE_MEMORY_DIR      Directory to restore (default: auto-detect oracle-v2/*/memory)
  RESTORE_STOP_SERVICES  Stop compose services before restore (default: true)
  RESTORE_START_SERVICES Start compose services after restore (default: true)
EOF
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage
  exit 1
fi

TARGET="$1"
DRY_RUN=false
if [[ "${2:-}" == "--dry-run" ]]; then
  DRY_RUN=true
elif [[ -n "${2:-}" ]]; then
  usage
  exit 1
fi

run() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[dry-run] $*"
    return 0
  fi
  "$@"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[restore] missing required command: $1" >&2
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

require_cmd tar
require_cmd docker

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NANOCLAW_DATA_VOLUME="${NANOCLAW_DATA_VOLUME:-jellycore_nanoclaw-data}"
NANOCLAW_STORE_VOLUME="${NANOCLAW_STORE_VOLUME:-jellycore_nanoclaw-store}"
ORACLE_DATA_VOLUME="${ORACLE_DATA_VOLUME:-jellycore_oracle-data}"
GROUPS_DIR="${GROUPS_DIR:-groups}"
ORACLE_MEMORY_DIR="${ORACLE_MEMORY_DIR:-}"
if [[ -z "$ORACLE_MEMORY_DIR" ]]; then
  ORACLE_MEMORY_DIR="$(cd "$REPO_ROOT" && ls -d oracle-v2/*/memory 2>/dev/null | grep -Ev '^oracle-v2/(src|dist)/' | head -n 1 || true)"
  ORACLE_MEMORY_DIR="${ORACLE_MEMORY_DIR:-oracle-v2/memory}"
fi
RESTORE_STOP_SERVICES="${RESTORE_STOP_SERVICES:-true}"
RESTORE_START_SERVICES="${RESTORE_START_SERVICES:-true}"

WORK_DIR=""
cleanup() {
  if [[ -n "$WORK_DIR" && -d "$WORK_DIR" ]]; then
    rm -rf "$WORK_DIR"
  fi
}
trap cleanup EXIT

resolve_snapshot_dir() {
  local input="$1"
  if [[ -f "$input" ]]; then
    WORK_DIR="$(mktemp -d)"
    tar -tzf "$input" >/dev/null
    tar -xzf "$input" -C "$WORK_DIR"
    local extracted
    extracted="$(find "$WORK_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1 || true)"
    if [[ -z "$extracted" ]]; then
      echo "[restore] no snapshot directory found in archive" >&2
      exit 1
    fi
    echo "$extracted"
    return
  fi

  if [[ -d "$input" ]]; then
    echo "$input"
    return
  fi

  echo "[restore] target does not exist: $input" >&2
  exit 1
}

SNAPSHOT_DIR="$(resolve_snapshot_dir "$TARGET")"

for f in \
  "$SNAPSHOT_DIR/files/oracle-memory.tar.gz" \
  "$SNAPSHOT_DIR/files/groups.tar.gz"; do
  if [[ ! -f "$f" ]]; then
    echo "[restore] missing required artifact: $f" >&2
    exit 1
  fi
done

restore_volume() {
  local volume_name="$1"
  local archive_name="$2"
  local archive_path="$SNAPSHOT_DIR/volumes/$archive_name"
  local backup_mount
  backup_mount="$(docker_host_path "$SNAPSHOT_DIR/volumes")"

  if [[ ! -f "$archive_path" ]]; then
    echo "[restore] warning: optional volume archive missing, skipping restore: $archive_name"
    return 0
  fi

  run docker volume create "$volume_name" >/dev/null
  run docker run --rm \
    -v "$volume_name:/target" \
    -v "$backup_mount:/backup:ro" \
    alpine:3.20 \
    sh -lc "rm -rf /target/* /target/.[!.]* /target/..?* 2>/dev/null || true; cd /target && tar -xzf /backup/$archive_name"
}

restore_path_archive() {
  local target_rel="$1"
  local archive_name="$2"
  local archive_path="$SNAPSHOT_DIR/files/$archive_name"
  local target_abs="$REPO_ROOT/$target_rel"
  local stage_dir="$REPO_ROOT/.tmp-restore-stage-$$-$RANDOM"

  if [[ ! -f "$archive_path" ]]; then
    echo "[restore] warning: file archive missing, skipping restore: $archive_name"
    return 0
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[dry-run] mkdir -p \"$target_abs\""
    echo "[dry-run] bash -lc rm -rf \"$target_abs\"/* \"$target_abs\"/.[!.]* \"$target_abs\"/..?* 2>/dev/null || true"
    echo "[dry-run] tar -xzf \"$archive_path\" -C \"$stage_dir\""
    echo "[dry-run] copy extracted payload to \"$target_abs\""
    echo "[dry-run] rm -rf \"$stage_dir\""
    return 0
  fi

  mkdir -p "$stage_dir"
  tar -xzf "$archive_path" -C "$stage_dir"

  local source_abs="$stage_dir/$target_rel"
  if [[ ! -d "$source_abs" ]]; then
    local base_name
    base_name="$(basename "$target_rel")"
    if [[ -d "$stage_dir/$base_name" ]]; then
      source_abs="$stage_dir/$base_name"
    fi
  fi
  if [[ ! -d "$source_abs" ]]; then
    local top_level
    top_level="$(find "$stage_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1 || true)"
    if [[ -n "$top_level" ]]; then
      source_abs="$top_level"
    fi
  fi
  if [[ ! -d "$source_abs" ]]; then
    echo "[restore] cannot map archive '$archive_name' to target '$target_rel'" >&2
    rm -rf "$stage_dir"
    exit 1
  fi

  mkdir -p "$target_abs"
  bash -lc "rm -rf \"$target_abs\"/* \"$target_abs\"/.[!.]* \"$target_abs\"/..?* 2>/dev/null || true"
  bash -lc "shopt -s dotglob nullglob; cp -a \"$source_abs\"/* \"$target_abs\"/ 2>/dev/null || true"
  rm -rf "$stage_dir"
}

if [[ "$RESTORE_STOP_SERVICES" == "true" ]]; then
  run docker compose -f "$REPO_ROOT/docker-compose.yml" down
fi

restore_volume "$NANOCLAW_DATA_VOLUME" "nanoclaw-data.tar.gz"
restore_volume "$NANOCLAW_STORE_VOLUME" "nanoclaw-store.tar.gz"
restore_volume "$ORACLE_DATA_VOLUME" "oracle-data.tar.gz"

restore_path_archive "$ORACLE_MEMORY_DIR" "oracle-memory.tar.gz"
restore_path_archive "$GROUPS_DIR" "groups.tar.gz"

if [[ "$RESTORE_START_SERVICES" == "true" ]]; then
  run docker compose -f "$REPO_ROOT/docker-compose.yml" up -d
fi

echo "[restore] restore complete from: $TARGET"

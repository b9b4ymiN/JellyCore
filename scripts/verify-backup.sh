#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/verify-backup.sh <backup-archive-or-directory>

Validates:
  - Backup archive readability (tar test)
  - Expected file artifacts are present
  - Embedded volume/file archives are readable
  - Oracle SQLite integrity check (quick_check + integrity_check)
EOF
}

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

TARGET="$1"
WORK_DIR=""
cleanup() {
  if [[ -n "$WORK_DIR" && -d "$WORK_DIR" ]]; then
    rm -rf "$WORK_DIR"
  fi
}
trap cleanup EXIT

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[verify] missing required command: $1" >&2
    exit 1
  fi
}

require_cmd tar

resolve_snapshot_dir() {
  local input="$1"

  if [[ -f "$input" ]]; then
    WORK_DIR="$(mktemp -d)"
    tar -tzf "$input" >/dev/null
    tar -xzf "$input" -C "$WORK_DIR"

    local extracted
    extracted="$(find "$WORK_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1 || true)"
    if [[ -z "$extracted" ]]; then
      echo "[verify] no snapshot directory found in archive" >&2
      exit 1
    fi
    echo "$extracted"
    return
  fi

  if [[ -d "$input" ]]; then
    echo "$input"
    return
  fi

  echo "[verify] target does not exist: $input" >&2
  exit 1
}

SNAPSHOT_DIR="$(resolve_snapshot_dir "$TARGET")"

if [[ ! -f "$SNAPSHOT_DIR/metadata.json" ]]; then
  echo "[verify] missing artifact: $SNAPSHOT_DIR/metadata.json" >&2
  exit 1
fi

declare -a REQUIRED_ARCHIVES=(
  "$SNAPSHOT_DIR/files/oracle-memory.tar.gz"
  "$SNAPSHOT_DIR/files/groups.tar.gz"
)

for f in "${REQUIRED_ARCHIVES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "[verify] missing artifact: $f" >&2
    exit 1
  fi
  tar -tzf "$f" >/dev/null
  echo "[verify] ok: $(basename "$f")"
done

declare -a OPTIONAL_VOLUME_ARCHIVES=(
  "$SNAPSHOT_DIR/volumes/nanoclaw-data.tar.gz"
  "$SNAPSHOT_DIR/volumes/nanoclaw-store.tar.gz"
  "$SNAPSHOT_DIR/volumes/oracle-data.tar.gz"
)

for f in "${OPTIONAL_VOLUME_ARCHIVES[@]}"; do
  if [[ -f "$f" ]]; then
    tar -tzf "$f" >/dev/null
    echo "[verify] ok: $(basename "$f")"
  else
    echo "[verify] warning: optional artifact missing (likely skipped due unavailable Docker daemon): $f"
  fi
done

PYTHON_BIN=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c "import sqlite3" >/dev/null 2>&1; then
    PYTHON_BIN="$candidate"
    break
  fi
done

if [[ -z "$PYTHON_BIN" ]]; then
  echo "[verify] python3/python with sqlite3 module is required for sqlite integrity checks" >&2
  exit 1
fi

SQLITE_TMP="$(mktemp -d)"
trap 'rm -rf "$SQLITE_TMP"; cleanup' EXIT

ORACLE_VOLUME_ARCHIVE="$SNAPSHOT_DIR/volumes/oracle-data.tar.gz"
if [[ ! -f "$ORACLE_VOLUME_ARCHIVE" ]]; then
  echo "[verify] warning: oracle-data archive missing; skipping sqlite integrity check"
  echo "[verify] backup is valid (degraded volume scope): $TARGET"
  exit 0
fi

tar -xzf "$ORACLE_VOLUME_ARCHIVE" -C "$SQLITE_TMP"
DB_PATH="$(find "$SQLITE_TMP" -type f -name 'oracle.db' | head -n 1 || true)"

if [[ -z "$DB_PATH" ]]; then
  echo "[verify] warning: oracle.db not found inside oracle-data archive; skipping sqlite integrity check"
  echo "[verify] backup is valid (degraded volume scope): $TARGET"
  exit 0
fi

"$PYTHON_BIN" - "$DB_PATH" <<'PY'
import sqlite3
import sys

path = sys.argv[1]
conn = sqlite3.connect(path)
cur = conn.cursor()
quick = cur.execute("PRAGMA quick_check;").fetchall()
integrity = cur.execute("PRAGMA integrity_check;").fetchall()
conn.close()

if quick != [("ok",)] or integrity != [("ok",)]:
    raise SystemExit(f"sqlite check failed: quick={quick} integrity={integrity}")

print("[verify] sqlite integrity: ok")
PY

echo "[verify] backup is valid: $TARGET"

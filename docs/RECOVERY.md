# JellyCore Recovery Runbook

This runbook covers backup, verification, and restore for the core recovery scope:

- NanoClaw state volumes: `nanoclaw-data`, `nanoclaw-store`
- Oracle SQLite volume: `oracle-data`
- Oracle memory files: `oracle-v2/?/memory`
- Group workspace files: `groups/`

Out of scope in this phase:

- ChromaDB volume (`chromadb-data`) is treated as rebuildable.

## 1) Create a backup

```bash
# Optional env overrides
export BACKUP_DIR=./backups
export BACKUP_RETENTION_DAYS=14
export RCLONE_REMOTE=""   # e.g. remote:bucket/jellycore

./scripts/backup.sh
```

Dry run:

```bash
./scripts/backup.sh --dry-run
```

Output archive format:

- `backups/jellycore-backup-<UTC_TIMESTAMP>.tar.gz`
- optional checksum: `*.sha256`

## 2) Verify backup integrity

```bash
./scripts/verify-backup.sh backups/jellycore-backup-<UTC_TIMESTAMP>.tar.gz
```

Validation includes:

- archive readability
- required artifacts present (`oracle-memory`, `groups`, metadata)
- embedded tar archives readable
- SQLite `quick_check` and `integrity_check` on `oracle.db` when `oracle-data` volume archive is available

If Docker daemon is unavailable during backup, volume archives may be skipped.
`verify-backup.sh` reports this as a degraded-scope warning (not a hard failure).

## 3) Restore from backup

```bash
./scripts/restore.sh backups/jellycore-backup-<UTC_TIMESTAMP>.tar.gz
```

Dry run (safe preview):

```bash
./scripts/restore.sh backups/jellycore-backup-<UTC_TIMESTAMP>.tar.gz --dry-run
```

Behavior:

- stops compose services (default)
- restores `nanoclaw-data`, `nanoclaw-store`, `oracle-data` volumes when archives exist
- restores `oracle-v2/?/memory` and `groups/` paths
- restarts compose services (default)

Control service stop/start behavior:

```bash
export RESTORE_STOP_SERVICES=false
export RESTORE_START_SERVICES=false
./scripts/restore.sh <backup>
```

## 4) Post-restore checks

```bash
docker compose ps
curl -fsS http://127.0.0.1:47778/api/health
curl -fsS http://127.0.0.1:47779/health
```

Then re-run `./scripts/verify-backup.sh` on the source archive to ensure the source backup remains valid.

## 5) Notes

- Backup scripts assume Docker volumes named with default compose project prefix (`jellycore_*`).
- Override volume names with env vars when project name differs.
- If ChromaDB data is needed later, add `chromadb-data` to backup scope in a future phase.

#!/bin/sh
set -eu

remote="${OFFSITE_BACKUP_REMOTE:-}"
interval="${OFFSITE_BACKUP_INTERVAL_SECONDS:-604800}"
retention_days="${OFFSITE_BACKUP_RETENTION_DAYS:-90}"
include_recordings="${OFFSITE_INCLUDE_RECORDINGS:-false}"

if [ -z "$remote" ]; then
  echo "OFFSITE_BACKUP_REMOTE não configurado; defina, por exemplo, s3-drac:cliente-flashnet" >&2
  exit 2
fi

while true; do
  started="$(date -u +%FT%TZ)"
  rclone copy /data/backups "$remote/database" \
    --checksum --transfers "${OFFSITE_BACKUP_TRANSFERS:-4}" \
    --checkers "${OFFSITE_BACKUP_CHECKERS:-8}" --log-level INFO
  if [ -d /data/keystores ]; then
    rclone copy /data/keystores "$remote/keystores" \
      --checksum --transfers "${OFFSITE_BACKUP_TRANSFERS:-4}" \
      --checkers "${OFFSITE_BACKUP_CHECKERS:-8}" --log-level INFO
  fi
  # `copy` protege contra exclusão local acidental; a retenção explícita remove
  # somente backups operacionais vencidos. Gravações nunca entram neste corte.
  rclone delete "$remote/database" --min-age "${retention_days}d" --log-level INFO
  rclone delete "$remote/keystores" --min-age "${retention_days}d" --log-level INFO
  rclone rmdirs "$remote/database" --leave-root 2>/dev/null || true
  rclone rmdirs "$remote/keystores" --leave-root 2>/dev/null || true
  if [ "$include_recordings" = "true" ]; then
    # copy (não sync) evita que uma exclusão local remova evidência já enviada.
    # Imutabilidade/WORM deve ser habilitada também no bucket/provedor remoto.
    rclone copy /data/storage "$remote/recordings" \
      --checksum --transfers "${OFFSITE_BACKUP_TRANSFERS:-4}" \
      --checkers "${OFFSITE_BACKUP_CHECKERS:-8}" --log-level INFO
  fi
  echo "$started offsite_backup=ok remote=$remote retention_days=$retention_days recordings=$include_recordings"
  sleep "$interval"
done

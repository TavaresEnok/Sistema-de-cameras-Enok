#!/bin/sh
set -eu

interval="${BACKUP_INTERVAL_SECONDS:-86400}"
retention_days="${BACKUP_RETENTION_DAYS:-30}"
export PGPASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"

mkdir -p /backups/postgres /backups/data

while true; do
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  db_tmp="/backups/postgres/.central-$timestamp.dump.tmp"
  db_out="/backups/postgres/central-$timestamp.dump"
  data_tmp="/backups/data/.central-data-$timestamp.tar.gz.tmp"
  data_out="/backups/data/central-data-$timestamp.tar.gz"

  rm -f "$db_tmp" "$data_tmp"
  pg_dump -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "$db_tmp"
  pg_restore --list "$db_tmp" >/dev/null
  mv "$db_tmp" "$db_out"
  chmod 600 "$db_out"

  tar -C /central-data -czf "$data_tmp" .
  tar -tzf "$data_tmp" >/dev/null
  mv "$data_tmp" "$data_out"
  chmod 600 "$data_out"

  find /backups/postgres -type f -name 'central-*.dump' -mtime "+$retention_days" -delete
  find /backups/data -type f -name 'central-data-*.tar.gz' -mtime "+$retention_days" -delete
  printf '%s central_backup=ok db=%s data=%s\n' "$(date -u +%FT%TZ)" "$(basename "$db_out")" "$(basename "$data_out")"
  sleep "$interval"
done

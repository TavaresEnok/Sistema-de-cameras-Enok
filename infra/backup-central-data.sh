#!/bin/sh
set -eu

interval="${CENTRAL_BACKUP_INTERVAL_SECONDS:-604800}"
retention_days="${CENTRAL_BACKUP_RETENTION_DAYS:-30}"
mkdir -p /backups

while true; do
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  tmp="/backups/.drac-central-$ts.tar.gz.tmp"
  out="/backups/drac-central-$ts.tar.gz"
  rm -f "$tmp"
  tar -C /central-data -czf "$tmp" .
  tar -tzf "$tmp" >/dev/null
  mv "$tmp" "$out"
  chmod 600 "$out"
  find /backups -type f -name 'drac-central-*.tar.gz' -mtime "+$retention_days" -delete
  echo "$(date -u +%FT%TZ) central_backup=ok file=$(basename "$out")"
  sleep "$interval"
done

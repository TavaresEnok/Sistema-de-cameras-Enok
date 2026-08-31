#!/bin/sh
set -u

initial_delay="${BACKUP_VERIFY_INITIAL_DELAY_SECONDS:-900}"
interval="${BACKUP_VERIFY_INTERVAL_SECONDS:-86400}"
retry="${BACKUP_VERIFY_RETRY_SECONDS:-300}"
verify_db="${POSTGRES_DB:-drac_central}_restore_verify"
export PGPASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"

cleanup() {
  dropdb --if-exists --force -h "$POSTGRES_HOST" -U "$POSTGRES_USER" "$verify_db" >/dev/null 2>&1 || true
}

verify_once() {
  latest="$(find /backups -maxdepth 1 -type f -name 'central-*.dump' -print | sort | tail -n 1)"
  [ -n "$latest" ] || return 1

  cleanup
  pg_restore --list "$latest" >/dev/null || return 1
  createdb -h "$POSTGRES_HOST" -U "$POSTGRES_USER" "$verify_db" || return 1
  pg_restore --exit-on-error --no-owner --no-privileges \
    -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$verify_db" "$latest" >/dev/null || return 1

  # Não basta o restore terminar: as tabelas que guardam instalações, contas e
  # metadados precisam existir e ser consultáveis.
  psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$verify_db" -v ON_ERROR_STOP=1 -Atc \
    'select (select count(*) from central_installations), (select count(*) from central_users), (select count(*) from central_meta);' \
    >/tmp/verified-counts || return 1

  cleanup
  return 0
}

trap cleanup EXIT INT TERM
sleep "$initial_delay"

while true; do
  if verify_once; then
    counts="$(cat /tmp/verified-counts 2>/dev/null || printf 'unknown')"
    touch /tmp/last-ok
    rm -f /tmp/last-failed
    printf '%s central_backup_restore_verify=ok counts=%s\n' "$(date -u +%FT%TZ)" "$counts"
    sleep "$interval"
  else
    cleanup
    touch /tmp/last-failed
    printf '%s central_backup_restore_verify=FALHOU; nova tentativa em %ss\n' "$(date -u +%FT%TZ)" "$retry" >&2
    sleep "$retry"
  fi
done

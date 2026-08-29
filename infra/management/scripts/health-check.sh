#!/bin/sh
set -eu

root="${MANAGEMENT_ROOT:-/opt/ajustcam-management/repo/infra/management}"
cd "$root"

failed="$(docker compose --env-file .env ps --status exited --format '{{.Name}}' 2>/dev/null || true)"
unhealthy="$(docker ps --filter health=unhealthy --format '{{.Names}}')"
disk_pct="$(df -P / | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"

if [ -n "$failed" ] || [ -n "$unhealthy" ] || [ "${disk_pct:-100}" -ge 85 ]; then
  logger -p daemon.err -t ajustcam-management "health=failed exited=${failed:-none} unhealthy=${unhealthy:-none} disk=${disk_pct:-unknown}%"
  exit 1
fi

if ! curl -fsS --max-time 5 http://10.10.0.11:8080/health >/dev/null; then
  logger -p daemon.err -t ajustcam-management "health=failed central=unreachable disk=${disk_pct:-unknown}%"
  exit 1
fi

logger -t ajustcam-management "health=ok disk=${disk_pct}%"

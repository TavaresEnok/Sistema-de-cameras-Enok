#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="${DRAC_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${DRAC_ENV_FILE:-$ROOT_DIR/infra/.env}"
RUN_RESTORE_CHECK="${DRAC_REGRESSION_RESTORE_CHECK:-true}"

CHECKS=0
WARNINGS=0
FAILURES=0

log() {
  printf '[DRAC regression] %s\n' "$*"
}

ok() {
  CHECKS=$((CHECKS + 1))
  printf '[OK] %s\n' "$*"
}

warn() {
  CHECKS=$((CHECKS + 1))
  WARNINGS=$((WARNINGS + 1))
  printf '[ATENCAO] %s\n' "$*"
}

fail() {
  CHECKS=$((CHECKS + 1))
  FAILURES=$((FAILURES + 1))
  printf '[FALHA] %s\n' "$*" >&2
}

load_env() {
  if [ ! -f "$ENV_FILE" ]; then
    fail "infra/.env nao encontrado em $ENV_FILE"
    return
  fi
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      ''|\#*) continue ;;
    esac
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      local key="${BASH_REMATCH[1]}"
      local value="${BASH_REMATCH[2]}"
      if [[ "$value" =~ ^\"(.*)\"$ ]] || [[ "$value" =~ ^\'(.*)\'$ ]]; then
        value="${BASH_REMATCH[1]}"
      fi
      export "$key=$value"
    fi
  done < "$ENV_FILE"
  ok "Ambiente carregado"
}

curl_status() {
  curl -sS -o /tmp/drac-regression-response.txt -w '%{http_code}' --max-time "${3:-10}" "$1" "${@:4}" 2>/tmp/drac-regression-curl.err
}

expect_http() {
  local name="$1"
  local url="$2"
  local expected="${3:-200}"
  local status
  status="$(curl_status "$url" "$expected" 10)"
  if [ "$status" = "$expected" ]; then
    ok "$name respondeu HTTP $status"
  else
    fail "$name respondeu HTTP ${status:-sem resposta}, esperado $expected"
  fi
}

container_running() {
  local name="$1"
  local status
  status="$(docker inspect -f '{{.State.Status}}' "$name" 2>/dev/null || true)"
  if [ "$status" = "running" ]; then
    ok "Container $name em execucao"
  else
    fail "Container $name em estado ${status:-ausente}"
  fi
}

psql_value() {
  local query="$1"
  docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-}" vms-postgres \
    psql -U "${POSTGRES_USER:-vms}" -d "${POSTGRES_DB:-vms_db}" -Atc "$query" 2>/dev/null | head -n 1
}

check_database_state() {
  local camera_total camera_online web_rtc live_main analytics_split admin_total
  camera_total="$(psql_value 'select count(*) from "Camera";')"
  camera_online="$(psql_value "select count(*) from \"Camera\" where status = 'ONLINE';")"
  web_rtc="$(psql_value "select count(*) from \"Camera\" where \"preferredLiveProtocol\" = 'webrtc';")"
  live_main="$(psql_value 'select count(*) from "Camera" where coalesce("liveSubtype", 0) = 0;')"
  analytics_split="$(psql_value 'select count(*) from "Camera" where "analyticsSubtype" is not null;')"
  admin_total="$(psql_value "select count(*) from \"User\" where role in ('ADMIN', 'SUPER_ADMIN') and \"isActive\" = true;")"

  if [ "${camera_total:-0}" -gt 0 ]; then
    ok "Banco possui cameras cadastradas ($camera_total)"
  else
    fail "Banco nao possui cameras cadastradas"
  fi

  if [ "${camera_total:-0}" = "${camera_online:-x}" ]; then
    ok "Todas as cameras cadastradas estao online ($camera_online/$camera_total)"
  else
    warn "Nem todas as cameras estao online ($camera_online/$camera_total)"
  fi

  if [ "${camera_total:-0}" = "${web_rtc:-x}" ]; then
    ok "Todas as cameras usam WebRTC como protocolo live"
  else
    fail "Existem cameras fora de WebRTC ($web_rtc/$camera_total)"
  fi

  if [ "${camera_total:-0}" = "${live_main:-x}" ]; then
    ok "Todas as cameras usam perfil principal para live"
  else
    warn "Algumas cameras nao usam perfil principal para live ($live_main/$camera_total)"
  fi

  if [ "${camera_total:-0}" = "${analytics_split:-x}" ]; then
    ok "Todas as cameras possuem analyticsSubtype separado"
  else
    warn "Algumas cameras ainda nao possuem analyticsSubtype ($analytics_split/$camera_total)"
  fi

  if [ "${admin_total:-0}" -gt 0 ]; then
    ok "Existe administrador ativo"
  else
    fail "Nenhum administrador ativo encontrado"
  fi
}

check_auth_contract() {
  local status
  status="$(curl -sS -o /tmp/drac-regression-auth.txt -w '%{http_code}' --max-time 10 \
    -H 'Content-Type: application/json' \
    -d '{"email":"regression.invalid@example.local","password":"invalid"}' \
    http://127.0.0.1:3000/auth/login 2>/tmp/drac-regression-auth.err || true)"
  case "$status" in
    400|401)
      ok "Servidor de autenticacao respondeu corretamente a login invalido ($status)"
      ;;
    *)
      fail "Servidor de autenticacao respondeu $status para login invalido"
      ;;
  esac
}

check_mediamtx() {
  if docker exec vms-api node -e 'const u=process.env.MEDIAMTX_API_USER,p=process.env.MEDIAMTX_API_PASS; fetch("http://mediamtx:9997/v3/config/global/get",{headers:{authorization:"Basic "+Buffer.from(u+":"+p).toString("base64")},signal:AbortSignal.timeout(8000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(2))' >/dev/null 2>&1; then
    ok "MediaMTX API respondeu com credenciais internas"
  else
    fail "MediaMTX API nao respondeu com credenciais internas"
  fi

  if [ -n "${PUBLIC_APP_URL:-}" ] && [ -n "${API_PUBLIC_URL:-}" ]; then
    ok "URLs publicas de app/API configuradas"
  else
    warn "PUBLIC_APP_URL/API_PUBLIC_URL ausentes; WebRTC externo dependera de host inferido"
  fi

  if [[ "${PUBLIC_APP_URL:-}" =~ ^https:// ]] && [ "${MEDIAMTX_WEBRTC_ALLOW_ORIGIN:-*}" = "*" ]; then
    warn "WebRTC em HTTPS deve restringir MEDIAMTX_WEBRTC_ALLOW_ORIGIN ao dominio real"
  fi
}

check_central() {
  if [ "${CLOUD_CONNECTOR_ENABLED:-false}" != "true" ]; then
    warn "Conector central desativado"
    return
  fi
  if docker exec vms-api node -e 'fetch(process.env.CLOUD_API_URL.replace(/\/$/,"")+"/api/health",{signal:AbortSignal.timeout(8000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(2))' >/dev/null 2>&1; then
    ok "Central respondeu /api/health"
  else
    warn "Central nao respondeu /api/health"
  fi
  if docker exec vms-api node -e 'const base=process.env.CLOUD_API_URL.replace(/\/$/,""); fetch(base+"/api/agent/status",{headers:{"X-DRAC-Installation-Id":process.env.CLOUD_INSTALLATION_ID,"X-DRAC-License-Key":process.env.CLOUD_LICENSE_KEY},signal:AbortSignal.timeout(8000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(2))' >/dev/null 2>&1; then
    ok "Central confirmou identidade e licença da instalação"
  else
    fail "Central nao confirmou identidade/licenca em /api/agent/status"
  fi
}

run_restore_check() {
  if [ "$RUN_RESTORE_CHECK" != "true" ]; then
    warn "Teste de restore ignorado por DRAC_REGRESSION_RESTORE_CHECK=false"
    return
  fi
  if "$ROOT_DIR/scripts/verify-backup-restore.sh"; then
    ok "Backup mais recente restaurou em banco temporario"
  else
    fail "Backup mais recente nao passou no restore temporario"
  fi
}

main() {
  log "Iniciando regressao automatica de producao"
  load_env

  for name in vms-postgres vms-redis vms-mediamtx vms-api vms-web vms-postgres-backup; do
    container_running "$name"
  done

  expect_http "API readiness" "http://127.0.0.1:3000/health/ready" 200
  expect_http "Web" "http://127.0.0.1:5173/" 200
  check_auth_contract
  check_database_state
  check_mediamtx
  check_central

  if [ -x "$ROOT_DIR/scripts/production-readiness.sh" ]; then
    "$ROOT_DIR/scripts/production-readiness.sh"
    readiness_status=$?
    case "$readiness_status" in
      0)
        ok "Readiness completo aprovado"
        ;;
      1)
        warn "Readiness completo aprovado com itens em atencao"
        ;;
      *)
        fail "Readiness completo encontrou bloqueios"
        ;;
    esac
  fi

  run_restore_check

  log "Resultado: checks=$CHECKS avisos=$WARNINGS falhas=$FAILURES"
  if [ "$FAILURES" -gt 0 ]; then
    exit 2
  fi
  if [ "$WARNINGS" -gt 0 ]; then
    exit 1
  fi
}

main "$@"

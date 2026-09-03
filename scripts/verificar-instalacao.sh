#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# BATERIA DE VERIFICAÇÃO DE UMA INSTALAÇÃO DRAC
#
# Roda contra QUALQUER instalação: a máquina virgem do teste automatizado, ou
# um servidor de cliente já em produção.
#
#   bash scripts/verificar-instalacao.sh
#   bash scripts/verificar-instalacao.sh --dir /opt/drac
#
# Cada check corresponde a um defeito REAL encontrado na primeira instalação de
# cliente (07/08/2026). Não são checagens genéricas de saúde: é a lista do que
# já passou despercebido até o cliente.
#
# Saída 0 = instalação sadia. Qualquer outra = há pendência descrita na saída.
# ════════════════════════════════════════════════════════════════════════════
set -uo pipefail

DIR="${DRAC_INSTALL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE=""
API="${DRAC_API_URL:-http://127.0.0.1:3000}"
WEB="${DRAC_WEB_URL:-http://127.0.0.1:5173}"

while [ $# -gt 0 ]; do
  case "$1" in
    -d|--dir) DIR="$2"; shift 2 ;;
    --api) API="$2"; shift 2 ;;
    --web) WEB="$2"; shift 2 ;;
    -h|--help) sed -n '2,17p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) printf 'Opcao desconhecida: %s\n' "$1" >&2; exit 2 ;;
  esac
done
ENV_FILE="$DIR/infra/.env"

falhas=0
avisos=0
secao() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()    { printf '  \033[1;32mok\033[0m      %s\n' "$1"; }
falha() { printf '  \033[1;31mFALHOU\033[0m  %s\n          %s\n' "$1" "$2"; falhas=$((falhas + 1)); }
aviso() { printf '  \033[1;33maviso\033[0m   %s\n          %s\n' "$1" "$2"; avisos=$((avisos + 1)); }

env_get() { sed -nE "s/^$2=(.*)$/\1/p" "$1" 2>/dev/null | tail -n 1; }

# Em tenants atrás da Gateway o painel é publicado no IP privado da VM, não
# em loopback. Verificar sempre 127.0.0.1 fazia uma instalação saudável ser
# declarada quebrada e mantinha o watchdog em alerta permanente.
if [ -z "${DRAC_WEB_URL:-}" ] && [ "$WEB" = "http://127.0.0.1:5173" ]; then
  web_bind="$(env_get "$ENV_FILE" DRAC_WEB_BIND)"
  case "$web_bind" in
    ''|0.0.0.0|127.0.0.1) ;;
    *) WEB="http://${web_bind}:5173" ;;
  esac
fi

compose() {
  local f="-f $DIR/infra/docker-compose.yml -f $DIR/infra/docker-compose.prod.yml"
  # shellcheck disable=SC2086
  docker compose --env-file "$ENV_FILE" $f "$@"
}

# ─── 1. Containers ──────────────────────────────────────────────────────────
secao '1. Containers'

esperados="vms-postgres vms-redis vms-api vms-web vms-mediamtx vms-rtmp-callback vms-rtmp-ingest"
for c in $esperados; do
  estado="$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo ausente)"
  saude="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}sem-healthcheck{{end}}' "$c" 2>/dev/null || echo '-')"
  case "$estado:$saude" in
    running:healthy|running:sem-healthcheck) ok "$c ($estado/$saude)" ;;
    running:starting) aviso "$c ainda subindo" "healthcheck em 'starting'; rode de novo em instantes" ;;
    *) falha "$c" "estado=$estado saude=$saude — 'docker logs $c'" ;;
  esac
done

# ─── 2. Nada exposto além do combinado ──────────────────────────────────────
# O defeito mais grave da instalação do D-GUARDIAN: o Docker escreve DNAT
# avaliado ANTES do ufw. O firewall estava certo e a API inteira respondia da
# internet. Aqui olhamos a LIGAÇÃO real dos containers, que é o que manda.
secao '2. Exposição à internet (ligações dos containers)'

# Só é público o que NÃO PODE passar pelo nginx.
PUBLICO_PERMITIDO="1935/tcp 8189/udp"
exposto=""
# Uma VM pode hospedar outros produtos. Auditar `docker ps` inteiro fazia o
# AjustCam reprovar por uma porta pública do ViralForge (projeto independente),
# embora nenhum container desta instalação estivesse exposto. O label do
# Compose delimita exatamente a stack à qual o vms-api pertence.
COMPOSE_PROJECT="$(docker inspect vms-api \
  --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true)"
docker_ps_da_instalacao() {
  if [ -n "$COMPOSE_PROJECT" ]; then
    docker ps --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
      --format '{{.Names}} {{.Ports}}' 2>/dev/null
  else
    # Compatibilidade com uma instalação antiga sem labels Compose: os nomes
    # vms-* são reservados ao AjustCam neste host.
    docker ps --filter 'name=^/vms-' --format '{{.Names}} {{.Ports}}' 2>/dev/null
  fi
}
while read -r linha; do
  [ -n "$linha" ] || continue
  nome="${linha%% *}"
  portas="${linha#* }"
  # Formato do docker: 0.0.0.0:8888->8888/tcp
  while read -r mapa; do
    [ -n "$mapa" ] || continue
    case "$mapa" in
      0.0.0.0:*|:::*|\[::\]:*) ;;
      *) continue ;;
    esac
    destino="${mapa##*->}"          # 8888/tcp
    case " $PUBLICO_PERMITIDO " in
      *" $destino "*) continue ;;
    esac
    exposto="$exposto\n    $nome  $mapa"
  # A quebra final é necessária: sem ela, `read` devolve EOF antes de executar
  # o corpo para a última porta. Justamente a publicação 0.0.0.0 costuma ser a
  # última depois de "80/tcp," e desaparecia da auditoria.
  done < <(printf '%s\n' "$portas" | tr ',' '\n' | sed 's/^ *//')
done < <(docker_ps_da_instalacao)

if [ -z "$exposto" ]; then
  ok "nenhum container desta instalação expõe 0.0.0.0 além de $PUBLICO_PERMITIDO"
else
  falha "porta(s) publicadas na internet indevidamente" "$(printf '%b' "$exposto")"
fi

# Confere também a INTENÇÃO declarada no .env, para o defeito não voltar pelo
# arquivo mesmo que os containers de agora estejam certos.
if [ -f "$ENV_FILE" ]; then
  for chave in DRAC_API_BIND DRAC_WEB_BIND DRAC_POSTGRES_BIND DRAC_REDIS_BIND \
               DRAC_MEDIAMTX_RTSP_BIND DRAC_MEDIAMTX_HLS_BIND DRAC_MEDIAMTX_WEBRTC_HTTP_BIND; do
    valor="$(env_get "$ENV_FILE" "$chave")"
    if [ "$valor" = "0.0.0.0" ]; then
      falha "$chave=0.0.0.0 no infra/.env" "esse serviço passa pelo nginx; deve ligar em 127.0.0.1"
    fi
  done
  [ "$falhas" -eq 0 ] && ok "infra/.env não declara 0.0.0.0 para serviço que passa pelo nginx"
fi

# ─── 3. O banco tem TODAS as tabelas do schema ──────────────────────────────
# `migrate deploy` diz "up to date" mesmo faltando tabela que nunca teve
# migração (chegou por `db push`). Foi assim que RolePermission sumiu.
secao '3. Banco cobre o schema inteiro'

PG_USER="$(env_get "$ENV_FILE" POSTGRES_USER)"
PG_DB="$(env_get "$ENV_FILE" POSTGRES_DB)"
if [ -z "$PG_USER" ] || [ -z "$PG_DB" ]; then
  falha "não consegui ler POSTGRES_USER/DB" "$ENV_FILE"
else
  tabelas="$(compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -tAc \
    "SELECT tablename FROM pg_tables WHERE schemaname='public'" 2>/dev/null | tr -d '\r')"
  if [ -z "$tabelas" ]; then
    falha "não consegui listar as tabelas" "o postgres respondeu vazio"
  else
    faltando=""
    while read -r modelo; do
      [ -n "$modelo" ] || continue
      printf '%s\n' "$tabelas" | grep -qxF "$modelo" || faltando="$faltando $modelo"
    done < <(grep -oE '^model[[:space:]]+[A-Za-z0-9_]+' "$DIR/apps/api/prisma/schema.prisma" 2>/dev/null | awk '{print $2}')
    if [ -z "$faltando" ]; then
      ok "todas as tabelas do schema.prisma existem no banco ($(printf '%s\n' "$tabelas" | grep -c .) tabelas)"
    else
      falha "tabela(s) do schema AUSENTES no banco:$faltando" "migrate deploy diria 'up to date' assim mesmo"
    fi
  fi
fi

# ─── 4. Dá para ENTRAR ──────────────────────────────────────────────────────
# Uma instalação sem usuário nenhum "sobe" perfeitamente e não serve para nada.
secao '4. Login funciona'

CRED_FILE="$DIR/infra/.credenciais-iniciais"
LOGIN_EMAIL="${DRAC_ADMIN_EMAIL:-}"
LOGIN_SENHA="${DRAC_ADMIN_PASSWORD:-}"
LOGIN_EXPLICITO=false
if [ -n "$LOGIN_EMAIL" ] || [ -n "$LOGIN_SENHA" ]; then
  LOGIN_EXPLICITO=true
fi
if [ -z "$LOGIN_EMAIL" ] && [ -r "$CRED_FILE" ]; then
  LOGIN_EMAIL="$(env_get "$CRED_FILE" usuario)"
  LOGIN_SENHA="$(env_get "$CRED_FILE" senha)"
fi

TOKEN=""
if [ -z "$LOGIN_EMAIL" ] || [ -z "$LOGIN_SENHA" ]; then
  aviso "sem credenciais para testar o login" "defina DRAC_ADMIN_EMAIL/DRAC_ADMIN_PASSWORD ou mantenha $CRED_FILE"
else
  resposta="$(curl -fsS --max-time 10 -X POST "$API/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$LOGIN_EMAIL\",\"password\":\"$LOGIN_SENHA\"}" 2>/dev/null || true)"
  TOKEN="$(printf '%s' "$resposta" | sed -nE 's/.*"access_?[Tt]oken"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')"
  if [ -n "$TOKEN" ]; then
    ok "login do administrador ($LOGIN_EMAIL) devolveu token"
  elif [ "$LOGIN_EXPLICITO" = true ]; then
    falha "login do administrador falhou" "usuario=$LOGIN_EMAIL — as credenciais fornecidas explicitamente não foram aceitas; resposta: ${resposta:0:120}"
  else
    # O arquivo é entregue somente para o primeiro acesso. Depois da troca
    # obrigatória de senha ele fica, corretamente, desatualizado. Isso não pode
    # bloquear uma atualização segura nem provocar rollback de uma instalação
    # saudável. Ainda exigimos a existência de ao menos um administrador ativo;
    # para comprovar o login em si, o operador pode fornecer DRAC_ADMIN_*.
    admins_ativos="$(compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -tAc \
      'SELECT count(*) FROM "User" WHERE "isActive" = true AND role IN ('"'"'ADMIN'"'"', '"'"'SUPER_ADMIN'"'"');' \
      2>/dev/null | tr -d '[:space:]')"
    if [[ "$admins_ativos" =~ ^[1-9][0-9]*$ ]]; then
      aviso "credencial inicial não é mais válida" "há $admins_ativos administrador(es) ativo(s); a senha inicial provavelmente já foi trocada. Use DRAC_ADMIN_EMAIL/DRAC_ADMIN_PASSWORD para testar o login atual"
    else
      falha "login do administrador falhou" "a credencial inicial não funciona e nenhum administrador ativo foi confirmado no banco"
    fi
  fi
fi

# ─── 5. As telas respondem (inclusive a que quebrava) ───────────────────────
secao '5. Rotas da aplicação'

curl -fsS --max-time 10 "$API/health" >/dev/null 2>&1 \
  && ok "API /health" || falha "API /health não respondeu" "$API/health"
curl -fsS --max-time 10 "$WEB/" >/dev/null 2>&1 \
  && ok "painel web" || falha "painel web não respondeu" "$WEB/"

# Um GET simples era falso-verde quando o CSP da instalação por IP convertia
# os assets relativos para HTTPS numa porta que só fala HTTP. O HTML dava 200;
# a tela real ficava sem CSS e JavaScript.
if [[ "$WEB" == http://* ]]; then
  WEB_HEADERS="$(curl -fsSI --max-time 10 "$WEB/" 2>/dev/null | tr -d '\r' || true)"
  if printf '%s\n' "$WEB_HEADERS" | grep -qiE '^Content-Security-Policy:.*upgrade-insecure-requests'; then
    falha "painel HTTP força assets para HTTPS" "CSP incompatível com $WEB — causará ERR_SSL_PROTOCOL_ERROR"
  elif printf '%s\n' "$WEB_HEADERS" | grep -qi '^Strict-Transport-Security:'; then
    falha "painel HTTP emite HSTS" "HSTS deve ficar somente no proxy HTTPS externo"
  else
    ok "política de transporte do painel é compatível com HTTP"
  fi
fi

if [ -n "$TOKEN" ]; then
  # /role-permissions é a rota que respondia 500 em TODA instalação de cliente
  # por causa da tabela sem migração. Entra aqui de propósito.
  for rota in role-permissions cameras users settings audit-logs; do
    codigo="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
      -H "Authorization: Bearer $TOKEN" "$API/$rota" 2>/dev/null || echo 000)"
    case "$codigo" in
      200|201) ok "GET /$rota → $codigo" ;;
      403) ok "GET /$rota → 403 (permissão, não defeito)" ;;
      *) falha "GET /$rota → $codigo" "esperado 200; 500 aqui costuma ser tabela ausente" ;;
    esac
  done
else
  aviso "rotas autenticadas não verificadas" "sem token (ver check 4)"
fi

# ─── 6. Monitoramento provou que funciona ───────────────────────────────────
secao '6. Watchdog'

STATUS_FILE="$DIR/infra/storage/.monitor/runtime-status.json"
if [ ! -f "$STATUS_FILE" ]; then
  falha "watchdog nunca gravou estado" "$STATUS_FILE ausente — instalação sem monitoramento"
else
  idade=$(( $(date +%s) - $(stat -c %Y "$STATUS_FILE" 2>/dev/null || echo 0) ))
  problemas="$(sed -nE 's/.*"issues"[[:space:]]*:[[:space:]]*\[([^]]*)\].*/\1/p' "$STATUS_FILE" | tr -d ' "')"
  if [ -z "$problemas" ]; then
    ok "watchdog reportou issues: [] (estado de ${idade}s atrás)"
  else
    aviso "watchdog reportou problemas" "$problemas"
  fi
  if [ "$idade" -gt 1800 ]; then
    falha "estado do watchdog velho (${idade}s)" "o agendamento parou? 'systemctl list-timers | grep drac-watchdog'"
  fi
fi

# ─── 7. A instalação reporta a versão que ela REALMENTE roda ────────────────
# A versão que sobe para a Central vem de DRAC_VERSION no .env, não do git. Se
# os dois divergem, a Central mostra a instalação como atrasada para sempre e
# alguém roda a atualização em laço — foi o que aconteceu ao atualizar o
# D-GUARDIAN pela primeira vez.
secao '7. Versão reportada bate com a instalada'

VERSAO_ENV="$(env_get "$ENV_FILE" DRAC_VERSION)"
VERSAO_GIT="$(git -C "$DIR" rev-parse HEAD 2>/dev/null || echo '')"
if [ -z "$VERSAO_GIT" ]; then
  aviso "não é um repositório git" "$DIR — instalação fora do padrão do instalador"
elif [ -z "$VERSAO_ENV" ]; then
  aviso "DRAC_VERSION ausente no infra/.env" "a Central não saberá em que versão esta instalação está"
elif [ "$VERSAO_ENV" = "$VERSAO_GIT" ]; then
  ok "reporta ${VERSAO_GIT:0:12}, que é o que está instalado"
elif ! printf '%s' "$VERSAO_ENV" | grep -qE '^[0-9a-f]{40}$'; then
  # Marcador deliberado (ex.: "local" na matriz, onde o código muda o tempo
  # todo e fixar um commit seria mentira na maior parte do tempo). Não é
  # deriva — mas a Central fica sem saber em que versão ela está, e isso
  # precisa aparecer.
  aviso "reporta \"$VERSAO_ENV\", não um commit" "instalação de desenvolvimento; a Central não consegue situá-la na frota"
else
  falha "versão reportada ≠ versão instalada" "reporta ${VERSAO_ENV:0:12}, roda ${VERSAO_GIT:0:12} — a Central a verá eternamente atrasada"
fi

# ─── Resultado ──────────────────────────────────────────────────────────────
printf '\n'
if [ "$falhas" -eq 0 ] && [ "$avisos" -eq 0 ]; then
  printf '\033[1;32mInstalação sadia: todos os checks passaram.\033[0m\n\n'
  exit 0
fi
if [ "$falhas" -eq 0 ]; then
  printf '\033[1;33mInstalação de pé, com %s aviso(s) acima.\033[0m\n\n' "$avisos"
  exit 0
fi
printf '\033[1;31m%s check(s) FALHARAM e %s aviso(s). A instalação NÃO está pronta.\033[0m\n\n' "$falhas" "$avisos"
exit 1

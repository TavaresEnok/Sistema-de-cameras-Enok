#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# CHECKS ESTÁTICOS DA INFRAESTRUTURA — rodam em segundos, sem instalar nada.
#
# Pegam as CLASSES de defeito que quebraram a primeira instalação de cliente e
# que eram invisíveis na máquina de quem desenvolve:
#
#   · porta ligada duas vezes (o Compose SOMA listas em vez de substituir);
#   · serviço que passa pelo nginx publicado em 0.0.0.0;
#   · Compose que só é válido se a Central existir.
#
#   bash scripts/tests/test-compose-estatico.sh
# ════════════════════════════════════════════════════════════════════════════
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA="$RAIZ/infra"
ENV_EXEMPLO="$INFRA/.env.example"

falhas=0
secao() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()    { printf '  \033[1;32mok\033[0m      %s\n' "$1"; }
falha() { printf '  \033[1;31mFALHOU\033[0m  %s\n          %s\n' "$1" "$2"; falhas=$((falhas + 1)); }

if ! docker compose version >/dev/null 2>&1; then
  printf 'docker compose indisponivel; checks estaticos pulados.\n' >&2
  exit 0
fi

render() {
  docker compose --env-file "$ENV_EXEMPLO" \
    -f "$INFRA/docker-compose.yml" -f "$INFRA/docker-compose.prod.yml" \
    config 2>/dev/null
}

# ─── 1. O Compose de produção é válido SEM a Central ────────────────────────
# A Central é o painel mestre e não existe no servidor do cliente. Já houve
# `depends_on: drac-central` no web, que invalidava o arquivo inteiro sem o
# perfil, e o web nem subia.
secao '1. Compose de produção se sustenta sozinho'

saida_config="$(docker compose --env-file "$ENV_EXEMPLO" \
  -f "$INFRA/docker-compose.yml" -f "$INFRA/docker-compose.prod.yml" config 2>&1)"
if [ $? -ne 0 ] || printf '%s' "$saida_config" | grep -qi 'error'; then
  falha "compose de produção inválido" "$(printf '%s' "$saida_config" | head -3)"
else
  ok "docker compose config validou"
fi

renderizado="$(render)"

if printf '%s' "$renderizado" | grep -qE '^\s{2}drac-central:'; then
  falha "drac-central entra na instalação do cliente" "a Central é o painel MESTRE; deve ficar sob profiles: [central]"
else
  ok "drac-central fica fora (profile 'central')"
fi

# Sem os comentários: o arquivo tem um comentário explicando justamente que a
# Central não pode entrar aqui, e ele não é uma dependência.
if sed 's/#.*//' "$INFRA/docker-compose.yml" "$INFRA/docker-compose.prod.yml" 2>/dev/null \
   | grep -E '^\s+-\s+drac-central\s*$' -q; then
  falha "algum serviço depende de drac-central" "invalida o compose onde a Central não existe"
else
  ok "nenhum serviço depende da Central"
fi

# ─── 2. Porta ligada duas vezes ─────────────────────────────────────────────
# O Compose SOMA as listas de `ports` entre arquivos. Base fixando a porta e
# overlay publicando a mesma porta = duas ligações. O sintoma mente: "address
# already in use" com a porta LIVRE no host.
secao '2. Nenhuma porta publicada duas vezes'

duplicadas="$(printf '%s' "$renderizado" \
  | awk '
      /^  [a-zA-Z0-9_-]+:$/ { servico = $1; sub(/:$/, "", servico) }
      /published:/ { gsub(/"/, "", $2); portas[servico "/" $2]++ }
      END { for (k in portas) if (portas[k] > 1) printf "%s (x%d)\n", k, portas[k] }
    ')"
if [ -z "$duplicadas" ]; then
  ok "cada porta publicada aparece uma vez só"
else
  falha "porta publicada em duplicidade" "$(printf '%s' "$duplicadas" | tr '\n' ' ')"
fi

# Base e overlay têm de usar AS MESMAS variáveis — porta crua na base é o que
# criava a duplicação quando o overlay publicava a mesma porta via variável.
# Só interessa o que REALMENTE vai para a máquina do cliente. Serviços sob
# perfil (drac-central, go2rtc-eval) não entram na instalação e podem fixar a
# porta à vontade.
servicos_do_cliente="$(printf '%s' "$renderizado" | awk '/^  [a-zA-Z0-9_-]+:$/ { s=$1; sub(/:$/,"",s); print s }')"
crua="$(awk '
    /^  [a-zA-Z0-9_-]+:$/ { s=$1; sub(/:$/,"",s) }
    /^[[:space:]]+- "?127\.0\.0\.1:[0-9]+:[0-9]+/ { print s ": " $0 }
  ' "$INFRA/docker-compose.yml" 2>/dev/null \
  | while IFS= read -r linha; do
      svc="${linha%%:*}"
      printf '%s\n' "$servicos_do_cliente" | grep -qxF "$svc" && printf '%s\n' "$linha"
    done)"
if [ -z "$crua" ]; then
  ok "compose base não fixa endereço:porta cru em serviço de cliente"
else
  falha "compose base fixa porta crua (soma com o overlay = duplicação)" "$(printf '%s' "$crua" | head -3 | tr '\n' ' ')"
fi

# ─── 3. Só é público o que NÃO passa pelo nginx ─────────────────────────────
# O Docker escreve DNAT avaliado ANTES do ufw: publicar em 0.0.0.0 aqui expõe
# de verdade, mesmo com o firewall fechado.
secao '3. Exposição declarada pelo instalador'

INSTALADOR="$RAIZ/scripts/install-drac.sh"
PERMITIDO_PUBLICO="DRAC_MEDIAMTX_WEBRTC_UDP_BIND"
indevidas=""
while read -r linha; do
  chave="$(printf '%s' "$linha" | sed -E 's/.*env_set "\$env_file" ([A-Z_]+) .*/\1/')"
  case " $PERMITIDO_PUBLICO " in
    *" $chave "*) continue ;;
  esac
  indevidas="$indevidas $chave"
done < <(grep -E 'env_set "\$env_file" DRAC_[A-Z_]*BIND "0\.0\.0\.0"' "$INSTALADOR" 2>/dev/null || true)

if [ -z "$indevidas" ]; then
  ok "instalador só publica $PERMITIDO_PUBLICO em 0.0.0.0"
else
  falha "instalador publicaria em 0.0.0.0:$indevidas" "esses serviços passam pelo nginx; devem ligar em 127.0.0.1"
fi

# ─── 4. Toda tabela do schema nasce de uma migração ─────────────────────────
secao '4. Migrações cobrem o schema'

SCHEMA="$RAIZ/apps/api/prisma/schema.prisma"
MIGRACOES="$RAIZ/apps/api/prisma/migrations"
if [ -f "$SCHEMA" ] && [ -d "$MIGRACOES" ]; then
  sql="$(cat "$MIGRACOES"/*/migration.sql 2>/dev/null)"
  ausentes=""
  while read -r modelo; do
    [ -n "$modelo" ] || continue
    # `<<<` em vez de `printf | grep`: com `pipefail`, o `grep -q` sai no
    # primeiro acerto, o `printf` leva SIGPIPE e o pipeline inteiro vira
    # não-zero — o teste acusava ausente justamente o model que casava CEDO.
    grep -qiE "CREATE[[:space:]]+TABLE[[:space:]]+(IF[[:space:]]+NOT[[:space:]]+EXISTS[[:space:]]+)?\"?${modelo}\"?" <<< "$sql" \
      || ausentes="$ausentes $modelo"
  done < <(grep -oE '^model[[:space:]]+[A-Za-z0-9_]+' "$SCHEMA" | awk '{print $2}')
  if [ -z "$ausentes" ]; then
    ok "toda tabela do schema tem CREATE TABLE em alguma migração"
  else
    falha "model(s) sem migração que crie a tabela:$ausentes" "numa base NOVA, migrate deploy diria 'up to date' e a tabela não existiria"
  fi
fi

# ─── 5. A Gateway pública é reproduzível e falha fechada ───────────────────
secao '5. Gateway pública reproduzível e fechada'

GATEWAY="$INFRA/gateway"
gateway_saida="$(docker compose -f "$GATEWAY/docker-compose.yml" config 2>&1)"
if [ $? -ne 0 ] || printf '%s' "$gateway_saida" | grep -qi 'error'; then
  falha "compose da Gateway inválido" "$(printf '%s' "$gateway_saida" | head -3)"
else
  ok "compose da Gateway validou"
fi

imagens_moveis="$(awk '/^[[:space:]]+image:/ { print $2 }' "$GATEWAY/docker-compose.yml" | grep -v '@sha256:' || true)"
if [ -z "$imagens_moveis" ]; then
  ok "imagens públicas fixadas por digest"
else
  falha "Gateway usa tag móvel" "uma recriação poderia trocar o binário sem revisão: $imagens_moveis"
fi

if [ -f "$GATEWAY/nginx/conf.d/gateway.conf" ] \
   && ! grep -Rqs 'tenant_backend\|proxy_pass[[:space:]]\+http://\$' "$GATEWAY/nginx"; then
  ok "tenant só é roteado por server_name explícito"
else
  falha "roteamento dinâmico ou configuração fora de conf.d" "Host desconhecido deve falhar fechado, sem escolher backend por variável"
fi

if [ ! -e "$GATEWAY/coturn/turnserver.conf" ] \
   && [ -f "$GATEWAY/coturn/turnserver.conf.example" ] \
   && grep -q '^coturn/turnserver.conf$' "$GATEWAY/.gitignore"; then
  ok "segredo TURN não está na árvore versionável"
else
  falha "segredo TURN pode ser versionado" "mantenha apenas turnserver.conf.example e ignore o arquivo real"
fi

# ─── 6. Central aceita agentes privados sem abrir o painel aos tenants ──────
secao '6. Fronteira privada da Central'

CENTRAL_NGINX="$INFRA/management/nginx/central.conf"
antes_do_primeiro_location="$(awk '/^[[:space:]]*location[[:space:]]/ { exit } { print }' "$CENTRAL_NGINX")"
if printf '%s\n' "$antes_do_primeiro_location" | grep -q 'deny all'; then
  falha "regra global bloqueia também os agentes" "controle de acesso deve ficar em cada location; o tenant precisa alcançar /api/agent/"
else
  ok "nenhum deny global intercepta os endpoints de agente"
fi

bloco_agente="$(awk '
  /location \^~ \/api\/agent\// { dentro=1 }
  dentro { print }
  dentro && /^[[:space:]]*}/ { exit }
' "$CENTRAL_NGINX")"
if printf '%s\n' "$bloco_agente" | grep -q 'allow 10\.10\.0\.0/24;' \
   && printf '%s\n' "$bloco_agente" | grep -q 'deny all;'; then
  ok "agentes da rede privada entram somente no endpoint autenticado"
else
  falha "location de agente sem ACL explícita" "permita 10.10.0.0/24 apenas em /api/agent/ e mantenha deny all"
fi

bloco_painel="$(awk '
  /^[[:space:]]*location \/ \{/ { dentro=1 }
  dentro { print }
  dentro && /^[[:space:]]*}/ { exit }
' "$CENTRAL_NGINX")"
if printf '%s\n' "$bloco_painel" | grep -q 'allow 10\.10\.0\.10;' \
   && printf '%s\n' "$bloco_painel" | grep -q 'allow 10\.10\.0\.11;' \
   && printf '%s\n' "$bloco_painel" | grep -q 'deny all;'; then
  ok "painel administrativo continua restrito à Gateway/Management"
else
  falha "painel da Central sem ACL fechada" "o location / não pode ficar acessível diretamente aos tenants"
fi

# ─── 7. Backup automático segue a política semanal ─────────────────────────
secao '7. Backup automático é semanal'

if grep -q '^POSTGRES_BACKUP_INTERVAL_SECONDS=604800$' "$ENV_EXEMPLO" \
   && grep -q '^CENTRAL_BACKUP_INTERVAL_SECONDS=604800$' "$ENV_EXEMPLO" \
   && grep -q '^OFFSITE_BACKUP_INTERVAL_SECONDS=604800$' "$ENV_EXEMPLO" \
   && grep -q 'BACKUP_UPLOAD_INTERVAL_SECONDS:-604800' "$INFRA/docker-compose.yml" \
   && grep -q 'BACKUP_INTERVAL_SECONDS:-604800' "$INFRA/management/docker-compose.yml"; then
  ok "banco local, Central, envio e cópia externa usam 604800s (7 dias)"
else
  falha "algum backup automático não usa a cadência semanal" "o padrão único deve ser 604800 segundos"
fi

# ─── 8. Healthchecks de mídia não geram clientes artificiais ────────────────
secao '8. Healthchecks cobrem a cadeia de mídia sem interferir nela'

if grep -qF "grep -Eq ':078F" "$INFRA/docker-compose.yml" \
   && ! grep -E 'healthcheck:|test:' -A6 "$INFRA/docker-compose.yml" | grep -qE 'nc -z 127\.0\.0\.1 1935|/dev/tcp/127\.0\.0\.1/1935'; then
  ok "SRS comprova o listener RTMP sem abrir publicação falsa"
else
  falha "healthcheck do SRS interfere na porta RTMP ou não a observa" "use /proc/net/tcp; conectar na 1935 polui sessões e métricas"
fi

if grep -qF 'for port in 078F 216A 270D 22B9' "$INFRA/docker-compose.yml" \
   && grep -qF '/proc/net/tcp /proc/net/tcp6' "$INFRA/docker-compose.yml"; then
  ok "MediaMTX comprova RTMP, RTSP, API e WebRTC sem gerar sessões"
else
  falha "healthcheck do MediaMTX cobre só parte do pipeline" "os quatro listeners críticos precisam ser observados sem conexões artificiais"
fi

printf '\n'
if [ "$falhas" -eq 0 ]; then
  printf '\033[1;32mChecks estáticos de infraestrutura: todos passaram.\033[0m\n\n'
  exit 0
fi
printf '\033[1;31m%s check(s) estático(s) FALHARAM.\033[0m\n\n' "$falhas"
exit 1

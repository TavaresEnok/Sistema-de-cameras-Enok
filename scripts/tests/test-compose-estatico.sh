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

printf '\n'
if [ "$falhas" -eq 0 ]; then
  printf '\033[1;32mChecks estáticos de infraestrutura: todos passaram.\033[0m\n\n'
  exit 0
fi
printf '\033[1;31m%s check(s) estático(s) FALHARAM.\033[0m\n\n' "$falhas"
exit 1

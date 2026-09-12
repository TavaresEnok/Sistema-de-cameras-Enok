#!/usr/bin/env bash
# ── TROCAR O IP PÚBLICO DE UMA INSTALAÇÃO ────────────────────────────────────
#
# Incidente Vibe (12/09/2026): a VM trocou de IP. Câmeras seguiram publicando,
# portas respondendo, watchdog "ok" — e TODO o ao vivo girando em "Conectando…".
# O .env continuava anunciando ao navegador o IP antigo
# (MEDIAMTX_WEBRTC_ADDITIONAL_HOST), único candidato WebRTC. O instalador grava
# esse valor uma vez e nada o atualizava.
#
# Troca o IP SÓ nas chaves que carregam o endereço público, mostra a diferença
# e, com --aplicar, faz backup e recria apenas o MediaMTX.
#
#   scripts/trocar-ip.sh 168.194.13.24 168.194.15.218            # só mostra
#   scripts/trocar-ip.sh 168.194.13.24 168.194.15.218 --aplicar  # grava e aplica
set -euo pipefail

ROOT_DIR="${DRAC_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
INFRA_DIR="$ROOT_DIR/infra"
ENV_FILE="$INFRA_DIR/.env"

# Lista FECHADA de propósito: o IP antigo pode aparecer legitimamente em outras
# chaves (CIDR de câmeras, por exemplo), e essas não são endereço público.
CHAVES="MEDIAMTX_WEBRTC_ADDITIONAL_HOST MEDIAMTX_WEBRTC_ALLOW_ORIGIN MEDIAMTX_HLS_ALLOW_ORIGIN
CORS_ALLOWED_ORIGINS MEDIAMTX_RTMP_SHORT_HOST MEDIAMTX_PUBLIC_HOST MEDIAMTX_PUBLIC_WEBRTC_URL
MEDIAMTX_PUBLIC_HLS_URL DRAC_PUBLIC_ORIGIN API_PUBLIC_URL"

uso() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
ipv4() { [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; }
env_val() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1 | sed 's/^"//; s/"$//'; }

[ $# -ge 2 ] || uso
ANTIGO="$1"
NOVO="$2"
APLICAR=false
if [ "${3:-}" = "--aplicar" ]; then APLICAR=true; fi
if ! ipv4 "$ANTIGO" || ! ipv4 "$NOVO"; then echo "ERRO: informe dois IPv4." >&2; exit 2; fi
if [ "$ANTIGO" = "$NOVO" ]; then echo "ERRO: os dois IPs são iguais." >&2; exit 2; fi
[ -f "$ENV_FILE" ] || { echo "ERRO: $ENV_FILE não existe." >&2; exit 1; }

antigo_re="${ANTIGO//./\\.}"
filtro="$(printf '%s\n' $CHAVES | paste -sd'|')"
# IP inteiro, nunca pedaço: 168.194.13.24 não pode virar parte de 168.194.13.240.
# A troca roda duas vezes porque o separador consumido por um acerto ("IP,IP")
# esconderia o vizinho na mesma passada.
troca="s/(^|[^0-9.])${antigo_re}([^0-9]|$)/\\1${NOVO}\\2/g"
novo_env="$(mktemp)"
trap 'rm -f "$novo_env"' EXIT
sed -E "/^(${filtro})=/ { ${troca}; ${troca}; }" "$ENV_FILE" > "$novo_env"

mudancas="$(diff "$ENV_FILE" "$novo_env" | grep -E '^[<>]' || true)"
if [ -z "$mudancas" ]; then
  echo "Nada a trocar: $ANTIGO não aparece nas chaves de endereço público."
  exit 0
fi
echo "Mudanças em $ENV_FILE:"
printf '%s\n' "$mudancas"
restantes="$(grep -nE "(^|[^0-9.])${antigo_re}([^0-9]|$)" "$novo_env" | sed -E 's/=.*/=…/' || true)"
if [ -n "$restantes" ]; then
  echo
  echo "ATENÇÃO: $ANTIGO continua em chaves fora da lista (revise à mão; valores ocultos):"
  printf '  %s\n' $restantes
fi

if [ "$APLICAR" != "true" ]; then
  echo
  echo "Simulação — nada foi gravado. Para gravar e aplicar:"
  echo "  $0 $ANTIGO $NOVO --aplicar"
  exit 0
fi

# Mesma escolha de arquivos da auto-cura do watchdog: recriar sem o overlay da
# Gateway tiraria o TURN de um MediaMTX que ainda atende sessões.
arquivos=(-f "$INFRA_DIR/docker-compose.yml" -f "$INFRA_DIR/docker-compose.prod.yml")
if [ "$(env_val DRAC_GATEWAY_MODE)" = "true" ] || [ -n "$(env_val MEDIAMTX_TURN_URL)" ]; then
  [ -f "$INFRA_DIR/docker-compose.gateway.yml" ] || {
    echo "ERRO: instalação Gateway sem docker-compose.gateway.yml; recusando recriar sem TURN." >&2
    exit 1
  }
  arquivos+=(-f "$INFRA_DIR/docker-compose.gateway.yml")
fi
if [ "$(env_val DRAC_GPU_ENABLED)" = "true" ] && [ -f "$INFRA_DIR/docker-compose.gpu.yml" ]; then
  arquivos+=(-f "$INFRA_DIR/docker-compose.gpu.yml")
fi

backup="$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"
cp -p "$ENV_FILE" "$backup"
# `cat >` e não `mv`: preserva dono e permissão (0600) do .env original.
cat "$novo_env" > "$ENV_FILE"
echo
echo "Backup: $backup"

echo "Recriando o MediaMTX (o ao vivo pisca ~10–30 s; as câmeras reconectam sozinhas)…"
COMPOSE_FILE="" docker compose --env-file "$ENV_FILE" "${arquivos[@]}" up -d --no-deps --force-recreate mediamtx

esperado="$(env_val MEDIAMTX_WEBRTC_ADDITIONAL_HOST)"
anunciado="$(docker inspect vms-mediamtx --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | sed -n 's/^MTX_WEBRTCADDITIONALHOSTS=//p' | tail -n1)"
if [ "$anunciado" != "$esperado" ]; then
  echo "ERRO: o MediaMTX anuncia '$anunciado', mas o .env pede '$esperado'." >&2
  exit 1
fi
echo "MediaMTX anunciando ao navegador: $anunciado"

cat <<EOF

Pendências que este script NÃO faz sozinho:
  · API: CORS_ALLOWED_ORIGINS só vale depois de recriar a API, o que custa
    alguns minutos sem gravação nas câmeras em modo movimento. Agende:
      COMPOSE_FILE="" docker compose --env-file infra/.env ${arquivos[*]} up -d --no-deps --force-recreate api
  · Gateway (outra VM): troque $ANTIGO por $NOVO no SRS (destination) e no
    nginx do tenant; rode nginx -t antes de recarregar.
  · Firewall, NAT ou DNS externos que ainda citem $ANTIGO.
EOF

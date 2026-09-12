#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# A troca de IP mexe SÓ no endereço público e recria SÓ o MediaMTX.
#
# Roda com um `docker` falso: nenhum container é tocado.
#
#   bash scripts/tests/test-trocar-ip.sh
# ════════════════════════════════════════════════════════════════════════════
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
falhas=0
ok()  { printf '  \033[1;32mok\033[0m      %s\n' "$1"; }
nok() { printf '  \033[1;31mFALHOU\033[0m  %s\n          %s\n' "$1" "$2"; falhas=$((falhas + 1)); }

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/infra" "$T/bin"
touch "$T/infra/docker-compose.yml" "$T/infra/docker-compose.prod.yml"
cat > "$T/infra/.env" <<'EOF'
CORS_ALLOWED_ORIGINS=https://vibe.s2cam.com.br,http://168.194.13.24:5173,http://168.194.13.24:3002
MEDIAMTX_WEBRTC_ALLOW_ORIGIN=https://vibe.s2cam.com.br,http://168.194.13.24:5173
MEDIAMTX_WEBRTC_ADDITIONAL_HOST=168.194.13.24,168.194.13.24
MEDIAMTX_RTMP_SHORT_HOST=168.194.13.240
DRAC_CAMERA_ALLOWED_CIDRS=168.194.13.24/32
POSTGRES_PASSWORD=segredo168.194.13.24
EOF

# docker falso: registra a chamada e, no inspect, devolve o que o .env pede.
cat > "$T/bin/docker" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$T/docker.log"
if [ "\$1" = "inspect" ]; then
  printf 'MTX_WEBRTCADDITIONALHOSTS=%s\n' "\$(sed -n 's/^MEDIAMTX_WEBRTC_ADDITIONAL_HOST=//p' "$T/infra/.env")"
fi
EOF
chmod +x "$T/bin/docker"
executar() { PATH="$T/bin:$PATH" DRAC_ROOT_DIR="$T" bash "$RAIZ/scripts/trocar-ip.sh" "$@"; }

printf '\n\033[1mTroca de IP público\033[0m\n'

antes="$(sha256sum < "$T/infra/.env")"
executar 168.194.13.24 168.194.15.218 >/dev/null 2>&1
if [ "$(sha256sum < "$T/infra/.env")" = "$antes" ] && [ ! -e "$T/docker.log" ]; then
  ok 'sem --aplicar só mostra: não grava nem recria'
else
  nok 'simulação é inofensiva' 'o .env mudou ou o docker foi chamado'
fi

saida="$(executar 168.194.13.24 168.194.15.218 --aplicar 2>&1)"
rc=$?
depois="$(cat "$T/infra/.env")"

if grep -qx 'MEDIAMTX_WEBRTC_ADDITIONAL_HOST=168.194.15.218,168.194.15.218' <<< "$depois" \
   && grep -qF 'http://168.194.15.218:5173,http://168.194.15.218:3002' <<< "$depois"; then
  ok 'troca o host anunciado e as origens, inclusive vizinhos na mesma linha'
else
  nok 'troca completa' "$(grep -E 'ADDITIONAL_HOST|CORS' <<< "$depois" | tr '\n' ' ')"
fi

if grep -qx 'MEDIAMTX_RTMP_SHORT_HOST=168.194.13.240' <<< "$depois"; then
  ok 'não confunde 168.194.13.24 com 168.194.13.240'
else
  nok 'troca só o IP inteiro' 'alterou um pedaço de outro IP'
fi

if grep -qx 'DRAC_CAMERA_ALLOWED_CIDRS=168.194.13.24/32' <<< "$depois" \
   && grep -qx 'POSTGRES_PASSWORD=segredo168.194.13.24' <<< "$depois"; then
  ok 'chaves fora da lista de endereço público ficam intactas'
else
  nok 'lista fechada de chaves' 'mexeu em chave que não é endereço público'
fi

if ls "$T/infra/".env.bak-* >/dev/null 2>&1; then
  ok 'faz backup do .env antes de gravar'
else
  nok 'backup' 'nenhum .env.bak-* foi criado'
fi

if [ "$rc" -eq 0 ] \
   && grep -qE 'compose .*up -d --no-deps --force-recreate mediamtx$' "$T/docker.log" \
   && ! grep -qE 'force-recreate .*api' "$T/docker.log"; then
  ok 'recria somente o MediaMTX e confere o host anunciado'
else
  nok 'recriação restrita ao MediaMTX' "rc=$rc; docker: $(tr '\n' ';' < "$T/docker.log")"
fi

if ! grep -qF 'segredo' <<< "$saida"; then
  ok 'não imprime valor de chave fora da lista'
else
  nok 'sem vazamento na saída' 'um valor de chave sensível apareceu no terminal'
fi

printf '\n'
if [ "$falhas" -eq 0 ]; then
  printf '\033[1;32mTroca de IP: todos os testes passaram.\033[0m\n\n'
  exit 0
fi
printf '\033[1;31m%s teste(s) da troca de IP falharam.\033[0m\n\n' "$falhas"
exit 1

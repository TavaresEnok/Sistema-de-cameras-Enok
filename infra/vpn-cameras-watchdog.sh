#!/usr/bin/env bash
# ── VIGIA DA VPN ATÉ AS CÂMERAS DO D-GUARDIAN ───────────────────────────────
#
# Prova o túnel PINGANDO O PEER — nunca "existe ppp0?".
#
# Medido na VM em 12/08/2026: o túnel subiu, as três câmeras responderam RTSP,
# e minutos depois a `ppp0` continuava de pé COM a rota 192.168.100.0/24
# enquanto o peer 192.168.100.168 estava mudo — nada passava. Pouco depois a
# interface sumiu sozinha. Um vigia que olha "a interface existe?" teria
# chamado o zumbi de saudável, e o cliente só descobriria ao precisar da imagem.
#
# Aqui a saúde é ALCANCE. Sem alcance, redisca. Roda por systemd timer.
set -uo pipefail

VPN=${VPN:-/usr/local/sbin/vpn-dguardian}
LOG=${LOG:-/var/log/vpn-cameras-watchdog.log}
diz() { echo "$(date '+%F %T') $*" >> "$LOG"; }

# O peer sai da própria ppp0 — nunca fixo. Se a interface não existe, não há
# peer, e isso já é "sem alcance" (o caso do túnel ausente).
peer_vivo() {
  local p
  p=$(ip -o addr show ppp0 2>/dev/null | grep -oP 'peer \K[0-9.]+' | head -1)
  [ -n "$p" ] || return 1
  ping -c 2 -W 3 "$p" >/dev/null 2>&1
}

if peer_vivo; then
  exit 0
fi

diz "sem alcance (peer mudo ou ppp0 ausente) — rediscando"
"$VPN" down >/dev/null 2>&1
sleep 3
"$VPN" up   >/dev/null 2>&1
sleep 12

if peer_vivo; then
  diz "recuperado"
  exit 0
fi

diz "FALHOU ao recuperar — provável gateway/IPsec do lado do cliente"
exit 1

#!/usr/bin/env bash
# ── DEIXA A VPN DO D-GUARDIAN DE PÉ PARA SEMPRE (com root, UMA vez) ──────────
#
# Roda NA VM do cliente, com sudo. Resolve os dois defeitos medidos em 12/08:
#   1. a VPN não sobe no boot;
#   2. e — pior — o túnel MORRE com a VM ligada, virando zumbi (ppp0 de pé,
#      peer mudo). Subir no boot não cobre isso; só um vigia de ALCANCE cobre.
#
# Instala:
#   · o vigia em /usr/local/sbin (testa o peer e redisca);
#   · timer systemd de 2min + serviço oneshot;
#   · autostart da VPN no boot;
#   · a regra de sudo NOPASSWD só para /usr/local/sbin/vpn-dguardian, para a
#     automação (e o Claude) operarem a VPN sem senha — nada além dela.
#
# Idempotente: rodar de novo só reafirma o estado. Uso:
#   sudo bash infra/instalar-vpn-persistente.sh [usuario-operador]
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "precisa de root: sudo bash $0"; exit 1; }

OPERADOR=${1:-${SUDO_USER:-dguardianajust}}
AQUI=$(cd "$(dirname "$0")" && pwd)
VPN=/usr/local/sbin/vpn-dguardian
VIGIA=/usr/local/sbin/vpn-cameras-watchdog

[ -x "$VPN" ] || { echo "ERRO: $VPN não existe — a VPN não foi instalada ainda"; exit 1; }

echo "→ instalando o vigia em $VIGIA"
install -m 0755 "$AQUI/vpn-cameras-watchdog.sh" "$VIGIA"

echo "→ serviço + timer do vigia (a cada 2 min)"
cat > /etc/systemd/system/vpn-cameras-watchdog.service <<UNIT
[Unit]
Description=Vigia de alcance da VPN ate as cameras do D-GUARDIAN
After=network-online.target
[Service]
Type=oneshot
ExecStart=$VIGIA
UNIT

cat > /etc/systemd/system/vpn-cameras-watchdog.timer <<UNIT
[Unit]
Description=Roda o vigia da VPN das cameras a cada 2 min
[Timer]
OnBootSec=90s
OnUnitActiveSec=120s
AccuracySec=15s
[Install]
WantedBy=timers.target
UNIT

echo "→ autostart da VPN no boot"
cat > /etc/systemd/system/vpn-dguardian.service <<UNIT
[Unit]
Description=Sobe a VPN L2TP/IPsec ate a LAN das cameras do D-GUARDIAN
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=$VPN up
ExecStop=$VPN down
[Install]
WantedBy=multi-user.target
UNIT

echo "→ regra de sudo (só a VPN, nada além)"
echo "$OPERADOR ALL=(root) NOPASSWD: $VPN" > /etc/sudoers.d/vpn-dguardian
chmod 440 /etc/sudoers.d/vpn-dguardian
visudo -cf /etc/sudoers.d/vpn-dguardian

systemctl daemon-reload
systemctl enable --now vpn-dguardian.service
systemctl enable --now vpn-cameras-watchdog.timer

echo
echo "── PRONTO. Estado agora: ──"
systemctl is-enabled vpn-dguardian.service vpn-cameras-watchdog.timer
sleep 12
PEER=$(ip -o addr show ppp0 2>/dev/null | grep -oP 'peer \K[0-9.]+' | head -1)
if [ -n "$PEER" ] && ping -c 2 -W 3 "$PEER" >/dev/null 2>&1; then
  echo "VPN de pé e com ALCANCE (peer $PEER responde) ✓"
else
  echo "VPN ainda sem alcance — o vigia vai insistir a cada 2 min; ver /var/log/vpn-cameras-watchdog.log"
fi
echo
echo "Rota padrao (tem de continuar por ens18, não pela VPN):"
ip route show default

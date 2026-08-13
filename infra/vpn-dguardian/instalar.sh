#!/usr/bin/env bash
# ── INSTALA (OU RESTAURA) A VPN DAS CÂMERAS DO D-GUARDIAN ───────────────────
#
# Este diretório existe porque, até 13/08/2026, tudo aqui vivia SÓ no host —
# uma reinstalação da VM perderia correções pagas com horas de cliente fora do
# ar (o vigia que media o cano em vez da água, a rota amarrada ao nome ppp0,
# o ipsec restart que matava o charon). Rode este script numa VM nova e o
# comportamento volta idêntico.
#
# O que ele NÃO faz: segredos. A senha L2TP e a PSK do IPsec não vivem no git.
# Os templates em etc/ têm placeholders __ASSIM__; o script instala config que
# não contém segredo, copia template quando o destino não existe, e AVISA o que
# ficou faltando preencher. Nunca sobrescreve um arquivo de segredo já vivo.
#
# Uso:  sudo ./instalar.sh
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "rode com sudo"; exit 1; }
cd "$(dirname "$0")"

echo "── pacotes necessários"
for p in strongswan xl2tpd ppp; do
  dpkg -s "$p" >/dev/null 2>&1 && echo "   ok      $p" || echo "   FALTA   $p  (apt install $p)"
done

echo "── scripts"
install -m 0755 -o root -g root vpn-dguardian        /usr/local/sbin/vpn-dguardian
install -m 0755 -o root -g root vpn-dguardian-watch  /usr/local/sbin/vpn-dguardian-watch
echo "   /usr/local/sbin/vpn-dguardian{,-watch}"

echo "── gancho do pppd (rota das câmeras em QUALQUER ppp que suba)"
install -d -m 0755 /etc/ppp/ip-up.d
install -m 0755 -o root -g root ppp/dguardian-rota /etc/ppp/ip-up.d/dguardian-rota
# O gancho antigo amarrado ao nome ppp0 não pode coexistir com o novo:
# duas fontes de verdade, uma delas errada.
rm -f /etc/ppp/ip-up.d/50-rota-cameras
echo "   /etc/ppp/ip-up.d/dguardian-rota"

echo "── unidades do systemd"
install -m 0644 -o root -g root systemd/vpn-dguardian.service       /etc/systemd/system/
install -m 0644 -o root -g root systemd/vpn-dguardian-watch.service /etc/systemd/system/
install -m 0644 -o root -g root systemd/vpn-dguardian-watch.timer   /etc/systemd/system/
systemctl daemon-reload
systemctl enable vpn-dguardian.service vpn-dguardian-watch.timer >/dev/null 2>&1
echo "   vpn-dguardian.service + vpn-dguardian-watch.timer (enabled)"

echo "── sudoers (operador chama o script sem senha, e SÓ ele)"
install -m 0440 -o root -g root sudoers-vpn-dguardian /etc/sudoers.d/vpn-dguardian
visudo -cf /etc/sudoers.d/vpn-dguardian >/dev/null || { echo "   sudoers INVÁLIDO — removendo"; rm -f /etc/sudoers.d/vpn-dguardian; exit 1; }
echo "   /etc/sudoers.d/vpn-dguardian"

echo "── configuração (sem segredos)"
install -m 0644 -o root -g root etc/ipsec.conf  /etc/ipsec.conf
install -m 0644 -o root -g root etc/xl2tpd.conf /etc/xl2tpd/xl2tpd.conf
echo "   /etc/ipsec.conf + /etc/xl2tpd/xl2tpd.conf"

echo "── configuração COM segredo (só se não existir; nunca sobrescreve)"
PENDENTES=()
if [ ! -f /etc/ppp/options.l2tpd.client ]; then
  install -m 0600 -o root -g root etc/options.l2tpd.client.template /etc/ppp/options.l2tpd.client
  PENDENTES+=("/etc/ppp/options.l2tpd.client  → trocar __SENHA_L2TP__")
else
  echo "   mantido /etc/ppp/options.l2tpd.client (já existia)"
fi
if [ ! -f /etc/ipsec.secrets ]; then
  install -m 0600 -o root -g root etc/ipsec.secrets.template /etc/ipsec.secrets
  PENDENTES+=("/etc/ipsec.secrets            → trocar __CHAVE_PRE_COMPARTILHADA__")
else
  echo "   mantido /etc/ipsec.secrets (já existia)"
fi
grep -rl "__SENHA_L2TP__" /etc/ppp/options.l2tpd.client >/dev/null 2>&1 \
  && PENDENTES+=("/etc/ppp/options.l2tpd.client  ainda com placeholder")
grep -rl "__CHAVE_PRE_COMPARTILHADA__" /etc/ipsec.secrets >/dev/null 2>&1 \
  && PENDENTES+=("/etc/ipsec.secrets            ainda com placeholder")

echo
if [ "${#PENDENTES[@]}" -gt 0 ]; then
  echo "⚠ SEGREDOS PENDENTES — o túnel NÃO sobe até preencher:"
  printf '   %s\n' "${PENDENTES[@]}"
  echo "   (valores no cofre; depois: sudo systemctl restart strongswan-starter xl2tpd && sudo vpn-dguardian up)"
else
  echo "✓ tudo instalado. Subir agora:  sudo vpn-dguardian up"
  echo "  conferir:                     sudo vpn-dguardian status"
fi

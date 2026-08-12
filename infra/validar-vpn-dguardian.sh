#!/usr/bin/env bash
# ── A VPN ATÉ AS CÂMERAS DO D-GUARDIAN ESTÁ DE PÉ AGORA? ────────────────────
#
# Roda DE FORA (deste host) e faz o diagnóstico DENTRO da VM do cliente por SSH.
# Existe porque a resposta certa não é "o túnel subiu": é "as câmeras respondem".
# O túnel pode subir e a rota não entrar, e aí tudo parece bem e nada funciona.
#
# Estado conhecido em 07/08/2026: IPsec fecha, L2TP/PPP é RECUSADO pelo MikroTik
# do cliente (E=691, "user Ajust authentication failed"). Se este script parar
# no passo 3, o problema continua sendo do lado deles — não nosso.
#
# Uso:  ./validar-vpn-dguardian.sh            # diagnostica e, se preciso, disca
#       ./validar-vpn-dguardian.sh --so-ver   # só lê o estado, não disca
set -uo pipefail

VM_HOST=${VM_HOST:-168.194.13.20}
VM_PORTA=${VM_PORTA:-2211}
VM_USUARIO=${VM_USUARIO:-dguardianajust}
CHAVE=${CHAVE:-$HOME/.ssh/id_ed25519_dguardian}
CAMERAS=(192.168.100.110 192.168.100.112 192.168.100.194)
SO_VER=0
[[ "${1:-}" == "--so-ver" ]] && SO_VER=1

ssh_vm() {
  ssh -p "$VM_PORTA" -i "$CHAVE" -o BatchMode=yes -o ConnectTimeout=10 \
      -o StrictHostKeyChecking=accept-new "$VM_USUARIO@$VM_HOST" "$@"
}

titulo() { printf '\n\033[1m── %s\033[0m\n' "$*"; }
ok()     { printf '   \033[32m✓\033[0m %s\n' "$*"; }
falha()  { printf '   \033[31m✗\033[0m %s\n' "$*"; }
nota()   { printf '     %s\n' "$*"; }

# ── 1. CHEGO NA VM? ─────────────────────────────────────────────────────────
titulo "1. Acesso à VM do cliente ($VM_HOST:$VM_PORTA)"
if ! ssh_vm 'echo ok' >/dev/null 2>&1; then
  falha "sem acesso por chave"
  nota "instale a pública uma vez:"
  nota "  ssh-copy-id -i ${CHAVE}.pub -p $VM_PORTA $VM_USUARIO@$VM_HOST"
  exit 1
fi
ok "conectado por chave (sem senha)"

# ── 2. O GATEWAY DELES ESTÁ VIVO? ───────────────────────────────────────────
# Medido daqui E de lá: se só um dos dois enxerga, o problema é de caminho de
# rede, não do serviço — distinção que muda completamente quem tem de agir.
titulo "2. Gateway VPN do cliente"
IP_VPN=$(getent hosts hf2099ybvj0.sn.mynetname.net | awk '{print $1}' | head -1)
if [[ -n "$IP_VPN" ]]; then
  ok "DDNS resolve para $IP_VPN"
  [[ "$IP_VPN" != "45.176.143.184" ]] && nota "ATENÇÃO: mudou (era 45.176.143.184) — reveja a config do strongSwan"
else
  falha "o DDNS hf2099ybvj0.sn.mynetname.net não resolve"
fi
if ssh_vm "ping -c 2 -W 3 ${IP_VPN:-45.176.143.184}" >/dev/null 2>&1; then
  ok "a VM alcança o gateway"
else
  falha "a VM NÃO alcança o gateway — problema de rede, nem chega a ser VPN"
fi

# ── 3. O TÚNEL ──────────────────────────────────────────────────────────────
titulo "3. Estado do túnel"
ESTADO=$(ssh_vm 'sudo -n /usr/local/sbin/vpn-dguardian status 2>&1' || true)
if grep -qi 'sudo: a password is required\|sudo: a senha' <<<"$ESTADO"; then
  falha "o sudo pede senha — não consigo operar a VPN"
  nota "libere SÓ este comando, uma vez, na VM:"
  nota "  echo '$VM_USUARIO ALL=(root) NOPASSWD: /usr/local/sbin/vpn-dguardian' | sudo tee /etc/sudoers.d/vpn-dguardian"
  nota "  sudo chmod 440 /etc/sudoers.d/vpn-dguardian"
  exit 1
fi
sed 's/^/     /' <<<"$ESTADO"

TEM_PPP=$(ssh_vm "ip -o addr show 2>/dev/null | grep -c ppp" || echo 0)
if [[ "${TEM_PPP:-0}" -gt 0 ]]; then
  ok "interface ppp presente — túnel JÁ está de pé"
elif [[ $SO_VER -eq 1 ]]; then
  falha "túnel abaixo (modo --so-ver: não vou discar)"
else
  nota "túnel abaixo — discando..."
  ssh_vm 'sudo -n /usr/local/sbin/vpn-dguardian up' 2>&1 | sed 's/^/     /'
  sleep 12
  TEM_PPP=$(ssh_vm "ip -o addr show 2>/dev/null | grep -c ppp" || echo 0)
  [[ "${TEM_PPP:-0}" -gt 0 ]] && ok "túnel SUBIU" || falha "o túnel não subiu"
fi

# ── 4. POR QUE NÃO SUBIU (a causa, não o sintoma) ───────────────────────────
if [[ "${TEM_PPP:-0}" -eq 0 ]]; then
  titulo "4. Causa provável"
  LOG=$(ssh_vm 'sudo -n tail -40 /var/log/syslog 2>/dev/null | grep -iE "pppd|xl2tpd|charon|l2tp" | tail -12' 2>/dev/null || true)
  sed 's/^/     /' <<<"${LOG:-  (sem log acessível)}"
  if grep -qiE 'E=691|authentication failed|bad username' <<<"$LOG"; then
    printf '\n   \033[31mVEREDITO: continua travado NO LADO DO CLIENTE.\033[0m\n'
    nota "O MikroTik recusa o PPP (E=691). IPsec fecha; usuário/senha já foram"
    nota "conferidos byte a byte. Pedir ao Arthur: PPP → Secrets com"
    nota "Service = l2tp (ou any) e o secret habilitado."
  elif grep -qiE 'no matching|NO_PROPOSAL|AUTHENTICATION_FAILED' <<<"$LOG"; then
    printf '\n   \033[31mVEREDITO: o IPsec parou de fechar — mudou config do lado deles.\033[0m\n'
  fi
  exit 2
fi

# ── 5. O QUE REALMENTE IMPORTA: AS CÂMERAS RESPONDEM? ───────────────────────
# Túnel de pé sem rota é o defeito silencioso clássico. A prova é a câmera.
titulo "5. Alcance das câmeras na LAN do cliente"
ssh_vm "ip route show | grep '192.168.100'" 2>/dev/null | sed 's/^/     rota: /' \
  || falha "NENHUMA rota para 192.168.100.0/24 — o túnel subiu mas não leva a lugar nenhum"

VIVAS=0
for cam in "${CAMERAS[@]}"; do
  if ssh_vm "ping -c 2 -W 3 $cam" >/dev/null 2>&1; then
    ok "$cam responde"
    VIVAS=$((VIVAS + 1))
    PORTAS=$(ssh_vm "for p in 554 80 8000; do timeout 3 bash -c '</dev/tcp/$cam/'\$p 2>/dev/null && echo -n \"\$p \"; done" 2>/dev/null || true)
    [[ -n "${PORTAS// }" ]] && nota "portas abertas: $PORTAS"
  else
    falha "$cam sem resposta"
  fi
done

# ── TRAVA DE SEGURANÇA QUE NÃO PODE SUMIR ───────────────────────────────────
# Sem `nodefaultroute` o túnel vira rota padrão e a VM perde o SSH 2211 e o
# HTTPS — ou seja, o cliente fica sem sistema para ganhar acesso às câmeras.
titulo "Trava: o túnel não pode virar rota padrão"
if ssh_vm "grep -q '^nodefaultroute' /etc/ppp/options.l2tpd.client" 2>/dev/null; then
  ok "nodefaultroute presente"
else
  falha "nodefaultroute AUSENTE — risco de a VM perder SSH/HTTPS ao discar"
fi

printf '\n\033[1mRESULTADO: %d de %d câmeras alcançáveis pela VPN.\033[0m\n' "$VIVAS" "${#CAMERAS[@]}"
[[ $VIVAS -gt 0 ]] && exit 0 || exit 3

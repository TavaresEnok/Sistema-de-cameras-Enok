#!/usr/bin/env bash
# ── APLICA O TÚNEL ATÉ AS CÂMERAS DO CLIENTE ────────────────────────────────
#
# Lê o perfil que a Central entregou (guardado pela API em `cloud.vpn`) e monta
# o túnel. Roda no HOST, com privilégio, porque mexe em rota — a API, que vive
# em contêiner, não tem nem deve ter esse poder.
#
# Generaliza o que o D-GUARDIAN fazia à mão em infra/vpn-dguardian/, e carrega
# as mesmas cicatrizes:
#
#   · A ROTA NUNCA É AMARRADA AO NOME DA INTERFACE. Em 13/08/2026 o túnel
#     reconectou como `ppp1` em vez de `ppp0`, o gancho de rota estava preso ao
#     nome, e o cliente ficou 8 HORAS sem gravar com tudo "verde".
#   · A PROVA DE VIDA É CÂMERA, NUNCA O TÚNEL. A ponta do túnel responde
#     sempre; foi acreditar nela que escondeu aquelas 8 horas.
#   · NUNCA ROTA PADRÃO. Só as faixas declaradas entram. Um perfil pedindo
#     0.0.0.0/0 jogaria todo o tráfego do servidor para dentro da rede do
#     cliente: o painel some do endereço público e todos perdem acesso — nós
#     inclusive. Recusado na Central, recusado no conector e recusado aqui:
#     três vezes, porque trava de um lado só é trava que um dia não existe.
#
# Uso:
#   sudo bash aplicar-vpn.sh aplicar   # monta a partir do perfil guardado
#   sudo bash aplicar-vpn.sh estado    # diz se o túnel serve, provando câmera
#   sudo bash aplicar-vpn.sh desmontar # derruba e limpa as rotas
set -Eeuo pipefail

DRAC_DIR="${DRAC_DIR:-/opt/drac}"
PERFIL_JSON="${PERFIL_JSON:-}"

log()  { printf '\033[1;36m[VPN]\033[0m %s\n' "$*"; }
erro() { printf '\033[1;31m[VPN]\033[0m %s\n' "$*" >&2; exit 1; }

# ── Lê o perfil do banco da instalação ──────────────────────────────────────
ler_perfil() {
  [ -n "$PERFIL_JSON" ] && { printf '%s' "$PERFIL_JSON"; return; }
  docker exec vms-postgres psql -U vms -d vms_db -tAc \
    "select value from \"SystemSetting\" where key='cloud.vpn'" 2>/dev/null | tr -d '\n'
}

campo() { printf '%s' "$1" | python3 -c "import sys,json;d=json.load(sys.stdin) or {};v=d.get('$2');print(','.join(v) if isinstance(v,list) else (v or ''))" 2>/dev/null; }

# ── A trava: nenhuma faixa pode virar rota padrão ───────────────────────────
recusa_rota_padrao() {
  local faixas="$1"
  for f in ${faixas//,/ }; do
    case "$f" in
      0.0.0.0/0|0.0.0.0/1|128.0.0.0/1|::/0)
        erro "RECUSADO: a faixa '$f' jogaria TODO o tráfego deste servidor para dentro da rede do cliente.
  O painel deixaria de responder no endereço público e o acesso seria perdido dos dois lados.
  Declare apenas as faixas das câmeras."
        ;;
    esac
  done
}

# ── Rota pela faixa, achando a interface pelo IP do par ─────────────────────
# Nunca por nome: o kernel sorteia ppp0/ppp1/wg0 e o nome muda entre reconexões.
por_rota() {
  local faixas="$1" par="$2"
  for f in ${faixas//,/ }; do
    ip route replace "$f" via "$par" 2>/dev/null \
      || ip route replace "$f" dev "$(ip -o route get "$par" | awk '{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1)}')" 2>/dev/null \
      || log "aviso: não consegui instalar a rota de $f"
  done
}

# ── A prova de vida: uma CÂMERA responde ────────────────────────────────────
alcanca_camera() {
  local cameras="$1"
  for c in ${cameras//,/ }; do
    ping -c1 -W3 "$c" >/dev/null 2>&1 && return 0
    # Câmera que não responde a ping ainda pode servir RTSP.
    timeout 4 bash -c "cat < /dev/null > /dev/tcp/$c/554" 2>/dev/null && return 0
  done
  return 1
}

acao="${1:-estado}"
perfil="$(ler_perfil)"

if [ -z "$perfil" ] || [ "$perfil" = "null" ]; then
  [ "$acao" = "desmontar" ] && { log "sem perfil; nada a desmontar"; exit 0; }
  log "Nenhuma VPN configurada na Central para esta instalação."
  exit 0
fi

tipo="$(campo "$perfil" tipo)"
servidor="$(campo "$perfil" servidor)"
faixas="$(campo "$perfil" faixas)"
cameras="$(campo "$perfil" cameras)"
[ -n "$tipo" ] || erro "perfil sem tipo"
[ -n "$faixas" ] || erro "perfil sem faixa de câmeras: o túnel não teria o que rotear"
[ -n "$cameras" ] || erro "perfil sem endereço de câmera: sem isso não há como provar que o túnel serve"
recusa_rota_padrao "$faixas"

case "$acao" in
  estado)
    if alcanca_camera "$cameras"; then
      log "TÚNEL SERVINDO — uma câmera respondeu ($tipo → $servidor)"
      exit 0
    fi
    erro "TÚNEL NÃO SERVE: nenhuma câmera de '$cameras' respondeu.
  O túnel pode até estar de pé — o que importa é a câmera, e ela não está sendo alcançada."
    ;;
  desmontar)
    log "Desmontando o túnel e removendo as rotas"
    for f in ${faixas//,/ }; do ip route del "$f" 2>/dev/null || true; done
    case "$tipo" in
      wireguard)  wg-quick down drac-vpn 2>/dev/null || true ;;
      l2tp-ipsec) systemctl stop xl2tpd 2>/dev/null || true; ipsec down drac-vpn 2>/dev/null || true ;;
      openvpn)    systemctl stop openvpn@drac-vpn 2>/dev/null || true ;;
    esac
    log "desmontado"
    ;;
  aplicar)
    log "Aplicando perfil '$tipo' para $servidor (faixas: $faixas)"
    case "$tipo" in
      wireguard)
        command -v wg-quick >/dev/null || erro "wireguard não instalado neste host (apt install wireguard)"
        wg-quick down drac-vpn 2>/dev/null || true
        wg-quick up drac-vpn || erro "wg-quick falhou; confira /etc/wireguard/drac-vpn.conf"
        par="$(wg show drac-vpn endpoints 2>/dev/null | awk '{print $2}' | cut -d: -f1 | head -1)"
        ;;
      l2tp-ipsec|openvpn)
        erro "'$tipo' ainda precisa dos arquivos de configuração no host.
  O L2TP do D-GUARDIAN continua em infra/vpn-dguardian/ e segue funcionando.
  Este script já entrega estado e desmontagem para os três tipos."
        ;;
    esac
    [ -n "${par:-}" ] && por_rota "$faixas" "$par"
    sleep 3
    if alcanca_camera "$cameras"; then
      log "TÚNEL SERVINDO — câmera respondeu"
    else
      erro "o túnel subiu mas NENHUMA câmera respondeu. Confira as faixas e os endereços do perfil."
    fi
    ;;
  *) erro "uso: $0 {aplicar|estado|desmontar}" ;;
esac

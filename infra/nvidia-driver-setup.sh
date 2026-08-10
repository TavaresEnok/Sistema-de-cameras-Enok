#!/usr/bin/env bash
# ============================================================================
# DRAC VMS — Instalação do driver NVIDIA no HOST (passo de sistema)
#
# Roda UMA vez, com sudo, no servidor que ganhou uma placa NVIDIA. Depois deste
# script + UM reboot, `gpu-setup.sh` liga o toolkit e a stack com GPU.
#
#   sudo bash infra/nvidia-driver-setup.sh          # instala e PEDE reboot
#   sudo bash infra/nvidia-driver-setup.sh --reboot # instala e reinicia sozinho
#
# POR QUE UM SCRIPT PRÓPRIO, e não `ubuntu-drivers autoinstall`:
#   As placas Blackwell (RTX 50 / linha GB20x, ex.: device 10de:2d04) SÓ
#   funcionam com o KERNEL MODULE ABERTO (pacotes `-open`). O `autoinstall`
#   pode escolher um driver "fechado" mais antigo que instala sem erro e
#   simplesmente NÃO liga a placa. Aqui forçamos a variante `-open`.
#
# O QUE ELE FAZ:
#   1) confere que há uma NVIDIA e que o SO é Ubuntu/Debian;
#   2) instala os headers do kernel atual (DKMS precisa deles);
#   3) tira o nouveau da frente (blacklist) — o driver proprietário não sobe com
#      o nouveau segurando a placa;
#   4) instala o driver `-open` mais novo disponível (ou o que você passar em
#      DRAC_NVIDIA_DRIVER=nvidia-driver-580-open);
#   5) NÃO reinicia sozinho (a menos que --reboot): num servidor de produção o
#      reboot para a gravação, e a hora é decisão de quem opera.
# ============================================================================
set -euo pipefail

REBOOT=0
[[ "${1:-}" == "--reboot" ]] && REBOOT=1

say()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "Rode com sudo: sudo bash infra/nvidia-driver-setup.sh"
command -v apt-get >/dev/null 2>&1 || die "Suportado em Ubuntu/Debian. Em outro SO, instale o driver -open à mão."

# ── 1. Há uma NVIDIA? ───────────────────────────────────────────────────────
say "1/5 Procurando a placa NVIDIA…"
if ! lspci -nn 2>/dev/null | grep -qiE "10de:.*(VGA|3D|Display)|NVIDIA"; then
  die "Nenhuma GPU NVIDIA encontrada no barramento PCI. A placa está passada para esta VM?"
fi
GPU_LINE="$(lspci -nn | grep -iE "NVIDIA" | head -1)"
ok "Encontrada: ${GPU_LINE}"

if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
  ok "O driver JÁ está funcionando (nvidia-smi responde). Nada a fazer."
  nvidia-smi --query-gpu=name,driver_version --format=csv,noheader || true
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive

# ── 2. Headers do kernel (DKMS) ─────────────────────────────────────────────
say "2/5 Instalando headers do kernel $(uname -r)…"
apt-get update -qq
apt-get install -y "linux-headers-$(uname -r)" build-essential dkms pciutils >/dev/null
ok "Headers presentes."

# ── 3. Tirar o nouveau da frente ────────────────────────────────────────────
say "3/5 Bloqueando o driver nouveau…"
cat > /etc/modprobe.d/blacklist-nouveau.conf <<'EOF'
blacklist nouveau
options nouveau modeset=0
EOF
# Regenera o initramfs para o nouveau não subir no próximo boot.
update-initramfs -u >/dev/null 2>&1 || warn "update-initramfs falhou; o blacklist ainda vale no próximo boot."
ok "nouveau bloqueado (efetivo após o reboot)."

# ── 4. Instalar o driver -open ──────────────────────────────────────────────
say "4/5 Instalando o driver NVIDIA (kernel aberto, exigido por Blackwell)…"
DRIVER="${DRAC_NVIDIA_DRIVER:-}"
if [[ -z "$DRIVER" ]]; then
  # Escolhe o -open de maior versão que o apt oferece (ex.: nvidia-driver-580-open).
  DRIVER="$(apt-cache search '^nvidia-driver-[0-9]+-open$' 2>/dev/null \
    | grep -oE 'nvidia-driver-[0-9]+-open' | sort -t- -k3 -n | tail -1)"
fi
[[ -n "$DRIVER" ]] || die "Não achei um pacote nvidia-driver-*-open no apt. Adicione o repositório graphics-drivers ou informe DRAC_NVIDIA_DRIVER."
say "Pacote escolhido: $DRIVER"
apt-get install -y "$DRIVER" || die "Falha ao instalar $DRIVER. Veja o log do apt acima."
ok "Driver instalado: $DRIVER."

# ── 5. Reboot (a peça que só o dono decide) ─────────────────────────────────
say "5/5 Quase lá."
cat <<EOF

============================================================
  Driver instalado. Falta UM reboot para a placa ligar.

  ATENÇÃO: reiniciar o servidor PARA a gravação de todas as
  câmeras por alguns minutos. Escolha a hora.

  Depois do reboot, confirme e ligue a stack com GPU:
    nvidia-smi                       # deve listar a placa
    bash infra/gpu-setup.sh --install-toolkit
============================================================
EOF

if [[ "$REBOOT" == "1" ]]; then
  warn "Reiniciando em 10s (--reboot). Ctrl-C para abortar."
  sleep 10
  reboot
fi

#!/usr/bin/env bash
# ============================================================================
# DRAC VMS — Ativação de GPU (turnkey)
#
# Roda UMA vez no servidor que tem placa NVIDIA. Faz tudo sozinho:
#   1) confere o driver da GPU (nvidia-smi no host)
#   2) confere se o Docker enxerga a GPU (NVIDIA Container Toolkit)
#      - se faltar e for Ubuntu/Debian, pode instalar com:  ./gpu-setup.sh --install-toolkit
#   3) constrói a imagem do MediaMTX com ffmpeg NVENC e sobe a stack com GPU
#   4) verifica se o NVENC ficou disponível e mostra o resultado
#
# Depois disso, é só ir em Configurações → GPU / Aceleração e clicar em "Ativar".
# Nada aqui precisa de desenvolvedor: é o operador do servidor rodando um comando.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")"

# Overlay de ambiente: prod por padrão (é o que roda num servidor real). Use
# DRAC_ENV=dev na máquina de desenvolvimento.
ENV_OVERLAY="docker-compose.prod.yml"
[[ "${DRAC_ENV:-prod}" == "dev" ]] && ENV_OVERLAY="docker-compose.dev.yml"
COMPOSE=(docker compose -f docker-compose.yml -f "$ENV_OVERLAY" -f docker-compose.gpu.yml)
CUDA_TEST_IMAGE="nvidia/cuda:12.4.1-base-ubuntu22.04"
INSTALL_TOOLKIT=0
[[ "${1:-}" == "--install-toolkit" ]] && INSTALL_TOOLKIT=1

say()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

# ── 1. Driver da GPU no host ────────────────────────────────────────────────
say "1/4 Verificando driver da GPU no host…"
if ! command -v nvidia-smi >/dev/null 2>&1; then
  die "nvidia-smi não encontrado. Instale o driver NVIDIA no host antes de continuar
   (ex.: 'sudo ubuntu-drivers autoinstall' e reinicie). Este passo é do sistema
   operacional — nenhum app web pode/deve instalar driver de kernel."
fi
nvidia-smi --query-gpu=name,driver_version --format=csv,noheader || die "nvidia-smi falhou."
ok "Driver da GPU OK."

# ── 2. Docker enxerga a GPU? (NVIDIA Container Toolkit) ──────────────────────
say "2/4 Verificando acesso do Docker à GPU…"
if docker run --rm --gpus all "$CUDA_TEST_IMAGE" nvidia-smi >/dev/null 2>&1; then
  ok "Docker consegue usar a GPU (NVIDIA Container Toolkit presente)."
else
  warn "Docker ainda não enxerga a GPU (NVIDIA Container Toolkit ausente ou não configurado)."
  if [[ "$INSTALL_TOOLKIT" == "1" ]]; then
    command -v apt-get >/dev/null 2>&1 || die "Auto-instalação só suportada em Ubuntu/Debian. Instale o toolkit manualmente:
   https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html"
    say "Instalando NVIDIA Container Toolkit (requer sudo)…"
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
    curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
      | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
      | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list >/dev/null
    sudo apt-get update
    sudo apt-get install -y nvidia-container-toolkit
    sudo nvidia-ctk runtime configure --runtime=docker
    sudo systemctl restart docker
    docker run --rm --gpus all "$CUDA_TEST_IMAGE" nvidia-smi >/dev/null 2>&1 \
      && ok "Toolkit instalado e funcionando." \
      || die "Toolkit instalado mas o Docker ainda não usa a GPU. Verifique a configuração do daemon."
  else
    die "Instale o NVIDIA Container Toolkit e rode de novo, OU rode:  ./gpu-setup.sh --install-toolkit
   Docs: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html"
  fi
fi

# ── 3. Build da imagem NVENC + subir a stack com GPU ────────────────────────
say "3/4 Construindo a imagem do MediaMTX com NVENC e subindo a stack…"
"${COMPOSE[@]}" up -d --build
ok "Stack no ar com o override de GPU."

# ── 4. Verificação do NVENC no pipeline de transcode ────────────────────────
say "4/4 Verificando NVENC no ffmpeg do MediaMTX…"
if docker run --rm --entrypoint ffmpeg drac-mediamtx-nvenc:local -hide_banner -encoders 2>/dev/null | grep -q nvenc; then
  ok "ffmpeg do MediaMTX tem NVENC (h264_nvenc disponível)."
else
  warn "Não consegui confirmar NVENC na imagem. Verifique se a imagem foi construída corretamente."
fi

cat <<'EOF'

============================================================
  GPU pronta. Próximo e único passo (sem terminal):
  → Abra o sistema em Configurações → "GPU / Aceleração"
  → Rode o auto-teste e clique em "Ativar".
  O transcode passa de CPU (libx264) para GPU (h264_nvenc).
============================================================
EOF

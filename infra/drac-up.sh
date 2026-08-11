#!/usr/bin/env bash
# ── SUBIR O DRAC ESCOLHENDO OS OVERLAYS PELA REALIDADE DO HOST ──────────────
#
# Existe por causa de um incidente real (11/08/2026, 14 h de produção fora):
# o `docker-compose.gpu.yml` estava FIXO no COMPOSE_FILE do host. A VM voltou de
# um reboot sem a placa (o passthrough não reatachou) e o nvidia-container-runtime
# abortou a criação dos containers:
#
#   OCI runtime create failed: ... failed to initialize NVML: Driver Not Loaded
#
# Não caiu só a aceleração: caiu o sistema TODO — banco, web, API, gravação —
# e ficou caído a noite inteira, porque nada sabia voltar sem a GPU.
#
# A lição: a presença da GPU é uma condição de AMBIENTE, que muda sem aviso
# (reboot, passthrough, placa arrancada). Ela não pode estar cozinhada num
# arquivo de configuração estático. Este script decide na hora de subir.
#
# Uso:
#   ./drac-up.sh              # sobe com o que houver (GPU se existir)
#   ./drac-up.sh --sem-gpu    # força CPU, ignorando a placa
#   ./drac-up.sh --build      # repassa flags extras ao docker compose
set -euo pipefail

cd "$(dirname "$0")"

FORCAR_CPU=0
EXTRA=()
for arg in "$@"; do
  case "$arg" in
    --sem-gpu|--no-gpu) FORCAR_CPU=1 ;;
    *) EXTRA+=("$arg") ;;
  esac
done

# ── A GPU está REALMENTE utilizável? ────────────────────────────────────────
# Três provas, porque cada uma sozinha mente:
#   1. o device node existe          → a placa foi entregue a esta máquina;
#   2. `nvidia-smi` responde         → o driver está carregado (não basta o
#                                      pacote instalado: depois de um reboot o
#                                      módulo pode simplesmente não subir);
#   3. um container consegue usá-la  → o runtime/toolkit está sadio. É a única
#                                      prova que cobre o erro que nos derrubou,
#                                      que acontecia na CRIAÇÃO do container.
gpu_utilizavel() {
  [ -e /dev/nvidia0 ] || return 1
  nvidia-smi -L >/dev/null 2>&1 || return 1
  # `--entrypoint` é obrigatório: imagens de serviço (MediaMTX) têm entrypoint
  # próprio e engoliriam o `nvidia-smi` como argumento — o teste passaria a
  # medir o help do MediaMTX em vez da GPU (erro cometido na 1ª versão daqui).
  timeout 60 docker run --rm --runtime=nvidia --entrypoint nvidia-smi \
    -e NVIDIA_VISIBLE_DEVICES=all "$IMAGEM_TESTE" -L >/dev/null 2>&1 || return 1
  return 0
}

# Imagem já presente no host (não baixa nada durante um boot possivelmente
# offline). Uma imagem-base é preferida à de serviço: menos entrypoint no
# caminho, menos chance do teste medir a coisa errada.
IMAGEM_TESTE="$(docker images --format '{{.Repository}}:{{.Tag}}' \
  | grep -E '^(ubuntu|debian|alpine):' | head -n1 || true)"
[ -n "$IMAGEM_TESTE" ] || IMAGEM_TESTE="$(docker images --format '{{.Repository}}:{{.Tag}}' \
  | grep -E '^drac-mediamtx-nvenc:' | head -n1 || true)"
[ -n "$IMAGEM_TESTE" ] || IMAGEM_TESTE="ubuntu:24.04"

ARQUIVOS=(-f docker-compose.yml)
[ -f docker-compose.prod.yml ] && ARQUIVOS+=(-f docker-compose.prod.yml)

MODO="CPU"
if [ "$FORCAR_CPU" = "1" ]; then
  MODO="CPU (forçado por --sem-gpu)"
elif gpu_utilizavel; then
  ARQUIVOS+=(-f docker-compose.gpu.yml)
  MODO="GPU ($(nvidia-smi --query-gpu=name --format=csv,noheader | head -n1))"
fi

echo "── DRAC: subindo em modo $MODO"
echo "   overlays: ${ARQUIVOS[*]}"

# COMPOSE_FILE do .env é ignorado de propósito: os -f explícitos mandam. Se ele
# tiver o gpu.yml fixo, é exatamente o defeito que este script existe para
# neutralizar.
COMPOSE_FILE="" docker compose "${ARQUIVOS[@]}" up -d "${EXTRA[@]}"

echo "── DRAC no ar em modo $MODO"

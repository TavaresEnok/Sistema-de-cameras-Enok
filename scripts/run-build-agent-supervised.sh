#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="${DRAC_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${BUILD_AGENT_ENV_FILE:-$ROOT_DIR/infra/build-agent.env}"
AGENT="$ROOT_DIR/apps/mobile/scripts/build-agent.mjs"
LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/drac-build-agent.lock"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

if [ ! -r "$ENV_FILE" ]; then
  logger -t drac-build-agent "arquivo de ambiente ausente: $ENV_FILE"
  exit 1
fi

set -a
# O arquivo é gerado localmente e possui somente atribuições shell (modo 600).
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

export BUILD_AGENT_HOST="${BUILD_AGENT_HOST:-172.17.0.1}"
export BUILD_AGENT_PORT="${BUILD_AGENT_PORT:-8780}"
export PUBLIC_APK_BASE="${PUBLIC_APK_BASE:-https://s2cam.com.br}"
export MIN_FREE_GB="${MIN_FREE_GB:-6}"
export JAVA_HOME="${JAVA_HOME:-/home/flashnet/toolchain/jdk-17.0.19+10}"
export ANDROID_HOME="${ANDROID_HOME:-/home/flashnet/toolchain/android-sdk}"
export PATH="$JAVA_HOME/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

cd "$ROOT_DIR/apps/mobile"
while true; do
  /usr/local/bin/node "$AGENT" 2>&1 | logger -t drac-build-agent
  status=${PIPESTATUS[0]}
  logger -t drac-build-agent "agente encerrou status=$status; reiniciando em 5s"
  sleep 5
done

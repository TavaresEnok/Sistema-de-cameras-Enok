#!/usr/bin/env bash
# Instala o compilador de APKs na VM Management.  A Central o alcança somente
# pela bridge Docker (172.17.0.1); a porta 8780 não recebe DNAT público.
set -euo pipefail

ROOT_DIR="${S2CAM_ROOT_DIR:-/opt/ajustcam-management/repo}"
RUN_AS="${S2CAM_BUILD_USER:-management}"
ANDROID_HOME="${ANDROID_HOME:-/home/${RUN_AS}/toolchain/android-sdk}"
ENV_FILE="$ROOT_DIR/infra/management/build-agent.env"
UNIT_SRC="$ROOT_DIR/infra/management/systemd/s2cam-mobile-build-agent.service"
UNIT_DST="/etc/systemd/system/s2cam-mobile-build-agent.service"
SDK_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"

[ "$(id -u)" = 0 ] || { echo 'execute como root'; exit 1; }
[ -d "$ROOT_DIR/apps/mobile" ] || { echo "repositório ausente: $ROOT_DIR"; exit 1; }
[ -n "${BUILD_AGENT_TOKEN:-}" ] || { echo 'BUILD_AGENT_TOKEN é obrigatório'; exit 1; }

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  ca-certificates curl ffmpeg git openjdk-17-jdk-headless nodejs npm unzip

command -v corepack >/dev/null 2>&1 || npm install -g corepack@0.31.0
corepack enable

install -d -o "$RUN_AS" -g "$RUN_AS" -m 0700 \
  "$(dirname "$ANDROID_HOME")" "$ROOT_DIR/infra/management/apk"
if [ ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]; then
  stage="$(mktemp -d)"
  trap 'rm -rf "$stage"' EXIT
  curl -fsSL "$SDK_URL" -o "$stage/commandline-tools.zip"
  unzip -q "$stage/commandline-tools.zip" -d "$stage"
  install -d -o "$RUN_AS" -g "$RUN_AS" "$ANDROID_HOME/cmdline-tools"
  rm -rf "$ANDROID_HOME/cmdline-tools/latest"
  mv "$stage/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
  chown -R "$RUN_AS:$RUN_AS" "$ANDROID_HOME"
fi

export ANDROID_HOME JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:$PATH"
yes | sdkmanager --licenses >/dev/null
sdkmanager 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0' 'cmake;3.22.1' 'ndk;27.1.12297006'

# O agente escreve apenas nas áreas geradas por cliente/build; o código fica
# controlado pelo Git e não é aberto para escrita desnecessariamente.
install -d -o "$RUN_AS" -g "$RUN_AS" \
  "$ROOT_DIR/apps/mobile/clients" "$ROOT_DIR/apps/mobile/builds" \
  "$ROOT_DIR/infra/management/apk"
chown -R "$RUN_AS:$RUN_AS" "$ROOT_DIR/apps/mobile/clients" "$ROOT_DIR/apps/mobile/builds" "$ROOT_DIR/infra/management/apk"

runuser -u "$RUN_AS" -- env HOME="/home/$RUN_AS" COREPACK_HOME="/home/$RUN_AS/.cache/corepack" \
  bash -lc "cd '$ROOT_DIR' && corepack pnpm --filter mobile... install --frozen-lockfile"

umask 077
printf 'BUILD_AGENT_TOKEN=%s\nPUBLIC_APK_BASE=https://s2cam.com.br\nMIN_FREE_GB=10\n' "$BUILD_AGENT_TOKEN" > "$ENV_FILE"
chown "$RUN_AS:$RUN_AS" "$ENV_FILE"
chmod 0600 "$ENV_FILE"
install -m 0644 "$UNIT_SRC" "$UNIT_DST"
systemctl daemon-reload
systemctl enable --now s2cam-mobile-build-agent.service
systemctl --no-pager --full status s2cam-mobile-build-agent.service

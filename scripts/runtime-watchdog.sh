#!/usr/bin/env bash
# DRAC runtime watchdog — saúde de INFRA (para o dono/operador da Central, não para o
# cliente final). Roda a cada poucos minutos (cron/systemd). Faz 3 coisas:
#   1) DETECTA problemas técnicos (container morto, /live 502, disco cheio, backup velho…).
#   2) AUTO-CURA o que dá pra curar sozinho (ex.: religar as portas do MediaMTX que já
#      derrubaram o /live inteiro uma vez — nginx batia em porta morta → 502).
#   3) ALERTA você quando algo degrada e a auto-cura não resolveu (Telegram/webhook), só
#      na MUDANÇA de estado (nada de spam). Sem canal configurado, cai no journal + arquivo.
set -uo pipefail

ROOT_DIR="${DRAC_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
INFRA_DIR="$ROOT_DIR/infra"
STATE_DIR="$INFRA_DIR/storage/.monitor"
STATUS_FILE="$STATE_DIR/runtime-status.json"
HASH_FILE="$STATE_DIR/runtime-status.sha256"
# `storage` costuma pertencer ao root (os containers o criam), enquanto o
# watchdog roda como usuário operador. Sem isto, o mkdir falha em silêncio e o
# serviço morre em "No such file or directory" no primeiro disparo — foi o que
# aconteceu na instalação do D-GUARDIAN.
if ! mkdir -p "$STATE_DIR" 2>/dev/null; then
  sudo -n mkdir -p "$STATE_DIR" 2>/dev/null || true
  sudo -n chown "$(id -u):$(id -g)" "$STATE_DIR" 2>/dev/null || true
fi
[ -w "$STATE_DIR" ] || { echo "drac-watchdog: sem permissão de escrita em $STATE_DIR" >&2; exit 1; }
# O lock antigo ficava em /tmp. Em hosts com fs.protected_regular=2, uma
# execução administrativa como root não pode reabrir o arquivo criado pelo
# usuário do serviço dentro do diretório sticky, resultando em "Permission
# denied". Mantê-lo junto ao estado também evita colisão entre instalações.
LOCK_FILE="$STATE_DIR/runtime-watchdog.lock"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

# Config de alerta: lida do ambiente OU do infra/.env (sem exigir export manual).
# Suporta Telegram (ALERT_TELEGRAM_BOT_TOKEN + ALERT_TELEGRAM_CHAT_ID) e/ou um webhook
# genérico (ALERT_WEBHOOK_URL, recebe JSON — serve p/ Discord/Slack/ntfy/gateway).
load_env_var() { # nome -> valor do infra/.env (sem sobrescrever o que já está no ambiente)
  local name="$1"
  local current="${!name:-}"
  if [ -n "$current" ]; then printf '%s' "$current"; return; fi
  [ -f "$INFRA_DIR/.env" ] || return
  sed -n "s/^${name}=//p" "$INFRA_DIR/.env" | head -n1 | sed 's/^"//; s/"$//'
}
TG_TOKEN="$(load_env_var ALERT_TELEGRAM_BOT_TOKEN)"
TG_CHAT="$(load_env_var ALERT_TELEGRAM_CHAT_ID)"
ALERT_WEBHOOK="$(load_env_var ALERT_WEBHOOK_URL)"
INSTANCE_NAME="$(load_env_var DRAC_INSTANCE_NAME)"; INSTANCE_NAME="${INSTANCE_NAME:-$(hostname)}"
WEB_BIND="$(load_env_var DRAC_WEB_BIND)"
case "$WEB_BIND" in
  ''|0.0.0.0|127.0.0.1) WEB_HEALTH_URL="http://127.0.0.1:5173/" ;;
  *) WEB_HEALTH_URL="http://${WEB_BIND}:5173/" ;;
esac

issues=()      # problemas ativos (viram status degraded)
actions=()     # auto-curas executadas neste ciclo (para o log/alerta)

COMPOSE_MEDIAMTX=(docker compose --env-file "$INFRA_DIR/.env" -f "$INFRA_DIR/docker-compose.yml" -f "$INFRA_DIR/docker-compose.prod.yml")
GATEWAY_EXPECTED=false
GATEWAY_OVERLAY_AVAILABLE=true
if [ "$(load_env_var DRAC_GATEWAY_MODE)" = "true" ] || [ -n "$(load_env_var MEDIAMTX_TURN_URL)" ]; then
  GATEWAY_EXPECTED=true
  if [ -f "$INFRA_DIR/docker-compose.gateway.yml" ]; then
    COMPOSE_MEDIAMTX+=(-f "$INFRA_DIR/docker-compose.gateway.yml")
  else
    GATEWAY_OVERLAY_AVAILABLE=false
    issues+=("live:overlay-turn-ausente")
  fi
fi
if [ "$(load_env_var DRAC_GPU_ENABLED)" = "true" ] && [ -f "$INFRA_DIR/docker-compose.gpu.yml" ]; then
  COMPOSE_MEDIAMTX+=(-f "$INFRA_DIR/docker-compose.gpu.yml")
fi

# ── 1) CONTAINERS ────────────────────────────────────────────────────────────
for container in vms-postgres vms-redis vms-mediamtx vms-api vms-web vms-ai-service; do
  state="$(docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || true)"
  case "$state" in
    running\|healthy|running\|none) ;;
    *) issues+=("container:$container:${state:-missing}") ;;
  esac
done

# ── 2) SERVIÇOS HTTP internos ────────────────────────────────────────────────
curl -fsS --max-time 8 http://127.0.0.1:3000/health/ready >/dev/null 2>&1 || issues+=("api:not-ready")
curl -fsS --max-time 5 "$WEB_HEALTH_URL" >/dev/null 2>&1 || issues+=("web:unreachable")
# O build-agent (geração de APK) só existe no servidor MESTRE. Cobrá-lo numa
# instalação de cliente deixava o watchdog em "degraded" PARA SEMPRE, por um
# serviço que não deveria estar lá — e um alerta que nunca apaga é um alerta
# que o operador aprende a ignorar. Verifica só se foi declarado.
if [ "${DRAC_BUILD_AGENT_EXPECTED:-false}" = "true" ]; then
  curl -fsS --max-time 5 http://172.17.0.1:8780/health >/dev/null 2>&1 || issues+=("build-agent:unreachable")
fi

# ── 3) PIPELINE DE LIVE (a falha de hoje) + AUTO-CURA ────────────────────────
# O nginx faz proxy de /hls/ e /webrtc/ para 127.0.0.1:8888/8889. Se o MediaMTX for
# recriado sem as portas (ex.: `up` só com o compose base), NADA escuta lá → 502 → todas
# as câmeras presas em "conectando...". Detecta pela porta publicada no host e RELIGA.
mediamtx_ports_ok() {
  docker port vms-mediamtx 2>/dev/null | grep -q '8889/tcp' \
    && docker port vms-mediamtx 2>/dev/null | grep -q '8888/tcp'
}
mediamtx_turn_ok() {
  [ "$GATEWAY_EXPECTED" = "true" ] || return 0
  local expected actual
  expected="$(load_env_var MEDIAMTX_TURN_URL)"
  [ -n "$expected" ] || return 1
  actual="$(docker inspect vms-mediamtx --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | sed -n 's/^MTX_WEBRTCICESERVERS2_0_URL=//p' | tail -n1)"
  [ "$actual" = "$expected" ]
}
if docker inspect vms-mediamtx >/dev/null 2>&1; then
  # DEBOUNCE: um recreate do mediamtx + restart da api PISCA todos os viewers. Então só
  # age se as portas estiverem REALMENTE ausentes — reconfirma após 5s p/ descartar um
  # soluço transiente do `docker port`. Sem isto, o próprio watchdog poderia virar fonte
  # de piscar ao reiniciar a api por um falso-positivo momentâneo.
  if ! mediamtx_ports_ok; then
    sleep 5
  fi
  if { ! mediamtx_ports_ok || ! mediamtx_turn_ok; } \
     && [ "$GATEWAY_OVERLAY_AVAILABLE" = "false" ]; then
    # Fail-closed: se a instalação exige Gateway mas o arquivo sumiu, NÃO
    # recrie pelo compose base. Isso removeria o TURN de um container que ainda
    # pode estar atendendo sessões e transformaria degradação em pane total.
    issues+=("live:autocura-bloqueada-sem-overlay-turn")
  elif ! mediamtx_ports_ok || ! mediamtx_turn_ok; then
    ports_were_ok=false
    mediamtx_ports_ok && ports_were_ok=true
    # AUTO-CURA: recria o mediamtx pelo compose base (que agora carrega as portas).
    "${COMPOSE_MEDIAMTX[@]}" up -d mediamtx >/dev/null 2>&1 && sleep 3
    # Fallback: se ainda sem portas (ex.: container órfão/fora do compose segurando o
    # nome), força remoção e recria limpo pelo compose.
    if ! mediamtx_ports_ok; then
      docker rm -f vms-mediamtx >/dev/null 2>&1
      "${COMPOSE_MEDIAMTX[@]}" up -d mediamtx >/dev/null 2>&1 && sleep 3
    fi
    if mediamtx_ports_ok && mediamtx_turn_ok; then
      if [ "$ports_were_ok" = "true" ]; then
        actions+=("restaurou-turn-mediamtx")
      else
        actions+=("religou-portas-mediamtx")
      fi
      # MediaMTX novo perde os paths dinâmicos; a API os re-injeta no boot (warmCameraPaths).
      docker restart vms-api >/dev/null 2>&1 && actions+=("reaqueceu-paths-api")
    else
      mediamtx_ports_ok || issues+=("live:mediamtx-sem-portas")
      mediamtx_turn_ok || issues+=("live:mediamtx-sem-turn")
    fi
  fi
  # Confirma o caminho ponta-a-ponta: host consegue falar HLS/WebRTC do MediaMTX?
  # (000 = conexão recusada = porta morta; qualquer HTTP = vivo). Só checa se as portas existem.
  if mediamtx_ports_ok; then
    hls_code="$(curl -s -o /dev/null -m 4 -w '%{http_code}' http://127.0.0.1:8888/ 2>/dev/null || echo 000)"
    rtc_code="$(curl -s -o /dev/null -m 4 -w '%{http_code}' http://127.0.0.1:8889/ 2>/dev/null || echo 000)"
    [ "$hls_code" = "000" ] && issues+=("live:hls-porta-morta")
    [ "$rtc_code" = "000" ] && issues+=("live:webrtc-porta-morta")
  fi
fi

# ── 4) DISCO ─────────────────────────────────────────────────────────────────
disk_used="$(df -P "$INFRA_DIR/storage" | awk 'NR==2 {gsub(/%/, "", $5); print $5}')"
if [ "${disk_used:-100}" -ge 90 ]; then issues+=("disk:CRITICO:${disk_used}%")
elif [ "${disk_used:-100}" -ge 85 ]; then issues+=("disk:${disk_used}%"); fi

# ── 5) BACKUP fresco ─────────────────────────────────────────────────────────
latest_backup="$(find "$INFRA_DIR/backups/postgres" -type f -name 'drac-postgres-*.dump' -printf '%T@\n' 2>/dev/null | sort -nr | head -n1 | cut -d. -f1)"
now_epoch="$(date +%s)"
if [ -z "$latest_backup" ] || [ $((now_epoch - latest_backup)) -gt 129600 ]; then issues+=("backup:mais-velho-que-36h"); fi

# ── 6) SEGURANÇA: credencial vazando em log ──────────────────────────────────
credential_lines="$(for name in vms-api vms-ai-service; do docker logs --since 10m "$name" 2>&1 || true; done | grep -Eic 'rtsp(s)?://[^/@[:space:]:]+:[^/@[:space:]]+@' || true)"
if [ "${credential_lines:-0}" -gt 0 ]; then issues+=("security:credencial-em-log:$credential_lines"); fi

# ── 7) SITES DE CÂMERAS remotos (link do cliente caiu?) ──────────────────────
# Agrupa câmeras HABILITADAS por IP e testa TCP em até 3 portas RTSP do site.
# Só acusa quando NENHUMA porta responde (site inteiro fora), com reconfirmação
# após 3s para não alertar num soluço de rede. Uma câmera isolada fora não dispara.
#
# Fica de FORA da sondagem quem não tem site sondável:
#  - câmeras rtmp_push: elas EMPURRAM vídeo para nós; não existe RTSP do lado de
#    lá para testar (a de teste tinha ip 0.0.0.0 e gerou "site-cameras:0.0.0.0:
#    inacessivel" a cada execução, o dia inteiro — alarme falso permanente que
#    afoga alerta verdadeiro);
#  - IP vazio/0.0.0.0: não é um endereço alcançável, sondar é acusar sempre.
site_rows="$(docker exec vms-postgres psql -U vms -d vms_db -tAc \
  "SELECT ip || '|' || string_agg(DISTINCT \"rtspPort\"::text, ',') FROM \"Camera\" \
   WHERE enabled IS DISTINCT FROM false \
     AND \"sourceMode\" IS DISTINCT FROM 'rtmp_push' \
     AND ip IS NOT NULL AND ip <> '' AND ip <> '0.0.0.0' \
   GROUP BY ip;" 2>/dev/null || true)"
if [ -n "$site_rows" ]; then
  while IFS='|' read -r site_ip site_ports; do
    [ -n "$site_ip" ] || continue
    site_reachable=0
    for attempt in 1 2; do
      port_idx=0
      for port in $(echo "$site_ports" | tr ',' ' '); do
        port_idx=$((port_idx + 1)); [ "$port_idx" -gt 3 ] && break
        if timeout 4 bash -c "echo > /dev/tcp/$site_ip/$port" 2>/dev/null; then site_reachable=1; break; fi
      done
      [ "$site_reachable" = "1" ] && break
      [ "$attempt" = "1" ] && sleep 3
    done
    [ "$site_reachable" = "1" ] || issues+=("site-cameras:${site_ip}:inacessivel")
  done <<< "$site_rows"
fi

# ── 8) GPU SUMIU E DEIXOU CONTÊINER PRESO NO RUNTIME NVIDIA ───────────────────
# Reincidência MEDIDA duas vezes (14h e 5h fora): a GPU some do host (nvidia-smi
# para de responder, /dev/nvidia0 evapora) e um container marcado com o runtime
# nvidia não sobe mais — "failed to initialize NVML: Driver Not Loaded",
# Exited 128. O resto fica de pé, então nada reexecuta o drac-up.sh e a matriz
# fica fora até alguém perceber.
#
# O drac-up.sh SEMPRE soube escolher CPU/GPU — mas só QUANDO executado. Faltava
# quem o reexecutasse quando a placa cai EM VOO. É esta seção.
#
# A decisão é função PURA (testável sem derrubar a GPU de verdade): só cura
# quando as DUAS coisas são verdade ao mesmo tempo —
#   1. existe container vms-* PARADO (exited/restarting) com runtime nvidia;
#   2. a GPU está inutilizável (nvidia-smi falha E /dev/nvidia0 ausente).
# Nunca dispara com sistema são nem com GPU sã. Quando dispara, a produção JÁ
# está quebrada nesse ponto exato — então relançar em CPU só recupera.
gpu_recovery_decision() { # $1=ha_container_preso_nvidia(0/1) $2=gpu_morta(0/1) -> recover|ok
  if [ "$1" = "1" ] && [ "$2" = "1" ]; then echo "recover"; else echo "ok"; fi
}

# Sinal 1: algum container vms-* parado herdou o runtime nvidia?
preso_nvidia=0
for cid in $(docker ps -a --filter "name=vms-" --filter "status=exited" --filter "status=restarting" -q 2>/dev/null); do
  [ "$(docker inspect "$cid" --format '{{.HostConfig.Runtime}}' 2>/dev/null || true)" = "nvidia" ] \
    && { preso_nvidia=1; break; }
done
# Sinal 2: a GPU está morta? (driver não comunica E device sumiu)
gpu_morta=0
if ! command -v nvidia-smi >/dev/null 2>&1 || ! nvidia-smi >/dev/null 2>&1; then
  [ -e /dev/nvidia0 ] || gpu_morta=1
fi
if [ "$(gpu_recovery_decision "$preso_nvidia" "$gpu_morta")" = "recover" ]; then
  # AUTO-CURA: relança em CPU pelo caminho documentado (idempotente).
  if [ -x "$INFRA_DIR/drac-up.sh" ] && (cd "$INFRA_DIR" && ./drac-up.sh --sem-gpu >/dev/null 2>&1); then
    actions+=("gpu-sumiu:relancado-em-cpu")
  else
    issues+=("gpu-sumiu:relanco-cpu-falhou")
  fi
fi

# ── STATUS JSON (consumível pela Central / painel) ───────────────────────────
# Montado em shell PURO, de propósito. Isto rodava em `node`, que não existe no
# host de um servidor de cliente — o Node mora nos containers, é essa a
# arquitetura. O watchdog morria em "node: command not found" e a instalação
# ficava sem monitoramento. Só apareceu na máquina virgem do teste de
# instalação limpa, porque quem desenvolve tem node instalado.
#
# O resto do watchdog só depende de bash, curl e docker; agora esta parte
# também.
json_escapar() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

json_lista() {
  # Cada linha não vazia da entrada vira um item do array JSON.
  local linha saida='' sep=''
  while IFS= read -r linha; do
    [ -n "$linha" ] || continue
    saida="$saida$sep\"$(json_escapar "$linha")\""
    sep=', '
  done
  printf '[%s]' "$saida"
}

json_issues="$(printf '%s\n' "${issues[@]:-}" | sed '/^$/d' | json_lista)"
json_actions="$(printf '%s\n' "${actions[@]:-}" | sed '/^$/d' | json_lista)"

json_status='ok'
[ "$json_issues" = '[]' ] || json_status='degraded'

# Número ou null — nunca uma string, para o consumidor não ter de adivinhar.
json_disk="${disk_used:-null}"
case "$json_disk" in ''|*[!0-9.]*) json_disk='null' ;; esac

json_instance='null'
[ -z "$INSTANCE_NAME" ] || json_instance="\"$(json_escapar "$INSTANCE_NAME")\""

cat > "$STATUS_FILE.tmp" <<JSON
{
  "instance": $json_instance,
  "status": "$json_status",
  "checkedAt": "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)",
  "diskUsedPercent": $json_disk,
  "selfHealed": $json_actions,
  "issues": $json_issues
}
JSON
mv -f "$STATUS_FILE.tmp" "$STATUS_FILE"

# ── ALERTA (só na mudança de estado) ─────────────────────────────────────────
send_alert() {
  local text="$1"
  if [ -n "$TG_TOKEN" ] && [ -n "$TG_CHAT" ]; then
    curl -s -m 10 -o /dev/null \
      --data-urlencode "chat_id=${TG_CHAT}" \
      --data-urlencode "text=${text}" \
      "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" || true
  fi
  if [ -n "$ALERT_WEBHOOK" ]; then
    # Escapar em shell PURO (json_escapar), como o resto do script: o host do
    # cliente NÃO tem node (mesma armadilha já corrigida no STATUS JSON acima —
    # esta chamada era a última sobrevivente e mataria o webhook em produção).
    curl -s -m 10 -o /dev/null -H 'Content-Type: application/json' \
      --data "$(printf '{"text":"%s"}' "$(json_escapar "$text")")" \
      "$ALERT_WEBHOOK" || true
  fi
}

new_hash="$(printf '%s\n' "${issues[@]:-ok}" "${actions[@]:-}" | sha256sum | awk '{print $1}')"
old_hash="$(cat "$HASH_FILE" 2>/dev/null || true)"
if [ "$new_hash" != "$old_hash" ]; then
  heal_note=""
  [ "${#actions[@]}" -gt 0 ] && heal_note=" | auto-cura: $(IFS=,; echo "${actions[*]}")"
  if [ "${#issues[@]}" -eq 0 ]; then
    logger -t drac-watchdog "status=ok${heal_note}"
    # avisa recuperação só se houve auto-cura (evita ruído de "voltou ao normal" trivial)
    [ "${#actions[@]}" -gt 0 ] && send_alert "✅ DRAC ${INSTANCE_NAME}: recuperado.${heal_note}"
  else
    msg="status=degraded issues=$(IFS=,; echo "${issues[*]}")${heal_note}"
    logger -t drac-watchdog "$msg"
    send_alert "⚠️ DRAC ${INSTANCE_NAME} com problema: $(IFS=', '; echo "${issues[*]}")${heal_note}"
  fi
  printf '%s' "$new_hash" > "$HASH_FILE"
fi

[ "${#issues[@]}" -eq 0 ]

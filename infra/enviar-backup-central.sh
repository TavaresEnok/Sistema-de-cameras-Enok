#!/bin/sh
# ── ENVIA A CÓPIA DE SEGURANÇA PARA A CENTRAL ───────────────────────────────
#
# O buraco que isto fecha (25/08/2026): cada instalação fazia backup diário do
# banco e guardava no MESMO disco dos dados. Isso protege contra apagar uma
# tabela por engano e NÃO protege contra o disco falhar — que é o que de fato
# acontece em servidor rodando 24 horas. Nenhuma instalação mandava cópia para
# lugar nenhum.
#
# O que vai: o dump do Postgres — câmeras, usuários, permissões, eventos,
# configuração e os REGISTROS das gravações. O VÍDEO não vai: é volumoso e tem
# caminho próprio (nuvem, por política de retenção). Com esta cópia você
# reconstrói o SISTEMA numa máquina nova.
#
# Envia o MAIS RECENTE a cada ciclo. Se a Central estiver fora do ar, tenta de
# novo no ciclo seguinte — nunca desiste em silêncio e nunca apaga o local.
set -eu

CENTRAL="${CLOUD_API_URL:-}"
ID="${CLOUD_INSTALLATION_ID:-}"
CHAVE="${CLOUD_LICENSE_KEY:-}"
INTERVALO="${BACKUP_UPLOAD_INTERVAL_SECONDS:-86400}"
PASTA="${BACKUP_DIR:-/backups}"

if [ -z "$CENTRAL" ] || [ -z "$ID" ] || [ -z "$CHAVE" ]; then
  echo "envio de backup DESLIGADO: falta CLOUD_API_URL, CLOUD_INSTALLATION_ID ou CLOUD_LICENSE_KEY" >&2
  # Dorme em vez de sair: sair faria o contêiner reiniciar em laço e encher o log.
  while true; do sleep 3600; done
fi

enviar() {
  # O mais recente pelo NOME, não pela data do arquivo: o nome carrega o
  # carimbo em UTC e não muda se alguém copiar os arquivos de lugar.
  arquivo="$(ls -1 "$PASTA"/*.dump 2>/dev/null | sort | tail -1 || true)"
  if [ -z "$arquivo" ]; then
    echo "$(date -u +%FT%TZ) nenhum backup em $PASTA ainda"
    return 0
  fi
  tamanho="$(wc -c < "$arquivo" | tr -d ' ')"
  if [ "$tamanho" -lt 1024 ]; then
    echo "$(date -u +%FT%TZ) RECUSADO: $arquivo tem só ${tamanho}B — backup truncado não substitui o bom" >&2
    return 0
  fi
  codigo="$(curl -s -o /tmp/resp -w '%{http_code}' --max-time 120 \
    -X POST "${CENTRAL%/}/api/agent/backup" \
    -H 'Content-Type: application/octet-stream' \
    -H "X-DRAC-Installation-Id: $ID" \
    -H "X-DRAC-License-Key: $CHAVE" \
    --data-binary "@$arquivo" 2>/dev/null || echo 000)"
  if [ "$codigo" = "201" ]; then
    echo "$(date -u +%FT%TZ) enviado: $(basename "$arquivo") (${tamanho}B)"
  else
    echo "$(date -u +%FT%TZ) FALHA ao enviar $(basename "$arquivo"): HTTP $codigo $(head -c 200 /tmp/resp 2>/dev/null)" >&2
  fi
  rm -f /tmp/resp
}

echo "envio de backup para a Central a cada ${INTERVALO}s (instalação: $ID)"
# Primeira tentativa com atraso: dá tempo de o backup do dia existir.
sleep 120
while true; do
  enviar || true
  sleep "$INTERVALO"
done

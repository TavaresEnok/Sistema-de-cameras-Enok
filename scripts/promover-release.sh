#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# PROMOVER UMA VERSÃO PARA A FROTA — roda na MATRIZ.
#
# A matriz é a instalação principal: é nela que se constrói, se testa e se
# aprova. Uma versão só vira "a versão da frota" depois de passar por dois
# testes DIFERENTES, que provam coisas diferentes:
#
#   1. instalação limpa numa máquina virgem  → prova que INSTALA do zero;
#   2. bateria contra a própria matriz       → prova que RODA com dados reais.
#
# Nenhum substitui o outro. Uma instalação pode subir perfeita e a aplicação
# não funcionar; e o contrário também.
#
# Este script roda os dois, monta a evidência e só então promove na Central.
# A Central RECUSA promoção sem evidência — não há como pular por pressa.
#
#   bash scripts/promover-release.sh                      # testa tudo e promove
#   bash scripts/promover-release.sh --so-testar          # testa e não promove
#   bash scripts/promover-release.sh --notas "perímetro"  # anota o que mudou
#
# Configuração (infra/.env ou ambiente):
#   DRAC_CENTRAL_URL         URL da Central
#   DRAC_CENTRAL_ADMIN_TOKEN token administrativo da Central
# ════════════════════════════════════════════════════════════════════════════
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SO_TESTAR=false
PULAR_LIMPA=false
NOTAS=""

log()    { printf '\033[1;36m[promover]\033[0m %s\n' "$*"; }
erro()   { printf '\033[1;31m[promover]\033[0m %s\n' "$*" >&2; }
titulo() { printf '\n\033[1m══ %s\033[0m\n' "$*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --so-testar) SO_TESTAR=true; shift ;;
    # Existe para quando o gate JÁ rodou neste commit (ex.: no CI) e você não
    # quer pagar 15 minutos de novo. Continua exigindo a bateria na matriz.
    --pular-instalacao-limpa) PULAR_LIMPA=true; shift ;;
    --notas) NOTAS="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,25p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) erro "Opcao desconhecida: $1"; exit 2 ;;
  esac
done

# Lê a configuração do infra/.env sem executá-lo.
env_get() { sed -nE "s/^$1=(.*)$/\1/p" "$RAIZ/infra/.env" 2>/dev/null | tail -n 1; }
ADMIN_TOKEN="${DRAC_CENTRAL_ADMIN_TOKEN:-$(env_get DRAC_CENTRAL_ADMIN_TOKEN)}"
INSTALLER_SHA256="${DRAC_CENTRAL_INSTALLER_SHA256:-$(env_get DRAC_CENTRAL_INSTALLER_SHA256)}"

# `CLOUD_API_URL` é o endereço que os CONTAINERES usam (ex.: http://drac-central:9765,
# nome da rede Docker). Este script roda no HOST, onde esse nome não resolve.
# Por isso a ordem: o que foi dito explicitamente, depois o .env, e por fim a
# Central local — que é onde ela vive, já que isto roda na matriz.
CENTRAL_URL="${DRAC_CENTRAL_URL:-}"
if [ -z "$CENTRAL_URL" ]; then
  candidato="$(env_get CLOUD_API_URL)"
  host_do_candidato="$(printf '%s' "$candidato" | sed -E 's#^[a-z]+://##; s#[:/].*$##')"
  if [ -n "$host_do_candidato" ] && getent hosts "$host_do_candidato" >/dev/null 2>&1; then
    CENTRAL_URL="$candidato"
  else
    CENTRAL_URL="http://127.0.0.1:9765"
  fi
fi

# ── Configuração é conferida ANTES da parte cara ────────────────────────────
# Descobrir que o token está errado depois de 15 minutos de teste é desperdício
# puro — e foi o que aconteceu na primeira execução real deste script.
titulo "Conferindo o acesso à Central"
[ -n "$ADMIN_TOKEN" ] || { erro "Sem DRAC_CENTRAL_ADMIN_TOKEN — é o token administrativo da Central."; exit 1; }
if ! printf '%s' "$INSTALLER_SHA256" | grep -Eq '^[0-9a-fA-F]{64}$'; then
  erro "Sem DRAC_CENTRAL_INSTALLER_SHA256 válido (64 caracteres hexadecimais)."
  erro "A release precisa provar exatamente qual script de instalação foi aprovado."
  exit 1
fi
INSTALLER_SHA256="$(printf '%s' "$INSTALLER_SHA256" | tr '[:upper:]' '[:lower:]')"
log "Central: $CENTRAL_URL"
if ! curl -fsS --max-time 10 -H "Authorization: Bearer $ADMIN_TOKEN" \
     "${CENTRAL_URL%/}/api/admin/releases" >/dev/null 2>&1; then
  erro "Não consegui falar com a Central em ${CENTRAL_URL%/} com este token."
  erro "Defina DRAC_CENTRAL_URL e/ou DRAC_CENTRAL_ADMIN_TOKEN e tente de novo."
  erro "Nada foi testado ainda — você não perdeu tempo."
  exit 1
fi
log "Central responde e o token vale"

# ── O que exatamente vai ser promovido ──────────────────────────────────────
titulo "O que vai ser promovido"

if ! git -C "$RAIZ" diff --quiet || ! git -C "$RAIZ" diff --cached --quiet; then
  erro "A árvore de trabalho tem alterações não commitadas."
  erro "Promover o que não está commitado publicaria uma versão que não existe em lugar nenhum."
  exit 1
fi

COMMIT="$(git -C "$RAIZ" rev-parse HEAD)"
log "commit: $COMMIT"
log "assunto: $(git -C "$RAIZ" log -1 --format=%s)"

if ! git -C "$RAIZ" branch -r --contains "$COMMIT" 2>/dev/null | grep -q .; then
  erro "Este commit não está publicado em nenhum branch remoto."
  erro "As instalações clonam do GitHub: sem push, elas não conseguem buscá-lo."
  exit 1
fi
log "publicado no remoto"

# ── Teste 1: instala do zero? ───────────────────────────────────────────────
GATE_LIMPA=false
if [ "$PULAR_LIMPA" = true ]; then
  titulo "Instalação limpa — PULADA a pedido"
  erro "Você está promovendo sem rodar o gate agora. Só faça isso se ele JÁ rodou neste commit."
  GATE_LIMPA=true
else
  titulo "Teste 1 de 2: instala do zero numa máquina virgem?"
  log "isto leva vários minutos"
  if bash "$RAIZ/scripts/teste-instalacao-limpa.sh" --commit "$COMMIT"; then
    GATE_LIMPA=true
    log "instalação limpa PASSOU"
  else
    erro "A instalação limpa REPROVOU. Este commit não pode ir para cliente nenhum."
    exit 1
  fi
fi

# ── Teste 2: roda de verdade, com dados reais? ──────────────────────────────
titulo "Teste 2 de 2: a matriz continua sadia neste commit?"
GATE_MATRIZ=false
if bash "$RAIZ/scripts/verificar-instalacao.sh" --dir "$RAIZ"; then
  GATE_MATRIZ=true
  log "matriz verificada"
else
  erro "A bateria REPROVOU na matriz. Corrija antes de promover."
  exit 1
fi

if [ "$SO_TESTAR" = true ]; then
  titulo "RESULTADO"
  log "Os dois testes passaram. Nada foi promovido (--so-testar)."
  exit 0
fi

# ── Promoção ────────────────────────────────────────────────────────────────
titulo "Promovendo na Central"

REPO_URL="$(git -C "$RAIZ" remote get-url origin 2>/dev/null | sed -E 's#^git@([^:]+):#https://\1/#')"
AGORA="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# `python3` só para montar JSON com escape correto — notas têm aspas e acentos.
CORPO="$(python3 - "$COMMIT" "$REPO_URL" "$INSTALLER_SHA256" "$NOTAS" "$AGORA" "$GATE_LIMPA" "$GATE_MATRIZ" <<'PY'
import json, sys
commit, repo, installer_sha256, notas, agora, limpa, matriz = sys.argv[1:8]
print(json.dumps({
    "commit": commit,
    "repositoryUrl": repo or None,
    "installerSha256": installer_sha256,
    "notas": notas or None,
    "gate": {
        "instalacaoLimpa": limpa == "true",
        "verificadaNaMatriz": matriz == "true",
        "em": agora,
    },
}))
PY
)"

RESPOSTA="$(curl -sS --max-time 20 -X POST "${CENTRAL_URL%/}/api/admin/releases" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d "$CORPO" 2>&1)"

if printf '%s' "$RESPOSTA" | grep -q '"atual"'; then
  titulo "RESULTADO"
  printf '\033[1;32mVersão promovida.\033[0m\n'
  printf '%s' "$RESPOSTA" | python3 -c "
import json,sys
d=json.load(sys.stdin)
a=d.get('atual') or {}
f=d.get('frota') or {}
print(f\"  commit    {a.get('commit')}\")
print(f\"  promovido {a.get('promovidoEm')} por {a.get('promovidoPor')}\")
print()
print('  Frota agora:')
print(f\"    atualizadas  {f.get('atualizada',0)} de {f.get('total',0)}\")
print(f\"    atrasadas    {f.get('atrasada',0)}\")
print(f\"    sem resposta {f.get('desconhecida',0)}\")
print()
print('  Nas instalações atrasadas, rode:  bash scripts/atualizar-instalacao.sh')
" 2>/dev/null || printf '%s\n' "$RESPOSTA"
  exit 0
fi

erro "A Central recusou a promoção:"
printf '%s\n' "$RESPOSTA" >&2
exit 1

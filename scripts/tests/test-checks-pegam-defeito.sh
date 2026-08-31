#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# O TESTE QUE TESTA O TESTE.
#
# Um check que só passa não prova nada — ele pode estar quebrado e verde. Aqui
# cada defeito REAL da primeira instalação de cliente é INJETADO de volta numa
# cópia do repositório, e exigimos que o check estático o reprove.
#
# Se algum dia alguém mexer nos checks e eles pararem de enxergar, este teste
# falha e diz qual deixou de funcionar.
#
#   bash scripts/tests/test-checks-pegam-defeito.sh
# ════════════════════════════════════════════════════════════════════════════
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
falhas=0
ok()   { printf '  \033[1;32mok\033[0m      %s\n' "$1"; }
nok()  { printf '  \033[1;31mFALHOU\033[0m  %s\n          %s\n' "$1" "$2"; falhas=$((falhas + 1)); }

docker compose version >/dev/null 2>&1 || { printf 'docker compose indisponivel; pulado.\n' >&2; exit 0; }

# Cópia mínima do repositório, suficiente para o check estático rodar.
copia_limpa() {
  local t="$1"
  mkdir -p "$t/scripts/tests" "$t/infra" "$t/apps/api/prisma"
  cp "$RAIZ/infra/docker-compose.yml" "$RAIZ/infra/docker-compose.prod.yml" "$RAIZ/infra/.env.example" "$t/infra/"
  cp -r "$RAIZ/infra/gateway" "$t/infra/"
  cp "$RAIZ/scripts/install-drac.sh" "$t/scripts/"
  cp "$RAIZ/scripts/tests/test-compose-estatico.sh" "$t/scripts/tests/"
  cp "$RAIZ/apps/api/prisma/schema.prisma" "$t/apps/api/prisma/"
  cp -r "$RAIZ/apps/api/prisma/migrations" "$t/apps/api/prisma/"
}

# Injeta um defeito e exige que o check ESTÁTICO o reprove.
exige_reprovacao() {
  local titulo="$1" trecho_esperado="$2" injetar="$3"
  local t saida
  t="$(mktemp -d)"
  copia_limpa "$t"
  ( cd "$t" && eval "$injetar" )
  saida="$(bash "$t/scripts/tests/test-compose-estatico.sh" 2>&1)"
  local rc=$?
  rm -rf "$t"

  if [ "$rc" -eq 0 ]; then
    nok "$titulo" 'o check PASSOU com o defeito presente — ele não enxerga mais'
  elif printf '%s' "$saida" | grep -qE -- "$trecho_esperado"; then
    ok "$titulo"
  else
    nok "$titulo" "reprovou, mas por outro motivo: $(printf '%s' "$saida" | grep FALHOU | head -1)"
  fi
}

printf '\n\033[1mCada check enxerga o defeito que promete enxergar\033[0m\n'

# 1) Serviço do cliente dependendo da Central: o compose fica inválido onde a
#    Central não existe, e o web nem sobe.
exige_reprovacao 'depends_on: drac-central é pego' \
  'algum serviço depende de drac-central|compose de produção inválido' \
  "python3 - <<'PY'
import re,pathlib
p=pathlib.Path('infra/docker-compose.yml'); s=p.read_text()
s=s.replace('    depends_on:\n      - api\n', '    depends_on:\n      - api\n      - drac-central\n', 1)
p.write_text(s)
PY"

# 2) Porta publicada duas vezes: o Compose SOMA as listas entre arquivos.
#    Sintoma que mente: 'address already in use' com a porta LIVRE no host.
exige_reprovacao 'porta publicada em duplicidade é pega' \
  'porta publicada em duplicidade' \
  "python3 - <<'PY'
import pathlib,re
# Reproduz o defeito EXATO: o base fixa a porta crua e o overlay publica a
# MESMA porta por variável. Grafias diferentes, então o Compose mantém as duas
# (ele SOMA as listas) e o container tenta ligar 3000 duas vezes.
# Duplicar uma linha idêntica não serve: aí o Compose deduplica.
p=pathlib.Path('infra/docker-compose.yml'); s=p.read_text()
alvo='      - \"\${DRAC_API_BIND:-127.0.0.1}:3000:3000\"\n'
assert alvo in s, 'a linha de porta da api mudou; ajuste a injecao'
s=s.replace(alvo, alvo+'      - \"0.0.0.0:3000:3000\"\n', 1)
p.write_text(s)
PY"

# 3) Serviço que passa pelo nginx publicado em 0.0.0.0: o Docker escreve DNAT
#    avaliado ANTES do ufw — expõe de verdade com o firewall fechado.
exige_reprovacao 'bind 0.0.0.0 indevido no instalador é pego' \
  'instalador publicaria em 0.0.0.0' \
  "sed -i 's|env_set \"\$env_file\" DRAC_API_BIND \"127.0.0.1\"|env_set \"\$env_file\" DRAC_API_BIND \"0.0.0.0\"|' scripts/install-drac.sh"

# 4) Tabela no schema sem migração: 'migrate deploy' diz 'up to date' numa base
#    NOVA e a tabela não existe. Foi assim que RolePermission sumiu.
exige_reprovacao 'model sem migração é pego' \
  'sem migração que crie a tabela' \
  "printf '\nmodel TabelaFantasma {\n  id String @id\n}\n' >> apps/api/prisma/schema.prisma"

# 5) Tag móvel em serviço da borda: `up -d` pode trocar o binário público sem
#    qualquer mudança no Git. O defeito só aparece na próxima recriação.
exige_reprovacao 'imagem móvel na Gateway é pega' \
  'Gateway usa tag móvel' \
  "sed -i 's|nginx:1.27-alpine@sha256:[a-f0-9]*|nginx:1.27-alpine|' infra/gateway/docker-compose.yml"

printf '\n'
if [ "$falhas" -eq 0 ]; then
  printf '\033[1;32mTodos os checks provaram que enxergam o defeito.\033[0m\n\n'
  exit 0
fi
printf '\033[1;31m%s check(s) NAO enxergam mais o defeito que deveriam pegar.\033[0m\n\n' "$falhas"
exit 1

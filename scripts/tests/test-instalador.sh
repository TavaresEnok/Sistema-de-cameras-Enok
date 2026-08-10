#!/usr/bin/env bash
# Testes do instalador que NÃO precisam de uma máquina.
#
# Cobrem o que a primeira instalação de cliente ensinou: arquivo de respostas
# com erro tem de falhar dizendo o quê, e perguntar sem terminal era um laço
# infinito. Rodam em segundos, no CI, a cada mudança.
#
#   bash scripts/tests/test-instalador.sh
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALADOR="$RAIZ/scripts/install-drac.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

falhas=0
ok()   { printf '  \033[1;32mok\033[0m   %s\n' "$1"; }
nok()  { printf '  \033[1;31mFALHOU\033[0m %s\n     %s\n' "$1" "$2"; falhas=$((falhas + 1)); }

# Roda o instalador e devolve a saída (stdout+stderr). Nunca chega a instalar:
# todos os casos abaixo morrem antes de qualquer efeito no sistema.
executar() { bash "$INSTALADOR" "$@" 2>&1 || true; }

espera_conter() {
  local titulo="$1" esperado="$2" saida="$3"
  if printf '%s' "$saida" | grep -qF -- "$esperado"; then ok "$titulo"; else nok "$titulo" "esperava conter: $esperado | veio: $(printf '%s' "$saida" | tail -2 | tr '\n' ' ')"; fi
}

printf '\n\033[1mArquivo de respostas\033[0m\n'

espera_conter 'arquivo inexistente é dito pelo nome' \
  'Arquivo de respostas nao encontrado' "$(executar --config "$TMP/nao-existe.env")"

printf 'DRAC_CUSTUMER_NAME=Cliente\n' > "$TMP/typo.env"
espera_conter 'chave mal digitada é ERRO, não um padrão silencioso' \
  "chave desconhecida 'DRAC_CUSTUMER_NAME'" "$(executar --config "$TMP/typo.env")"

printf 'isto nao e uma atribuicao\n' > "$TMP/formato.env"
espera_conter 'linha fora do formato diz o número da linha' \
  'linha 1: esperado CHAVE=valor' "$(executar --config "$TMP/formato.env")"

espera_conter 'opção desconhecida não é ignorada' \
  'Opcao desconhecida: --naoexiste' "$(executar --naoexiste)"

espera_conter '--config sem argumento reclama' \
  '--config exige o caminho' "$(executar --config)"

# ── Leitura correta: comentários, aspas, espaços, CRLF ──────────────────────
printf '# comentario\n\nDRAC_CUSTOMER_NAME="Cliente Teste"\n  DRAC_INSTALL_DIR = /opt/x \nDRAC_ADMIN_NAME=Chefe\r\n' > "$TMP/bom.env"
saida="$(
  set +e
  # shellcheck disable=SC1090
  source "$INSTALADOR" >/dev/null 2>&1
  trap - ERR
  DRAC_CONFIG_FILE="$TMP/bom.env"
  DRAC_CUSTOMER_NAME='' DRAC_INSTALL_DIR='' DRAC_ADMIN_NAME=''
  load_config_file >/dev/null 2>&1
  printf '%s|%s|%s|%s' "$DRAC_CUSTOMER_NAME" "$DRAC_INSTALL_DIR" "$DRAC_ADMIN_NAME" "$DRAC_AUTO_YES"
)"
if [ "$saida" = 'Cliente Teste|/opt/x|Chefe|true' ]; then
  ok 'lê aspas, espaços, comentários e CRLF; e liga o modo sem perguntas'
else
  nok 'lê aspas, espaços, comentários e CRLF' "veio: $saida"
fi

printf '\n\033[1mNunca perguntar no vazio\033[0m\n'

# O defeito: sem terminal, `read` retorna EOF, a resposta fica vazia, o laço
# avisa "Campo obrigatorio" e pergunta de novo — para sempre. Um instalador
# vindo de pipe/cron/CI travava sem dizer o porquê.
saida="$(
  set +e
  # shellcheck disable=SC1090
  source "$INSTALADOR" >/dev/null 2>&1
  trap - ERR
  DRAC_AUTO_YES=false
  ALGUMA_COISA=''
  timeout 5 bash -c '
    # shellcheck disable=SC1090
    source "'"$INSTALADOR"'" >/dev/null 2>&1
    trap - ERR
    DRAC_AUTO_YES=false
    ALGUMA_COISA=""
    prompt ALGUMA_COISA "Pergunta obrigatoria"
  ' < /dev/null 2>&1
  printf '|saida=%s' "$?"
)"
if printf '%s' "$saida" | grep -q 'Sem terminal para perguntar'; then
  ok 'sem terminal, diz qual variável faltou em vez de travar'
elif printf '%s' "$saida" | grep -q 'saida=124'; then
  nok 'sem terminal, diz qual variável faltou' 'TRAVOU (timeout) — o laço infinito voltou'
else
  nok 'sem terminal, diz qual variável faltou' "veio: $(printf '%s' "$saida" | tail -2 | tr '\n' ' ')"
fi

printf '\n\033[1mAjuda\033[0m\n'
espera_conter '--help explica o modo recomendado' \
  '--config cliente.env' "$(executar --help)"

printf '\n'
if [ "$falhas" -eq 0 ]; then
  printf '\033[1;32mTodos os testes do instalador passaram.\033[0m\n\n'
  exit 0
fi
printf '\033[1;31m%s teste(s) do instalador falharam.\033[0m\n\n' "$falhas"
exit 1

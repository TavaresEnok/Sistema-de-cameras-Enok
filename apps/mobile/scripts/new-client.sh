#!/usr/bin/env bash
# new-client.sh — cadastra um novo cliente white-label (sem editar código).
#
#   ./scripts/new-client.sh --slug acme --name "Acme VMS" \
#       --api https://acme.s2cam.com.br/api [--package com.s2cam.acme] \
#       [--color "#3b82f6"] [--logo /caminho/logo.png]
#
# Cria clients/<slug>/config.json (e copia a logo, se informada). Depois:
#   ./scripts/build-client.sh <slug>
set -euo pipefail

SLUG="" NAME="" API="" PACKAGE="" COLOR="#3b82f6" LOGO=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --slug) SLUG="$2"; shift 2;;
    --name) NAME="$2"; shift 2;;
    --api) API="$2"; shift 2;;
    --package) PACKAGE="$2"; shift 2;;
    --color) COLOR="$2"; shift 2;;
    --logo) LOGO="$2"; shift 2;;
    *) echo "argumento desconhecido: $1" >&2; exit 2;;
  esac
done

[[ -n "$SLUG" && -n "$NAME" && -n "$API" ]] || { echo "obrigatórios: --slug --name --api" >&2; exit 2; }
[[ "$SLUG" =~ ^[a-z0-9][a-z0-9-]{1,38}$ ]] || { echo "slug inválido (a-z 0-9 -): $SLUG" >&2; exit 2; }
[[ -z "$PACKAGE" ]] && PACKAGE="com.s2cam.${SLUG//-/}"
[[ "$PACKAGE" =~ ^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$ ]] || { echo "package inválido: $PACKAGE" >&2; exit 2; }

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export DIR="$MOBILE_DIR/clients/$SLUG"
mkdir -p "$DIR"

node -e '
const fs=require("fs");
const [slug,name,api,pkg,color]=process.argv.slice(1);
const cfg={appName:name, slug:"drac-"+slug, packageId:pkg, apiUrl:api, primaryColor:color};
fs.writeFileSync(process.env.DIR+"/config.json", JSON.stringify(cfg,null,2)+"\n");
' "$SLUG" "$NAME" "$API" "$PACKAGE" "$COLOR"

if [[ -n "$LOGO" ]]; then
  [[ -f "$LOGO" ]] || { echo "logo não encontrada: $LOGO" >&2; exit 2; }
  cp "$LOGO" "$DIR/logo.png"
  echo ">> logo copiada"
fi

echo ">> cliente '$SLUG' criado em clients/$SLUG/config.json"
echo ">> agora rode: ./scripts/build-client.sh $SLUG"

#!/bin/sh
set -eu

cd /app/apps/api

# O schema precisa chegar ANTES do código. Assim, até um `docker compose up`
# executado manualmente não consegue publicar uma API nova sobre um banco velho.
# Se a migração falhar, o processo termina e o healthcheck nunca fica verde.
../../node_modules/.bin/prisma migrate deploy

exec node dist/main.js

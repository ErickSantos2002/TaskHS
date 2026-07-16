#!/usr/bin/env bash
# Abre o psql no banco do projeto, lendo a credencial do backend/.env.
#
# POR QUE ISTO EXISTE: os planos deste repo costumavam trazer o comando psql com a
# senha inline. O repo e PUBLICO, entao a senha do banco de producao ficou no
# GitHub de 2026-06-18 ate 2026-07-16 (~1 mes). Nunca mais escreva credencial em
# doc, plano, spec ou mensagem de commit: use este script.
#
# Uso:
#   ./scripts/psql-dev.sh -c "SELECT count(*) FROM users;"
#   ./scripts/psql-dev.sh -f backend/migrations/005_card_members_unique.sql
#   ./scripts/psql-dev.sh                      # sessao interativa
#
# Le DATABASE_URL de backend/.env (gitignorado). O formato esperado e:
#   postgresql+asyncpg://USUARIO:SENHA@HOST:PORTA/BANCO
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$RAIZ/backend/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "erro: $ENV_FILE nao encontrado (copie de backend/.env.example)" >&2
  exit 1
fi

URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
if [[ -z "$URL" ]]; then
  echo "erro: DATABASE_URL nao encontrado em $ENV_FILE" >&2
  exit 1
fi

# postgresql+asyncpg://user:pass@host:port/db  ->  o psql nao entende o +asyncpg
URL_PSQL="${URL/+asyncpg/}"

exec psql "$URL_PSQL" "$@"

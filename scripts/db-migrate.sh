#!/usr/bin/env bash
#
# db-migrate.sh — Ejecuta las migraciones de Prisma contra la base local.
# Propiedad: devops. PLACEHOLDER tolerante: funciona en cuanto el rol backend
# cree backend/ con Prisma (prisma/schema.prisma). Hasta entonces avisa y sale.
#
# Uso:
#   ./scripts/db-migrate.sh            # aplica migraciones (prisma migrate dev)
#   ./scripts/db-migrate.sh deploy     # aplica migraciones en modo prod (migrate deploy)
#   ./scripts/db-migrate.sh reset      # DROP + recrea + migra + seed (destruye datos)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"

if [[ ! -f "${BACKEND_DIR}/prisma/schema.prisma" ]]; then
  echo "⚠  Aún no existe backend/prisma/schema.prisma."
  echo "   Este script se activará cuando el rol backend cree el esquema de Prisma."
  exit 0
fi

# Carga .env (para DATABASE_URL) si existe.
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a; . "${ROOT_DIR}/.env"; set +a
fi

cd "${BACKEND_DIR}"

CMD="${1:-dev}"
case "${CMD}" in
  dev)    echo "→ prisma migrate dev";    npx prisma migrate dev ;;
  deploy) echo "→ prisma migrate deploy"; npx prisma migrate deploy ;;
  reset)  echo "→ prisma migrate reset (DESTRUYE datos)"; npx prisma migrate reset --force ;;
  *)      echo "Uso: $0 [dev|deploy|reset]" >&2; exit 1 ;;
esac

echo "✓ Migraciones aplicadas."

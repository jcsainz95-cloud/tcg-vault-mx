#!/usr/bin/env bash
#
# seed.sh — Puebla la base local con datos de arranque. Propiedad: devops.
# PLACEHOLDER tolerante: delega en el seed que defina el rol backend
# (convención: `npm run seed` o `prisma db seed` en backend/).
#
# Datos de arranque esperados (los define backend según ARCHITECTURE):
#   - Diales de M10 (ConfigSetting): envío 17500, aportación 70, IVA 16,
#     topes buylist 300000/1000000, INE=tope, colchón FX, PricingProvider*.
#   - Usuario super_admin inicial (el negocio ES el admin en el MVP).
#   - Ubicaciones de bóveda base (platform_stock / customer_custody).
#
# Uso:
#   ./scripts/seed.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"

if [[ ! -f "${BACKEND_DIR}/package.json" ]]; then
  echo "⚠  Aún no existe backend/. Este script se activará cuando el rol backend cree la app."
  exit 0
fi

if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a; . "${ROOT_DIR}/.env"; set +a
fi

cd "${BACKEND_DIR}"

# Prefiere un script npm "seed"; si no, intenta `prisma db seed`.
if npm run | grep -qE '^\s*seed'; then
  echo "→ npm run seed"
  npm run seed
elif [[ -f prisma/schema.prisma ]]; then
  echo "→ npx prisma db seed"
  npx prisma db seed
else
  echo "⚠  No hay script de seed definido todavía (backend lo añadirá)."
  exit 0
fi

echo "✓ Seed aplicado."

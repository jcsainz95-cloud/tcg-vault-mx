#!/usr/bin/env bash
#
# seed-synthetic.sh — Puebla STAGING con DATOS SINTÉTICOS. Propiedad: devops.
# =============================================================================
# PLACEHOLDER tolerante: delega en el seed sintético que expone el rol backend.
# Convención esperada (backend la implementa): `npm run seed:synthetic` en
# backend/, o `prisma db seed` con SEED_MODE=synthetic.
#
#   REGLA DE ORO: en staging NUNCA se cargan datos reales de clientes.
#   Este seed genera usuarios/cartas/órdenes/buylist FICTICIOS y deterministas
#   para poder correr E2E y DAST de forma repetible.
#
# Diferencia con scripts/seed.sh:
#   - seed.sh          -> datos mínimos de arranque (diales M10 + super_admin).
#   - seed-synthetic.sh -> dataset amplio ficticio para probar los flujos E2E
#                          (catálogo, compras settled, retiros, buylist, disputas).
#
# Uso:
#   ./scripts/seed-synthetic.sh
#
# Apunta a la base de STAGING: exporta las variables STAGING_* o corre este
# script con el .env de staging. Si DATABASE_URL no está seteada, delega en la
# config del backend (que debe apuntar a la base de staging).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"

echo "=== seed-synthetic (STAGING) ==="

if [[ ! -f "${BACKEND_DIR}/package.json" ]]; then
  echo "⚠  Aún no existe backend/. Este script se activará cuando el rol backend cree la app."
  exit 0
fi

# Cargar .env si existe (para DATABASE_URL de staging).
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a; . "${ROOT_DIR}/.env"; set +a
fi

# Salvaguarda: si DATABASE_URL apunta a una base que parece de producción,
# aborta. Staging debe usar una base separada (tcg_staging / *staging*).
if [[ -n "${DATABASE_URL:-}" ]]; then
  case "${DATABASE_URL}" in
    *staging*|*localhost*|*127.0.0.1*|*postgres:5432*)
      : ;; # ok: staging o local
    *)
      echo "✗ DATABASE_URL no parece de staging/local: se aborta por seguridad."
      echo "  El seed sintético NUNCA debe correr contra producción."
      echo "  Exporta STAGING_* o usa el .env de staging (base tcg_staging)."
      exit 1 ;;
  esac
fi

# Marca de modo sintético para el backend (por si su seed la respeta).
export SEED_MODE="${SEED_MODE:-synthetic}"

cd "${BACKEND_DIR}"

# Prefiere un script npm dedicado "seed:synthetic"; si no, cae a seed normal
# con SEED_MODE=synthetic; si tampoco, avisa qué debe exponer backend.
if npm run 2>/dev/null | grep -qE '^\s*seed:synthetic'; then
  echo "→ npm run seed:synthetic"
  npm run seed:synthetic
elif npm run 2>/dev/null | grep -qE '^\s*seed'; then
  echo "→ npm run seed  (SEED_MODE=synthetic)"
  npm run seed
elif [[ -f prisma/schema.prisma ]]; then
  echo "→ npx prisma db seed  (SEED_MODE=synthetic)"
  npx prisma db seed
else
  echo "⚠  El backend aún no expone un seed sintético."
  echo "   Backend debe añadir el script npm 'seed:synthetic' (o respetar SEED_MODE=synthetic)."
  exit 0
fi

echo "✓ Datos sintéticos cargados en staging."

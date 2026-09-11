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
#
# ⚠️ `grep -E … >/dev/null` y NO `grep -qE` (2026-09-10, §45.3). Este script corre
# con `set -o pipefail` (arriba): `grep -q` sale al primer match y cierra el pipe,
# `npm run` se lleva un SIGPIPE (141) y el PIPELINE se evalúa como FALSO aunque el
# script SÍ exista. Aquí la consecuencia no es un rojo de CI, es peor y silenciosa:
# la rama equivocada ⇒ este entorno se siembra con el seed que no toca, o se
# declara «el backend no expone seed» y NO se siembra — y encima sale exit 0.
# Sin `-q`, grep consume toda la entrada y nadie escribe contra un pipe cerrado.
if npm run 2>/dev/null | grep -E '^\s*seed:synthetic' >/dev/null; then
  echo "→ npm run seed:synthetic"
  npm run seed:synthetic
elif npm run 2>/dev/null | grep -E '^\s*seed' >/dev/null; then
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

# -----------------------------------------------------------------------------
# PARIDAD DE PROVEEDOR DE PRECIO (`I-PP5`) — §43.2, con el puente RETIRADO §45.1.
#
# El seed MATERIALIZA la fila `ConfigSetting.price_provider` (prisma/seed.ts y
# seed-e2e.ts hacen `upsert(... update:{})`). Si el dial no está en el PRIMARIO,
# el entorno barre y escribe precios APLANADOS con el proveedor LEGACY —que no es
# inerte— y los E2E y el DAST que corran encima medirían un barrido distinto del
# que se promueve.
#
# RETIRO de `--ensure` (2026-09-10): `D-PP-1` aterrizó y el seed del código ya es
# el primario, así que el puente interino caducó — y desde ese día `--ensure` era
# un no-op que salía 0 sin mirar nada. Queda `--assert`, que NO es interino: es el
# candado `I-PP5` y MIDE el valor vigente.
#
# ⚠️ Lo que el puente tapaba y ahora se ve: una BD sembrada ANTES de `D-PP-1`
# conserva la fila LEGACY aunque el seed del código haya cambiado (§32.1). Eso es
# precisamente lo que hay que ver, no autocorregir: el arreglo es un
# `PUT /admin/settings` por el panel M10 (auditado), con un humano delante.
# -----------------------------------------------------------------------------
PARITY_API_BASE="${PARITY_API_BASE:-http://localhost:${STAGING_BACKEND_PORT:-3011}/api/v1}"
echo "=== paridad del dial price_provider (I-PP5) ==="
if curl -sf --max-time 5 "${PARITY_API_BASE%/}/health" >/dev/null 2>&1; then
  if ! "${SCRIPT_DIR}/price-provider-parity.sh" --assert --api-base "$PARITY_API_BASE"; then
    echo "✗ Este entorno NO evalúa el proveedor de precio PRIMARIO."
    echo "  Causa típica: la BD se sembró ANTES de D-PP-1 y conserva la fila legacy"
    echo "  (los seeds hacen upsert(... update:{}): cambiar el seed NO cambia lo ya sembrado)."
    echo "  Arreglo: panel M10 > proveedor de precio (PUT /admin/settings, auditado)."
    echo "  Desde cero:  docker compose -f docker-compose.staging.yml --profile apps down -v"
    echo "  NO declares este staging apto para E2E/DAST hasta verlo en verde (DEVOPS_NOTES §43.2)."
    exit 1
  fi
else
  echo "✗ La API de staging no responde en $PARITY_API_BASE."
  echo "  El dial vive en la BD y se LEE por GET /admin/settings: sin API no se puede medir."
  echo "  Levanta las apps y repite:"
  echo "     docker compose -f docker-compose.staging.yml --profile apps up -d --build"
  echo "     ./scripts/price-provider-parity.sh --assert --api-base $PARITY_API_BASE"
  echo "  NO declares este staging apto para E2E/DAST hasta verlo en verde (DEVOPS_NOTES §43.2)."
  exit 1
fi

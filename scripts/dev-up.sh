#!/usr/bin/env bash
#
# dev-up.sh — Levanta la infraestructura local (Postgres, Redis, MinIO).
# Propiedad: devops.
#
# Uso:
#   ./scripts/dev-up.sh          # solo infraestructura
#   ./scripts/dev-up.sh --apps   # + backend y frontend (requiere código en backend/ y frontend/)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

# --- Asegurar .env ----------------------------------------------------------
if [[ ! -f .env ]]; then
  echo "→ No existe .env; creándolo desde .env.example."
  echo "  RECUERDA rellenar las claves reales (Stripe, APIs de precio) antes de usarlas."
  cp .env.example .env
fi

# --- Elegir perfil ----------------------------------------------------------
PROFILE_ARGS=()
if [[ "${1:-}" == "--apps" ]]; then
  echo "→ Levantando infraestructura + apps (perfil apps)."
  echo "  Nota: requiere que existan backend/ y frontend/ con su código."
  PROFILE_ARGS=(--profile apps)
else
  echo "→ Levantando solo infraestructura (postgres, redis, minio)."
fi

docker compose "${PROFILE_ARGS[@]}" up -d

echo
echo "→ Esperando healthchecks..."
docker compose ps

cat <<EOF

✓ Entorno arriba.
  Postgres : localhost:5432   (user/db según .env)
  Redis    : localhost:6379
  MinIO API: http://localhost:9000
  MinIO UI : http://localhost:9001  (login: MINIO_ROOT_USER / MINIO_ROOT_PASSWORD)

Siguientes pasos (cuando exista el código):
  Backend : cd backend  && npm install && npm run start:dev   (o: ./scripts/dev-up.sh --apps)
  Frontend: cd frontend && npm install && npm run dev
  Migrar  : ./scripts/db-migrate.sh
  Seed    : ./scripts/seed.sh

Apagar: ./scripts/dev-down.sh
EOF

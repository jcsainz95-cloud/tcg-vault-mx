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

# --- Secretos: generados aquí, NUNCA heredados del repo (S-88-1) -------------
# Antes, `.env.example` traía valores USABLES (`tcg_local_dev_password`,
# `minioadmin_local_dev`, `whsec_CHANGE_ME`…) y esta copia los daba por buenos. El
# argumento de que «son de desarrollo local» es el que seguridad refutó midiendo:
# el repositorio es PÚBLICO, y un valor de respaldo gana justo en el momento del
# ERROR del operador —cuando creyó haberlo cambiado y no lo hizo—, nunca en el
# momento cómodo. Con el JWT publicado se firma un `super_admin`; con la clave PII
# se descifra una CLABE. Seguridad hizo las dos cosas.
#
# `secrets-preflight.sh env-file`:
#   · rellena las que falten con valores ALEATORIOS de esta máquina;
#   · sustituye las que traigan un valor que el repo PUBLICA (identidad, no
#     heurística: `security/secretos-publicados.sha256`);
#   · respeta las que ya tengas puestas de verdad — es idempotente y no rota nada.
echo "→ Secretos locales (S-88-1): ninguno puede venir escrito en el repo."
./scripts/secrets-preflight.sh env-file .env

# P-WH-1: el webhook conserva ADEMÁS su preflight propio, porque es el único
# secreto cuya exigencia depende de un EMPAREJAMIENTO (si hay una clave de Stripe
# real, no vale cualquier valor). `env-file` de arriba ya le puso uno generado si
# faltaba o si el `.env` traía el `whsec_CHANGE_ME` publicado; esto comprueba el
# par y aborta si alguien metió una clave real de Stripe con un secreto público.
set -a; . ./.env; set +a
./scripts/webhook-secret-preflight.sh assert

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

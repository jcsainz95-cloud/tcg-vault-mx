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

  # --- P-WH-1: el secreto del webhook NO puede ser un valor que esté en el repo -
  # `.env.example` trae `whsec_CHANGE_ME`. Es no vacío (bien: la firma se verifica
  # en vez de degradar a cero), pero es un literal PÚBLICO: cualquiera que lea el
  # repo puede firmar un `payment_intent.succeeded` válido contra este stack. El
  # pentester hizo exactamente eso —con la clave vacía— y liquidó un pedido con la
  # carta movida a la bóveda del comprador, sin cobro (ALTA, LIVE-DB).
  # Aquí se sustituye por uno ALEATORIO de esta máquina: el stack levanta sin
  # Stripe y todo webhook entrante se rechaza porque nadie conoce la clave.
  # Si vas a probar webhooks de verdad, pon tu `whsec_…` de `stripe listen` en .env.
  if grep -q '^STRIPE_WEBHOOK_SECRET=whsec_CHANGE_ME$' .env; then
    if command -v openssl >/dev/null 2>&1; then
      NUEVO="whsec_local_$(openssl rand -hex 24)"
    else
      NUEVO="whsec_local_$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    fi
    # `sed -i` con sufijo vacío no es portable entre GNU/BSD: se hace con fichero temporal.
    sed "s|^STRIPE_WEBHOOK_SECRET=whsec_CHANGE_ME$|STRIPE_WEBHOOK_SECRET=${NUEVO}|" .env > .env.tmp && mv .env.tmp .env
    echo "  · STRIPE_WEBHOOK_SECRET: se generó uno ALEATORIO para este .env (P-WH-1)."
    echo "    El stack levanta sin Stripe y RECHAZA todo webhook: 'sin Stripe' ya no"
    echo "    significa 'acepto cualquier firma'. Sustitúyelo por tu whsec_… real si"
    echo "    vas a probar webhooks."
  fi
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

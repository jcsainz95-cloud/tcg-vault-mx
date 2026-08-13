#!/usr/bin/env bash
#
# dev-down.sh — Apaga la infraestructura local. Propiedad: devops.
#
# Uso:
#   ./scripts/dev-down.sh          # apaga y CONSERVA los datos (volúmenes)
#   ./scripts/dev-down.sh --wipe   # apaga y BORRA los datos (reset total)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

if [[ "${1:-}" == "--wipe" ]]; then
  echo "→ Apagando y BORRANDO volúmenes (Postgres, Redis, MinIO). Esto elimina todos los datos locales."
  docker compose --profile apps down -v
  echo "✓ Entorno apagado y datos borrados."
else
  echo "→ Apagando (los datos se conservan en los volúmenes)."
  docker compose --profile apps down
  echo "✓ Entorno apagado. Vuelve a levantar con ./scripts/dev-up.sh"
fi

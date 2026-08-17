#!/usr/bin/env bash
#
# trivy-image.sh — Trivy sobre imágenes Docker construidas. Propiedad: devops.
# =============================================================================
# Escanea las imágenes backend/frontend (Dockerfile.backend/.frontend) en busca
# de CVEs del sistema base y de las librerías. Falla en HIGH/CRITICAL.
#
# Uso:
#   ./security/scripts/trivy-image.sh                 # construye y escanea ambas
#   IMAGES="tcg-backend:ci" ./security/scripts/trivy-image.sh   # escanea una ya construida
#
# Requiere: trivy + docker (daemon). En esta sesión NO hay daemon Docker; se
# valida estáticamente y corre de verdad en CI (runner con Docker).
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEC_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${SEC_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

if ! command -v trivy >/dev/null 2>&1; then
  echo "✗ trivy no está instalado. Ver https://aquasecurity.github.io/trivy"
  exit 127
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "✗ docker no está disponible (se requiere daemon para build/scan de imágenes)."
  exit 127
fi

# Construye las imágenes si no se pasa una lista explícita.
if [[ -z "${IMAGES:-}" ]]; then
  echo "→ Construyendo imágenes para escaneo ..."
  docker build -f Dockerfile.backend  -t tcg-backend:scan  --target runtime .
  docker build -f Dockerfile.frontend -t tcg-frontend:scan --target runtime \
    --build-arg NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1 \
    --build-arg NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_scan \
    --build-arg NEXT_PUBLIC_DEFAULT_LOCALE=es \
    --build-arg NEXT_PUBLIC_USE_MOCKS=false .
  IMAGES="tcg-backend:scan tcg-frontend:scan"
fi

FAILED=0
for img in ${IMAGES}; do
  echo "→ Trivy image: ${img} ..."
  if ! trivy image --config "${SEC_DIR}/trivy.yaml" --ignorefile "${SEC_DIR}/.trivyignore" --exit-code 1 --no-progress "${img}"; then
    echo "✗ ${img}: HIGH/CRITICAL detectadas."
    FAILED=1
  fi
done

if [[ "${FAILED}" -ne 0 ]]; then
  echo "✗ Trivy image encontró vulnerabilidades que bloquean el gate."
  exit 1
fi
echo "✓ Trivy image OK (sin HIGH/CRITICAL)."

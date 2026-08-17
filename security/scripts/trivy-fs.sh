#!/usr/bin/env bash
#
# trivy-fs.sh — Trivy sobre el filesystem (deps de backend/frontend). devops.
# =============================================================================
# Escanea las dependencias del repo en busca de CVEs. Falla en HIGH/CRITICAL.
#
# Uso:
#   ./security/scripts/trivy-fs.sh
#   TRIVY_SARIF=1 ./security/scripts/trivy-fs.sh    # emite trivy-fs.sarif
#
# Requiere: trivy en PATH (https://aquasecurity.github.io/trivy) o Docker:
#   docker run --rm -v "$PWD:/src" aquasec/trivy fs /src ...
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEC_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${SEC_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

if ! command -v trivy >/dev/null 2>&1; then
  echo "✗ trivy no está instalado. Ver https://aquasecurity.github.io/trivy"
  echo "  (o usa la imagen aquasec/trivy). En CI ya viene incluido."
  exit 127
fi

ARGS=(
  fs
  --config "${SEC_DIR}/trivy.yaml"
  --ignorefile "${SEC_DIR}/.trivyignore"   # excepciones justificadas (node-tar de npm base)
  --exit-code 1                       # gate: HIGH/CRITICAL => fallo
  --no-progress
)

if [[ "${TRIVY_SARIF:-0}" == "1" ]]; then
  ARGS+=(--format sarif --output trivy-fs.sarif)
fi

echo "→ Trivy fs sobre el repositorio (deps) ..."
trivy "${ARGS[@]}" .
echo "✓ Trivy fs OK (sin HIGH/CRITICAL)."

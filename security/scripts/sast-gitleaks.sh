#!/usr/bin/env bash
#
# sast-gitleaks.sh — Detección de secretos con gitleaks. Propiedad: devops.
# =============================================================================
# Escanea el árbol de trabajo Y el historial de git. Falla si encuentra un
# secreto que no esté en la allowlist de security/gitleaks.toml.
#
# Uso:
#   ./security/scripts/sast-gitleaks.sh            # escanea el repo (dir)
#   GITLEAKS_MODE=git ./security/scripts/sast-gitleaks.sh   # escanea historial
#
# Requiere: gitleaks en PATH (https://github.com/gitleaks/gitleaks) o Docker:
#   docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest ...
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEC_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${SEC_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "✗ gitleaks no está instalado. Ver https://github.com/gitleaks/gitleaks"
  echo "  (o usa la imagen Docker zricethezav/gitleaks). En CI ya viene incluido."
  exit 127
fi

CONFIG="${SEC_DIR}/gitleaks.toml"
MODE="${GITLEAKS_MODE:-dir}"

COMMON=(
  --config "${CONFIG}"
  --redact
  --report-format sarif
  --report-path gitleaks.sarif
  --verbose
)

if [[ "${MODE}" == "git" ]]; then
  echo "→ gitleaks: escaneando historial de git ..."
  gitleaks git . "${COMMON[@]}"
else
  echo "→ gitleaks: escaneando árbol de trabajo ..."
  gitleaks dir . "${COMMON[@]}"
fi

echo "✓ gitleaks OK (sin secretos fuera de la allowlist)."

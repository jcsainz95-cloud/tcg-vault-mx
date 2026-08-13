#!/usr/bin/env bash
#
# sast-semgrep.sh — Corre Semgrep (SAST) local o en CI. Propiedad: devops.
# =============================================================================
# Reglas locales del proyecto (security/semgrep.yml) + rulesets curados de la
# registry. Falla (exit 1) si hay hallazgos de severidad ERROR.
#
# Uso:
#   ./security/scripts/sast-semgrep.sh              # tabla legible, gate ERROR
#   SEMGREP_SARIF=1 ./security/scripts/sast-semgrep.sh   # emite semgrep.sarif
#
# Requiere: semgrep en PATH (pip install semgrep) o correrlo vía Docker:
#   docker run --rm -v "$PWD:/src" returntocorp/semgrep semgrep ...
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEC_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${SEC_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

if ! command -v semgrep >/dev/null 2>&1; then
  echo "✗ semgrep no está instalado. Instala con: pip install semgrep"
  echo "  (o usa la imagen Docker returntocorp/semgrep). En CI ya viene incluido."
  exit 127
fi

CONFIGS=(
  "--config=${SEC_DIR}/semgrep.yml"
  "--config=p/default"
  "--config=p/typescript"
  "--config=p/javascript"
  "--config=p/nodejs"
  "--config=p/react"
  "--config=p/owasp-top-ten"
  "--config=p/secrets"
  "--config=p/jwt"
)

EXTRA_ARGS=(
  --error                # exit 1 si hay findings de severidad ERROR
  --disable-version-check
  --metrics=off
  --exclude=node_modules
  --exclude=.next
  --exclude=dist
  --exclude=coverage
)

if [[ "${SEMGREP_SARIF:-0}" == "1" ]]; then
  EXTRA_ARGS+=(--sarif --output=semgrep.sarif)
fi

echo "→ Semgrep sobre backend/ y frontend/ ..."
semgrep "${CONFIGS[@]}" "${EXTRA_ARGS[@]}" backend/ frontend/
echo "✓ Semgrep OK (sin hallazgos ERROR)."

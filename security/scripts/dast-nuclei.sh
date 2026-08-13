#!/usr/bin/env bash
#
# dast-nuclei.sh — nuclei contra una URL objetivo. Propiedad: devops.
# =============================================================================
# Corre nuclei con una selección de templates (security/nuclei/templates.txt)
# orientada al stack. Falla (exit 1) si hay hallazgos de severidad high/critical.
#
# Uso:
#   TARGET_URL=https://staging.tudominio.com ./security/scripts/dast-nuclei.sh
#
# Requiere: nuclei en PATH (https://github.com/projectdiscovery/nuclei) o Docker:
#   docker run --rm projectdiscovery/nuclei ...
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEC_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${SEC_DIR}/.." && pwd)"

: "${TARGET_URL:?Define TARGET_URL (ej. https://staging.tudominio.com)}"

if [[ "${TARGET_URL}" == *"tudominio.com"* && "${TARGET_URL}" != *"staging"* ]]; then
  if [[ "${ALLOW_PROD_DAST:-0}" != "1" ]]; then
    echo "✗ TARGET_URL parece producción. Requiere autorización + ALLOW_PROD_DAST=1."
    exit 2
  fi
fi

if ! command -v nuclei >/dev/null 2>&1; then
  echo "✗ nuclei no está instalado. Ver https://github.com/projectdiscovery/nuclei"
  exit 127
fi

REPORT_DIR="${ROOT_DIR}/security/reports"
mkdir -p "${REPORT_DIR}"

# Construye los flags -tags a partir de templates.txt (ignora comentarios/vacíos).
TAGS="$(grep -vE '^\s*#|^\s*$' "${SEC_DIR}/nuclei/templates.txt" | paste -sd, -)"

echo "→ nuclei contra ${TARGET_URL} (tags: ${TAGS}) ..."
# -rl rate-limit para no saturar staging; -severity gate al reportar.
nuclei \
  -u "${TARGET_URL}" \
  -tags "${TAGS}" \
  -severity low,medium,high,critical \
  -rate-limit "${NUCLEI_RATE_LIMIT:-50}" \
  -jsonl -o "${REPORT_DIR}/nuclei.jsonl" \
  -stats

# Gate: falla si hay high/critical en el reporte.
if grep -Eq '"severity":"(high|critical)"' "${REPORT_DIR}/nuclei.jsonl" 2>/dev/null; then
  echo "✗ nuclei encontró hallazgos high/critical (ver security/reports/nuclei.jsonl)."
  exit 1
fi
echo "✓ nuclei OK (sin high/critical)."

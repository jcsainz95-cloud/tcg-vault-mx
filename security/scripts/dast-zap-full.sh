#!/usr/bin/env bash
#
# dast-zap-full.sh — OWASP ZAP full scan (activo) contra una URL. devops.
# =============================================================================
# Barrido COMPLETO y ACTIVO (spider + ajax spider + reglas activas: inyección,
# XSS, etc.). Es INTRUSIVO: solo contra STAGING con datos sintéticos, o contra
# producción DENTRO de una ventana de prueba puntual AUTORIZADA POR ESCRITO.
#
# Uso:
#   TARGET_URL=https://staging.tudominio.com ./security/scripts/dast-zap-full.sh
#
# Requiere Docker (imagen oficial de ZAP). Más lento que el baseline; se usa en
# el cron semanal (security-scheduled.yml) y en pruebas puntuales autorizadas.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEC_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${SEC_DIR}/.." && pwd)"

: "${TARGET_URL:?Define TARGET_URL (ej. https://staging.tudominio.com)}"

# Guardia anti-producción compartida (P-21 cierre): decide por HOST, no por
# substring de la URL — ver security/scripts/_guard.sh. Source obligatorio.
# Este scan es ACTIVO: contra prod solo con ventana autorizada + ALLOW_PROD_DAST=1.
source "${SCRIPT_DIR}/_guard.sh"
dast_prod_guard "${TARGET_URL}"

REPORT_DIR="${ROOT_DIR}/security/reports"
mkdir -p "${REPORT_DIR}"

echo "→ ZAP FULL scan (activo) contra ${TARGET_URL} ..."
docker run --rm \
  -v "${SEC_DIR}/zap:/zap/wrk/conf:ro" \
  -v "${REPORT_DIR}:/zap/wrk/out:rw" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-full-scan.py \
    -t "${TARGET_URL}" \
    -c /zap/wrk/conf/baseline.conf \
    -r /zap/wrk/out/zap-full.html \
    -w /zap/wrk/out/zap-full.md \
    -J /zap/wrk/out/zap-full.json \
    -m 10

echo "✓ ZAP full scan terminó. Reportes en security/reports/."

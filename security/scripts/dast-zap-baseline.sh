#!/usr/bin/env bash
#
# dast-zap-baseline.sh — OWASP ZAP baseline (pasivo) contra una URL. devops.
# =============================================================================
# Barrido RÁPIDO y NO intrusivo (spider + reglas pasivas). Apto para correr en
# cada deploy a staging y bloquear la promoción a prod si hay FAIL.
#
#   TARGET_URL es OBLIGATORIA. NUNCA apuntes a producción sin autorización
#   escrita (ver runbook de prueba puntual en docs/DEVOPS_NOTES.md).
#
# Uso:
#   TARGET_URL=https://staging.tudominio.com ./security/scripts/dast-zap-baseline.sh
#
# Requiere Docker (imagen oficial de ZAP). En esta sesión no hay daemon; corre
# de verdad en CI (e2e/deploy/scheduled) o en un host con Docker.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEC_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${SEC_DIR}/.." && pwd)"

: "${TARGET_URL:?Define TARGET_URL (ej. https://staging.tudominio.com)}"

# Guardia anti-producción compartida (P-21 cierre): decide por HOST, no por
# substring de la URL — ver security/scripts/_guard.sh. Source obligatorio.
source "${SCRIPT_DIR}/_guard.sh"
dast_prod_guard "${TARGET_URL}"

REPORT_DIR="${ROOT_DIR}/security/reports"
mkdir -p "${REPORT_DIR}"

echo "→ ZAP baseline contra ${TARGET_URL} ..."
# -c config con reglas (FAIL/WARN/IGNORE); -I no falla por WARN; el gate lo
# marcan las reglas FAIL de baseline.conf. -r reporte HTML, -w markdown, -J json.
docker run --rm \
  -v "${SEC_DIR}/zap:/zap/wrk/conf:ro" \
  -v "${REPORT_DIR}:/zap/wrk/out:rw" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py \
    -t "${TARGET_URL}" \
    -c /zap/wrk/conf/baseline.conf \
    -r /zap/wrk/out/zap-baseline.html \
    -w /zap/wrk/out/zap-baseline.md \
    -J /zap/wrk/out/zap-baseline.json \
    -m 5 \
    -T 60

echo "✓ ZAP baseline terminó. Reportes en security/reports/."

#!/usr/bin/env bash
#
# dast-extra.sh — Wrappers para sqlmap / nikto / ffuf. Propiedad: devops.
# =============================================================================
# Herramientas ofensivas puntuales, dirigidas por el pentester. Este script es
# SOLO el andamiaje de infraestructura (parametrización por TARGET_URL, salida
# a security/reports/, rate-limit). La METODOLOGÍA y los casos concretos viven
# en docs/PENTEST_NOTES.md (rol pentester); el VEREDICTO en SECURITY_NOTES.md.
#
#   Estas herramientas son INTRUSIVAS. Contra prod: solo dentro de una ventana
#   de prueba puntual AUTORIZADA POR ESCRITO (runbook en docs/DEVOPS_NOTES.md).
#
# Uso:
#   TARGET_URL=https://staging.tudominio.com ./security/scripts/dast-extra.sh nikto
#   TARGET_URL=https://staging.tudominio.com/api/v1/... ./security/scripts/dast-extra.sh sqlmap
#   TARGET_URL=https://staging.tudominio.com ./security/scripts/dast-extra.sh ffuf
#
# Requiere Docker o las herramientas instaladas localmente.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEC_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${SEC_DIR}/.." && pwd)"

TOOL="${1:-help}"
: "${TARGET_URL:?Define TARGET_URL}"

if [[ "${TARGET_URL}" == *"tudominio.com"* && "${TARGET_URL}" != *"staging"* ]]; then
  if [[ "${ALLOW_PROD_DAST:-0}" != "1" ]]; then
    echo "✗ Herramienta intrusiva contra lo que parece prod. Requiere autorización + ALLOW_PROD_DAST=1."
    exit 2
  fi
fi

REPORT_DIR="${ROOT_DIR}/security/reports"
mkdir -p "${REPORT_DIR}"

case "${TOOL}" in
  nikto)
    echo "→ nikto contra ${TARGET_URL} ..."
    docker run --rm -v "${REPORT_DIR}:/out" sullo/nikto \
      -h "${TARGET_URL}" -maxtime 120s -o /out/nikto.txt -Format txt
    ;;
  sqlmap)
    # sqlmap dirigido a un endpoint concreto. --batch no interactivo, --crawl 0
    # (sin crawl automático), risk/level bajos por defecto para no saturar.
    echo "→ sqlmap contra ${TARGET_URL} (dirigido, no intrusivo por defecto) ..."
    docker run --rm -v "${REPORT_DIR}:/out" hysnsec/sqlmap \
      -u "${TARGET_URL}" --batch --level="${SQLMAP_LEVEL:-1}" --risk="${SQLMAP_RISK:-1}" \
      --output-dir=/out/sqlmap
    ;;
  ffuf)
    # Fuzzing de rutas/params. Requiere una wordlist montada. Placeholder: usa
    # una wordlist estándar del contenedor; el pentester ajusta FFUF_WORDLIST.
    echo "→ ffuf contra ${TARGET_URL}/FUZZ ..."
    docker run --rm -v "${REPORT_DIR}:/out" ghcr.io/ffuf/ffuf \
      -u "${TARGET_URL}/FUZZ" \
      -w "${FFUF_WORDLIST:-/usr/share/seclists/Discovery/Web-Content/common.txt}" \
      -mc 200,204,301,302,307,401,403 \
      -rate "${FFUF_RATE:-50}" \
      -o /out/ffuf.json -of json
    ;;
  help|*)
    cat <<EOF
Uso: TARGET_URL=... ./security/scripts/dast-extra.sh <nikto|sqlmap|ffuf>

  nikto   escaneo de servidor web (misconfigs, archivos peligrosos)
  sqlmap  prueba de inyección SQL dirigida a un endpoint (TARGET_URL = endpoint)
  ffuf    fuzzing de rutas/parametros (FFUF_WORDLIST para la wordlist)

La metodología concreta la define el pentester en docs/PENTEST_NOTES.md.
EOF
    ;;
esac

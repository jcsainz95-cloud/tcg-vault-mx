#!/usr/bin/env bash
#
# dast-selftest.sh — ¿el candado del DAST sabe ponerse ROJO?  ·  devops
# =============================================================================
# Levanta security/dast-selftest/canary.py (blanco con vulnerabilidades
# PLANTADAS), lo escanea con el MISMO ZAP, la MISMA política de
# security/zap/baseline.conf y el MISMO security/scripts/dast-gate.py que usa
# el barrido semanal, y EXIGE que el gate salga en ROJO.
#
#   Verde del gate sobre el canario  ->  ESTE SCRIPT FALLA.
#
# Por qué existe: durante toda la vida del proyecto el DAST apuntó a un
# `STAGING_BASE_URL` que nunca se creó. Nadie vio jamás al escáner encontrar
# nada ni al gate bloquear nada, y aun así el tablero decía "DAST cableado".
# Esto convierte esa creencia en una medición que se repite cada semana.
#
# Es BARATO a propósito (el canario son ~5s de arranque y un blanco de 4 URLs,
# frente a los ~140s de levantar el stack real). Lo que verifica es la cadena
# escáner → política → candado, que es donde estaba el agujero; que el stack
# real levanta ya lo mide e2e-real.yml en cada corrida nocturna.
#
# Uso:  ./security/scripts/dast-selftest.sh          (necesita Docker)
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEC_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${SEC_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

COMPOSE="docker-compose.dast-selftest.yml"
PORT="${DAST_CANARY_PORT:-8088}"
TARGET="http://localhost:${PORT}"
REPORT_DIR="${ROOT_DIR}/security/reports/selftest"
SCAN_PROFILE="${SCAN_PROFILE:-full}"
ZAP_IMAGE="${ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:stable}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

cleanup() { docker compose -f "${COMPOSE}" down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

mkdir -p "${REPORT_DIR}"; chmod -R 777 "${ROOT_DIR}/security/reports" 2>/dev/null || true

log "Levantando canario vulnerable (${TARGET})"
docker compose -f "${COMPOSE}" up -d || exit 1
for i in $(seq 1 30); do
  curl -sf "${TARGET}/" >/dev/null 2>&1 && { echo "canario arriba (intento $i)"; break; }
  [ "$i" = "30" ] && { echo "::error::El canario no arrancó."; docker compose -f "${COMPOSE}" logs; exit 1; }
  sleep 2
done

if [ "${SCAN_PROFILE}" = "full" ]; then ZAP_SCRIPT="zap-full-scan.py"; else ZAP_SCRIPT="zap-baseline.py"; fi

log "ZAP ${SCAN_PROFILE} contra el canario (misma imagen, misma política que el barrido semanal)"
T0="$(date +%s)"
# Pared de reloj + tope del escaneo activo. `scanner.` es el prefijo correcto
# (no `ascan.`, que ZAP ignora en silencio — ver dast-ephemeral.sh).
timeout --signal=INT 900s \
docker run --rm --network host \
  -v "${SEC_DIR}/zap:/zap/wrk/conf:ro" \
  -v "${REPORT_DIR}:/zap/wrk/out:rw" \
  "${ZAP_IMAGE}" "${ZAP_SCRIPT}" \
    -t "${TARGET}" \
    -c /zap/wrk/conf/baseline.conf \
    -J /zap/wrk/out/zap-canary.json \
    -w /zap/wrk/out/zap-canary.md \
    -m 1 -T 5 -I \
    -z "-config scanner.maxScanDurationInMins=4 -config scanner.maxRuleDurationInMins=1"
echo "ZAP sobre el canario: $(( $(date +%s) - T0 ))s"

log "Veredicto invertido: se EXIGE rojo"
python3 "${SCRIPT_DIR}/dast-gate.py" \
  --zap-json "${REPORT_DIR}/zap-canary.json" \
  --policy "${SEC_DIR}/zap/baseline.conf" \
  --summary "${REPORT_DIR}/selftest-summary.md" \
  --label "Autoprueba del candado (canario con vulnerabilidades plantadas)" \
  --target "${TARGET}" \
  --expect-red

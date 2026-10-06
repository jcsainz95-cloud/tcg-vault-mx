#!/usr/bin/env bash
#
# check-csp-zap-parity.sh — «la CSP en `enforce` y las reglas 10038/10055 de ZAP
#                            en FAIL se mueven JUNTAS»          · devops · LIVE-3
# =============================================================================
# DE DÓNDE VIENE (API_CONTRACT §14.3, LIVE-3 · SEC-HDR-2)
# ---------------------------------------------------------------------------
# La CSP con nonce sale en dos fases, controladas por una CONSTANTE en código
# (`frontend/src/security/csp.ts`, `CSP_MODE`):
#   1. `report-only` — cabecera `Content-Security-Policy-Report-Only`. ZAP no la
#      cuenta como CSP: 10038/10055 tienen que seguir en WARN, o el DAST de
#      release se pone rojo por un hallazgo ESPERADO.
#   2. `enforce` — cabecera `Content-Security-Policy`. El contrato manda subir
#      **10038 y 10055 a FAIL en `security/zap/baseline.conf` en el mismo cambio**
#      (SECURITY_NOTES.md:13030-13037): si no, una regresión que pierda la CSP
#      pasaría el DAST en WARN, sin que nadie lo vea.
# Dos ficheros de dos dueños (frontend la constante, devops la política) que
# deben cambiar a la vez: es exactamente el tipo de pareja que se desincroniza
# en silencio. Este candado la ata.
#
# REGLAS
#   · csp.ts no existe              ⇒ rc 0 «no aplica todavía» (lo dice; no es verde de la pareja)
#   · CSP_MODE no se puede leer     ⇒ rc 2 (la constante tiene que ser un literal)
#   · enforce  y 10038/10055 ≠ FAIL ⇒ rc 1
#   · report-only y alguna en FAIL  ⇒ rc 1
#
# Uso:  ./scripts/check-csp-zap-parity.sh [<csp.ts> <baseline.conf>]
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CSP="${1:-$ROOT_DIR/frontend/src/security/csp.ts}"
CONF="${2:-$ROOT_DIR/security/zap/baseline.conf}"

[ -f "$CONF" ] || { echo "::error::no existe $CONF. NO concluyente."; exit 2; }
if [ ! -f "$CSP" ]; then
  echo "  · $CSP no existe todavía: la pareja CSP_MODE ↔ 10038/10055 no aplica (no es un verde de LIVE-3)."
  exit 0
fi

MODE="$(sed -n "s/^export const CSP_MODE[^=]*= *'\([a-z-]*\)'.*/\1/p" "$CSP" | head -1)"
case "$MODE" in
  report-only|enforce) ;;
  *) echo "::error file=$CSP::no pude leer CSP_MODE como literal ('report-only' | 'enforce'). LIVE-3 exige una constante en código; NO concluyente."; exit 2 ;;
esac
accion() { awk -F'\t' -v r="$1" '$1==r {print $2; exit}' "$CONF"; }
A38="$(accion 10038)"; A55="$(accion 10055)"; A38="${A38:-WARN(no listada)}"; A55="${A55:-WARN(no listada)}"

echo "  CSP_MODE=$MODE · ZAP 10038=$A38 · 10055=$A55"
if [ "$MODE" = "enforce" ]; then
  if [ "$A38" = "FAIL" ] && [ "$A55" = "FAIL" ]; then
    echo "  ✔ enforce con 10038 y 10055 en FAIL: una regresión que pierda la CSP bloquea el DAST."; exit 0
  fi
  echo "::error file=$CONF::LIVE-3: CSP_MODE='enforce' pero 10038=$A38 y 10055=$A55. El contrato (§14.3) exige subirlas a FAIL en el MISMO cambio. Dueño: devops (baseline.conf)."
  exit 1
fi
if [ "$A38" = "FAIL" ] || [ "$A55" = "FAIL" ]; then
  echo "::error file=$CONF::LIVE-3: CSP_MODE='report-only' y 10038=$A38 / 10055=$A55. Con Report-Only ZAP no ve CSP: el DAST de release se pondría rojo por un hallazgo esperado. Bájalas a WARN hasta el paso a 'enforce'."
  exit 1
fi
echo "  ✔ report-only con 10038/10055 en WARN (se suben a FAIL en el mismo cambio que pase a 'enforce')."
exit 0

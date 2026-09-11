#!/usr/bin/env bash
#
# check-dast-report-only-expiry.sh — ⏳ «`report_only: true` del DAST de release
# tiene fecha, y el rojo sale solo» · devops
# =============================================================================
# DE DÓNDE VIENE (techlead F1-1, 2026-09-11)
# ---------------------------------------------------------------------------
# `deploy.yml > dast-release` llama al DAST con `report_only: true` (C2): el
# run no se pone rojo mientras seguridad calibra la política con los primeros
# barridos reales. Eso es legítimo HOY y deja de serlo el día que nadie lo
# retire: un «modo calibración» que sobrevive a su motivo es un gate apagado
# con otro nombre (ARCHITECTURE §0-B.3 regla 9(b); misma familia que
# `price-provider-parity.sh --check-expiry`, ci.yml `price-provider-interim-expiry`).
#
# QUÉ HACE (estático: lee un fichero, sin red)
#   · Aísla el BLOQUE del job `dast-release` de deploy.yml (no el fichero entero:
#     mencionar no es cablear) y mira si lleva `report_only: true`.
#   · Si NO lo lleva → verde: el DAST ya bloquea el run. Nada que retirar.
#   · Si lo lleva y hoy < FECHA_LIMITE → verde con aviso (quedan N días).
#   · Si lo lleva y hoy ≥ FECHA_LIMITE → ROJO (rc=9) con el comando de retiro.
#   · Si no hay bloque `dast-release` → rc=2: NO concluyente (eso lo vigila
#     check-provenance-gate.sh #5; aquí no se finge verde).
#
# Lo que `report_only` YA NO hace (F1-1): abrir el gate de promoción. `blocking`
# se calcula en todos los modos (dast-gate.py → GITHUB_OUTPUT) y los `promote-*`
# exigen `== 'false'`. Este script solo vigila que el «no pone rojo» tenga fin.
#
# Uso:  ./scripts/check-dast-report-only-expiry.sh [--today YYYY-MM-DD] [--deploy RUTA]
#       (`--today` y `--deploy` existen para el canario; en CI no se pasan)
# rc: 0 vigente o retirado · 9 CADUCÓ · 2 no concluyente
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR" || exit 2

# FECHA LÍMITE. Fijada por devops el 2026-09-11 tras el primer barrido `full`
# citable sobre lo publicado (run 34561010792, `c13f4179`, report_only=false,
# sin bloqueantes). Da cuatro barridos semanales (lunes 06:00 UTC: 09-14, 09-21,
# 09-28, 10-05) para que seguridad calibre. Moverla exige anotarlo en
# DEVOPS_NOTES con el motivo; no se mueve «porque caducó».
FECHA_LIMITE="2026-10-06"

DEPLOY=".github/workflows/deploy.yml"
HOY="$(date -u +%F)"
while [ $# -gt 0 ]; do
  case "$1" in
    --today)  HOY="$2"; shift 2 ;;
    --deploy) DEPLOY="$2"; shift 2 ;;
    *) echo "::error::argumento desconocido: $1"; exit 2 ;;
  esac
done
[[ "$HOY" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "::error::--today debe ser YYYY-MM-DD (recibí '$HOY')"; exit 2; }
[ -f "$DEPLOY" ] || { echo "::error::no existe $DEPLOY. NO concluyente."; exit 2; }

printf '\n\033[1m== ⏳ ¿`report_only` del DAST de release sigue dentro de plazo? ==\033[0m\n\n'

# Mismo aislamiento de bloque que check-provenance-gate.sh #5.
BLOQUE="$(awk '/^  dast-release:/{f=1} f&&/^  [a-z][a-z0-9-]*:$/&&!/^  dast-release:/{f=0} f' "$DEPLOY")"
if [ -z "$BLOQUE" ]; then
  echo "::error::$DEPLOY no tiene bloque \`dast-release\`. NO concluyente (que el DAST esté cableado lo vigila check-provenance-gate.sh #5)."
  exit 2
fi

# Solo cuenta el USO: se descartan líneas comentadas.
if ! grep -vE '^[[:space:]]*#' <<<"$BLOQUE" | grep -E '^[[:space:]]*report_only:[[:space:]]*true([[:space:]]|$)' >/dev/null; then
  printf '\033[1;32m  ✔ dast-release ya NO lleva `report_only: true`: el DAST bloquea el run. Nada que retirar.\033[0m\n'
  exit 0
fi

# Comparación lexicográfica de ISO-8601: válida sin `date -d` (portátil).
if [[ "$HOY" < "$FECHA_LIMITE" ]]; then
  DIAS="$(( ( $(date -u -d "$FECHA_LIMITE" +%s 2>/dev/null || echo 0) - $(date -u -d "$HOY" +%s 2>/dev/null || echo 0) ) / 86400 ))"
  printf '\033[1;33m  ⏳ dast-release lleva `report_only: true` — vigente hasta %s (hoy %s%s).\033[0m\n' \
    "$FECHA_LIMITE" "$HOY" "$( [ "$DIAS" -gt 0 ] && printf ', quedan %s días' "$DIAS" )"
  echo "::notice title=DAST en report_only::deploy.yml > dast-release sigue en report_only (calibración, C2). Caduca el $FECHA_LIMITE; lo sube a bloqueante seguridad."
  exit 0
fi

printf '\033[1;31m  ✗ `report_only: true` CADUCÓ el %s (hoy %s) y sigue en deploy.yml > dast-release.\033[0m\n' "$FECHA_LIMITE" "$HOY"
echo "::error title=report_only del DAST caducado::deploy.yml > dast-release sigue con report_only: true desde el $FECHA_LIMITE. Un modo de calibración sin fin es un gate apagado. Retiro: borra la línea 'report_only: true' del job dast-release (o ponla en false) — el rojo se apaga solo. Si seguridad necesita más plazo, se mueve FECHA_LIMITE en scripts/check-dast-report-only-expiry.sh CON motivo en DEVOPS_NOTES. Dueño: seguridad (decisión) / devops (cableado)."
exit 9

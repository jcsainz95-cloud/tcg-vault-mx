#!/usr/bin/env bash
#
# check-e2e-skip-census.sh — censo de salvaguardas de salto en la suite E2E de
# frontend (mockOnly / needsSeed / harnessLimit / skipIfSeedMissing) contra un
# BASELINE commiteado; rojo si alguna categoría CRECE sin nota · devops
# =============================================================================
# DE DÓNDE VIENE (techlead N7, 2026-09-11)
# ---------------------------------------------------------------------------
# Cada `mockOnly`/`needsSeed`/`harnessLimit`/`skipIfSeedMissing` es un test que
# en algún entorno NO mide. Son legítimos uno a uno y letales en conjunto: la
# suite «verde» va midiendo menos sin que nadie lo vea. Esto no juzga cada
# salvaguarda (eso es de frontend/QA): solo impide que el número suba en
# silencio. Subirlo exige regenerar el baseline CON motivo, en el mismo diff.
#
# QUÉ CUENTA: ocurrencias por palabra completa (`grep -rwo`) y ficheros que
# la contienen, en frontend/e2e/**/*.ts (utilidades incluidas: el método es
# uno solo y reproducible; el techlead contó 71/18 con otro método el
# 2026-09-11 — este script fija EL método).
#
# Uso:
#   ./scripts/check-e2e-skip-census.sh                       (gate)
#   ./scripts/check-e2e-skip-census.sh --update --motivo "…" (regenera baseline, con motivo)
#   ./scripts/check-e2e-skip-census.sh --dir D --baseline F  (para el canario)
# rc: 0 sin crecimiento · 1 alguna categoría creció · 2 no concluyente
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR" || exit 2
DIR="frontend/e2e"; BASELINE="scripts/e2e-skip-census.baseline"; UPDATE=0; MOTIVO=""
CLAVES="mockOnly needsSeed harnessLimit skipIfSeedMissing"
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;; --baseline) BASELINE="$2"; shift 2 ;;
    --update) UPDATE=1; shift ;; --motivo) MOTIVO="$2"; shift 2 ;;
    *) echo "::error::argumento desconocido: $1"; exit 2 ;;
  esac
done
[ -d "$DIR" ] || { echo "::error::no existe $DIR. NO concluyente."; exit 2; }
censo() { # imprime "clave ocurrencias ficheros"
  for k in $CLAVES; do
    printf '%s %s %s\n' "$k" "$(grep -rwo --include='*.ts' "$k" "$DIR" | wc -l)" "$(grep -rlw --include='*.ts' "$k" "$DIR" | wc -l)"
  done
}
ACTUAL="$(censo)"
if [ "$UPDATE" -eq 1 ]; then
  [ -n "$MOTIVO" ] || { echo "::error::--update exige --motivo \"…\": un baseline sin motivo es un número que nadie defiende."; exit 2; }
  { echo "# Baseline del censo de salvaguardas E2E (scripts/check-e2e-skip-census.sh)."
    echo "# Formato: clave ocurrencias ficheros. Se regenera SOLO con --update --motivo, en el mismo diff que el cambio."
    echo "# $(date -u +%F) · $MOTIVO"
    printf '%s\n' "$ACTUAL"; } > "$BASELINE"
  echo "baseline regenerado en $BASELINE:"; cat "$BASELINE"; exit 0
fi
[ -f "$BASELINE" ] || { echo "::error::falta $BASELINE. Genera uno: $0 --update --motivo \"…\". NO concluyente."; exit 2; }
printf '\n\033[1m== Censo de salvaguardas E2E (%s) vs baseline ==\033[0m\n\n' "$DIR"
CRECIO=0; BAJO=0
while read -r k n f; do
  b="$(grep -E "^$k " "$BASELINE" | awk '{print $2}')"; bf="$(grep -E "^$k " "$BASELINE" | awk '{print $3}')"
  [ -n "$b" ] || { echo "::error::el baseline no tiene la clave $k. NO concluyente."; exit 2; }
  if [ "$n" -gt "$b" ]; then CRECIO=$((CRECIO+1)); printf '  \033[1;31m✗ %-18s %3s → %3s ocurrencias (%s → %s ficheros): CRECIÓ\033[0m\n' "$k" "$b" "$n" "$bf" "$f"
  elif [ "$n" -lt "$b" ]; then BAJO=$((BAJO+1)); printf '  \033[1;33m↓ %-18s %3s → %3s ocurrencias (%s → %s ficheros): bajó (regenera el baseline para fijarlo)\033[0m\n' "$k" "$b" "$n" "$bf" "$f"
  else printf '  \033[1;32m✔ %-18s %3s ocurrencias en %s ficheros (= baseline)\033[0m\n' "$k" "$n" "$f"; fi
done <<<"$ACTUAL"
echo
if [ "$CRECIO" -ne 0 ]; then
  echo "::error title=censo E2E::$CRECIO categoría(s) de salvaguardas de salto CRECIERON respecto a $BASELINE. Cada una es un test que en algún entorno no mide. Si el crecimiento es deliberado: ./scripts/check-e2e-skip-census.sh --update --motivo \"…\" en el MISMO diff (dueño del motivo: frontend; del baseline: devops)."
  exit 1
fi
[ "$BAJO" -ne 0 ] && echo "::notice::el censo bajó en $BAJO categoría(s): regenera el baseline con --update para que el techo baje contigo."
printf '\033[1;32m✓ Censo dentro del baseline.\033[0m\n'; exit 0

#!/usr/bin/env bash
#
# measurement-e2e-run.sh — corre el E2E de medición de UN modo con SU config, y no deja pasar
# «0 pruebas» como si nada                                                       · devops
# =============================================================================
# DE DÓNDE VIENE (QA, B2, 2026-10-19, run 39202758169): el paso de e2e.yml corría
# `npx playwright test e2e/measurement-on.spec.ts` con la config POR DEFECTO, que ignora ese spec
# a propósito (`frontend/playwright.config.ts`, `testIgnore: '**/measurement-on.spec.ts'`): «No tests
# found», C-F3/C-F5 nunca corrieron en CI. Y C-F1 `on` miraba una carpeta de build que esa config no
# usa. Una sola tabla, aquí, decide config y carpeta por modo:
#
#   off · -c playwright.config.ts                  · build en $E2E_MOCK_DIST_DIR   = .next-e2e-measurement-off
#   on  · -c playwright.measurement-on.config.ts   · build en $E2E_MKT_ON_DIST_DIR = .next-e2e-measurement-on
#
# Antes de correr, LISTA las pruebas (`--list`) y exige > 0: si la config no encuentra el spec, el
# paso sale ROJO diciendo qué config y qué spec, no un «No tests found» suelto. Escribe en
# $GITHUB_OUTPUT `dist=<carpeta de build>` (la lee C-F1) y `tests=<n>`.
#
# Uso (desde la raíz del repo):  ./scripts/measurement-e2e-run.sh <off|on>
# Sale con el rc de Playwright; 1 si no hay pruebas; 2 si el modo es inválido.
# Canario: scripts/measurement-e2e-run-canary.sh
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODO="${1:-}"
case "$MODO" in
  off) CFG=playwright.config.ts;                DIST=.next-e2e-measurement-off; export E2E_MOCK_DIST_DIR="$DIST" ;;
  on)  CFG=playwright.measurement-on.config.ts; DIST=.next-e2e-measurement-on;  export E2E_MKT_ON_DIST_DIR="$DIST" ;;
  *) echo "uso: $0 <off|on>"; exit 2 ;;
esac
SPEC="e2e/measurement-$MODO.spec.ts"
cd "$ROOT_DIR/frontend" || exit 2
[ -f "$CFG" ] || { echo "::error title=E2E de medición ($MODO)::no existe frontend/$CFG. Dueño: frontend."; exit 1; }
out() { [ -n "${GITHUB_OUTPUT:-}" ] && echo "$1" >> "$GITHUB_OUTPUT"; echo "$1"; }
out "dist=frontend/$DIST"

LISTA="$(npx playwright test -c "$CFG" --list "$SPEC" 2>&1)"; rc_list=$?
N="$(grep -oE 'Total: [0-9]+ tests?' <<<"$LISTA" | grep -oE '[0-9]+' | tail -1)"
if [ -z "$N" ] || [ "$N" -eq 0 ]; then
  echo "$LISTA" | tail -5
  echo "::error title=E2E de medición ($MODO) · 0 PRUEBAS::-c $CFG no encuentra ninguna prueba en $SPEC (listado rc=$rc_list). El candado no midió nada: eso es ROJO, no un verde. ¿La config ignora el spec (testIgnore/testMatch) o el spec cambió de nombre? DEVOPS_NOTES §101.4."
  out "tests=0"; exit 1
fi
out "tests=$N"
echo "E2E de medición ($MODO): $N prueba(s) con -c $CFG; build en frontend/$DIST."
npx playwright test -c "$CFG" "$SPEC"

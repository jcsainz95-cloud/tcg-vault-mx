#!/usr/bin/env bash
#
# check-runner-pin-canary.sh — «¿el candado de runners fijados MUERDE?» · devops
# =============================================================================
# Ejercita `check-runner-pin.sh` sobre COPIAS de `.github/workflows/` y le planta
# la mutación literal del 2026-10-29 (un workflow con `runs-on: ubuntu-latest`)
# y sus variantes. Rojos Y verdes: un candado que siempre cierra tampoco sirve.
#
#   1. copia intacta                                          -> VERDE
#   2. workflow NUEVO de prueba con runs-on: ubuntu-latest    -> ROJO (el caso de #107)
#   3. un job real de ci.yml devuelto a ubuntu-latest         -> ROJO
#   4. "ubuntu-latest" entre comillas                         -> ROJO
#   5. lista [self-hosted, ubuntu-latest]                     -> ROJO
#   6. mapa {labels: [macos-latest]}                          -> ROJO
#   7. windows-latest                                         -> ROJO
#   8. runs-on: ${{ matrix.os }}                              -> ROJO
#   9. ubuntu-latest solo en un COMENTARIO                    -> VERDE
#  10. job reutilizable (uses:) sin runs-on                   -> VERDE
#  11. sin workflows                                          -> rc=2, NUNCA 0
#
# Uso:  ./scripts/check-runner-pin-canary.sh      (sin red, ~2 s)
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE="$ROOT_DIR/scripts/check-runner-pin.sh"

FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; FALLOS=$((FALLOS+1)); }

printf '\n\033[1m== ¿El candado de runners fijados muerde? ==\033[0m\n\n'
[ -x "$GATE" ] || { bad "No existe/ejecuta $GATE"; exit 1; }

BASE="$(mktemp -d -t runner-pin-canary-XXXXXX)"
trap 'rm -rf "$BASE"' EXIT

copia() { local d="$1"; rm -rf "$d"; mkdir -p "$d/.github/workflows"; cp "$ROOT_DIR"/.github/workflows/*.yml "$d/.github/workflows/"; }

# caso <ROJO|VERDE|RC2> <nombre> <dir> [<texto que debe aparecer>…]
caso() {
  local esperado="$1" nombre="$2" dir="$3"; shift 3
  local salida rc
  salida="$("$GATE" --root "$dir" 2>&1)"; rc=$?
  case "$esperado" in
    ROJO)  [ "$rc" -eq 1 ] || { bad "$nombre — esperaba ROJO (rc=1), salió rc=$rc"; return; } ;;
    VERDE) [ "$rc" -eq 0 ] || { bad "$nombre — esperaba VERDE (rc=0), salió rc=$rc"; printf '      %s\n' "$(grep -E '✗|error' <<<"$salida" | head -3)"; return; } ;;
    RC2)   [ "$rc" -eq 2 ] || { bad "$nombre — esperaba NO CONCLUYENTE (rc=2), salió rc=$rc"; return; } ;;
  esac
  for txt in "$@"; do
    grep -qF -- "$txt" <<<"$salida" || { bad "$nombre — rc correcto pero la salida no nombra «$txt»"; return; }
  done
  ok "$nombre — $esperado"
}

nuevo_wf() { # nuevo_wf <dir> <bloque runs-on (una línea, con sangría de 4)>
  printf 'name: canario\non: push\njobs:\n  canario-runner:\n%s\n    steps:\n      - run: echo ok\n' "$2" > "$1/.github/workflows/canario-runner.yml"
}

D="$BASE/c1"; copia "$D"
caso VERDE "Copia intacta de los workflows" "$D"

D="$BASE/c2"; copia "$D"; nuevo_wf "$D" '    runs-on: ubuntu-latest'
caso ROJO "Workflow nuevo con runs-on: ubuntu-latest (PR #107)" "$D" "canario-runner.yml" "canario-runner" "ubuntu-latest"

D="$BASE/c3"; copia "$D"
awk '!h && /^    runs-on: ubuntu-24\.04$/ {print "    runs-on: ubuntu-latest"; h=1; next} {print}' \
  "$D/.github/workflows/ci.yml" > "$D/x" && mv "$D/x" "$D/.github/workflows/ci.yml"
grep -q 'runs-on: ubuntu-latest' "$D/.github/workflows/ci.yml" || bad "c3: la mutación no se aplicó (¿cambió el pin de ci.yml?)"
caso ROJO "Un job real de ci.yml devuelto a ubuntu-latest" "$D" "ci.yml" "ubuntu-latest"

D="$BASE/c4"; copia "$D"; nuevo_wf "$D" '    runs-on: "ubuntu-latest"'
caso ROJO "\"ubuntu-latest\" entre comillas" "$D" "ubuntu-latest"

D="$BASE/c5"; copia "$D"; nuevo_wf "$D" '    runs-on: [self-hosted, ubuntu-latest]'
caso ROJO "Lista [self-hosted, ubuntu-latest]" "$D" "ubuntu-latest"

D="$BASE/c6"; copia "$D"; nuevo_wf "$D" '    runs-on: { labels: [macos-latest] }'
caso ROJO "Mapa {labels: [macos-latest]}" "$D" "macos-latest"

D="$BASE/c7"; copia "$D"; nuevo_wf "$D" '    runs-on: windows-latest'
caso ROJO "windows-latest" "$D" "windows-latest"

D="$BASE/c8"; copia "$D"; nuevo_wf "$D" '    runs-on: ${{ matrix.os }}'
caso ROJO "Expresión \${{ matrix.os }} (no fijable estáticamente)" "$D" "expresión"

D="$BASE/c9"; copia "$D"; nuevo_wf "$D" '    runs-on: ubuntu-24.04  # antes: ubuntu-latest'
caso VERDE "ubuntu-latest solo en un comentario" "$D"

D="$BASE/c10"; copia "$D"
printf 'name: canario\non: push\njobs:\n  llama:\n    uses: ./.github/workflows/e2e-real.yml\n' > "$D/.github/workflows/canario-reusable.yml"
caso VERDE "Job reutilizable (uses:) sin runs-on" "$D"

D="$BASE/c11"; copia "$D"; rm -f "$D"/.github/workflows/*.yml
caso RC2 "Sin workflows: no concluyente, nunca verde" "$D"

echo
if [ "$FALLOS" -ne 0 ]; then
  printf '\033[1;31m✗ Canario de runners fijados: %s/%s casos fallaron. El candado NO muerde donde debe.\033[0m\n' "$FALLOS" "$((PASADAS+FALLOS))"
  exit 1
fi
printf '\033[1;32m✓ Canario de runners fijados: %s/%s — muerde en los rojos y deja pasar los verdes.\033[0m\n' "$PASADAS" "$((PASADAS+FALLOS))"
exit 0

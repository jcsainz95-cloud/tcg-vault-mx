#!/usr/bin/env bash
#
# check-measurement-e2e-specs-canary.sh — ¿borrar un spec de medición es ROJO (y no un aviso)?   · devops
# =============================================================================
# D6 del techlead (2026-10-19): con la excepción PENDIENTE viva, borrar los dos specs antes de su
# caducidad convertía el candado de privacidad en un ::warning que pasaba. La excepción se retiró;
# esto lo vigila. Árboles temporales (nunca el repo):
#   los dos specs ⇒ rc 0 run=true · falta off ⇒ rc 1 · falta on ⇒ rc 1 · faltan los dos ⇒ rc 1 y sin
#   ::warning · modo inválido ⇒ rc 2.
# Uso: ./scripts/check-measurement-e2e-specs-canary.sh [N]
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$ROOT_DIR/scripts/check-measurement-e2e-specs.sh"; N="${1:-1}"
BASE="$(mktemp -d -t e2e-specs-canario-XXXXXX)"; trap 'rm -rf "$BASE"' EXIT
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }
arbol() { local d; d="$(mktemp -d "$BASE/t-XXXXXX")"; mkdir -p "$d/frontend/e2e"; for m in "$@"; do echo '// spec' > "$d/frontend/e2e/measurement-$m.spec.ts"; done; echo "$d"; }
caso() { # <rc> <nombre> <dir> <modo> <debe> [no-debe]
  local out rc; out="$(env -u GITHUB_OUTPUT "$CHECK" "$4" --root "$3" 2>&1)"; rc=$?
  if [ "$rc" -ne "$1" ]; then bad "$2 — rc=$rc, esperaba $1"; return; fi
  if [[ "$out" != *"$5"* ]]; then bad "$2 — no dice «$5»"; return; fi
  if [ -n "${6:-}" ] && [[ "$out" == *"$6"* ]]; then bad "$2 — dice «$6» y no debía"; return; fi
  ok "$2 — rc=$rc"
}
for ((r=1;r<=N;r++)); do
  printf '\n\033[1m== specs E2E de medición, ronda %s/%s ==\033[0m\n' "$r" "$N"
  caso 0 "los dos specs" "$(arbol off on)" on "run=true"
  caso 1 "falta measurement-off" "$(arbol on)" on "falta frontend/e2e/measurement-off.spec.ts"
  caso 1 "falta measurement-on" "$(arbol off)" off "falta frontend/e2e/measurement-on.spec.ts"
  caso 1 "faltan los dos (sin excepción PENDIENTE)" "$(arbol)" off "::error::" "::warning"
  caso 2 "modo inválido" "$(arbol off on)" ON "uso:"
done
printf '\n'
if [ "$FALLOS" -gt 0 ]; then printf '\033[1;31mROJO: %s/%s casos fallaron.\033[0m\n' "$FALLOS" "$((FALLOS+PASADAS))"; exit 1; fi
printf '\033[1;32mVERDE: %s/%s casos (N=%s): sin un spec de medición, el candado es rojo.\033[0m\n' "$PASADAS" "$PASADAS" "$N"

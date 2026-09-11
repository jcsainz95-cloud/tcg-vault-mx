#!/usr/bin/env bash
#
# check-provenance-gate-canary.sh — «¿la guarda SEC-OPS-1 muerde?» · devops
# =============================================================================
# QA midió (lote 2026-09-11) que `provenance-gate` lleva 0 rojos en 60 corridas
# y no tiene canario. La guarda (`check-provenance-gate.sh`) comprueba SIETE
# puntos de cableado leyendo ficheros relativos a su propia raíz. Aquí se copia
# la guarda y esos ficheros a una raíz TEMPORAL, se muta cada punto y se exige
# rojo; y se exige verde con la copia intacta.
#
#   1. copia intacta                                                    -> VERDE
#   2. start_backend() de stack-native.sh sin ASSERT_HEAD                -> ROJO
#   3. deploy.yml sin el job staging-serves-head                         -> ROJO
#   7-9. dast-release sin ref: github.sha / sin el job / stack efímero sin assert-serving-head -> ROJO
#   4. e2e-real.yml sin --newer-than                                     -> ROJO
#   5. stack-native.sh sin el subcomando verify:head                     -> ROJO
#   6. sin scripts/assert-serving-head.sh                                -> ROJO
#
# Uso:  ./scripts/check-provenance-gate-canary.sh
# Sale 0 si los 6 casos salen como deben. Sin red. ~1 s.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; FALLOS=$((FALLOS+1)); }

printf '\n\033[1m== ¿La guarda de procedencia SEC-OPS-1 muerde? ==\033[0m\n\n'
[ -x "$ROOT_DIR/scripts/check-provenance-gate.sh" ] || { bad "No existe la guarda"; exit 1; }

BASE="$(mktemp -d -t provenance-canary-XXXXXX)"
trap 'rm -rf "$BASE"' EXIT

copia() {  # copia <dir>: la guarda + los ficheros que lee
  local d="$1"; rm -rf "$d"; mkdir -p "$d/scripts" "$d/.github/workflows" "$d/security/scripts"
  cp "$ROOT_DIR/scripts/check-provenance-gate.sh" "$ROOT_DIR/scripts/assert-serving-head.sh" "$ROOT_DIR/scripts/stack-native.sh" "$d/scripts/"
  cp "$ROOT_DIR/.github/workflows/e2e-real.yml" "$ROOT_DIR/.github/workflows/deploy.yml" "$ROOT_DIR/.github/workflows/security-dast.yml" "$d/.github/workflows/"
  cp "$ROOT_DIR/security/scripts/dast-ephemeral.sh" "$d/security/scripts/"
}
caso() {  # caso <ROJO|VERDE> <nombre> <dir> [<texto esperado>]
  local esperado="$1" nombre="$2" dir="$3"; shift 3
  local salida rc
  salida="$("$dir/scripts/check-provenance-gate.sh" 2>&1)"; rc=$?
  if [ "$esperado" = ROJO ] && [ "$rc" -eq 0 ]; then bad "$nombre — quedó VERDE (rc=0)"; return; fi
  if [ "$esperado" = VERDE ] && [ "$rc" -ne 0 ]; then bad "$nombre — quedó ROJO (rc=$rc)"; printf '      %s\n' "$(grep -E '✖' <<<"$salida" | head -2)"; return; fi
  for t in "$@"; do grep -qF -- "$t" <<<"$salida" || { bad "$nombre — rc correcto pero no nombra «$t»"; return; }; done
  ok "$nombre — $esperado"
}

D="$BASE/c1"; copia "$D"
caso VERDE "Copia intacta" "$D"

D="$BASE/c2"; copia "$D"
python3 - "$D/scripts/stack-native.sh" <<'PY'
import re, sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
m = re.search(r'^start_backend\(\)[\s\S]*?^}', s, re.M); assert m, 'no encuentro start_backend()'
body = m.group(0); assert 'ASSERT_HEAD' in body, 'start_backend no menciona ASSERT_HEAD'
s = s.replace(body, body.replace('ASSERT_HEAD', 'QUITADO_POR_EL_CANARIO'))
open(p, 'w', encoding='utf-8').write(s)
PY
caso ROJO "start_backend() sin ASSERT_HEAD (reutiliza un backend sin saber qué sirve)" "$D" "SIN comprobar"

D="$BASE/c3"; copia "$D"
sed -i 's/^  staging-serves-head:$/  staging-serves-head-renombrado:/' "$D/.github/workflows/deploy.yml"
caso ROJO "deploy.yml sin el job staging-serves-head" "$D" "staging-serves-head"

D="$BASE/c4"; copia "$D"
sed -i 's/newer-than/newer-than-quitado/g; s/--newer-than-quitado/--xx/g' "$D/.github/workflows/e2e-real.yml"
caso ROJO "e2e-real.yml sin --newer-than (un contenedor superviviente daría verde)" "$D" "procedencia del stack"

D="$BASE/c5"; copia "$D"
sed -i 's/verify:head)/verify-head-quitado)/' "$D/scripts/stack-native.sh"
caso ROJO "stack-native.sh sin el subcomando verify:head" "$D" "verify:head"

D="$BASE/c6"; copia "$D"; rm -f "$D/scripts/assert-serving-head.sh"
caso ROJO "Sin scripts/assert-serving-head.sh" "$D" "FALTA"

# §56: la ruta de release. `dast-release` tiene que llamar al DAST con el SHA de
# este run, y el stack efímero tiene que exigir procedencia antes de escanear.
D="$BASE/c7"; copia "$D"
sed -i '/^  dast-release:/,/^  [a-z][a-z0-9-]*:$/{s/^\(\s*\)ref: \${{ github.sha }}$/\1ref: main/}' "$D/.github/workflows/deploy.yml"
caso ROJO "deploy.yml: dast-release sin 'ref: github.sha' (escanearía otro commit)" "$D" "dast-release"

D="$BASE/c8"; copia "$D"
sed -i 's/^  dast-release:$/  dast-release-renombrado:/' "$D/.github/workflows/deploy.yml"
caso ROJO "deploy.yml sin el job dast-release" "$D" "dast-release"

D="$BASE/c9"; copia "$D"
sed -i 's|assert-serving-head\.sh|assert-serving-head-quitado.sh|g' "$D/security/scripts/dast-ephemeral.sh"
caso ROJO "dast-ephemeral.sh sin assert-serving-head (el stack efímero no exige procedencia)" "$D" "procedencia"

echo
if [ "$FALLOS" -ne 0 ]; then
  printf '\033[1;31m✗ Canario de SEC-OPS-1: %s/%s casos fallaron.\033[0m\n' "$FALLOS" "$((PASADAS+FALLOS))"; exit 1
fi
printf '\033[1;32m✓ Canario de SEC-OPS-1: %s/%s.\033[0m\n' "$PASADAS" "$((PASADAS+FALLOS))"

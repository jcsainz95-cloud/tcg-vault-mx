#!/usr/bin/env bash
#
# check-e2e-provider-incapacitation-canary.sh — «¿la guarda del proveedor de
# PAGA muerde?» · devops
# =============================================================================
# QA midió (lote 2026-09-11) que `e2e-provider-guard` lleva 0 rojos en 60
# corridas y no tiene canario. Aquí se le dan COPIAS mutadas de los workflows
# reales (vía su override `WORKFLOWS=`) y se exige el color correcto:
#
#   1. copia intacta de e2e.yml                                   -> VERDE
#   2. `POKEMONPRICETRACKER_API_KEY` BORRADA del job backend-e2e    -> ROJO
#   3. la misma clave con un valor NO vacío (credencial viva)      -> ROJO
#   4. job de arnés Playwright sin la constancia
#      `E2E_GRADING_PROVIDER_INCAPACITATED: '1'`                    -> ROJO
#   5. workflow inexistente en la lista                            -> ROJO
#
# Uso:  ./scripts/check-e2e-provider-incapacitation-canary.sh
# Sale 0 si los 5 casos salen como deben. Sin red. ~2 s.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE="$ROOT_DIR/scripts/check-e2e-provider-incapacitation.sh"
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; FALLOS=$((FALLOS+1)); }

printf '\n\033[1m== ¿La guarda del proveedor de paga (§4.38r.6.1) muerde? ==\033[0m\n\n'
[ -x "$GATE" ] || { bad "No existe/ejecuta $GATE"; exit 1; }
python3 -c 'import yaml' 2>/dev/null || { bad "python3+PyYAML no disponible"; exit 1; }

BASE="$(mktemp -d -t provguard-canary-XXXXXX)"
trap 'rm -rf "$BASE"' EXIT

muta() {  # muta <fichero.yml> <código python sobre `d`>
  python3 - "$1" "$2" <<'PY'
import sys, yaml
f, code = sys.argv[1], sys.argv[2]
d = yaml.safe_load(open(f, encoding='utf-8'))
exec(code)
yaml.safe_dump(d, open(f, 'w', encoding='utf-8'), sort_keys=False, allow_unicode=True)
PY
}
# caso <ROJO|VERDE> <nombre> <fichero(s) para WORKFLOWS=> [<texto esperado>]
caso() {
  local esperado="$1" nombre="$2" wfs="$3"; shift 3
  local salida rc
  salida="$(WORKFLOWS="$wfs" "$GATE" 2>&1)"; rc=$?
  if [ "$esperado" = ROJO ] && [ "$rc" -eq 0 ]; then bad "$nombre — quedó VERDE (rc=0)"; return; fi
  if [ "$esperado" = VERDE ] && [ "$rc" -ne 0 ]; then bad "$nombre — quedó ROJO (rc=$rc)"; printf '      %s\n' "$(grep -E '✖' <<<"$salida" | head -2)"; return; fi
  for t in "$@"; do grep -qF -- "$t" <<<"$salida" || { bad "$nombre — rc correcto pero no nombra «$t»"; return; }; done
  ok "$nombre — $esperado"
}

# 1. intacto
cp "$ROOT_DIR/.github/workflows/e2e.yml" "$BASE/c1.yml"
caso VERDE "e2e.yml intacto" "$BASE/c1.yml"

# 2. clave borrada del job de integración
cp "$ROOT_DIR/.github/workflows/e2e.yml" "$BASE/c2.yml"
muta "$BASE/c2.yml" 'd["jobs"]["backend-e2e"]["env"].pop("POKEMONPRICETRACKER_API_KEY")'
caso ROJO "POKEMONPRICETRACKER_API_KEY borrada de backend-e2e (la ausencia por casualidad)" "$BASE/c2.yml" "NO está declarada"

# 3. credencial viva
cp "$ROOT_DIR/.github/workflows/e2e.yml" "$BASE/c3.yml"
muta "$BASE/c3.yml" 'd["jobs"]["backend-e2e"]["env"]["POKEMONPRICETRACKER_API_KEY"]="ppt_live_canario"'
caso ROJO "Clave con valor no vacío en backend-e2e (pagaría créditos en cada corrida)" "$BASE/c3.yml" "valor NO vacío"

# 4. arnés sin constancia
cp "$ROOT_DIR/.github/workflows/e2e.yml" "$BASE/c4.yml"
muta "$BASE/c4.yml" 'd["jobs"]["frontend-e2e"]["env"].pop("E2E_GRADING_PROVIDER_INCAPACITATED")'
caso ROJO "Arnés Playwright sin E2E_GRADING_PROVIDER_INCAPACITATED" "$BASE/c4.yml" "Falta E2E_GRADING_PROVIDER_INCAPACITATED"

# 5. fichero inexistente
caso ROJO "Workflow inexistente en la lista" "$BASE/no-existe.yml" "No existe"

echo
if [ "$FALLOS" -ne 0 ]; then
  printf '\033[1;31m✗ Canario de la guarda del proveedor: %s/%s casos fallaron.\033[0m\n' "$FALLOS" "$((PASADAS+FALLOS))"; exit 1
fi
printf '\033[1;32m✓ Canario de la guarda del proveedor: %s/%s.\033[0m\n' "$PASADAS" "$((PASADAS+FALLOS))"

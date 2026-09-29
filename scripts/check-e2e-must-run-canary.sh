#!/usr/bin/env bash
#
# check-e2e-must-run-canary.sh — «¿check-e2e-must-run.sh se pone ROJO cuando el
# spec que consume su semilla no se midió?» · devops (P-REL-3, 2026-09-29)
# =============================================================================
# Trabaja sobre reportes JSON SINTÉTICOS con la forma exacta del reporter `json`
# de @playwright/test 1.56.0 (medida 2026-09-29: raíz {config,suites,errors,stats};
# suite de fichero {title,file,line,specs,suites}; test {status,results[].status}).
# No depende de `frontend/` ni de un stack: prueba el INSTRUMENTO, no la suite.
#
# QUÉ EXIGE
#   1. 2 casos `expected` con un único `passed`             → rc=0
#   2. un caso `skipped` (sin semilla)                      → rc=1
#   3. `flaky` ["failed","skipped"] (reintento sobre filas
#      consumidas — el hueco MEDIDO con Playwright real)   → rc=1
#   4. `flaky` ["failed","passed"] (hubo reintento)         → rc=1
#   5. `unexpected` ["failed"]                              → rc=1
#   6. el spec no aparece en el reporte                     → rc=1
#   7. 1 caso con --min 2                                   → rc=1
#   8. reporte ausente                                      → rc=2
#   9. JSON roto                                            → rc=2
#  10. --min 0                                              → rc=2
#  11. CABLEADO en .github/workflows/e2e-real.yml: el paso SPEI corre el spec con
#      `--retries=0`, reporter json, `E2E_EXPECT_NOT_MEASURED=0`, y llama al
#      comprobador con `--min 2`; y el smoke por defecto NO incluye el spec (dos
#      corridas por siembra = la segunda se salta).
#
# Uso:  ./scripts/check-e2e-must-run-canary.sh
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE="$ROOT_DIR/scripts/check-e2e-must-run.sh"
WF="$ROOT_DIR/.github/workflows/e2e-real.yml"
SPEC="m4-ship-spei-real.spec.ts"
[ -x "$GATE" ] || { echo "✗ falta $GATE (o no es ejecutable)"; exit 1; }
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT

# report <fichero> <spec-file> <caso1> [<caso2> ...]; caso = "status:res1,res2"
report() {
  local out="$1" file="$2"; shift 2
  local specs="" i=0 c st rs results
  for c in "$@"; do
    i=$((i+1)); st="${c%%:*}"; rs="${c#*:}"; results=""
    IFS=',' read -r -a arr <<<"$rs"
    for x in "${arr[@]}"; do results="${results:+$results,}{\"status\":\"$x\"}"; done
    specs="${specs:+$specs,}{\"title\":\"@real caso $i\",\"file\":\"$file\",\"line\":$((100+i)),\"tests\":[{\"expectedStatus\":\"passed\",\"status\":\"$st\",\"results\":[${results}]}]}"
  done
  printf '{"config":{},"errors":[],"stats":{},"suites":[{"title":"%s","file":"%s","line":0,"specs":[],"suites":[{"title":"cubeta","file":"%s","line":110,"specs":[%s]}]}]}\n' \
    "$file" "$file" "$file" "$specs" > "$out"
}
expect_rc() { # expect_rc <rc esperado> <descripción> <args...>
  local want="$1" desc="$2"; shift 2
  "$GATE" "$@" >"$T/out" 2>&1; local got=$?
  if [ "$got" = "$want" ]; then ok "$desc (rc=$got)"; else bad "$desc: esperaba rc=$want, dio rc=$got"; sed 's/^/      /' "$T/out"; fi
}

printf '\n\033[1m== Canario: check-e2e-must-run.sh ==\033[0m\n\n'
report "$T/1.json" "$SPEC" "expected:passed" "expected:passed"
expect_rc 0 "1. 2 casos pasados en un intento → verde" --report "$T/1.json" --spec "$SPEC" --min 2
report "$T/2.json" "$SPEC" "expected:passed" "skipped:skipped"
expect_rc 1 "2. un caso SALTADO (sin semilla) → rojo" --report "$T/2.json" --spec "$SPEC" --min 2
report "$T/3.json" "$SPEC" "flaky:failed,skipped" "expected:passed"
expect_rc 1 "3. flaky [failed,skipped] (reintento sobre filas consumidas) → rojo" --report "$T/3.json" --spec "$SPEC" --min 2
grep -q "REINTENTO se saltó" "$T/out" && ok "3b. y lo nombra (reintento sobre filas consumidas)" || bad "3b. el rojo del caso 3 no nombra la causa"
report "$T/4.json" "$SPEC" "flaky:failed,passed" "expected:passed"
expect_rc 1 "4. flaky [failed,passed] (hubo reintento) → rojo" --report "$T/4.json" --spec "$SPEC" --min 2
report "$T/5.json" "$SPEC" "unexpected:failed" "expected:passed"
expect_rc 1 "5. unexpected [failed] → rojo" --report "$T/5.json" --spec "$SPEC" --min 2
report "$T/6.json" "otro.spec.ts" "expected:passed" "expected:passed"
expect_rc 1 "6. el spec no está en el reporte → rojo" --report "$T/6.json" --spec "$SPEC" --min 2
report "$T/7.json" "$SPEC" "expected:passed"
expect_rc 1 "7. 1 caso con --min 2 → rojo" --report "$T/7.json" --spec "$SPEC" --min 2
expect_rc 2 "8. reporte ausente → no concluyente" --report "$T/no-existe.json" --spec "$SPEC" --min 2
printf '{"suites":[' > "$T/9.json"
expect_rc 2 "9. JSON roto → no concluyente" --report "$T/9.json" --spec "$SPEC" --min 2
expect_rc 2 "10. --min 0 → no concluyente" --report "$T/1.json" --spec "$SPEC" --min 0

# 11. Cableado en el workflow (estructura, no conducta).
if [ ! -f "$WF" ]; then bad "11. falta $WF"; else
  STEP="$(awk '/name: P-REL-3/{f=1} f&&/^      - name:/&&!/P-REL-3/{exit} f' "$WF")"
  [ -n "$STEP" ] && ok "11a. e2e-real.yml tiene el paso P-REL-3" || bad "11a. e2e-real.yml no tiene el paso P-REL-3"
  for needle in "$SPEC" "--retries=0" "PLAYWRIGHT_JSON_OUTPUT_NAME" "E2E_EXPECT_NOT_MEASURED: '0'" "check-e2e-must-run.sh" "--min 2"; do
    printf '%s' "$STEP" | grep -qF -- "$needle" && ok "11b. el paso lleva «$needle»" || bad "11b. al paso P-REL-3 le falta «$needle»"
  done
  grep -E "^\s+SMOKE_SPECS:|default: \"" "$WF" | grep -qF "$SPEC" \
    && bad "11c. el smoke por defecto incluye $SPEC: correría dos veces por siembra" \
    || ok "11c. el smoke por defecto NO incluye $SPEC (una corrida por siembra)"
fi

echo
if [ "$FALLOS" -ne 0 ]; then printf '\033[1;31m✗ Canario: %d fallo(s), %d bien. El comprobador NO muerde como debe.\033[0m\n' "$FALLOS" "$PASADAS"; exit 1; fi
printf '\033[1;32m✓ Canario: %d/%d. El comprobador se pone rojo cuando el spec que consume su semilla no se midió.\033[0m\n' "$PASADAS" "$PASADAS"

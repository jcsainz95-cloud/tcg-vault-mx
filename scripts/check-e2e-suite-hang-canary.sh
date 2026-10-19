#!/usr/bin/env bash
#
# check-e2e-suite-hang-canary.sh — «una suite colgada es ROJO CON MOTIVO, no un cancelled mudo de 6 h»  · devops
# =============================================================================
# DE DÓNDE VIENE (2026-10-19, DEVOPS_NOTES §102): `backend-e2e` (e2e.yml) se colgaba en «Test de
# integración» hasta que GitHub lo cortaba a las 6 h (run 39152042442 en `production`: paso 358,9 min,
# job `cancelled`, `e2e-ok` = failure sin decir por qué). Ahora el paso tiene presupuesto propio
# (`timeout` 35 min) y escribe `colgada=1`, el veredicto de fase lo nombra `suite-colgada` y `e2e-ok`
# lo dice. Este canario EJECUTA los `run:` REALES de e2e.yml (scripts/run-workflow-step.sh) con un
# `npm` de mentira y resultados simulados de pasos/jobs, y exige el veredicto correcto:
#
#   A · paso «Test de integración» (presupuesto E2E_SUITE_TIMEOUT=2s):
#       cuelgue sin resumen ⇒ rc 1 «SE COLGÓ» + «no llegó a imprimir» · cuelgue tras el resumen de
#       jest ⇒ rc 1 «handles abiertos» · tests en rojo ⇒ rc 1 SIN «SE COLGÓ» · verde ⇒ rc 0.
#   B · «Veredicto de fase»: success ⇒ suite-verde · failure+colgada ⇒ suite-colgada ·
#       cancelled ⇒ suite-colgada · failure sin colgada ⇒ suite-roja · tests skipped + Install
#       failure ⇒ infra-muerta (paso Install).
#   C · `e2e-ok` «Resumen»: failure+suite-colgada y cancelled+suite-colgada ⇒ rc 1 «SE COLGÓ» ·
#       failure+suite-roja ⇒ rc 1 «CORRIÓ y falló» sin «COLGÓ» · success ⇒ rc 0.
# Uso: ./scripts/check-e2e-suite-hang-canary.sh [N]      (sin red, sin Docker, ~30 s por ronda)
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="$ROOT_DIR/scripts/run-workflow-step.sh"; WF=.github/workflows/e2e.yml
N="${1:-1}"
BASE="$(mktemp -d -t hang-canario-XXXXXX)"; trap 'rm -rf "$BASE"' EXIT
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }

# npm de mentira: lo que haga lo decide FAKE_NPM.
mkdir -p "$BASE/bin"
cat > "$BASE/bin/npm" <<'NPM'
#!/usr/bin/env bash
case "${FAKE_NPM:-}" in
  cuelga)         echo "RUNS test/integration/a.e2e-spec.ts"; exec sleep 300 ;;
  cuelga-resumen) echo "PASS test/integration/a.e2e-spec.ts"; echo "Tests:       3 passed, 3 total"
                  echo "Jest did not exit one second after the test run has completed."; exec sleep 300 ;;
  rojo)           echo "FAIL test/integration/a.e2e-spec.ts"; echo "Tests:       1 failed, 2 passed, 3 total"; exit 1 ;;
  verde)          echo "PASS test/integration/a.e2e-spec.ts"; echo "Tests:       3 passed, 3 total"; exit 0 ;;
  *)              echo "FAKE_NPM sin definir"; exit 99 ;;
esac
NPM
chmod +x "$BASE/bin/npm"

# caso <rc esperado> <nombre> <debe contener> <no debe contener|-> <job> <paso> [VAR=valor…]
caso() {
  local esp="$1" nombre="$2" debe="$3" nodebe="$4" job="$5" paso="$6"; shift 6
  # `timeout 60`: si alguien quita el presupuesto del paso, el canario no se cuelga con él: sale rojo.
  local out rc; out="$(env "$@" PATH="$BASE/bin:$PATH" timeout 60 "$RUN" "$WF" "$job" "$paso" --root "$ROOT_DIR" 2>&1)"; rc=$?
  if [ "$rc" -ne "$esp" ]; then bad "$nombre — rc=$rc, esperaba $esp. $(grep -E '::error|fase=' <<<"$out" | head -2 | tr '\n' ' ')"; return; fi
  if [[ "$out" != *"$debe"* ]]; then bad "$nombre — rc=$rc correcto pero no dice «$debe»"; return; fi
  if [ "$nodebe" != "-" ] && [[ "$out" == *"$nodebe"* ]]; then bad "$nombre — dice «$nodebe» y no debía"; return; fi
  ok "$nombre — rc=$rc («$debe»)"
}
fase() { printf '{"steps.secrets.outcome":"success","steps.provider_guard.outcome":"success","steps.script_guard.outcome":"success","steps.setup_node.outcome":"success","steps.install.outcome":"%s","steps.s3.outcome":"success","steps.prisma.outcome":"success","steps.seed.outcome":"success","steps.tests.outcome":"%s","steps.tests.outputs.colgada":"%s","steps.tests.outputs.colgada_motivo":"motivo-canario"}' "$1" "$2" "$3"; }
ok_job() { printf '{"needs.backend-e2e.result":"%s","needs.backend-e2e.outputs.fase":"%s","needs.backend-e2e.outputs.paso":"Test de integración (E2E backend)","needs.frontend-e2e.result":"success","needs.measurement-e2e.result":"success"}' "$1" "$2"; }

for ((r=1;r<=N;r++)); do
  printf '\n\033[1m== backend-e2e: cuelgue ≠ rojo — ronda %s/%s ==\033[0m\n' "$r" "$N"
  caso 1 "A · cuelgue sin resumen" "no llegó a imprimir su resumen" - backend-e2e tests FAKE_NPM=cuelga E2E_SUITE_TIMEOUT=2s
  caso 1 "A · cuelgue tras el resumen de jest" "handles abiertos" - backend-e2e tests FAKE_NPM=cuelga-resumen E2E_SUITE_TIMEOUT=2s
  caso 1 "A · tests en rojo (no es cuelgue)" "FAIL test/integration" "SE COLGÓ" backend-e2e tests FAKE_NPM=rojo E2E_SUITE_TIMEOUT=2s
  caso 0 "A · tests verdes" "3 passed" "SE COLGÓ" backend-e2e tests FAKE_NPM=verde E2E_SUITE_TIMEOUT=2s
  caso 0 "B · success ⇒ suite-verde" "fase=suite-verde" - backend-e2e fase RUN_STEP_EXPRS="$(fase success success '')"
  caso 0 "B · failure + colgada ⇒ suite-colgada" "fase=suite-colgada" "suite-roja" backend-e2e fase RUN_STEP_EXPRS="$(fase success failure 1)"
  caso 0 "B · cancelled (respaldo) ⇒ suite-colgada" "fase=suite-colgada" "suite-roja" backend-e2e fase RUN_STEP_EXPRS="$(fase success cancelled '')"
  caso 0 "B · failure sin colgada ⇒ suite-roja" "fase=suite-roja" "COLGÓ" backend-e2e fase RUN_STEP_EXPRS="$(fase success failure '')"
  caso 0 "B · Install failure ⇒ infra-muerta" "fase=infra-muerta · paso=Install" - backend-e2e fase RUN_STEP_EXPRS="$(fase failure skipped '')"
  caso 1 "C · e2e-ok: failure + suite-colgada" "SE COLGÓ" "CORRIÓ y falló" e2e-ok Resumen RUN_STEP_EXPRS="$(ok_job failure suite-colgada)"
  caso 1 "C · e2e-ok: cancelled + suite-colgada" "SE COLGÓ" - e2e-ok Resumen RUN_STEP_EXPRS="$(ok_job cancelled suite-colgada)"
  caso 1 "C · e2e-ok: failure + suite-roja" "CORRIÓ y falló" "COLGÓ" e2e-ok Resumen RUN_STEP_EXPRS="$(ok_job failure suite-roja)"
  caso 0 "C · e2e-ok: success" "E2E gate OK" - e2e-ok Resumen RUN_STEP_EXPRS="$(ok_job success suite-verde)"
done
printf '\n'
if [ "$FALLOS" -gt 0 ]; then printf '\033[1;31mROJO: %s/%s casos fallaron.\033[0m\n' "$FALLOS" "$((FALLOS+PASADAS))"; exit 1; fi
printf '\033[1;32mVERDE: %s/%s casos (N=%s rondas): un cuelgue sale rojo con motivo, distinto de un rojo de aserción.\033[0m\n' "$PASADAS" "$PASADAS" "$N"

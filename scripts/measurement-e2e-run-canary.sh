#!/usr/bin/env bash
#
# measurement-e2e-run-canary.sh — ¿el paso del E2E de medición usa la config de su modo y sale rojo
# con 0 pruebas?  (B2 de QA, 2026-10-19)                                          · devops
# =============================================================================
# Sin red ni navegador: un `npx` de mentira registra sus argumentos y su entorno, y responde lo que
# diga FAKE_LIST/FAKE_RUN. Se exige a measurement-e2e-run.sh:
#   · on  ⇒ `-c playwright.measurement-on.config.ts`, E2E_MKT_ON_DIST_DIR=.next-e2e-measurement-on,
#           dist=frontend/.next-e2e-measurement-on y rc 0 con 17 pruebas;
#   · off ⇒ `-c playwright.config.ts`, E2E_MOCK_DIST_DIR=.next-e2e-measurement-off;
#   · «No tests found» (el fallo de run 39202758169) ⇒ rc 1 con «0 PRUEBAS» y SIN ejecutar la corrida;
#   · «Total: 0 tests» ⇒ rc 1;   · 17 pruebas pero la corrida falla ⇒ rc de la corrida (1);
#   · modo inválido ⇒ rc 2.
# Uso: ./scripts/measurement-e2e-run-canary.sh [N]
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="$ROOT_DIR/scripts/measurement-e2e-run.sh"; N="${1:-1}"
BASE="$(mktemp -d -t mkt-e2e-run-canario-XXXXXX)"; trap 'rm -rf "$BASE"' EXIT
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }
mkdir -p "$BASE/bin"
cat > "$BASE/bin/npx" <<'NPX'
#!/usr/bin/env bash
echo "npx $* | MOCK=${E2E_MOCK_DIST_DIR:-} MKT=${E2E_MKT_ON_DIST_DIR:-}" >> "$FAKE_LOG"
if [[ " $* " == *" --list "* ]]; then
  case "$FAKE_LIST" in
    17)       echo "  [chromium] › measurement-on.spec.ts:10:3 › caso"; echo "Total: 17 tests in 1 file"; exit 0 ;;
    cero)     echo "Total: 0 tests in 0 files"; exit 0 ;;
    notfound) echo "Error: No tests found"; exit 1 ;;
  esac
fi
echo "CORRIDA"; exit "${FAKE_RUN:-0}"
NPX
chmod +x "$BASE/bin/npx"

caso() { # <rc> <nombre> <modo> <list> <run> <debe en salida+log> [no-debe]
  local log="$BASE/log-$RANDOM"; : > "$log"
  local out rc; out="$(env -u GITHUB_OUTPUT PATH="$BASE/bin:$PATH" FAKE_LOG="$log" FAKE_LIST="$4" FAKE_RUN="$5" "$RUN" "$3" 2>&1)"; rc=$?
  local todo="$out"$'\n'"$(cat "$log")"
  if [ "$rc" -ne "$1" ]; then bad "$2 — rc=$rc, esperaba $1"; return; fi
  local d; IFS='|' read -ra DEBE <<<"$6"
  for d in "${DEBE[@]}"; do [[ "$todo" == *"$d"* ]] || { bad "$2 — falta «$d»"; return; }; done
  if [ -n "${7:-}" ] && [[ "$todo" == *"$7"* ]]; then bad "$2 — aparece «$7» y no debía"; return; fi
  ok "$2 — rc=$rc"
}
for ((r=1;r<=N;r++)); do
  printf '\n\033[1m== measurement-e2e-run canario, ronda %s/%s ==\033[0m\n' "$r" "$N"
  caso 0 "on · config y carpeta propias, 17 pruebas" on 17 0 "-c playwright.measurement-on.config.ts --list e2e/measurement-on.spec.ts|MKT=.next-e2e-measurement-on|dist=frontend/.next-e2e-measurement-on|tests=17|CORRIDA"
  caso 0 "off · config por defecto y su carpeta" off 17 0 "-c playwright.config.ts --list e2e/measurement-off.spec.ts|MOCK=.next-e2e-measurement-off|dist=frontend/.next-e2e-measurement-off"
  caso 1 "on · «No tests found» (run 39202758169) ⇒ rojo con motivo y sin corrida" on notfound 0 "0 PRUEBAS|tests=0" "CORRIDA"
  caso 1 "on · Total: 0 tests ⇒ rojo" on cero 0 "0 PRUEBAS" "CORRIDA"
  caso 1 "on · 17 pruebas pero la corrida falla ⇒ rojo de la corrida" on 17 1 "tests=17|CORRIDA"
  caso 2 "modo inválido" ON 17 0 "uso:"
done
printf '\n'
if [ "$FALLOS" -gt 0 ]; then printf '\033[1;31mROJO: %s/%s casos fallaron.\033[0m\n' "$FALLOS" "$((FALLOS+PASADAS))"; exit 1; fi
printf '\033[1;32mVERDE: %s/%s casos (N=%s): cada modo usa su config y 0 pruebas es rojo.\033[0m\n' "$PASADAS" "$PASADAS" "$N"

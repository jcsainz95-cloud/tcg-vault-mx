#!/usr/bin/env bash
#
# check-csp-zap-parity-canary.sh — el canario de check-csp-zap-parity.sh  · devops · LIVE-3
# =============================================================================
# Ejercita el candado REAL contra pares (csp.ts, baseline.conf) fabricados: las
# dos combinaciones buenas salen 0, las dos desincronizadas salen 1, una
# constante ilegible sale 2 y la ausencia de csp.ts sale 0 diciendo «no aplica».
# MUTACIÓN: quitar la exigencia de FAIL en `enforce` ⇒ el caso «enforce + WARN»
# tiene que dejar de salir 1.
# Uso:  ./scripts/check-csp-zap-parity-canary.sh
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHK="$ROOT_DIR/scripts/check-csp-zap-parity.sh"
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
mal() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }
TMP="$(mktemp -d -t csp-canario-XXXXXX)"; trap 'rm -rf "$TMP"' EXIT

csp()  { printf "export type CspMode = 'report-only' | 'enforce';\nexport const CSP_MODE: CspMode = '%s';\n" "$1" > "$TMP/csp.ts"; }
conf() { printf '10055\t%s\t(x)\n10038\t%s\t(x)\n10020\tFAIL\t(x)\n' "$1" "$2" > "$TMP/conf"; }
caso() { # <rc> <texto> <nombre> [script]
  local out rc; out="$(bash "${4:-$CHK}" "$TMP/csp.ts" "$TMP/conf" 2>&1)"; rc=$?
  [ "$rc" -eq "$1" ] && grep -qF -- "$2" <<<"$out" && ok "$3 ⇒ rc $rc" || { mal "$3 ⇒ rc $rc (esperaba $1)"; sed 's/^/      /' <<<"$out" | head -3; }
}
printf '\n\033[1m== LIVE-3 · ¿CSP_MODE y ZAP 10038/10055 se mueven juntas? ==\033[0m\n\n'
csp report-only; conf WARN WARN; caso 0 "report-only con 10038/10055 en WARN" "report-only + WARN/WARN (fase 1)"
csp enforce;     conf FAIL FAIL; caso 0 "enforce con 10038 y 10055 en FAIL" "enforce + FAIL/FAIL (fase 2)"
csp enforce;     conf WARN WARN; caso 1 "exige subirlas a FAIL" "enforce sin subir las reglas ⇒ rojo"
csp enforce;     conf FAIL WARN; caso 1 "exige subirlas a FAIL" "enforce con solo una en FAIL ⇒ rojo"
csp report-only; conf FAIL FAIL; caso 1 "Bájalas a WARN" "report-only con las reglas ya en FAIL ⇒ rojo"
printf 'export const CSP_MODE = process.env.X;\n' > "$TMP/csp.ts"; conf WARN WARN; caso 2 "no pude leer CSP_MODE" "CSP_MODE no literal ⇒ rc 2"
rm -f "$TMP/csp.ts"; caso 0 "no aplica" "sin csp.ts ⇒ «no aplica todavía»"
python3 - "$CHK" "$TMP/mut.sh" <<'PY'
import sys
s = open(sys.argv[1]).read(); a = 'if [ "$A38" = "FAIL" ] && [ "$A55" = "FAIL" ]; then'
assert a in s, 'anclaje'
open(sys.argv[2], 'w').write(s.replace(a, 'if true; then'))
PY
csp enforce; conf WARN WARN
bash "$TMP/mut.sh" "$TMP/csp.ts" "$TMP/conf" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "mutación m-enforce-sin-fail ⇒ «enforce + WARN» pasa a rc 0: el canario la caza" || mal "mutación no cambió el veredicto (rc $rc)"
echo
[ "$FALLOS" -eq 0 ] && { printf '\033[1;32m✓ LIVE-3 pareja CSP↔ZAP: %s/%s.\033[0m\n' "$PASADAS" "$PASADAS"; exit 0; }
printf '\033[1;31m✗ LIVE-3 pareja CSP↔ZAP: %s fallo(s).\033[0m\n' "$FALLOS"; exit 1

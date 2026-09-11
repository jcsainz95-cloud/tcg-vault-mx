#!/usr/bin/env bash
# check-e2e-skip-census-canary.sh — «¿el censo E2E se pone rojo si crece?» · devops (N7)
# Sobre una COPIA de frontend/e2e: igual → 0; +1 mockOnly → 1; -1 → 0 con aviso;
# baseline ausente → 2; --update sin motivo → 2.
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE="$ROOT_DIR/scripts/check-e2e-skip-census.sh"; BL="$ROOT_DIR/scripts/e2e-skip-census.baseline"
[ -x "$GATE" ] && [ -f "$BL" ] || { echo "✗ falta $GATE o $BL"; exit 1; }
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }
printf '\n\033[1m== ¿El censo de salvaguardas E2E muerde si crece? ==\033[0m\n\n'
TMP="$(mktemp -d -t e2e-census-canario-XXXXXX)"; trap 'rm -rf "$TMP"' EXIT
cp -r "$ROOT_DIR/frontend/e2e" "$TMP/e2e"
caso() { local rc; "$GATE" --dir "$TMP/e2e" --baseline "${3:-$BL}" >/dev/null 2>&1; rc=$?; [ "$rc" -eq "$1" ] && ok "$2 — rc=$rc" || bad "$2 — rc=$rc, esperaba $1"; }
caso 0 "copia intacta = baseline"
printf '\n// canario\nconst x = { mockOnly: true };\n' >> "$TMP/e2e/zz-canario.spec.ts"
caso 1 "MUTACIÓN: +1 mockOnly ⇒ rojo"
rm "$TMP/e2e/zz-canario.spec.ts"
F="$(grep -rlw --include='*.ts' needsSeed "$TMP/e2e" | head -1)"
if [ -n "$F" ]; then sed -i '0,/\bneedsSeed\b/s//needsSeedX/' "$F"; caso 0 "-1 needsSeed ⇒ verde (con aviso de regenerar)"; else bad "no hay needsSeed que quitar"; fi
caso 2 "baseline ausente ⇒ rc=2" "$TMP/no-existe"
"$GATE" --dir "$TMP/e2e" --baseline "$TMP/b" --update >/dev/null 2>&1; rc=$?; [ "$rc" -eq 2 ] && ok "--update sin --motivo ⇒ rc=2" || bad "--update sin motivo ⇒ rc=$rc, esperaba 2"
TOTAL=$((PASADAS+FALLOS)); echo
[ "$FALLOS" -eq 0 ] && { printf '\033[1;32m✓ Canario censo E2E: %s/%s.\033[0m\n' "$PASADAS" "$TOTAL"; exit 0; }
printf '\033[1;31m✗ Canario censo E2E: %s/%s.\033[0m\n' "$PASADAS" "$TOTAL"; exit 1

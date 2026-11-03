#!/usr/bin/env bash
# =============================================================================
# e2e-mock-verdict-canary.sh — candado + canario del veredicto de `frontend-e2e` · devops
# =============================================================================
# Dos cosas, ambas sin red ni navegador:
#
#  A) CANDADO sobre .github/workflows/e2e.yml (o el fichero que se pase):
#     - el job `frontend-e2e` NO tiene `continue-on-error` (fue la causa: el job salió
#       verde con IDS-F7 roja en sus 3 intentos, run 41702516917, sha 48077124);
#     - su paso de la suite llama a scripts/e2e-mock-verdict.sh con el rc de Playwright
#       y no lo neutraliza (`|| true`, `|| :`, `; true`, `exit 0`);
#     - `e2e-ok` bloquea por `needs.frontend-e2e.result` (no lo degrada a warning).
#  B) CANARIO de scripts/e2e-mock-verdict.sh: salidas reales de @playwright/test 1.56.0
#     (retries=2), medidas el 2026-11-03 en scratch; cada caso dice qué exit espera.
#     Y el candado A se prueba contra mutaciones del workflow: cada una debe ponerlo rojo.
#
# Uso: scripts/e2e-mock-verdict-canary.sh            # candado sobre el vivo + canario
# Sale 0 si todo muerde como debe; 1 si no. DEVOPS_NOTES-24 §24.0.
# =============================================================================
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERDICT="$ROOT/scripts/e2e-mock-verdict.sh"
WF="$ROOT/.github/workflows/e2e.yml"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
FALLOS=0
ok() { echo "  ok  · $1"; }
ko() { echo "  KO  · $1"; FALLOS=$((FALLOS+1)); }

# --------------------------------------------------------------------------- A
bloque() { # $1 fichero, $2 job → líneas del job (desde «  job:» hasta el siguiente job)
  awk -v j="  $2:" '$0==j{on=1; print; next} on && /^  [A-Za-z0-9_-]+:[[:space:]]*$/{exit} on{print}' "$1"
}
check_wf() { # $1 fichero → 0 si cumple, 1 si no (imprime por qué)
  local f="$1" fe ok_blk rc=0
  fe="$(bloque "$f" frontend-e2e)"; ok_blk="$(bloque "$f" e2e-ok)"
  [ -n "$fe" ] || { echo "    sin job frontend-e2e"; return 1; }
  if grep -qE '^[[:space:]]*continue-on-error:' <<<"$fe"; then echo "    frontend-e2e tiene continue-on-error"; rc=1; fi
  if ! grep -qE 'scripts/e2e-mock-verdict\.sh "\$rc" "\$LOG"' <<<"$fe"; then echo "    frontend-e2e no pasa el rc a e2e-mock-verdict.sh"; rc=1; fi
  if grep -qE 'e2e-mock-verdict\.sh[^#]*(\|\|[[:space:]]*(true|:)|;[[:space:]]*true|;[[:space:]]*exit 0)' <<<"$fe"; then echo "    el veredicto está neutralizado"; rc=1; fi
  if ! grep -qE 'npm run test:e2e .*\|\| rc=\$\?' <<<"$fe"; then echo "    la suite no captura su rc (|| rc=\$?)"; rc=1; fi
  if ! grep -qF 'needs.frontend-e2e.result' <<<"$ok_blk" || ! grep -qE '^[[:space:]]*ROJO=1 ;;' <<<"$ok_blk"; then
    echo "    e2e-ok no bloquea por frontend-e2e"; rc=1
  fi
  if grep -qiE 'frontend-e2e.*informativo' <<<"$ok_blk"; then echo "    e2e-ok sigue tratando frontend-e2e como informativo"; rc=1; fi
  return $rc
}

echo "A · candado sobre el workflow vivo ($WF)"
if check_wf "$WF"; then ok "e2e.yml cumple"; else ko "e2e.yml NO cumple"; fi

echo "A · el candado muerde (mutaciones del workflow)"
mut() { # $1 nombre, $2 programa sed
  sed -E "$2" "$WF" >"$TMP/wf.yml"
  if cmp -s "$WF" "$TMP/wf.yml"; then ko "$1: la mutación no cambió nada (canario roto)"; return; fi
  if check_wf "$TMP/wf.yml" >/dev/null; then ko "$1: el candado NO la detecta"; else ok "$1: rojo"; fi
}
mut "continue-on-error en el paso" 's/^(        id: mock_e2e)$/\1\n        continue-on-error: true/'
mut "veredicto con || true"        's#(scripts/e2e-mock-verdict\.sh "\$rc" "\$LOG")#\1 || true#'
mut "veredicto quitado"            '/scripts\/e2e-mock-verdict\.sh "\$rc" "\$LOG"/d'
mut "rc no capturado"              's/ \|\| rc=\$\?//'
mut "e2e-ok vuelve a informativo"  's/^(              )ROJO=1 ;;$/\1echo informativo ;;/'

# --------------------------------------------------------------------------- B
echo "B · canario del veredicto (salidas reales de Playwright 1.56.0)"
caso() { # $1 nombre, $2 rc, $3 exit esperado, $4 patrón que DEBE salir (o vacío), $5 fichero
  local out got
  out="$(GITHUB_STEP_SUMMARY="$TMP/summary.md" "$VERDICT" "$2" "$5" 2>&1)"; got=$?
  if [ "$got" != "$3" ]; then ko "$1: exit $got, esperado $3"; echo "$out" | sed 's/^/      /'; return; fi
  if [ -n "$4" ] && ! grep -qE -- "$4" <<<"$out"; then ko "$1: falta «$4» en la salida"; return; fi
  ok "$1: exit $got"
}

cat >"$TMP/rojo.log" <<'EOF'
  1) [chromium] › e2e/ids-real.spec.ts:147:7 › @real §IDS contra el stack sembrado › @real IDS-F7: M10 lee el dial

    Error: No se encontró la API real. Probé: http://localhost:3099/api/v1

    Retry #1 ───────────────────────────────────────────────────────────────
    Retry #2 ───────────────────────────────────────────────────────────────

  1 failed
    [chromium] › e2e/ids-real.spec.ts:147:7 › @real §IDS contra el stack sembrado › @real IDS-F7: M10 lee el dial ─────
  38 skipped
  433 passed (13.9m)
::notice title=🎭 Playwright Run Summary::  1 failed%0A    [chromium] › e2e/ids-real.spec.ts:147:7%0A  433 passed (13.9m)
EOF
caso "roja en sus 3 intentos (rc=1)" 1 1 'rojo en todos sus intentos::\[chromium\] › e2e/ids-real\.spec\.ts:147:7' "$TMP/rojo.log"

cat >"$TMP/flaky.log" <<'EOF'
  1 flaky
    t/a.spec.js:3:1 › flaky ────────────────────────────────────────────────────────────────────────
  1 passed (1.5s)
EOF
caso "flaky (rc=0): verde y registrada" 0 0 'flaky \(registrada, no bloquea\)::t/a\.spec\.js:3:1 › flaky —' "$TMP/flaky.log"
grep -qF -- '- t/a.spec.js:3:1 › flaky' "$TMP/summary.md" && ok "flaky: aparece en el resumen del job" || ko "flaky: no aparece en el resumen del job"

cat >"$TMP/mixto.log" <<'EOF'
  1 failed
    t/b.spec.js:2:1 › rojo siempre ─────────────────────────────────────────────────────────────────
  2 flaky
    t/a.spec.js:3:1 › flaky ────────────────────────────────────────────────────────────────────────
    t/c.spec.js:7:3 › @real grupo › @real dos ──────────────────────────────────────────────────────
  1 skipped
  1 passed (3.8s)
EOF
caso "mixto: 1 roja + 2 flaky (rc=1)" 1 1 'rojo en todos sus intentos::t/b\.spec\.js:2:1 › rojo siempre' "$TMP/mixto.log"
caso "rc=0 pero el resumen dice failed (rc tragado)" 0 1 'rojo en todos sus intentos' "$TMP/mixto.log"

cat >"$TMP/notests.log" <<'EOF'
Error: No tests found.
Make sure that arguments are regular expressions matching test files.
::error ::Error: No tests found.%0AMake sure that arguments are regular expressions matching test files.
::notice title=🎭 Playwright Run Summary::
EOF
caso "No tests found (rc=1, sin resumen)" 1 1 'sin pruebas rojas en el resumen' "$TMP/notests.log"
caso "rc=0 y 0 pasadas" 0 1 'no midió nada' "$TMP/notests.log"

printf '\033[32m  12 passed\033[39m (2.0s)\n' >"$TMP/ansi-verde.log"
printf '  12 passed (2.0s)\n' >"$TMP/verde.log"
caso "verde limpio" 0 0 'VERDE: passed=12 flaky=0' "$TMP/verde.log"
caso "verde con color ANSI" 0 0 'VERDE: passed=12' "$TMP/ansi-verde.log"

printf '  1 interrupted\n    [chromium] › x.spec.ts:1:1 › y\n  3 passed (9.0s)\n' >"$TMP/interr.log"
caso "interrumpida con rc=0" 0 1 'interrumpida' "$TMP/interr.log"
caso "sin log" 0 1 'sin log' "$TMP/no-existe.log"

printf '\033[31m  1 failed\033[39m\n    [chromium] › z.spec.ts:9:1 › roja\n\033[32m  4 passed\033[39m (1.0s)\n' >"$TMP/ansi.log"
caso "resumen con color ANSI" 1 1 'rojo en todos sus intentos::\[chromium\] › z\.spec\.ts:9:1 › roja' "$TMP/ansi.log"

echo
if [ "$FALLOS" -eq 0 ]; then echo "VERDE: candado y canario muerden."; exit 0; fi
echo "ROJO: $FALLOS comprobación(es) fallaron."; exit 1

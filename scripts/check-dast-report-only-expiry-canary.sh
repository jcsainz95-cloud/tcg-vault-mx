#!/usr/bin/env bash
#
# check-dast-report-only-expiry-canary.sh — «¿el disparador de caducidad de
# `report_only` sabe ponerse rojo, y solo cuando toca?» · devops
# =============================================================================
# Ejercita scripts/check-dast-report-only-expiry.sh contra deploy.yml de
# juguete y fechas inyectadas (`--today`), sin red. Exige:
#   1. report_only: true + hoy ANTES de la fecha        → rc=0 (vigente)
#   2. report_only: true + hoy EN la fecha              → rc=9 (caducó)
#   3. report_only: true + hoy DESPUÉS de la fecha      → rc=9 (caducó)
#   4. bloque sin report_only + hoy después             → rc=0 (retirado)
#   5. report_only: true SOLO en un comentario + después → rc=0 (mencionar no es usar)
#   6. report_only: true en OTRO job + después           → rc=0 (solo cuenta el bloque dast-release)
#   7. fichero sin bloque dast-release                  → rc=2 (no concluyente, nunca verde)
#   8. el deploy.yml REAL con hoy = víspera de la fecha → rc=0 y con hoy = fecha → rc=9
#      (o rc=0 en ambos si report_only ya se retiró: entonces el disparador ya cumplió)
#
# Uso:  ./scripts/check-dast-report-only-expiry-canary.sh
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE="$ROOT_DIR/scripts/check-dast-report-only-expiry.sh"
[ -x "$GATE" ] || { echo "✗ falta $GATE"; exit 1; }
FECHA="$(sed -n 's/^FECHA_LIMITE="\([0-9-]*\)"$/\1/p' "$GATE")"
[[ "$FECHA" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "✗ no leo FECHA_LIMITE de $GATE"; exit 1; }
ANTES="$(date -u -d "$FECHA -1 day" +%F)"; DESPUES="$(date -u -d "$FECHA +30 days" +%F)"

FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }
printf '\n\033[1m== ¿El disparador de caducidad de report_only muerde cuando toca? (fecha: %s) ==\033[0m\n\n' "$FECHA"

TMP="$(mktemp -d -t ro-expiry-canario-XXXXXX)"; trap 'rm -rf "$TMP"' EXIT
# plantilla <fichero> <cuerpo del bloque dast-release (o vacío para no tenerlo)> [bloque extra]
plantilla() {
  { echo "name: x"; echo "on: push"; echo "jobs:"
    [ -n "$2" ] && { echo "  dast-release:"; printf '%s\n' "$2"; }
    echo "  otro-job:"; echo "    runs-on: ubuntu-latest"; [ -n "${3:-}" ] && printf '%s\n' "$3"
    echo "    steps:"; echo "      - run: true"
  } > "$1"
}
# caso <rc_esperado> <nombre> <fichero> <hoy>
caso() {
  local out rc; out="$("$GATE" --deploy "$3" --today "$4" 2>&1)"; rc=$?
  if [ "$rc" -eq "$1" ]; then ok "$2 — rc=$rc"; else bad "$2 — rc=$rc, esperaba $1"; printf '      %s\n' "$(tail -1 <<<"$out" | tr -d '\033' | cut -c1-160)"; fi
}
CON=$'    uses: ./.github/workflows/security-dast.yml\n    with:\n      ref: ${{ github.sha }}\n      report_only: true'
SIN=$'    uses: ./.github/workflows/security-dast.yml\n    with:\n      ref: ${{ github.sha }}'
COMENTADO=$'    uses: ./.github/workflows/security-dast.yml\n    with:\n      ref: ${{ github.sha }}\n      # report_only: true'

plantilla "$TMP/con.yml" "$CON"
caso 0 "report_only vigente (víspera $ANTES)" "$TMP/con.yml" "$ANTES"
caso 9 "report_only caducado (el mismo día $FECHA)" "$TMP/con.yml" "$FECHA"
caso 9 "report_only caducado ($DESPUES)" "$TMP/con.yml" "$DESPUES"
plantilla "$TMP/sin.yml" "$SIN"
caso 0 "sin report_only, después de la fecha: retirado, verde" "$TMP/sin.yml" "$DESPUES"
plantilla "$TMP/comentado.yml" "$COMENTADO"
caso 0 "report_only solo en un comentario: mencionar no es usar" "$TMP/comentado.yml" "$DESPUES"
plantilla "$TMP/otro.yml" "$SIN" $'    with:\n      report_only: true'
caso 0 "report_only en OTRO job: solo cuenta el bloque dast-release" "$TMP/otro.yml" "$DESPUES"
plantilla "$TMP/nada.yml" ""
caso 2 "sin bloque dast-release: NO concluyente (rc=2), nunca verde" "$TMP/nada.yml" "$DESPUES"

# 8) el fichero real: coherente consigo mismo
REAL="$ROOT_DIR/.github/workflows/deploy.yml"
"$GATE" --deploy "$REAL" --today "$ANTES" >/dev/null 2>&1; r1=$?
"$GATE" --deploy "$REAL" --today "$FECHA" >/dev/null 2>&1; r2=$?
if { [ "$r1" -eq 0 ] && [ "$r2" -eq 9 ]; }; then ok "deploy.yml real: report_only puesto → vigente en la víspera (0) y caducado en la fecha (9)"
elif { [ "$r1" -eq 0 ] && [ "$r2" -eq 0 ]; }; then ok "deploy.yml real: report_only ya retirado → verde en ambas fechas (el disparador cumplió)"
else bad "deploy.yml real: víspera rc=$r1, fecha rc=$r2 (esperaba 0/9 con report_only, 0/0 sin él)"; fi

TOTAL=$((PASADAS+FALLOS)); echo
if [ "$FALLOS" -gt 0 ]; then printf '\033[1;31m✗ Canario de caducidad de report_only: %s/%s.\033[0m\n' "$PASADAS" "$TOTAL"; exit 1; fi
printf '\033[1;32m✓ Canario de caducidad de report_only: %s/%s — rojo cuando toca, verde cuando no, rc=2 cuando no puede medir.\033[0m\n' "$PASADAS" "$TOTAL"

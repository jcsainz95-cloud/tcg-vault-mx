#!/usr/bin/env bash
#
# check-restore-drill-canary.sh — «¿el simulacro de restauración sabe decir
#                                   NO CUADRA?»                    · devops · LIVE-13
# =============================================================================
# `restore-drill-verify.sh --verify` es el que certifica «el respaldo se
# restaura entero». Si su comparación se afloja, el simulacro sale verde sobre
# una restauración a medias y el dueño se queda con una esperanza en vez de un
# respaldo. Este canario corre SIN base de datos (para CI):
#   · la comparación pura (`--selftest-compare`) con fotos fabricadas: igual ⇒ 0,
#     una fila/suma/migración distinta ⇒ 1 y la línea, solo `meta.*` distinto ⇒ 0,
#     foto incompleta o ajena ⇒ 2;
#   · las guardas que no necesitan base: --target prod no restaura ni verifica;
#     --snapshot sin --target no corre; --target local con host remoto aborta;
#   · que la foto y el volcado COMPARTEN snapshot (pg_export_snapshot +
#     `pg_dump --snapshot`) — medido el 2026-10-05 con escrituras concurrentes:
#     compartido 5/5 cuadra, separado 0/5 (DEVOPS_NOTES §85.5);
#   · MUTACIÓN: la comparación que siempre cuadra ⇒ el caso «fila distinta» sale
#     rc 0 ⇒ el canario lo caza.
# La corrida CON base (restaurar de verdad y verificar, más 3 mutaciones sobre la
# base restaurada) se hizo en local el 2026-10-05: DEVOPS_NOTES §85.5.
#
# Uso:  ./scripts/check-restore-drill-canary.sh
# rc 0 todo como debe · 1 algún caso no · 2 no pudo medir.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRILL="$ROOT_DIR/scripts/restore-drill-verify.sh"
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
mal() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }
[ -f "$DRILL" ] || { echo "::error::falta $DRILL"; exit 1; }
TMP="$(mktemp -d -t drill-canario-XXXXXX)"; trap 'rm -rf "$TMP"' EXIT

foto() { # <fichero> [sustituciones sed…]
  local f="$1"; shift
  cat > "$f" <<'F'
meta.formato	restore-drill/v1
meta.tomada_utc	2026-10-05T04:40:39Z
meta.base	tcg
meta.host_huella	aaaaaaaa
meta.target	prod
migracion.ultima	20261005120000_m63_staff_username|2026-10-05T04:40:16
migracion.terminadas	51
order.total_cents.settled	241817
order.filas.settled	2
manual_refund.pending	2
filas.Order	2
filas.ManualRefund	2
filas.User	7
F
  local e; for e in "$@"; do sed -i "$e" "$f"; done
}
caso() { # <rc esperado> <texto|-> <nombre> <script> <a> <b>
  local rce="$1" txt="$2" nom="$3"; local out rc
  out="$(bash "$4" --selftest-compare "$5" "$6" 2>&1)"; rc=$?
  if [ "$rc" -eq "$rce" ] && { [ "$txt" = "-" ] || grep -qF -- "$txt" <<<"$out"; }; then ok "$nom ⇒ rc $rc"
  else mal "$nom ⇒ rc $rc (esperaba $rce${txt:+ y «$txt»})"; sed 's/^/      /' <<<"$out" | head -5; fi
}

printf '\n\033[1m== LIVE-13 · ¿el simulacro de restauración sabe decir «NO cuadra»? ==\033[0m\n\n'

foto "$TMP/a"
foto "$TMP/b";                                                   caso 0 "cuadran" "fotos iguales" "$DRILL" "$TMP/a" "$TMP/b"
foto "$TMP/b" 's/^meta.tomada_utc.*/meta.tomada_utc\t2026-10-06T00:00:00Z/' 's/^meta.host_huella.*/meta.host_huella\tbbbbbbbb/'
                                                                 caso 0 "cuadran" "solo cambian meta.* (fecha, host) ⇒ cuadra" "$DRILL" "$TMP/a" "$TMP/b"
foto "$TMP/b" 's/^filas.User\t7/filas.User\t6/';                 caso 1 "filas.User" "una tabla con una fila menos ⇒ NO cuadra y dice cuál" "$DRILL" "$TMP/a" "$TMP/b"
foto "$TMP/b" 's/^order.total_cents.settled.*/order.total_cents.settled\t241818/'
                                                                 caso 1 "order.total_cents.settled" "un centavo de diferencia en Order ⇒ NO cuadra" "$DRILL" "$TMP/a" "$TMP/b"
foto "$TMP/b" 's/m63_staff_username/m62_otra/';                  caso 1 "migracion.ultima" "otra última migración ⇒ NO cuadra" "$DRILL" "$TMP/a" "$TMP/b"
foto "$TMP/b" '/^filas.ManualRefund/d';                          caso 1 "filas.ManualRefund" "falta una tabla en la restaurada ⇒ NO cuadra" "$DRILL" "$TMP/a" "$TMP/b"
foto "$TMP/c" '/^migracion/d'; foto "$TMP/b";                    caso 2 "incompleta" "foto de origen sin migración ⇒ rc 2 (no concluyente)" "$DRILL" "$TMP/c" "$TMP/b"
printf 'hola\n' > "$TMP/c";                                      caso 2 "no es una foto" "fichero que no es una foto ⇒ rc 2" "$DRILL" "$TMP/c" "$TMP/b"

# --- guardas sin base ---------------------------------------------------------
g() { # <rc> <texto> <nombre> args…
  local rce="$1" txt="$2" nom="$3"; shift 3; local out rc
  out="$(env -u DATABASE_URL bash "$DRILL" "$@" 2>&1)"; rc=$?
  [ "$rc" -eq "$rce" ] && grep -qF -- "$txt" <<<"$out" && ok "$nom ⇒ rc $rc" || { mal "$nom ⇒ rc $rc"; sed 's/^/      /' <<<"$out" | head -3; }
}
g 2 "NO es producción" "--verify con --target prod ⇒ se niega" --verify "$TMP/a" --target prod
g 2 "NO es producción" "--restore con --target prod ⇒ se niega" --restore "$TMP/a" --target prod
g 2 "exige --target" "--snapshot sin --target ⇒ se niega" --snapshot
if command -v psql >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
  out="$(DATABASE_URL='postgresql://db.ejemplo.invalid:5432/tcg' bash "$DRILL" --snapshot --target local 2>&1)"; rc=$?
  [ "$rc" -eq 2 ] && grep -q "NO es local" <<<"$out" && ok "--target local con host remoto ⇒ aborta antes de conectar ⇒ rc 2" || mal "--target local con host remoto no abortó (rc $rc)"
  grep -q "ejemplo.invalid" <<<"$out" && mal "el host del DATABASE_URL salió por pantalla" || ok "el host del DATABASE_URL NO sale por pantalla (solo su huella)"
else
  echo "  · (sin psql/node: guardas de host no ejercidas aquí — no es un verde de ellas)"
fi

# --- foto y volcado comparten snapshot (estructura) ---------------------------
grep -q 'SELECT pg_export_snapshot();' "$DRILL" && grep -q 'SET TRANSACTION SNAPSHOT' "$DRILL" && grep -q 'pg_dump "$PGURL" --snapshot="$SNAP"' "$DRILL" \
  && ok "foto y volcado comparten snapshot (pg_export_snapshot + SET TRANSACTION SNAPSHOT + pg_dump --snapshot)" \
  || mal "foto y volcado ya NO comparten snapshot: con la tienda vendiendo, el --verify daría diferencias falsas (medido 0/5 separado)"
grep -c 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY' "$DRILL" | { read -r n; [ "$n" -ge 3 ]; } \
  && ok "toda foto se toma en una transacción READ ONLY" || mal "alguna foto dejó de ser READ ONLY"

# --- mutación -------------------------------------------------------------------
python3 - "$DRILL" "$TMP/mut.sh" <<'PY'
import sys
s = open(sys.argv[1]).read(); a = 'if [ "$da" = "$db_" ]; then'
assert a in s, 'anclaje de la comparación'
open(sys.argv[2], 'w').write(s.replace(a, 'if true; then'))
PY
[ $? -eq 0 ] || { echo "::error::no pude aplicar la mutación (anclaje desfasado). NO concluyente."; exit 2; }
foto "$TMP/b" 's/^filas.User\t7/filas.User\t6/'
bash "$TMP/mut.sh" --selftest-compare "$TMP/a" "$TMP/b" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "mutación m-siempre-cuadra ⇒ el caso «una fila menos» pasa a rc 0: el canario la caza" || mal "mutación m-siempre-cuadra no cambió el veredicto (rc $rc)"

echo
if [ "$FALLOS" -eq 0 ]; then printf '\033[1;32m✓ LIVE-13 simulacro: %s/%s.\033[0m\n' "$PASADAS" "$PASADAS"; exit 0; fi
printf '\033[1;31m✗ LIVE-13 simulacro: %s fallo(s) de %s.\033[0m\n' "$FALLOS" "$((PASADAS+FALLOS))"; exit 1

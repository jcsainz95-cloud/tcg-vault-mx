#!/usr/bin/env bash
# =============================================================================
# check-stack-verify-short.sh — DEVOPS-VERIFY-SHORT (QA, 2026-10-29) · devops
# -----------------------------------------------------------------------------
# QA mide sobre una copia `git archive` SIN .git (O-9). Ahí `stack-native.sh verify:head
# <sha corto>` decía «COMMIT DISTINTO» de un stack que servía EXACTAMENTE ese commit: el
# sello guarda el sha largo y la comparación era `!=` de cadenas. Sin .git no hay forma
# de expandir el corto, así que la comparación pasa a ser POR PREFIJO (`sha_mismo`, en
# stack-native.sh y en assert-serving-head.sh: hex de ≥ 7, uno prefijo del otro).
#
# Este candado lo mide sobre los scripts REALES, copiados (scripts/ + security/) a un
# directorio temporal SIN .git, con dos servidores de maqueta en puertos propios
# (39983 backend, 39984 frontend; `scripts/stack-test/fake-health-server.py`) y sellos
# escritos como los escribe `up --gate`:
#   1. `verify:head <7 primeros del sello>`  ⇒ rc 0, «VERIFICADO»;
#   2. `verify:head <sha largo>`              ⇒ rc 0;
#   3. `STACK_EXPECTED_SHA=<corto> verify:head` (sin argumento) ⇒ rc 0;
#   4. `verify:head <otro sha de 7>`          ⇒ rc ≠ 0 y «COMMIT DISTINTO» (no se vuelve ciego);
#   5. `verify:head abc12` (5 caracteres) / `verify:head xyz1234` ⇒ rc ≠ 0 con su motivo.
# Los servidores se apagan por PID al salir (trap). No toca Postgres, Redis ni s3.
#
# Uso:  ./scripts/check-stack-verify-short.sh            # candado
#       ./scripts/check-stack-verify-short.sh --canary   # mutaciones ⇒ todas ROJAS
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d -t stack-short-XXXXXX)"
BE_PORT=39983; FE_PORT=39984
PIDS=()
limpiar() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$TMP"; }
trap limpiar EXIT

command -v python3 >/dev/null || { echo "::error::falta python3 (servidores de maqueta)"; exit 2; }
for p in $BE_PORT $FE_PORT; do
  if curl -s -m 2 -o /dev/null "http://127.0.0.1:$p/" 2>/dev/null; then
    echo "::error::el puerto $p ya responde: no es mío, no mido encima (NO concluyente)"; exit 2
  fi
done

FULL="3b2fc87a1d9e4c5b6a7f8e9d0c1b2a3f4e5d6c7b"   # sha de ficción: la copia no tiene .git
OTRO="9999999"
T0="$(date +%s)"
python3 -I "$ROOT_DIR/scripts/stack-test/fake-health-server.py" "$BE_PORT" >/dev/null 2>&1 & PIDS+=($!); BE_PID=$!
python3 -I "$ROOT_DIR/scripts/stack-test/fake-health-server.py" "$FE_PORT" >/dev/null 2>&1 & PIDS+=($!); FE_PID=$!
for _ in $(seq 1 50); do
  curl -sf -m 1 "http://127.0.0.1:$BE_PORT/api/v1/health" >/dev/null 2>&1 \
    && curl -sf -m 1 "http://127.0.0.1:$FE_PORT/es" >/dev/null 2>&1 && break
  sleep 0.2
done

copia() {  # $1 destino, $2 stack-native.sh, $3 assert-serving-head.sh
  mkdir -p "$1"
  ( cd "$ROOT_DIR" && tar --exclude=node_modules --exclude=.native-stack -cf - scripts security ) | tar -xf - -C "$1"
  cp "$2" "$1/scripts/stack-native.sh"; cp "$3" "$1/scripts/assert-serving-head.sh"
  mkdir -p "$1/.native-stack"
  printf 'sha=%s\ntree_backend=\ntree_frontend=\nstarted_at=%s\ndirty=?\npid=%s\nstamped_by=stack-native.sh\nport=%s\n' \
    "$FULL" "$T0" "$BE_PID" "$BE_PORT" > "$1/.native-stack/backend.stamp"
  printf 'sha=%s\ntree_backend=\ntree_frontend=\nstarted_at=%s\ndirty=?\npid=%s\nstamped_by=stack-native.sh\nmode=build\nport=%s\n' \
    "$FULL" "$T0" "$FE_PID" "$FE_PORT" > "$1/.native-stack/frontend.stamp"
}

vh() {  # $1 dir, resto: args de verify:head ; imprime salida, rc en $RC
  local d="$1"; shift
  OUT="$(cd "$d" && env -u STACK_EXPECTED_SHA ${VH_ENV:-} BACKEND_PORT=$BE_PORT FRONTEND_PORT=$FE_PORT \
          timeout 60 ./scripts/stack-native.sh verify:head "$@" 2>&1)"; RC=$?
}

comprobar() {  # $1 stack-native.sh, $2 assert-serving-head.sh
  local d="$TMP/c-$RANDOM" fallos=0
  ok() { echo "  ✔ $*"; }
  ko() { echo "  ✗ $*"; fallos=$((fallos+1)); }
  copia "$d" "$1" "$2"
  [ ! -e "$d/.git" ] || { ko "la copia tiene .git"; return 1; }

  vh "$d" "${FULL:0:7}"
  { [ "$RC" = 0 ] && printf '%s' "$OUT" | grep -q 'VERIFICADO' && ! printf '%s' "$OUT" | grep -q 'COMMIT DISTINTO'; } \
    && ok "sin .git: verify:head ${FULL:0:7} ⇒ rc 0, VERIFICADO" \
    || ko "sin .git: verify:head ${FULL:0:7} ⇒ rc=$RC — $(printf '%s' "$OUT" | grep -m2 -E 'DISTINTO|✖' | tr '\n' ' ')"

  vh "$d" "$FULL"
  [ "$RC" = 0 ] && ok "sin .git: verify:head <largo> ⇒ rc 0" || ko "sin .git: verify:head <largo> ⇒ rc=$RC"

  VH_ENV="STACK_EXPECTED_SHA=${FULL:0:9}" vh "$d"
  [ "$RC" = 0 ] && ok "sin .git: STACK_EXPECTED_SHA=<corto> verify:head ⇒ rc 0" \
    || ko "STACK_EXPECTED_SHA=<corto> ⇒ rc=$RC — $(printf '%s' "$OUT" | grep -m2 -E 'DISTINTO|✖' | tr '\n' ' ')"

  vh "$d" "$OTRO"
  # Los DOS lados tienen que decirlo: el backend (assert-serving-head) y el frontend (verify_head).
  { [ "$RC" != 0 ] && printf '%s' "$OUT" | grep -q 'COMMIT DISTINTO: se está sirviendo' \
      && printf '%s' "$OUT" | grep -q 'COMMIT DISTINTO: horneado'; } \
    && ok "sin .git: verify:head $OTRO (otro commit) ⇒ rc=$RC, COMMIT DISTINTO en backend y frontend" \
    || ko "otro commit NO sale distinto en los dos lados: rc=$RC"

  vh "$d" "abc12"
  { [ "$RC" != 0 ] && printf '%s' "$OUT" | grep -q 'demasiado corto'; } && ok "sha de 5 ⇒ rojo «demasiado corto»" || ko "sha de 5: rc=$RC"
  vh "$d" "xyz1234"
  { [ "$RC" != 0 ] && printf '%s' "$OUT" | grep -q 'no es un sha'; } && ok "sha no-hex ⇒ rojo «no es un sha»" || ko "sha no-hex: rc=$RC"
  [ "$fallos" = 0 ]
}

SN="$ROOT_DIR/scripts/stack-native.sh"; AH="$ROOT_DIR/scripts/assert-serving-head.sh"
if [ "${1:-}" != "--canary" ]; then
  echo "== DEVOPS-VERIFY-SHORT: verify:head <sha corto> sobre copia sin .git =="
  comprobar "$SN" "$AH" && { echo "✓ OK"; exit 0; }
  echo "✗ ROJO"; exit 1
fi

echo "== Canario de check-stack-verify-short =="
comprobar "$SN" "$AH" >/dev/null 2>&1 || { echo "✗ el original ya está rojo: el canario no concluye"; exit 2; }
muerde=0; total=0
mutar() {  # $1 nombre, $2 fichero (sn|ah), $3 sed
  total=$((total+1)); local src m sn="$SN" ah="$AH"
  if [ "$2" = sn ]; then src="$SN"; else src="$AH"; fi
  m="$TMP/m$total"; sed "$3" "$src" > "$m"
  if cmp -s "$m" "$src"; then echo "  ✗ mutación '$1' no cambió nada (canario ciego)"; return; fi
  if [ "$2" = sn ]; then sn="$m"; else ah="$m"; fi
  if comprobar "$sn" "$ah" >/dev/null 2>&1; then echo "  ✗ '$1' ⇒ VERDE (el candado NO muerde)"
  else echo "  ✔ '$1' ⇒ ROJO"; muerde=$((muerde+1)); fi
}
mutar "assert vuelve a comparar con !="   ah 's|^  elif ! sha_mismo "\$STAMP_SHA" "\$EXPECT_SHA"; then|  elif [ "$STAMP_SHA" != "$EXPECT_SHA" ]; then|'
mutar "frontend vuelve a comparar con !=" sn 's|^      if ! sha_mismo "\$f_sha" "\$expected"; then|      if [ "$f_sha" != "$expected" ]; then|'
mutar "sha_mismo acepta cualquier cosa"   sn '/^sha_mismo() {$/a\  return 0'
mutar "sin mínimo de 7 en verify:head"    sn 's|^      \[ "\${#VH_SHA}" -ge 7 \] \|\| die|      : \|\| die|'
echo "Canario: $muerde/$total mutaciones salen ROJAS."
[ "$muerde" = "$total" ]

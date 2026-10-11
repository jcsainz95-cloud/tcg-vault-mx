#!/usr/bin/env bash
# =============================================================================
# check-stack-expected-sha.sh — M-4 (QA, 2026-10-05) · devops
# -----------------------------------------------------------------------------
# QA mide sobre una copia `git archive` (O-9), sin `.git`. Ahí `up --gate` acababa
# rc=1 con «assert-serving-head.sh: line 147: --sha necesita valor»: el sha esperado
# salía vacío y nadie lo decía. Ahora la copia pasa el suyo con STACK_EXPECTED_SHA, o
# falla con un mensaje que lo nombra. Este candado lo mide sobre los scripts REALES,
# copiados (scripts/ + security/) a un directorio temporal SIN .git:
#   1. sin .git y sin variable: `up --gate` y `verify:head` paran en < 30 s, ANTES de
#      levantar nada, nombrando STACK_EXPECTED_SHA — y sin el críptico «necesita valor»;
#   2. variable que no es un sha ⇒ rojo «no es un sha»;
#   3. variable válida ⇒ pasa la validación y llega al aserto real de procedencia
#      (con puertos muertos sale 1 por «no responde», nunca por sha vacío);
#   4. CON .git y variable que no coincide con HEAD ⇒ rojo «manda HEAD»; prefijo de
#      HEAD ⇒ pasa;
#   5. `assert-serving-head.sh --sha ""` ⇒ rc 2 con mensaje claro.
# Puertos 39981/39982 (nadie los usa en este repo): `verify:head` solo LEE, no arranca.
#
# Uso:  ./scripts/check-stack-expected-sha.sh            # candado
#       ./scripts/check-stack-expected-sha.sh --canary   # mutaciones ⇒ todas ROJAS
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d -t stack-sha-XXXXXX)"; trap 'rm -rf "$TMP"' EXIT
PORTS=(BACKEND_PORT=39981 FRONTEND_PORT=39982)
# SEGURIDAD DEL PROPIO CANARIO: un mutante sin la parada de M-4 SIGUE con `up --gate`
# hasta `start_infra`, que en una máquina compartida haría `ALTER ROLE` sobre el
# Postgres de OTROS clones o tocaría su s3-local. Por eso `up` corre con un PATH cuyas
# herramientas de infra son señuelos que no hacen nada salvo dejar constancia: si un
# mutante llega a infra, se ve («levantó infra») y no rompe a nadie.
SHIM="$TMP/shim"; mkdir -p "$SHIM"
for b in pg_isready pg_ctlcluster su psql redis-cli redis-server setsid npx node curl; do
  printf '#!/bin/sh\necho "%s $*" >> "%s/INFRA-TOCADA"\nexit 97\n' "$b" "$TMP" > "$SHIM/$b"; chmod +x "$SHIM/$b"
done

copia() {  # $1 destino, $2 (opcional) stack-native.sh mutado
  mkdir -p "$1"
  ( cd "$ROOT_DIR" && tar --exclude=node_modules --exclude=.native-stack -cf - scripts security ) | tar -xf - -C "$1"
  [ -z "${2:-}" ] || cp "$2" "$1/scripts/stack-native.sh"
}

comprobar() {  # $1 = stack-native.sh a probar ; imprime ✔/✗ ; rc 0 si todo bien
  local f="$1" d out rc t0 t fallos=0
  ok()  { echo "  ✔ $*"; }
  ko()  { echo "  ✗ $*"; fallos=$((fallos+1)); }

  d="$TMP/sin-git-$RANDOM"; copia "$d" "$f"
  for cmd in "up --gate" "verify:head"; do
    t0=$(date +%s)
    # shellcheck disable=SC2086
    out="$(cd "$d" && env -u STACK_EXPECTED_SHA PATH="$SHIM:$PATH" "${PORTS[@]}" timeout 60 ./scripts/stack-native.sh $cmd 2>&1)"; rc=$?
    t=$(( $(date +%s) - t0 ))
    if [ "$rc" != 0 ] && printf '%s' "$out" | grep -q 'STACK_EXPECTED_SHA' \
       && ! printf '%s' "$out" | grep -q 'necesita valor' && [ "$t" -lt 30 ]; then
      ok "sin .git ni variable: '$cmd' rc=$rc en ${t}s, nombra STACK_EXPECTED_SHA"
    else ko "sin .git ni variable: '$cmd' rc=$rc en ${t}s — $(printf '%s' "$out" | tail -2 | tr '\n' ' ')"; fi
  done
  [ ! -e "$TMP/INFRA-TOCADA" ] && [ ! -e "$d/.native-stack/s3.log" ] && [ ! -e "$d/.native-stack/frontend-build.log" ] \
    && ok "no levantó nada antes de parar" || ko "levantó infra antes de parar"
  rm -f "$TMP/INFRA-TOCADA"

  out="$(cd "$d" && env STACK_EXPECTED_SHA=xyz "${PORTS[@]}" timeout 60 ./scripts/stack-native.sh verify:head 2>&1)"; rc=$?
  { [ "$rc" != 0 ] && printf '%s' "$out" | grep -q 'no es un sha'; } && ok "variable no-sha ⇒ rojo claro" || ko "variable no-sha: rc=$rc"

  out="$(cd "$d" && env STACK_EXPECTED_SHA=0123abcd "${PORTS[@]}" timeout 60 ./scripts/stack-native.sh verify:head 2>&1)"; rc=$?
  if printf '%s' "$out" | grep -qE 'necesita valor|vino VACÍO|No sé qué commit'; then ko "variable válida: aún se queja de sha vacío"
  elif printf '%s' "$out" | grep -q 'no respondió'; then ok "variable válida ⇒ llega al aserto real (rc=$rc por puertos muertos)"
  else ko "variable válida: salida inesperada — $(printf '%s' "$out" | tail -2 | tr '\n' ' ')"; fi

  d="$TMP/con-git-$RANDOM"; copia "$d" "$f"
  ( cd "$d" && git init -q && git -c user.email=c@c -c user.name=c add -A >/dev/null \
      && git -c user.email=c@c -c user.name=c -c commit.gpgsign=false commit -qm canario ) >/dev/null 2>&1
  local h; h="$(git -C "$d" rev-parse HEAD 2>/dev/null)"
  out="$(cd "$d" && env STACK_EXPECTED_SHA=0123abcd "${PORTS[@]}" timeout 60 ./scripts/stack-native.sh verify:head 2>&1)"; rc=$?
  { [ "$rc" != 0 ] && printf '%s' "$out" | grep -q 'manda HEAD'; } && ok "con .git y variable ≠ HEAD ⇒ rojo" || ko "con .git y variable ≠ HEAD: rc=$rc"
  out="$(cd "$d" && env STACK_EXPECTED_SHA="${h:0:10}" "${PORTS[@]}" timeout 60 ./scripts/stack-native.sh verify:head 2>&1)"; rc=$?
  { ! printf '%s' "$out" | grep -qE 'manda HEAD|No sé qué commit|necesita valor' && printf '%s' "$out" | grep -q 'no respondió'; } \
    && ok "con .git y variable = prefijo de HEAD ⇒ pasa la validación" || ko "prefijo de HEAD rechazado"

  out="$("$d/scripts/assert-serving-head.sh" --url http://127.0.0.1:39981/x --sha "" 2>&1)"; rc=$?
  { [ "$rc" = 2 ] && printf '%s' "$out" | grep -q 'vino VACÍO'; } && ok "assert-serving-head --sha \"\" ⇒ rc 2 claro" || ko "assert --sha \"\": rc=$rc"
  [ "$fallos" = 0 ]
}

if [ "${1:-}" != "--canary" ]; then
  echo "== M-4: una copia sin .git pasa su sha o falla con un mensaje claro =="
  comprobar "$ROOT_DIR/scripts/stack-native.sh" && { echo "✓ OK"; exit 0; }
  echo "✗ ROJO"; exit 1
fi

SRC="$ROOT_DIR/scripts/stack-native.sh"; muerde=0; total=0
mutar() {
  total=$((total+1)); local m="$TMP/m$total.sh"
  sed "$2" "$SRC" > "$m"
  if cmp -s "$m" "$SRC"; then echo "  ✗ mutación '$1' no cambió nada (canario ciego)"; return; fi
  if comprobar "$m" >/dev/null 2>&1; then echo "  ✗ '$1' ⇒ VERDE (el candado NO muerde)"
  else echo "  ✔ '$1' ⇒ ROJO"; muerde=$((muerde+1)); fi
}
echo "== Canario de check-stack-expected-sha =="
comprobar "$SRC" >/dev/null 2>&1 || { echo "✗ el original ya está rojo: el canario no concluye"; exit 2; }
mutar "up --gate sin require_expected_sha" 's|^    if \[ "\${GATE_MODE:-0}" = 1 \]; then require_expected_sha; fi$|    :|'
mutar "verify:head sin require_expected_sha" 's|^    \[ -n "\$VH_SHA" \] \|\| require_expected_sha$|    :|'
mutar "con .git no se compara la variable" 's|^        \*) die "STACK_EXPECTED_SHA=\$STACK_EXPECTED_SHA pero|        *) : "|'
mutar "head_sha vuelve a ignorar la variable" 's|^    printf .%s\\n. "\$STACK_EXPECTED_SHA"$|    echo ""|'
echo "Canario: $muerde/$total mutaciones salen ROJAS."
[ "$muerde" = "$total" ]

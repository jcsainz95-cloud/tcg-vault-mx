#!/usr/bin/env bash
#
# check-format-mix-canary.sh — «¿el comparador BL-27 MUERDE?» · devops
# =============================================================================
# QA midió (lote 2026-09-11) que `format-mix` lleva 0 rojos en 60 corridas y no
# tiene canario. Un job que nunca se ha visto rojo no se sabe si «siempre
# pasa» o «no puede fallar». Este canario lo ejercita sobre un repo git
# TEMPORAL con el prettier real del árbol (backend/node_modules/.bin/prettier,
# la misma versión que el comparador exige), en los cuatro casos que definen
# la norma del arquitecto:
#
#   1. base sin formatear -> HEAD solo reformateado            -> VERDE (rc=0)
#      (y se comprueba que HEAD es prettier-limpio: si no lo fuera, el
#      comparador lo SALTA sin evaluar — límite conocido, ver §55)
#   2. base sin formatear -> HEAD reformateado + lógica nueva  -> ROJO  (rc=1)
#   3. base sin formatear -> HEAD solo lógica (sin reformatear)-> VERDE (rc=0)
#   4. BASE_REF inexistente                                    -> rc=2 (nunca 0)
#
# Uso:  ./scripts/check-format-mix-canary.sh
# Sale 0 si los 4 casos salen como deben; 1 si alguno no; 2 si NO PUDO MEDIR
# (sin prettier 3.9.6 local ni por red). Sin red si hay prettier local.
#
# rc=2 y no 1 (techlead F1-3, 2026-09-11): antes «no hay prettier» salía con
# `exit 1` y cara de BL-27 — un fallo de red del runner se leía como «el
# comparador no muerde». El comparador ya distingue «no concluyo» (rc=2) de
# «mezcla» (rc=1); el canario ahora también, y ci.yml lo imprime como tal.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE="$ROOT_DIR/scripts/check-format-mix.sh"
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; FALLOS=$((FALLOS+1)); }

printf '\n\033[1m== ¿El comparador BL-27 (format-mix) muerde? ==\033[0m\n\n'
[ -x "$GATE" ] || { bad "No existe/ejecuta $GATE"; exit 1; }

# prettier: el MISMO que usa el comparador, con la MISMA versión clavada
# (check-format-mix.sh: PRETTIER_VERSION). Local si existe con esa versión;
# si no, `npx prettier@<ver>` (red) — y si tampoco, rc=2: el canario no midió.
PRETTIER_VERSION="$(sed -n 's/^PRETTIER_VERSION="\([0-9.]*\)"$/\1/p' "$GATE")"
[ -n "$PRETTIER_VERSION" ] || { echo "✗ no leo PRETTIER_VERSION de $GATE: no sé qué prettier exige el comparador."; exit 2; }
PRETTIER_LOCAL="$ROOT_DIR/backend/node_modules/.bin/prettier"
if [ -x "$PRETTIER_LOCAL" ] && [ "$("$PRETTIER_LOCAL" --version 2>/dev/null)" = "$PRETTIER_VERSION" ]; then
  export PRETTIER_BIN="$PRETTIER_LOCAL"
elif timeout 120s npx --yes "prettier@$PRETTIER_VERSION" --version >/dev/null 2>&1; then
  export PRETTIER_BIN="npx --yes prettier@$PRETTIER_VERSION"
else
  printf '\033[1;33m  ? prettier %s no disponible: ni %s con esa versión ni `npx prettier@%s` (¿sin red?). El canario NO PUEDE MEDIR — no es un rojo de BL-27, es rc=2.\033[0m\n' "$PRETTIER_VERSION" "${PRETTIER_LOCAL#"$ROOT_DIR"/}" "$PRETTIER_VERSION"
  exit 2
fi
printf '   prettier: %s (v%s)\n' "${PRETTIER_BIN#"$ROOT_DIR"/}" "$PRETTIER_VERSION"

BASE="$(mktemp -d -t formatmix-canary-XXXXXX)"
trap 'rm -rf "$BASE"' EXIT

# Fichero base SIN formatear (comillas dobles, sin punto y coma, espaciado raro).
SIN_FORMATO='export function total(a: number,b: number){
  const  x = a+b
  return x
}
'
# El mismo fichero, formateado por prettier con la config por defecto.
fmt() { $PRETTIER_BIN --stdin-filepath src/a.ts; }
# OJO: `$(…)` recorta el salto de línea final y entonces HEAD deja de ser
# «prettier-limpio»: el comparador lo SALTA en silencio (no lo evalúa) y el caso
# sale verde sin medir. Se conserva el `\n` final a propósito.
# El `|| …` de un `$(cmd; echo x)` mira el rc de `echo`, nunca el de prettier:
# por eso se comprueba el RESULTADO (que hay salida y es distinta de la entrada).
CON_FORMATO="$(printf '%s' "$SIN_FORMATO" | fmt; echo x)"
CON_FORMATO="${CON_FORMATO%x}"
if [ -z "$CON_FORMATO" ] || [ "$CON_FORMATO" = "$SIN_FORMATO" ]; then
  printf '\033[1;33m  ? prettier no devolvió un fichero formateado distinto del de entrada. El canario NO PUEDE MEDIR (rc=2).\033[0m\n'; exit 2
fi

# repo <dir> : crea un repo con el fichero base commiteado en `base`
repo() {
  local d="$1"; mkdir -p "$d/src"
  git -C "$d" init -q -b main; git -C "$d" config user.email c@x; git -C "$d" config user.name canario
  printf '%s' "$SIN_FORMATO" > "$d/src/a.ts"; git -C "$d" add -A; git -C "$d" commit -qm base; git -C "$d" tag base
}
# caso <ROJO|VERDE|RC2> <nombre> <dir> <base-ref>
caso() {
  local esperado="$1" nombre="$2" dir="$3" baseref="$4" salida rc
  salida="$(cd "$dir" && "$GATE" "$baseref" HEAD 2>&1)"; rc=$?
  case "$esperado" in
    ROJO)  [ "$rc" -eq 1 ] || { bad "$nombre — esperaba ROJO (rc=1), salió rc=$rc"; printf '      %s\n' "$(tail -3 <<<"$salida")"; return; } ;;
    VERDE) [ "$rc" -eq 0 ] || { bad "$nombre — esperaba VERDE (rc=0), salió rc=$rc"; printf '      %s\n' "$(tail -3 <<<"$salida")"; return; } ;;
    RC2)   [ "$rc" -eq 2 ] || { bad "$nombre — esperaba NO CONCLUYENTE (rc=2), salió rc=$rc"; return; } ;;
  esac
  ok "$nombre — $esperado"
}

# 1. solo reformateo
D="$BASE/c1"; repo "$D"; printf '%s' "$CON_FORMATO" > "$D/src/a.ts"; cmp -s "$D/src/a.ts" <(printf '%s' "$CON_FORMATO" | fmt) || bad "el fichero formateado no es prettier-limpio: el canario no puede medir"; git -C "$D" commit -qam "style: reformateo"
caso VERDE "Solo reformateo (commit de estilo puro)" "$D" base

# 2. reformateo + lógica (la línea de dinero escondida)
D="$BASE/c2"; repo "$D"; printf '%s' "$CON_FORMATO" | sed 's/return x;/return x * 1.16;/' > "$D/src/a.ts"; git -C "$D" commit -qam "feat: iva"
grep -q '1.16' "$D/src/a.ts" || { bad "la mutación no se aplicó (el formateado no contiene 'return x;')"; }
caso ROJO "Reformateo + cambio de comportamiento en el mismo diff (BL-27)" "$D" base

# 3. solo lógica, sin reformatear
D="$BASE/c3"; repo "$D"; printf '%s' "$SIN_FORMATO" | sed 's/return x$/return x * 1.16/' > "$D/src/a.ts"; git -C "$D" commit -qam "feat: iva sin reformatear"
caso VERDE "Solo lógica, árbol sin formatear (como este repo)" "$D" base

# 4. base inexistente
D="$BASE/c4"; repo "$D"
caso RC2 "BASE_REF inexistente: no concluye, nunca verde" "$D" no-existe

echo
if [ "$FALLOS" -ne 0 ]; then
  printf '\033[1;31m✗ Canario de format-mix: %s/%s casos fallaron.\033[0m\n' "$FALLOS" "$((PASADAS+FALLOS))"; exit 1
fi
printf '\033[1;32m✓ Canario de format-mix: %s/%s — muerde en la mezcla y deja pasar el estilo puro y la lógica pura.\033[0m\n' "$PASADAS" "$((PASADAS+FALLOS))"

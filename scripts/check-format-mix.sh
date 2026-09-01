#!/usr/bin/env bash
# =============================================================================
# check-format-mix.sh — BL-27 · «un diff no mezcla reformateo con lógica»
# Propiedad: devops. Lo consume .github/workflows/ci.yml (job `format-mix`).
# =============================================================================
# QUÉ PROBLEMA RESUELVE (y cuál NO)
#
# Backend aplicó un cambio de dos líneas, corrió `prettier` de forma ad-hoc y el
# diff salió con 445 líneas reformateadas que no había tocado. Lo revirtió a
# mano, pero el agujero seguía abierto: `npm run lint` NO corre prettier (el
# `extends: ['prettier']` de eslint existe justamente para APAGAR las reglas de
# formato), así que nada impide que vuelva a pasar.
#
# Por qué importa aquí más que en otros proyectos: **el gate de seguridad y el
# techlead revisan POR DIFF**. Una línea de dinero escondida entre 445 de
# reformateo NO SE VE. La norma del arquitecto es la correcta:
#
#     Si hay que reformatear, va en SU PROPIO COMMIT, sin un solo cambio
#     de comportamiento.
#
# Este script hace EJECUTABLE esa norma. NO es un gate de estilo: no exige que
# el árbol esté formateado, no reformatea nada y no opina sobre comillas ni
# ancho de línea. Solo responde a UNA pregunta, por archivo:
#
#     ¿este cambio reformateó el archivo Y ADEMÁS cambió otra cosa?
#
# El commit de SOLO formato PASA (es el camino que la norma autoriza).
# El commit que MEZCLA falla, con la lista exacta de archivos.
#
# CÓMO LO DECIDE (exacto, sin umbrales ni heurísticas)
#
#   Para cada archivo MODIFICADO (no añadido, no borrado) del diff base..head:
#     1. Si en HEAD el archivo NO es idéntico a su propia salida de prettier
#        -> nadie lo reformateó -> SE IGNORA. (Es el caso normal: este árbol
#           está mayoritariamente sin formatear y eso NO es lo que se vigila.)
#     2. Si en HEAD sí es idéntico Y en BASE también lo era -> el archivo ya
#        estaba formateado de antes -> SE IGNORA.
#     3. Si en HEAD sí es idéntico y en BASE no lo era -> ESTE cambio lo
#        reformateó. Entonces se compara prettier(BASE) contra HEAD:
#           · iguales   -> el cambio es EXACTAMENTE el reformateo -> OK.
#           · distintos -> reformateo MEZCLADO con otra cosa      -> FALLA.
#
#   Consecuencia sana: re-indentar a mano (envolver un bloque en un `if`, por
#   ejemplo) NO dispara nada, porque el archivo no queda prettier-limpio.
#
# USO
#   scripts/check-format-mix.sh [BASE_REF] [HEAD_REF]      # default: origin/main HEAD
#   PRETTIER_BIN=/ruta/prettier scripts/check-format-mix.sh
#
# SALIDA: 0 = sin mezcla · 1 = mezcla detectada · 2 = no se pudo evaluar (avisa)
# =============================================================================
set -euo pipefail

# Versión CLAVADA. No es cosmético: prettier cambia su salida entre versiones, y
# la que hay en el árbol llega de rebote (`resend` -> `@react-email/render` ->
# prettier). Si el comparador usara "la última", su veredicto cambiaría solo.
PRETTIER_VERSION="3.9.6"

BASE_REF="${1:-${BASE_REF:-origin/main}}"
HEAD_REF="${2:-${HEAD_REF:-HEAD}}"

RED=$'\033[1;31m'; GRN=$'\033[1;32m'; YEL=$'\033[1;33m'; DIM=$'\033[2m'; RST=$'\033[0m'
note() { printf '%s\n' "$*"; }
warn() { printf '%s\n' "${YEL}$*${RST}"; }

# --- Extensiones que prettier gobierna. Se excluyen generados y vendorizados ---
is_candidate() {
  case "$1" in
    node_modules/*|*/node_modules/*|*/dist/*|*/.next/*|*/coverage/*) return 1 ;;
    *package-lock.json|*.min.js|*.min.css)                          return 1 ;;
    *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.css|*.scss|*.md|*.yml|*.yaml) return 0 ;;
    *) return 1 ;;
  esac
}

# --- Localiza prettier: primero el que YA está en el árbol (sirve sin red) ----
resolve_prettier() {
  if [ -n "${PRETTIER_BIN:-}" ]; then echo "$PRETTIER_BIN"; return; fi
  local local_bin="backend/node_modules/.bin/prettier"
  if [ -x "$local_bin" ]; then
    local v; v="$("$local_bin" --version 2>/dev/null || echo '')"
    if [ "$v" = "$PRETTIER_VERSION" ]; then echo "$local_bin"; return; fi
    warn "aviso: $local_bin es v$v y se esperaba v$PRETTIER_VERSION; se usa npx para no mezclar salidas."
  fi
  echo "npx --yes prettier@$PRETTIER_VERSION"
}
PRETTIER="$(resolve_prettier)"

# --- Base utilizable: sin ella no se concluye, pero NO se finge verde --------
if ! git rev-parse --verify --quiet "$BASE_REF^{commit}" >/dev/null; then
  warn "No pude resolver BASE_REF='$BASE_REF'. El comparador NO CONCLUYE (no es un verde)."
  exit 2
fi
MERGE_BASE="$(git merge-base "$BASE_REF" "$HEAD_REF" 2>/dev/null || echo "$BASE_REF")"

mapfile -t CHANGED < <(git diff --name-only --diff-filter=M "$MERGE_BASE" "$HEAD_REF" -- || true)
if [ "${#CHANGED[@]}" -eq 0 ]; then
  note "${GRN}✔${RST} Sin archivos modificados que evaluar (base $(git rev-parse --short "$MERGE_BASE"))."
  exit 0
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fmt() { # fmt <ruta-para-resolver-config> < contenido
  $PRETTIER --stdin-filepath "$1" 2>/dev/null || return 1
}

mixed=(); formatted_only=(); evaluated=0
for f in "${CHANGED[@]}"; do
  is_candidate "$f" || continue
  git cat-file -e "$MERGE_BASE:$f" 2>/dev/null || continue
  evaluated=$((evaluated + 1))

  git show "$HEAD_REF:$f" > "$TMP/head" 2>/dev/null || continue
  fmt "$f" < "$TMP/head" > "$TMP/head.fmt" 2>/dev/null || continue   # sin parser -> se ignora
  cmp -s "$TMP/head" "$TMP/head.fmt" || continue                     # (1) no quedó prettier-limpio

  git show "$MERGE_BASE:$f" > "$TMP/base" 2>/dev/null || continue
  fmt "$f" < "$TMP/base" > "$TMP/base.fmt" 2>/dev/null || continue
  cmp -s "$TMP/base" "$TMP/base.fmt" && continue                     # (2) ya estaba formateado

  if cmp -s "$TMP/base.fmt" "$TMP/head"; then
    formatted_only+=("$f")                                           # (3a) SOLO reformateo -> OK
  else
    n="$(diff -u "$TMP/base.fmt" "$TMP/head" | grep -c '^[+-][^+-]' || true)"
    mixed+=("$f|$n")                                                 # (3b) MEZCLA -> falla
  fi
done

note "${DIM}base=$(git rev-parse --short "$MERGE_BASE")  head=$(git rev-parse --short "$HEAD_REF")  archivos evaluados=$evaluated${RST}"

if [ "${#formatted_only[@]}" -gt 0 ]; then
  note "${GRN}✔${RST} Reformateo LIMPIO (sin lógica mezclada) en ${#formatted_only[@]} archivo(s):"
  printf '    %s\n' "${formatted_only[@]}"
fi

if [ "${#mixed[@]}" -eq 0 ]; then
  note "${GRN}✔ Ningún diff mezcla reformateo con cambios de comportamiento.${RST}"
  exit 0
fi

note ""
note "${RED}✖ BL-27 — este diff MEZCLA reformateo con cambios de comportamiento.${RST}"
note ""
note "El gate de seguridad y el techlead revisan POR DIFF. Una línea de dinero escondida"
note "entre cientos de líneas de reformateo NO SE VE, y por eso esto bloquea."
note ""
note "Archivos (y cuántas líneas quedan cuando se descuenta el reformateo — ESO es lo"
note "que realmente cambia, y es lo que debería verse solo en el diff):"
for m in "${mixed[@]}"; do
  printf '    %-70s  %s línea(s) de cambio real\n' "${m%|*}" "${m##*|}"
done
note ""
note "CÓMO SE ARREGLA (la norma del arquitecto, en dos commits):"
note "  1. git commit -m 'style: reformatear <archivos> (sin cambios de comportamiento)'"
note "     -> SOLO el reformateo. Este comparador lo deja pasar."
note "  2. git commit -m '<tu cambio real>'"
note "     -> solo la lógica, y el diff vuelve a ser revisable."
note ""
note "Si NO querías reformatear (te lo hizo un prettier ad-hoc): revierte el formato y"
note "reaplica tu cambio a mano. Este árbol NO está formateado a propósito; ver DEVOPS_NOTES §34."
exit 1

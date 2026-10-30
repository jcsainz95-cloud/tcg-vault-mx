#!/usr/bin/env bash
#
# limpieza-ramas-canary.sh — «¿limpieza-ramas.sh borra SOLO lo fusionado?»   · devops
# =============================================================================
# Monta un repositorio de juguete en un directorio temporal: un remoto «bare» y un
# clon, con ramas fusionadas en `production`, sin fusionar, cabeza y base de PR
# abierta (simuladas con el fichero --pr-file), protegidas (`staging`, `gh-pages`),
# `main` divergente, y una rama que se mueve entre la medición y el borrado.
# Lee el resultado en el REMOTO (`git ls-remote`), no en la salida del script.
#
#   1. confirmar=false                         -> rc 0, el remoto NO cambia, lista lo fusionado
#   2. sin --pr-file / confirmar=«yes»         -> rc 2, el remoto NO cambia
#   3. confirmar=true                          -> borra SOLO fus-1, fus-2, feat/fus-barra;
#                                                 sin-fusionar, protegidas, PR, main y production siguen
#   4. carrera: rama movida tras medir         -> sobrevive (lease), rc 1
#   5. archivar main con rama por defecto main -> rc 2, NO borra nada (ni las fusionadas)
#   6. archivar main, confirmar=false          -> main sigue, sin etiqueta
#   7. archivar main, confirmar=true           -> archive/main = sha de main, main borrada
#   8. archive/main ya existe en otro sha      -> rc 2, NO borra nada
#
# Uso:
#   ./scripts/limpieza-ramas-canary.sh                # los 8 casos contra el script real
#   ./scripts/limpieza-ramas-canary.sh --mutaciones   # además: 7 mutaciones del script, cada
#                                                     # una tiene que poner el canario en ROJO
# Sin red. Sale 0 verde · 1 rojo.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${LIMPIEZA_SCRIPT:-$ROOT_DIR/scripts/limpieza-ramas.sh}"
SILENCIO="${LIMPIEZA_SILENCIO:-0}"

export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=canario GIT_AUTHOR_EMAIL=canario@example.invalid
export GIT_COMMITTER_NAME=canario GIT_COMMITTER_EMAIL=canario@example.invalid
unset GITHUB_STEP_SUMMARY

FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); [ "$SILENCIO" = 1 ] || printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { FALLOS=$((FALLOS+1));   [ "$SILENCIO" = 1 ] || printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }

[ -x "$SCRIPT" ] || { echo "No existe/ejecuta $SCRIPT"; exit 1; }
TMP="$(mktemp -d -t limpieza-ramas-canary-XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

# --- repo de juguete -----------------------------------------------------------
# montar <dir>  →  <dir>/remoto.git (bare) y <dir>/clon
montar() {
  local d="$1"; mkdir -p "$d"
  git init -q --bare -b production "$d/remoto.git"
  git init -q -b production "$d/semilla"
  local S="git -C $d/semilla"
  c() { echo "$1" > "$d/semilla/f"; $S add f; $S commit -q -m "$1"; }
  c base
  $S branch main                       # main nace aquí y luego diverge
  c p1; $S branch fus-1
  c p2; $S branch fus-2; $S branch feat/fus-barra
  $S branch staging; $S branch gh-pages; $S branch pr-cabeza; $S branch pr-base; $S branch carrera
  c p3
  $S checkout -q -b sin-fusionar; c solo-en-rama; $S checkout -q production
  $S checkout -q main; c solo-en-main; $S checkout -q production
  $S push -q "$d/remoto.git" --all
  git clone -q "$d/remoto.git" "$d/clon"
  printf 'pr-cabeza\npr-base\n' > "$d/prs.txt"
}
refs() { git -C "$1/remoto.git" for-each-ref --format='%(refname) %(objectname)' | LC_ALL=C sort; }
tiene() { git -C "$1/remoto.git" show-ref --verify --quiet "refs/heads/$2"; }
corre() { local d="$1"; shift; SALIDA="$("$SCRIPT" --repo "$d/clon" "$@" 2>&1)"; RC=$?; }

[ "$SILENCIO" = 1 ] || printf '\n\033[1m== ¿limpieza-ramas.sh borra solo lo fusionado? ==\033[0m\n\n'

# 1. confirmar=false
D="$TMP/c1"; montar "$D"; antes="$(refs "$D")"
export GITHUB_STEP_SUMMARY="$D/resumen.md"
corre "$D" --pr-file "$D/prs.txt" --confirmar false
unset GITHUB_STEP_SUMMARY
lista="$(grep -o '^| `[^`]*` .*se borraría' <<<"$SALIDA" | sed 's/^| `\([^`]*\)`.*/\1/' | LC_ALL=C sort | tr '\n' ' ')"
if [ "$RC" -eq 0 ] && [ "$antes" = "$(refs "$D")" ] && [ "$lista" = "carrera feat/fus-barra fus-1 fus-2 " ] && grep -q 'se borraría' "$D/resumen.md"; then
  ok "1 confirmar=false: remoto intacto; lista = { $lista}; resumen escrito"
else bad "1 confirmar=false: rc=$RC, lista={ $lista}, remoto cambiado=$([ "$antes" = "$(refs "$D")" ] && echo no || echo SÍ)"; fi

# 2. fail-closed
D="$TMP/c2"; montar "$D"; antes="$(refs "$D")"
corre "$D" --confirmar true
r1=$RC; corre "$D" --pr-file "$D/prs.txt" --confirmar yes
if [ "$r1" -eq 2 ] && [ "$RC" -eq 2 ] && [ "$antes" = "$(refs "$D")" ]; then ok "2 sin --pr-file / confirmar=yes: rc 2 y remoto intacto"
else bad "2 fail-closed: rc sin pr-file=$r1, rc confirmar=yes=$RC, remoto cambiado=$([ "$antes" = "$(refs "$D")" ] && echo no || echo SÍ)"; fi

# 3. confirmar=true
D="$TMP/c3"; montar "$D"; sha_sf="$(git -C "$D/remoto.git" rev-parse refs/heads/sin-fusionar)"
corre "$D" --pr-file "$D/prs.txt" --confirmar true
mal=""
for b in fus-1 fus-2 feat/fus-barra carrera; do tiene "$D" "$b" && mal+=" $b(sigue)"; done
for b in production main staging gh-pages pr-cabeza pr-base sin-fusionar; do tiene "$D" "$b" || mal+=" $b(BORRADA)"; done
[ "$(git -C "$D/remoto.git" rev-parse refs/heads/sin-fusionar 2>/dev/null)" = "$sha_sf" ] || mal+=" sin-fusionar(movida)"
if [ "$RC" -eq 0 ] && [ -z "$mal" ]; then ok "3 confirmar=true: solo las fusionadas; sin fusionar, protegidas, PR, main y production siguen"
else bad "3 confirmar=true: rc=$RC;$mal"; fi

# 4. carrera: la rama se mueve después de medir (el clon no vuelve a hacer fetch)
D="$TMP/c4"; montar "$D"
git -C "$D/clon" fetch -q origin
git clone -q "$D/remoto.git" "$D/otro"; git -C "$D/otro" checkout -q carrera
echo nuevo > "$D/otro/g"; git -C "$D/otro" add g; git -C "$D/otro" commit -q -m nuevo; git -C "$D/otro" push -q origin carrera
corre "$D" --pr-file "$D/prs.txt" --confirmar true --no-fetch
if [ "$RC" -eq 1 ] && tiene "$D" carrera && ! tiene "$D" fus-1; then ok "4 carrera: la rama movida sobrevive (lease) y rc=1"
else bad "4 carrera: rc=$RC, carrera $(tiene "$D" carrera && echo sigue || echo BORRADA), fus-1 $(tiene "$D" fus-1 && echo sigue || echo borrada)"; fi

# 5. archivar con la rama por defecto todavía en main
D="$TMP/c5"; montar "$D"; antes="$(refs "$D")"
corre "$D" --pr-file "$D/prs.txt" --confirmar true --archivar-main true --rama-defecto main
if [ "$RC" -eq 2 ] && [ "$antes" = "$(refs "$D")" ]; then ok "5 archivar con default=main: rc 2 y NO borra nada"
else bad "5 archivar con default=main: rc=$RC, remoto cambiado=$([ "$antes" = "$(refs "$D")" ] && echo no || echo SÍ)"; fi

# 6. archivar, confirmar=false
D="$TMP/c6"; montar "$D"; antes="$(refs "$D")"
corre "$D" --pr-file "$D/prs.txt" --confirmar false --archivar-main true --rama-defecto production
if [ "$RC" -eq 0 ] && [ "$antes" = "$(refs "$D")" ] && grep -q 'Se crearía `archive/main`' <<<"$SALIDA"; then ok "6 archivar confirmar=false: remoto intacto, lo anuncia"
else bad "6 archivar confirmar=false: rc=$RC"; fi

# 7. archivar, confirmar=true
D="$TMP/c7"; montar "$D"; sha_main="$(git -C "$D/remoto.git" rev-parse refs/heads/main)"
corre "$D" --pr-file "$D/prs.txt" --confirmar true --archivar-main true --rama-defecto production
tag="$(git -C "$D/remoto.git" rev-parse --verify --quiet refs/tags/archive/main)"
if [ "$RC" -eq 0 ] && [ "$tag" = "$sha_main" ] && ! tiene "$D" main && tiene "$D" production && tiene "$D" sin-fusionar; then
  ok "7 archivar confirmar=true: archive/main = ${sha_main:0:8}, main borrada"
else bad "7 archivar confirmar=true: rc=$RC, tag=${tag:-ninguna}, main $(tiene "$D" main && echo sigue || echo borrada)"; fi

# 8. archive/main ya existe en otro sha
D="$TMP/c8"; montar "$D"
git -C "$D/remoto.git" update-ref refs/tags/archive/main "$(git -C "$D/remoto.git" rev-parse refs/heads/production)"
antes="$(refs "$D")"
corre "$D" --pr-file "$D/prs.txt" --confirmar true --archivar-main true --rama-defecto production
if [ "$RC" -eq 2 ] && [ "$antes" = "$(refs "$D")" ]; then ok "8 archive/main en otro sha: rc 2 y NO borra nada"
else bad "8 archive/main en otro sha: rc=$RC, remoto cambiado=$([ "$antes" = "$(refs "$D")" ] && echo no || echo SÍ)"; fi

[ "$SILENCIO" = 1 ] || printf '\n  casos: %s/8 verdes\n' "$PASADAS"

# --- mutaciones: cada una tiene que poner el canario en ROJO ----------------------
if [ "${1:-}" = "--mutaciones" ]; then
  printf '\n\033[1m== Mutaciones del script (cada una debe dar ROJO) ==\033[0m\n'
  declare -a MUT=(
    'sin comprobar ancestro|s/if G merge-base --is-ancestor "\$sha" "\$BASE_SHA"; then/if true; then/'
    'sin staging/gh-pages en PROTEGIDAS|s/^PROTEGIDAS=(production main staging gh-pages)/PROTEGIDAS=(production main)/'
    'ignora las PR abiertas|s/\[ -n "\$l" \] \&\& EN_PR\["\$l"\]=1/:/'
    'sin lease (--force a secas)|s/--force-with-lease="refs\/heads\/\$rama:\$sha"/--force/'
    'confirmar=false también borra|0,/if \[ "\$CONFIRMAR" = true \]; then/s//if true; then/'
    'sin --pr-file sigue adelante|/falta --pr-file legible/s/^/: #/'
    'archiva con main por defecto|/primero Settings → General → Default branch/s/^/: #/'
  )
  MORDIDAS=0
  for m in "${MUT[@]}"; do
    nom="${m%%|*}"; expr="${m#*|}"
    cp "$SCRIPT" "$TMP/mutado.sh"; sed -i "$expr" "$TMP/mutado.sh"; chmod +x "$TMP/mutado.sh"
    if cmp -s "$SCRIPT" "$TMP/mutado.sh"; then printf '\033[1;31m  ✗ %s — la mutación NO se aplicó\033[0m\n' "$nom"; FALLOS=$((FALLOS+1)); continue; fi
    if LIMPIEZA_SCRIPT="$TMP/mutado.sh" LIMPIEZA_SILENCIO=1 "$0" >/dev/null 2>&1; then
      printf '\033[1;31m  ✗ %s — el canario siguió VERDE (no muerde)\033[0m\n' "$nom"; FALLOS=$((FALLOS+1))
    else
      printf '\033[1;32m  ✔ %s — ROJO\033[0m\n' "$nom"; MORDIDAS=$((MORDIDAS+1))
    fi
  done
  printf '\n  mutaciones mordidas: %s/%s\n' "$MORDIDAS" "${#MUT[@]}"
fi

if [ "$FALLOS" -eq 0 ]; then [ "$SILENCIO" = 1 ] || printf '\033[1;32mVERDE\033[0m\n'; exit 0; fi
[ "$SILENCIO" = 1 ] || printf '\033[1;31mROJO: %s fallo(s)\033[0m\n' "$FALLOS"; exit 1

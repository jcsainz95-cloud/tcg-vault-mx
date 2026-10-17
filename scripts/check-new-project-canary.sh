#!/usr/bin/env bash
#
# check-new-project-canary.sh — «¿el candado de new-project.sh muerde?»   · devops
# =============================================================================
# DE DÓNDE VIENE (2026-10-10)
# ---------------------------------------------------------------------------
# `check-new-project.sh` nació porque `new-project.sh` arrastraba el PROJECT.md vivo
# a los proyectos nuevos. Un candado que vigila eso tiene que poder ponerse ROJO
# exactamente en los casos que lo motivaron. Muta SIEMPRE sobre una COPIA mínima
# de la plantilla (O-8/O-9): el árbol vivo no se toca. Cada mutación se corre N
# veces y se reporta la proporción (O-3), aunque aquí sean deterministas.
#
#   m0  (control) copia sin mutar ⇒ candado VERDE
#   m1  new-project.sh vuelve a copiar `${TEMPLATE_DIR}/PROJECT.md` (el vivo)  ⇒ ROJO
#   m2  new-project.sh deja de copiar HECHOS.md                                 ⇒ ROJO
#   m3  new-project.sh deja de copiar docs/DECISIONES.md                        ⇒ ROJO
#   m4  falta `.claude/templates/TRASPASO.md` ⇒ new-project.sh sale 2 y NO crea
#       el destino (nada a medias); y el candado sale ROJO
#   m5  new-project.sh acepta un destino existente (quita la guarda)           ⇒ ROJO
#
# Uso:  ./scripts/check-new-project-canary.sh [N]
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
N="${1:-3}"
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
mal() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }

BASE="$(mktemp -d -t new-project-canary-XXXXXX)" || exit 2
trap 'rm -rf "$BASE"' EXIT

# Copia MÍNIMA y PROPIA del canario: los dos scripts, .claude/ entero, CLAUDE.md y un
# PROJECT.md «vivo» sintético de 100 líneas (así el canario no depende de cuántas
# líneas tenga hoy el PROJECT.md real).
preparar() {
  local D="$BASE/$1"; rm -rf "$D"; mkdir -p "$D/scripts" "$D/docs"
  cp "$ROOT_DIR/scripts/new-project.sh" "$ROOT_DIR/scripts/check-new-project.sh" "$D/scripts/" || return 1
  cp -r "$ROOT_DIR/.claude" "$D/.claude" || return 1
  cp "$ROOT_DIR/CLAUDE.md" "$D/CLAUDE.md" || return 1
  seq 1 100 | sed 's/^/# PROJECT.md VIVO sintético — línea /' >"$D/PROJECT.md"
  printf '<html></html>\n' >"$D/docs/team-overview.html"
  printf '%s' "$D"
}

D0="$(preparar m0)" || { echo "✗ no pude preparar la copia. NO concluyente."; exit 2; }
if ( cd "$D0" && ./scripts/check-new-project.sh >/dev/null 2>&1 ); then ok "m0 · copia sin mutar ⇒ candado VERDE"
else
  mal "m0 · la copia sin mutar ya sale roja: el canario no puede concluir nada"
  ( cd "$D0" && ./scripts/check-new-project.sh 2>&1 | tail -15 ); exit 1
fi

mutar() { # $1=id  $2=descripción  $3=comando sh dentro de la copia  (esperado: candado ROJO)
  local id="$1" desc="$2" cmd="$3" cuenta=0 i D
  for i in $(seq 1 "$N"); do
    D="$(preparar "m${id}_$i")" || continue
    ( cd "$D" && eval "$cmd" ) || { printf '  (m%s: la mutación no aplicó)\n' "$id"; continue; }
    ( cd "$D" && ./scripts/check-new-project.sh >/dev/null 2>&1 ) || cuenta=$((cuenta+1))
  done
  if (( cuenta == N )); then ok "m${id} · ${desc} ⇒ candado ROJO ${cuenta}/${N}"
  else mal "m${id} · ${desc} ⇒ solo ${cuenta}/${N} salieron ROJO (debería ser ${N}/${N})"; fi
}

mutar 1 'new-project.sh copia el PROJECT.md de la RAÍZ (el defecto original)' \
  "sed -i 's|cp \"\${TEMPLATES_DIR}/\${f}\" \"\${DEST}/\${f}\"|if [[ \$f == PROJECT.md ]]; then cp \"\${TEMPLATE_DIR}/PROJECT.md\" \"\${DEST}/PROJECT.md\"; else cp \"\${TEMPLATES_DIR}/\${f}\" \"\${DEST}/\${f}\"; fi|' scripts/new-project.sh && grep -q 'TEMPLATE_DIR}/PROJECT.md' scripts/new-project.sh"

mutar 2 'new-project.sh deja de copiar HECHOS.md' \
  "sed -i 's|PLANTILLAS_RAIZ=(PROJECT.md HECHOS.md |PLANTILLAS_RAIZ=(PROJECT.md |' scripts/new-project.sh && ! grep -q 'PROJECT.md HECHOS.md' scripts/new-project.sh"

mutar 3 'new-project.sh deja de copiar docs/DECISIONES.md' \
  "sed -i 's|^PLANTILLAS_DOCS=(DECISIONES.md)|PLANTILLAS_DOCS=()|' scripts/new-project.sh && grep -q 'PLANTILLAS_DOCS=()' scripts/new-project.sh"

mutar 5 'new-project.sh acepta un destino que ya existe (sin guarda)' \
  "sed -i 's|^if \\[\\[ -e \"\${DEST}\" \\]\\]; then|if false; then|' scripts/new-project.sh && grep -q '^if false; then' scripts/new-project.sh"

# m4: plantilla incompleta ⇒ el script FALLA (exit 2) y no deja nada a medias.
cuenta_rc=0; cuenta_nada=0; cuenta_rojo=0
for i in $(seq 1 "$N"); do
  D="$(preparar "m4_$i")" || continue
  rm -f "$D/.claude/templates/TRASPASO.md"
  ( cd "$D" && ./scripts/new-project.sh "$D/destino" >/dev/null 2>&1 ); rc=$?
  (( rc == 2 )) && cuenta_rc=$((cuenta_rc+1))
  [[ ! -e "$D/destino" ]] && cuenta_nada=$((cuenta_nada+1))
  ( cd "$D" && ./scripts/check-new-project.sh >/dev/null 2>&1 ) || cuenta_rojo=$((cuenta_rojo+1))
done
if (( cuenta_rc == N && cuenta_nada == N && cuenta_rojo == N )); then
  ok "m4 · falta .claude/templates/TRASPASO.md ⇒ new-project exit 2 ${cuenta_rc}/${N} · destino NO creado ${cuenta_nada}/${N} · candado ROJO ${cuenta_rojo}/${N}"
else
  mal "m4 · falta plantilla ⇒ exit 2 ${cuenta_rc}/${N} · destino no creado ${cuenta_nada}/${N} · candado rojo ${cuenta_rojo}/${N} (todo debería ser ${N}/${N})"
fi

echo
if (( FALLOS == 0 )); then printf '\033[1;32m✓ Canario de new-project: %s/%s.\033[0m\n' "$PASADAS" "$PASADAS"; exit 0; fi
printf '\033[1;31m✗ Canario de new-project: %s fallo(s) de %s.\033[0m\n' "$FALLOS" "$((PASADAS+FALLOS))"; exit 1

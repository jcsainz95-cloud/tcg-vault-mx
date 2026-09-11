#!/usr/bin/env bash
#
# check-secret-masking-canary.sh — «¿el candado S-MASK-1 muerde, o solo saluda?»
#                                                                        · devops
# =============================================================================
# DE DÓNDE VIENE (2026-09-11)
# ---------------------------------------------------------------------------
# Un enmascarado que nadie comprueba se cae solo, y se cae EN SILENCIO: el log
# sigue saliendo, el job sigue verde, y el secreto sale en claro sin que nada
# cambie de color. Por eso el candado `check-secret-masking.sh` necesita su propia
# prueba de que puede ponerse rojo.
#
# El canario NO comprueba el enmascarado: comprueba EL CANDADO. Muta el árbol
# —sobre una COPIA, nunca el vivo (O-8/O-9)— reintroduciendo cada forma concreta
# del defecto, y exige que el candado se ponga rojo en cada una.
#
#   m1  quitar la llamada a `enmascarar` en `generar`   ⇒ los 15 valores del
#       catálogo salen en claro. Es el defecto ORIGINAL, tal cual se midió en el
#       run 34650494939.
#   m2  mandar la máscara a STDOUT en vez de a stderr   ⇒ el `::add-mask::` se mete
#       DENTRO del valor: el secreto queda corrupto y el fallo aparecería ocho
#       pasos más tarde, en el `compose`, apuntando al sitio equivocado.
#   m3  quitar el enmascarado del secreto EFÍMERO de webhook (la otra ruta, la de
#       `P-WH-1`, que no pasa por `generar`).
#   m4  enmascarar solo algunas formas (las `*_PASSWORD`) y dejar fuera las claves
#       de PII ⇒ el candado tiene que cazar la AUSENCIA PARCIAL, no solo la total.
#
# Cada mutación se corre N veces (por defecto 3) y se reporta la proporción: una
# sola tirada no distingue «el candado sirve» de «tuve suerte» (O-3).
#
# Uso:  ./scripts/check-secret-masking-canary.sh [N]
# Sale 0 si TODAS las mutaciones ponen el candado en rojo en las N tiradas.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
N="${1:-3}"
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
mal() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }

BASE="$(mktemp -d -t mask-canary-XXXXXX)"; trap 'rm -rf "$BASE"' EXIT

# Copia MÍNIMA y propia: solo los tres guiones implicados y lo que necesitan.
# No se toca el árbol vivo (hay más agentes trabajando en él).
preparar() {
  D="$BASE/$1"; rm -rf "$D"; mkdir -p "$D/scripts"
  cp "$ROOT_DIR/scripts/secrets-preflight.sh" "$ROOT_DIR/scripts/webhook-secret-preflight.sh" \
     "$ROOT_DIR/scripts/check-secret-masking.sh" "$D/scripts/" || return 1
  # El catálogo se deriva de los compose: se copian los que existan.
  for f in docker-compose.yml docker-compose.staging.yml docker-compose.prod.yml; do
    [ -f "$ROOT_DIR/$f" ] && cp "$ROOT_DIR/$f" "$D/" 2>/dev/null
  done
  chmod +x "$D/scripts/"*.sh
  printf '%s' "$D"
}

# Comprueba que la copia SIN mutar sale verde: si no, el canario mide otra cosa.
D0="$(preparar limpio)" || { echo "✗ no pude preparar la copia. NO concluyente."; exit 2; }
if ( cd "$D0" && ./scripts/check-secret-masking.sh >/dev/null 2>&1 ); then
  ok "la copia sin mutar sale VERDE (el canario mide la mutación, no el copiado)"
else
  mal "la copia sin mutar ya sale roja: el canario no puede concluir nada"
  echo; printf '\033[1;31m✗ Canario S-MASK-1: base rota.\033[0m\n'; exit 1
fi

# ---------------------------------------------------------------------------
correr_mutacion() { # $1=id  $2=descripción  $3=comando python de mutación
  local id="$2" rojo=0 i D
  for i in $(seq 1 "$N"); do
    D="$(preparar "m$1_$i")" || continue
    ( cd "$D" && python3 -c "$3" ) || { printf '  (m%s: la mutación no aplicó)\n' "$1"; continue; }
    if ( cd "$D" && ./scripts/check-secret-masking.sh >/dev/null 2>&1 ); then :; else rojo=$((rojo+1)); fi
  done
  if [ "$rojo" -eq "$N" ]; then ok "m$1 · $id ⇒ candado ROJO $rojo/$N"
  else mal "m$1 · $id ⇒ candado rojo solo $rojo/$N (debería ser $N/$N: el defecto pasaría)"; fi
}

correr_mutacion 1 "sin enmascarar lo generado (el defecto original)" '
import re
p="scripts/secrets-preflight.sh"; s=open(p).read()
old="  __v=\"$(generar_crudo \"$1\")\"\n  enmascarar \"$__v\"\n"
assert old in s, "no encontré la llamada a enmascarar en generar"
open(p,"w").write(s.replace(old,"  __v=\"$(generar_crudo \"$1\")\"\n",1))
'

correr_mutacion 2 "máscara por STDOUT (corrompe el valor dentro de \$(...))" '
p="scripts/secrets-preflight.sh"; s=open(p).read()
old="  printf '"'"'::add-mask::%s\\n'"'"' \"$1\" >&2\n}\n\ngenerar() {"
assert old in s, "no encontré el cuerpo de enmascarar"
new="  printf '"'"'::add-mask::%s\\n'"'"' \"$1\"\n}\n\ngenerar() {"
open(p,"w").write(s.replace(old,new,1))
'

correr_mutacion 3 "sin enmascarar el secreto efímero de webhook (ruta P-WH-1)" '
p="scripts/webhook-secret-preflight.sh"; s=open(p).read()
old="  enmascarar \"$__wh\"\n"
assert old in s, "no encontré el enmascarado del webhook"
open(p,"w").write(s.replace(old,"",1))
'

correr_mutacion 4 "enmascarado PARCIAL: tapa *_PASSWORD y deja las claves de PII" '
p="scripts/secrets-preflight.sh"
s=open(p).read()
g="enmascarar() {\n  [ \"${GITHUB_ACTIONS:-}\" = \"true\" ] || return 0\n"
assert g in s, "no encontré la guarda de enmascarar"
s=s.replace(g, g+"  case \"${__nombre_actual:-}\" in *PASSWORD) ;; *) return 0 ;; esac\n", 1)
h="generar() {\n"
assert h in s, "no encontré generar()"
s=s.replace(h, h+"  __nombre_actual=\"$1\"\n", 1)
open(p,"w").write(s)
'

echo
if [ "$FALLOS" -eq 0 ]; then
  printf '\033[1;32m✓ Canario S-MASK-1: %s/%s — el candado se pone rojo ante las cuatro formas del defecto.\033[0m\n' "$PASADAS" "$PASADAS"
  exit 0
fi
printf '\033[1;31m✗ Canario S-MASK-1: %s fallo(s) de %s.\033[0m\n' "$FALLOS" "$((PASADAS+FALLOS))"
exit 1

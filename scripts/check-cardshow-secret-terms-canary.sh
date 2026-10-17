#!/usr/bin/env bash
# check-cardshow-secret-terms-canary.sh — «¿el candado de nombres de patrocinador MUERDE?» · devops
# =============================================================================
# Ejercita scripts/check-cardshow-secret-terms.sh sobre un árbol SINTÉTICO (nunca el vivo),
# con un término de prueba INVENTADO que este repo nunca ha tenido:
#   verde (rc=0): árbol limpio con la env puesta;
#   ROJO  (rc=1): término plantado en backend/  ⇒ demuestra que mira backend;
#   ROJO  (rc=1): término plantado en docs/      ⇒ demuestra que mira docs;
#   ROJO  (rc=1): término plantado en frontend/  ⇒ demuestra que mira frontend;
#   ROJO  (rc=1): case-insensitive (minúsculas)  ⇒ demuestra que no se escapa por mayúsculas;
#   CERRADO (rc=2): misma fuga pero SIN env       ⇒ demuestra que NO se salta en silencio.
# Además comprueba que el workflow de CI cablea el secreto y escanea los TRES árboles
# (anti-regresión del defecto original: «siempre se salta y solo mira frontend»).
#
# El término de prueba NO es un nombre real de patrocinador: es un marcador QA.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE="$ROOT/scripts/check-cardshow-secret-terms.sh"
CANARY_TERM="ZZQA-CANARY-SPONSOR-9D3F7B"   # inventado; jamás un patrocinador real

F=0; ok(){ printf '  ok  %s\n' "$*"; }; bad(){ printf '  MAL %s\n' "$*"; F=$((F+1)); }
B="$(mktemp -d -t cardshow-secret-canario-XXXXXX)"; trap 'rm -rf "$B"' EXIT

# Árbol sintético con los tres subárboles y contenido inocuo.
mk() {
  rm -rf "$B/t"
  mkdir -p "$B/t/backend/src/modules/card-show" "$B/t/docs" "$B/t/frontend/src/content"
  echo "export const CARD_SHOW = { date: '2026-11-15', venue: 'CDMX' };" > "$B/t/frontend/src/content/card-show.ts"
  echo "# Card Show — notas" > "$B/t/docs/DEVOPS_NOTES.md"
  echo "export const SPONSOR_SHOW = false; // tipo de lead merchant|sponsor" > "$B/t/backend/src/modules/card-show/card-show.constants.ts"
}
# rc del gate con la env dada ($1 = valor de CARDSHOW_SECRET_TERMS; si se omite, SIN env).
run() {
  if [ "$#" -ge 1 ]; then
    CARDSHOW_SECRET_TERMS="$1" bash "$GATE" "$B/t" >/dev/null 2>&1
  else
    env -u CARDSHOW_SECRET_TERMS bash "$GATE" "$B/t" >/dev/null 2>&1
  fi
}

mk; run "$CANARY_TERM"; [ "$?" -eq 0 ] && ok "árbol limpio + env ⇒ verde (rc=0)" || bad "árbol limpio debía salir 0"

mk; echo "// contacto: $CANARY_TERM" >> "$B/t/backend/src/modules/card-show/card-show.constants.ts"
run "$CANARY_TERM"; [ "$?" -eq 1 ] && ok "término en backend/ ⇒ ROJO (rc=1)" || bad "término en backend/ DEBÍA ser rc=1"

mk; echo "patrocinador: $CANARY_TERM" >> "$B/t/docs/DEVOPS_NOTES.md"
run "$CANARY_TERM"; [ "$?" -eq 1 ] && ok "término en docs/ ⇒ ROJO (rc=1)" || bad "término en docs/ DEBÍA ser rc=1"

mk; echo "const sponsor = '$CANARY_TERM';" >> "$B/t/frontend/src/content/card-show.ts"
run "$CANARY_TERM"; [ "$?" -eq 1 ] && ok "término en frontend/ ⇒ ROJO (rc=1)" || bad "término en frontend/ DEBÍA ser rc=1"

# case-insensitive: el fichero trae minúsculas, la env trae mayúsculas.
mk; printf 'const s = "%s";\n' "$(printf '%s' "$CANARY_TERM" | tr 'A-Z' 'a-z')" >> "$B/t/frontend/src/content/card-show.ts"
run "$CANARY_TERM"; [ "$?" -eq 1 ] && ok "coincidencia case-insensitive ⇒ ROJO (rc=1)" || bad "case-insensitive DEBÍA ser rc=1"

# fail-closed: misma fuga, SIN env ⇒ rc=2 (no se salta).
mk; echo "// $CANARY_TERM" >> "$B/t/backend/src/modules/card-show/card-show.constants.ts"
run; [ "$?" -eq 2 ] && ok "fuga SIN env ⇒ FALLA CERRADO (rc=2), no se salta" || bad "sin env DEBÍA fallar cerrado (rc=2)"

# env en blanco (comas/espacios vacíos) ⇒ también cerrado.
mk; run " , , "; [ "$?" -eq 2 ] && ok "env en blanco ⇒ FALLA CERRADO (rc=2)" || bad "env en blanco DEBÍA ser rc=2"

# ------- anti-regresión del cableado del workflow (el defecto original) -------
CI="$ROOT/.github/workflows/ci.yml"
if [ -f "$CI" ]; then
  grep -q 'check-cardshow-secret-terms.sh' "$CI" \
    && ok "ci.yml invoca el escaneo" || bad "ci.yml NO invoca check-cardshow-secret-terms.sh"
  grep -q 'secrets.CARDSHOW_SECRET_TERMS' "$CI" \
    && ok "ci.yml pasa el secreto CARDSHOW_SECRET_TERMS" || bad "ci.yml NO pasa secrets.CARDSHOW_SECRET_TERMS al escaneo"
  grep -q 'check-cardshow-secret-terms-canary.sh' "$CI" \
    && ok "ci.yml invoca el canario" || bad "ci.yml NO invoca el canario"
else
  bad "no encuentro .github/workflows/ci.yml"
fi
# el escaneo mira los tres árboles (no solo frontend): está escrito en el propio script.
grep -q 'SUBDIRS=(backend docs frontend)' "$GATE" \
  && ok "el escaneo cubre backend+docs+frontend (no solo frontend)" || bad "el escaneo NO declara los tres árboles"

[ "$F" -eq 0 ] && { echo "canario: el candado muerde donde debe y el cableado está puesto"; exit 0; } || { echo "canario: $F fallo(s)"; exit 1; }

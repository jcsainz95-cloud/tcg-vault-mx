#!/usr/bin/env bash
#
# check-sepomex-pin.sh — el catálogo de CP de SEPOMEX del repositorio es EXACTAMENTE el que entregó el dueño · devops
# =============================================================================
# Norma: HECHOS.md, fila 2026-10-07 «Catálogo de códigos postales (SEPOMEX) VA EN EL REPOSITORIO, público, con su
# huella fijada» — palabras del dueño: «déjalo en el código, solo asegúrate que nadie lo pueda alterar».
#
# La huella vive en CÓDIGO (las dos constantes de abajo), y además en el `.sha256` hermano y en el manifiesto que lee
# el importador (`scripts/geo/import-sepomex.ts`, que ya comprueba sha256 y setDigest contra el manifiesto ANTES de
# interpretar el archivo). Este candado exige que las cuatro cosas digan lo mismo. Cambiar el archivo obliga a
# cambiar, en el MISMO diff, este script: el cambio queda a la vista en la revisión, no escondido en 15 MB de datos.
#
# Qué comprueba (cada rojo nombra su bloque):
#   [A] el archivo existe y su sha256 = PINNED_FILE_SHA256.
#   [B] `CPdescarga.txt.sha256` es exactamente «<PINNED_FILE_SHA256>  CPdescarga.txt» (formato de `sha256sum -c`).
#   [C] el manifiesto `CPdescarga.manifest.json`: `fileSha256` = PINNED_FILE_SHA256 y `setDigest` = PINNED_SET_DIGEST.
#   [D] git no lo normaliza: `git check-attr` da `text: unset` (y `diff`/`merge` unset: la regla `binary` de
#       `.gitattributes`). Con `text` puesto o sin regla, un `core.autocrlf`/`eol` ajeno podría convertir CRLF→LF al
#       commitear y la huella dejaría de cuadrar en el siguiente checkout — o peor, alguien re-fijaría la huella del
#       archivo convertido.
#   [E] si el archivo está en el índice, el blob del índice es byte a byte el del árbol (`git hash-object
#       --no-filters` = `git ls-files -s`): lo que se commitea es lo que se mide.
#   [F] `.gitignore` no lo ignora (hay una regla `data/` general; la excepción `!scripts/geo/data/` la abre): un
#       catálogo nuevo se tiene que poder añadir sin `git add -f`.
#
# Qué NO protege (dicho entero): quien pueda fusionar a `production` puede cambiar archivo + huellas + este script en
# una sola PR. Lo que impide eso es la revisión de la PR, no un script. Este candado garantiza que el cambio no pasa
# en silencio ni por accidente (normalización de fin de línea, re-descarga, edición a mano).
#
# Uso:   ./scripts/check-sepomex-pin.sh [--root DIR]   (--root: sobre una COPIA; lo usa el canario)
# Sale 0 si se cumple; 1 si no. Sin red, sin node, sin Docker. Canario: check-sepomex-pin-canary.sh. DEVOPS_NOTES §92.
# =============================================================================
set -uo pipefail

# ⛔ LA HUELLA FIJADA. Se cambia SOLO junto con el archivo, su `.sha256` y su manifiesto, y con la fila de HECHOS.md.
PINNED_FILE_SHA256='071fd9ecb5c3cd71788d12e51306dcea4d55775b30bd98c9b0607ddb725235dc'
PINNED_SET_DIGEST='20cd4a578b0cd2b30b5232e7eb783a625ccb29eaf1c80efadd6ee41af68aeb5b'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "${1:-}" = "--root" ]; then
  [ -n "${2:-}" ] || { echo "--root necesita un directorio"; exit 2; }
  ROOT_DIR="$(cd "$2" && pwd)"
fi

REL='scripts/geo/data/CPdescarga.txt'
F="$ROOT_DIR/$REL"
SHAF="$F.sha256"
MANI="$ROOT_DIR/scripts/geo/data/CPdescarga.manifest.json"

FALLOS=0
ok()  { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; FALLOS=$((FALLOS+1)); }

printf '\n\033[1m== sepomex-pin: ¿el catálogo de CP es el fijado? (HECHOS 2026-10-07) ==\033[0m\n\n'

hex64='^[0-9a-f]{64}$'
[[ "$PINNED_FILE_SHA256" =~ $hex64 && "$PINNED_SET_DIGEST" =~ $hex64 ]] || bad "[A] las constantes fijadas no son sha256 hex: el candado no tiene blanco."

# [A]
if [ ! -f "$F" ]; then
  bad "[A] no existe $REL."
else
  real="$(sha256sum "$F" | awk '{print $1}')"
  if [ "$real" = "$PINNED_FILE_SHA256" ]; then
    ok "[A] sha256($REL) = fijado ($PINNED_FILE_SHA256)"
  else
    bad "[A] sha256($REL) = $real ≠ fijado en scripts/check-sepomex-pin.sh ($PINNED_FILE_SHA256). El archivo cambió sin cambiar la huella."
  fi
fi

# [B]
esperado="$PINNED_FILE_SHA256  CPdescarga.txt"
if [ ! -f "$SHAF" ]; then
  bad "[B] no existe $REL.sha256."
elif [ "$(cat "$SHAF")" = "$esperado" ] && [ "$(wc -l < "$SHAF")" -eq 1 ]; then
  ok "[B] $REL.sha256 = fijado"
else
  bad "[B] $REL.sha256 no es exactamente «$esperado» (una línea)."
fi

# [C] (sin jq: el manifiesto lo escribe JSON.stringify con 2 espacios, una clave por línea)
if [ ! -f "$MANI" ]; then
  bad "[C] no existe scripts/geo/data/CPdescarga.manifest.json (el importador lo usa como fijación)."
else
  mf="$(sed -n 's/^  "fileSha256": "\([0-9a-f]*\)",\{0,1\}$/\1/p' "$MANI")"
  md="$(sed -n 's/^  "setDigest": "\([0-9a-f]*\)",\{0,1\}$/\1/p' "$MANI")"
  [ "$mf" = "$PINNED_FILE_SHA256" ] && ok "[C] manifiesto fileSha256 = fijado" || bad "[C] manifiesto fileSha256 «$mf» ≠ fijado ($PINNED_FILE_SHA256)."
  [ "$md" = "$PINNED_SET_DIGEST" ] && ok "[C] manifiesto setDigest = fijado" || bad "[C] manifiesto setDigest «$md» ≠ fijado ($PINNED_SET_DIGEST)."
fi

# [D] y [E]
if ! git -C "$ROOT_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  bad "[D] $ROOT_DIR no es un repositorio git: no puedo comprobar los atributos."
else
  attrs="$(git -C "$ROOT_DIR" check-attr text diff merge -- "$REL")"
  for a in text diff merge; do
    v="$(printf '%s\n' "$attrs" | sed -n "s|^$REL: $a: ||p")"
    [ "$v" = "unset" ] && ok "[D] .gitattributes: $a: unset" || bad "[D] .gitattributes: $a: «$v» (tiene que ser unset: regla «$REL binary»)."
  done
  idx="$(git -C "$ROOT_DIR" ls-files -s -- "$REL" | awk '{print $2}')"
  if [ -n "$idx" ] && [ -f "$F" ]; then
    wt="$(git -C "$ROOT_DIR" hash-object --no-filters -- "$REL")"
    [ "$idx" = "$wt" ] && ok "[E] blob del índice = bytes del árbol ($idx)" || bad "[E] blob del índice $idx ≠ bytes del árbol $wt (git lo filtró o hay cambios sin commitear)."
  fi
  if git -C "$ROOT_DIR" check-ignore -q --no-index -- "$REL"; then
    bad "[F] .gitignore ignora $REL (falta la excepción «!scripts/geo/data/»)."
  else
    ok "[F] .gitignore no lo ignora"
  fi
fi

echo
if [ "$FALLOS" -eq 0 ]; then
  printf '\033[1;32mOK — el catálogo de CP es el fijado.\033[0m\n'; exit 0
fi
printf '\033[1;31m%d fallo(s). Si el cambio del catálogo es legítimo: archivo + .sha256 + manifiesto (import-sepomex.sh manifest) + constantes de este script + fila de HECHOS.md, en la misma PR (DEVOPS_NOTES §92).\033[0m\n' "$FALLOS"
exit 1

#!/usr/bin/env bash
#
# check-image-sharp-canary.sh — canario de G-SHARP (scripts/check-image-sharp.sh) · devops
# =============================================================================
# Un candado que no se ha visto morder no es un candado. A partir de la imagen REAL ya construida, deriva imágenes
# rotas (sin red: solo `rm` sobre capas existentes) y exige que G-SHARP salga ROJO en cada una y VERDE en la prístina:
#   V1  prístina                                   ⇒ verde
#   R1  sin `@img/sharp-linuxmusl-<arch>`           ⇒ rojo (A): el addon de la plataforma no está
#   R2  sin `@img/sharp-libvips-linuxmusl-<arch>`   ⇒ rojo (A/B): el addon está pero su libvips no
#   R3  sin `dist/modules/accessories/accessory-photo.js` ⇒ rojo (D)
#   R4  la prístina comprobada como glibc          ⇒ rojo (B): el candado distingue la libc
#
# Uso:   ./scripts/check-image-sharp-canary.sh IMAGEN
# Sale 0 si los 5 casos dan lo esperado; 1 si alguno no. Borra las imágenes derivadas al terminar. DEVOPS_NOTES §93.
# =============================================================================
set -uo pipefail

IMG="${1:-}"
[ -n "$IMG" ] || { echo "uso: $0 IMAGEN" >&2; exit 2; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="$HERE/check-image-sharp.sh"
ARCH="$(docker run --rm --network none --entrypoint node "$IMG" -p process.arch 2>/dev/null)" \
  || { echo "✗ canario G-SHARP: no puedo leer process.arch de '$IMG'" >&2; exit 1; }
TAG="g-sharp-canary-$$"
FALLOS=0
DERIVADAS=()
DER=""
cleanup() { [ "${#DERIVADAS[@]}" -gt 0 ] && docker image rm -f "${DERIVADAS[@]}" >/dev/null 2>&1; }
trap cleanup EXIT

derivar() { # nombre, ruta a borrar (relativa a /app)
  local t="$TAG-$1"
  printf 'FROM %s\nUSER root\nRUN rm -rf /app/%s && test ! -e /app/%s\nUSER nestjs\n' "$IMG" "$2" "$2" \
    | docker build -q -t "$t" - >/dev/null || { echo "✗ canario: no pude derivar $1" >&2; exit 1; }
  DERIVADAS+=("$t"); DER="$t"   # en el shell padre (no en $(…)): el trap tiene que verla para borrarla
}

caso() { # etiqueta, esperado (0|1), imagen, [args…]
  local et="$1" esp="$2" im="$3"; shift 3
  local out rc
  out="$("$CHECK" "$im" "$@" 2>&1)"; rc=$?
  [ "$rc" -ne 0 ] && rc=1
  if [ "$rc" -eq "$esp" ]; then
    echo "  ok  $et (rc=$rc) — ${out%%$'\n'*}"
  else
    echo "  MAL $et: esperaba rc=$esp y salió rc=$rc — ${out%%$'\n'*}"; FALLOS=$((FALLOS+1))
  fi
}

echo "Canario G-SHARP sobre $IMG (arch $ARCH)"
caso "V1 prístina"               0 "$IMG"
derivar r1 "node_modules/@img/sharp-linuxmusl-$ARCH";             caso "R1 sin addon musl"         1 "$DER"
derivar r2 "node_modules/@img/sharp-libvips-linuxmusl-$ARCH";      caso "R2 sin libvips musl"       1 "$DER"
derivar r3 "dist/modules/accessories/accessory-photo.js";          caso "R3 sin accessory-photo.js" 1 "$DER"
caso "R4 libc equivocada"        1 "$IMG" --expect-libc glibc

if [ "$FALLOS" -eq 0 ]; then echo "✓ canario G-SHARP: 5/5"; exit 0; fi
echo "✗ canario G-SHARP: $FALLOS de 5 casos no dieron lo esperado"; exit 1

#!/usr/bin/env bash
# Regenera el subconjunto LATINO de Zen Old Mincho que sirve `src/app/[locale]/layout.tsx`
# vía next/font/local (pendiente P-FONTS-CJK, ver docs/FRONTEND_NOTES.md).
#
# Por qué existe: Zen Old Mincho es una familia CJK. `next/font/google` ignora `subsets: ['latin']`
# en familias CJK (Google la trocea en ~122 tramos unicode-range por peso) y generaba 366 woff2
# (242 precargados en el layout). El sitio no tiene ni un carácter japonés: solo necesitamos latín.
#
# Requisitos: curl, python3 (crea un venv temporal con fonttools + brotli).
# Uso: frontend/scripts/subset-zen-old-mincho.sh   (escribe en src/app/fonts/zen-old-mincho/)
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$HERE/src/app/fonts/zen-old-mincho"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Rango latin estándar de Google Fonts + flechas (→ se usa en la UI).
UNICODES="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD"

python3 -m venv "$WORK/venv"
"$WORK/venv/bin/pip" install -q fonttools brotli

# Sin User-Agent de navegador, la API css2 devuelve el TTF completo (sin trocear) por peso.
curl -sSf -A curl "https://fonts.googleapis.com/css2?family=Zen+Old+Mincho:wght@400;500;600" > "$WORK/api.css"

for W in 400 500 600; do
  URL="$(awk -v w="$W" '/font-weight:/{gsub(/[^0-9]/,"",$0); cur=$0} /src: url/{ if (cur==w) { match($0,/https:[^)]*/); print substr($0,RSTART,RLENGTH) } }' "$WORK/api.css")"
  curl -sSf -o "$WORK/$W.ttf" "$URL"
  "$WORK/venv/bin/pyftsubset" "$WORK/$W.ttf" \
    --unicodes="$UNICODES" --flavor=woff2 --layout-features='*' \
    --output-file="$OUT/zen-old-mincho-latin-$W.woff2"
done

ls -la "$OUT"

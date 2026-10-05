#!/usr/bin/env bash
# =============================================================================
# check-stack-upload-origin.sh — M-3 (QA, 2026-10-05) · devops
# -----------------------------------------------------------------------------
# El stack nativo NO exportaba `NEXT_PUBLIC_UPLOAD_ORIGIN`: la CSP del frontend
# (`frontend/src/security/csp.ts`) caía al comodín de R2 y en local el PUT prefirmado
# al s3-local no estaba en `connect-src`. Este candado comprueba, sobre el
# `scripts/stack-native.sh` REAL (las líneas se extraen del fichero, no se copian):
#   1. con S3_LOCAL_PORT=9000 y =9100, el origen exportado es http://127.0.0.1:<puerto>
#      (SIGUE al puerto, como S3_ENDPOINT — la lección de S3-CLON, §85.6);
#   2. el valor casa con ORIGIN_RE de csp.ts (si no casara, la CSP lo tiraría y
#      volvería al comodín de R2 en silencio);
#   3. un NEXT_PUBLIC_UPLOAD_ORIGIN explícito se respeta;
#   4. ningún lanzamiento de Next lo pisa con otro valor.
#
# Uso:  ./scripts/check-stack-upload-origin.sh            # candado
#       ./scripts/check-stack-upload-origin.sh --canary   # 3 mutaciones ⇒ las 3 deben salir ROJAS
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

comprobar() {
  local f="$1" csp="$ROOT_DIR/frontend/src/security/csp.ts" fallos=0 bloque re p got
  bloque="$(sed -n '/^S3_LOCAL_PORT=/,/^export NEXT_PUBLIC_UPLOAD_ORIGIN=/p' "$f")"
  if ! printf '%s\n' "$bloque" | grep -q '^export NEXT_PUBLIC_UPLOAD_ORIGIN='; then
    echo "  ✗ $f no exporta NEXT_PUBLIC_UPLOAD_ORIGIN tras S3_LOCAL_PORT/S3_ENDPOINT."; return 1
  fi
  # ORIGIN_RE de csp.ts, traducido a ERE (\d ⇒ [0-9]). Sin csp.ts (copia parcial) se usa
  # la última versión conocida, y se dice.
  re="$(sed -nE 's|^const ORIGIN_RE = /(.*)/i;$|\1|p' "$csp" 2>/dev/null | sed 's/\\d/[0-9]/g')"
  [ -n "$re" ] || { re='^https?://(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*(:[0-9]{1,5})?$'; echo "  · (sin csp.ts: ORIGIN_RE conocido)"; }
  for p in 9000 9100; do
    got="$(env -i PATH="$PATH" S3_LOCAL_PORT="$p" bash -c "$bloque"'
      printf "%s" "$NEXT_PUBLIC_UPLOAD_ORIGIN"')"
    if [ "$got" = "http://127.0.0.1:$p" ]; then echo "  ✔ S3_LOCAL_PORT=$p ⇒ $got"
    else echo "  ✗ S3_LOCAL_PORT=$p ⇒ '$got' (esperado http://127.0.0.1:$p)"; fallos=$((fallos+1)); fi
    if printf '%s' "$got" | grep -Eiq "$re"; then echo "  ✔ casa con ORIGIN_RE de csp.ts"
    else echo "  ✗ '$got' NO casa con ORIGIN_RE ⇒ la CSP caería al comodín de R2"; fallos=$((fallos+1)); fi
  done
  got="$(env -i PATH="$PATH" NEXT_PUBLIC_UPLOAD_ORIGIN=https://x.example bash -c "$bloque"'
    printf "%s" "$NEXT_PUBLIC_UPLOAD_ORIGIN"')"
  if [ "$got" = "https://x.example" ]; then echo "  ✔ un valor explícito se respeta"
  else echo "  ✗ valor explícito pisado: '$got'"; fallos=$((fallos+1)); fi
  if grep -nE '^[[:space:]]+NEXT_PUBLIC_UPLOAD_ORIGIN=' "$f" | grep -q .; then
    echo "  ✗ algún lanzamiento de Next fija NEXT_PUBLIC_UPLOAD_ORIGIN aparte:"; grep -nE '^[[:space:]]+NEXT_PUBLIC_UPLOAD_ORIGIN=' "$f"
    fallos=$((fallos+1))
  else echo "  ✔ ningún lanzamiento de Next lo pisa"; fi
  [ "$fallos" = 0 ]
}

if [ "${1:-}" != "--canary" ]; then
  echo "== M-3: el stack nativo exporta el origen de subida para la CSP =="
  comprobar "$ROOT_DIR/scripts/stack-native.sh" && { echo "✓ OK"; exit 0; }
  echo "✗ ROJO"; exit 1
fi

TMP="$(mktemp -d -t upl-origin-XXXXXX)"; trap 'rm -rf "$TMP"' EXIT
SRC="$ROOT_DIR/scripts/stack-native.sh"; muerde=0; total=0
mutar() {  # $1 = descripción, $2 = expresión sed
  total=$((total+1)); local m="$TMP/m$total.sh"
  sed "$2" "$SRC" > "$m"
  if cmp -s "$m" "$SRC"; then echo "  ✗ mutación '$1' no cambió nada (el canario está ciego)"; return; fi
  if comprobar "$m" >/dev/null 2>&1; then echo "  ✗ '$1' ⇒ VERDE (el candado NO muerde)"
  else echo "  ✔ '$1' ⇒ ROJO"; muerde=$((muerde+1)); fi
}
echo "== Canario de check-stack-upload-origin =="
comprobar "$SRC" >/dev/null 2>&1 || { echo "✗ el original ya está rojo: el canario no concluye"; exit 2; }
mutar "sin export" '/^export NEXT_PUBLIC_UPLOAD_ORIGIN=/d'
mutar "puerto fijo :9000" 's|^export NEXT_PUBLIC_UPLOAD_ORIGIN=.*|export NEXT_PUBLIC_UPLOAD_ORIGIN="${NEXT_PUBLIC_UPLOAD_ORIGIN:-http://127.0.0.1:9000}"|'
mutar "next start lo pisa" 's|^\([[:space:]]*\)NEXT_PUBLIC_USE_MOCKS=false \\$|&\n\1NEXT_PUBLIC_UPLOAD_ORIGIN= \\|'
echo "Canario: $muerde/$total mutaciones salen ROJAS."
[ "$muerde" = "$total" ]

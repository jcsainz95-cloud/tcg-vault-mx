#!/usr/bin/env bash
# =============================================================================
# check-stack-frontend-build.sh — PEN-VEL-2 + DEVOPS-GATE-MEDICION (2026-10-29) · devops
# -----------------------------------------------------------------------------
# Dos defectos del frontend HORNEADO de `stack-native.sh up --gate`:
#   PEN-VEL-2 (pentester): compilaba con `npx next build`, que se salta `prebuild`
#     (C-D1, aviso de medición) y `postbuild` (`check-home-bundle.mjs`). El gate local
#     medía un artefacto que no había pasado los candados del que se publica.
#   DEVOPS-GATE-MEDICION (QA): horneaba sin `NEXT_PUBLIC_MEASUREMENT_MODE` ni IDs, así que
#     el banner de cookies no existía en ningún gate local. Ahora `up --gate --measurement`
#     (o STACK_MEASUREMENT=on) lo hornea con IDs DE FICCIÓN; por defecto sigue `off`, y en
#     los dos casos las NEXT_PUBLIC_* de medición las FIJA el script (un ID real exportado
#     en la sesión no llega al bundle).
#
# Este candado ejecuta la `start_frontend` REAL del script (cargado con `source` en una
# copia de scripts/ + security/ sin .git) con `npm` y `npx` sustituidos por señuelos que
# anotan con qué se llamaron; el `next start` señuelo es un servidor de maqueta en :39988.
#   1. por defecto: `npm run build` (nunca `npx next build`), medición `off`, IDs VACÍOS
#      aunque el entorno exporte uno real, y el `next start` recibe lo mismo; sello `measurement=off`;
#   2. STACK_MEASUREMENT=on: modo `on` e IDs de ficción en build y start; sello `measurement=on`;
#   3. el build sin la marca del postbuild (HOME_BUNDLE_OK) ⇒ para y NO arranca el servidor;
#   4. el build sin la marca del prebuild (MEASUREMENT_NOTICE_OK) ⇒ ídem;
#   5. STACK_MEASUREMENT=banana ⇒ rc ≠ 0;
#   6. `up` acepta `--measurement` (estático: la opción enciende STACK_MEASUREMENT).
#
# Uso:  ./scripts/check-stack-frontend-build.sh            # candado
#       ./scripts/check-stack-frontend-build.sh --canary   # mutaciones ⇒ todas ROJAS
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d -t stack-febuild-XXXXXX)"
FE_PORT=39988
limpiar() {
  local f
  for f in "$TMP"/c-*/.native-stack/frontend.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; done
  rm -rf "$TMP"
}
trap limpiar EXIT
if curl -s -m 2 -o /dev/null "http://127.0.0.1:$FE_PORT/" 2>/dev/null; then
  echo "::error::el puerto $FE_PORT ya responde: no es mío (NO concluyente)"; exit 2
fi

SHIM="$TMP/shim"; mkdir -p "$SHIM"
cat > "$SHIM/npm" <<'EOF'
#!/bin/sh
echo "npm $*" >> "$LLAMADAS"
env | grep '^NEXT_PUBLIC_' | sort > "$ENV_BUILD"
case "${TEST_MARCAS:-ambas}" in
  ambas)  echo "MEASUREMENT_NOTICE_OK mode=${NEXT_PUBLIC_MEASUREMENT_MODE:-?}"; echo "HOME_BUNDLE_OK (1 chunks)" ;;
  pre)    echo "MEASUREMENT_NOTICE_OK mode=${NEXT_PUBLIC_MEASUREMENT_MODE:-?}" ;;
  post)   echo "HOME_BUNDLE_OK (1 chunks)" ;;
esac
exit 0
EOF
cat > "$SHIM/npx" <<EOF
#!/bin/sh
echo "npx \$*" >> "\$LLAMADAS"
if [ "\$1 \$2" = "next start" ]; then
  env | grep '^NEXT_PUBLIC_' | sort > "\$ENV_START"
  exec python3 -I "$ROOT_DIR/scripts/stack-test/fake-health-server.py" "\$4"
fi
exit 0
EOF
chmod +x "$SHIM"/*

copia() {  # $1 destino, $2 stack-native.sh
  mkdir -p "$1/frontend/node_modules" "$1/backend"
  ( cd "$ROOT_DIR" && tar --exclude=node_modules --exclude=.native-stack -cf - scripts security ) | tar -xf - -C "$1"
  cp "$2" "$1/scripts/stack-native.sh"
}

# Corre start_frontend en build; deja RC, OUT y los ficheros de llamadas/env en $1.
arrancar() {  # $1 dir ; env extra en el entorno del llamador
  local d="$1"
  export LLAMADAS="$d/llamadas" ENV_BUILD="$d/env-build" ENV_START="$d/env-start"
  : > "$LLAMADAS"; : > "$ENV_BUILD"; : > "$ENV_START"
  OUT="$(cd "$d" && env PATH="$SHIM:$PATH" FRONTEND_PORT=$FE_PORT BACKEND_PORT=39989 FRONTEND_MODE=build \
          NEXT_PUBLIC_GA4_MEASUREMENT_ID=G-REALREAL1 NEXT_PUBLIC_META_PIXEL_ID=999999999999999 \
          timeout 120 bash -c '. ./scripts/stack-native.sh && start_frontend' 2>&1)"; RC=$?
  if [ -f "$d/.native-stack/frontend.pid" ]; then kill "$(cat "$d/.native-stack/frontend.pid")" 2>/dev/null; sleep 0.3; fi
}

comprobar() {  # $1 stack-native.sh
  local d fallos=0
  ok() { echo "  ✔ $*"; }
  ko() { echo "  ✗ $*"; fallos=$((fallos+1)); }

  d="$TMP/c-$RANDOM"; copia "$d" "$1"
  unset STACK_MEASUREMENT TEST_MARCAS
  arrancar "$d"
  { [ "$RC" = 0 ] && grep -qx 'npm run build' "$d/llamadas" && ! grep -q 'next build' "$d/llamadas"; } \
    && ok "build con \`npm run build\` (no \`npx next build\`)" || ko "build: rc=$RC llamadas=[$(tr '\n' ';' < "$d/llamadas")] — $(printf '%s' "$OUT" | tail -n 2 | tr '\n' ' ')"
  for f in env-build env-start; do
    { grep -qx 'NEXT_PUBLIC_MEASUREMENT_MODE=off' "$d/$f" && grep -qx 'NEXT_PUBLIC_GA4_MEASUREMENT_ID=' "$d/$f" \
        && grep -qx 'NEXT_PUBLIC_META_PIXEL_ID=' "$d/$f" && grep -qx 'NEXT_PUBLIC_USE_MOCKS=false' "$d/$f"; } \
      && ok "por defecto ($f): medición off, IDs vacíos aunque el entorno traiga uno real" \
      || ko "por defecto ($f): $(tr '\n' ' ' < "$d/$f")"
  done
  grep -qx 'measurement=off' "$d/.native-stack/frontend.stamp" 2>/dev/null && ok "sello: measurement=off" || ko "sello sin measurement=off"

  d="$TMP/c-$RANDOM"; copia "$d" "$1"
  STACK_MEASUREMENT=on arrancar "$d"
  for f in env-build env-start; do
    { [ "$RC" = 0 ] && grep -qx 'NEXT_PUBLIC_MEASUREMENT_MODE=on' "$d/$f" && grep -qx 'NEXT_PUBLIC_GA4_MEASUREMENT_ID=G-E2ETEST1' "$d/$f" \
        && grep -qx 'NEXT_PUBLIC_META_PIXEL_ID=1234567890123' "$d/$f"; } \
      && ok "STACK_MEASUREMENT=on ($f): modo on e IDs de ficción" || ko "on ($f): rc=$RC $(tr '\n' ' ' < "$d/$f")"
  done
  grep -qx 'measurement=on' "$d/.native-stack/frontend.stamp" 2>/dev/null && ok "sello: measurement=on" || ko "sello sin measurement=on"

  for m in pre post; do
    d="$TMP/c-$RANDOM"; copia "$d" "$1"
    TEST_MARCAS=$m arrancar "$d"
    { [ "$RC" != 0 ] && ! grep -q 'next start' "$d/llamadas"; } \
      && ok "build con solo la marca «$m» ⇒ rc=$RC y no arranca el servidor" || ko "marca solo «$m»: rc=$RC llamadas=[$(tr '\n' ';' < "$d/llamadas")]"
  done

  d="$TMP/c-$RANDOM"; copia "$d" "$1"
  STACK_MEASUREMENT=banana arrancar "$d"
  { [ "$RC" != 0 ] && printf '%s' "$OUT" | grep -q 'STACK_MEASUREMENT debe ser' && [ ! -s "$d/llamadas" ]; } \
    && ok "STACK_MEASUREMENT=banana ⇒ rc=$RC al cargar, sin compilar nada" || ko "STACK_MEASUREMENT=banana: rc=$RC"

  grep -qE '^ +--measurement\) STACK_MEASUREMENT=on ;;' "$1" && ok "up acepta --measurement" || ko "up no acepta --measurement"
  [ "$fallos" = 0 ]
}

SRC="$ROOT_DIR/scripts/stack-native.sh"
if [ "${1:-}" != "--canary" ]; then
  echo "== PEN-VEL-2 + DEVOPS-GATE-MEDICION: el frontend del gate se hornea como el que se publica =="
  comprobar "$SRC" && { echo "✓ OK"; exit 0; }
  echo "✗ ROJO"; exit 1
fi
echo "== Canario de check-stack-frontend-build =="
comprobar "$SRC" >/dev/null 2>&1 || { echo "✗ el original ya está rojo: el canario no concluye"; exit 2; }
muerde=0; total=0
mutar() {
  total=$((total+1)); local m="$TMP/m$total.sh"
  sed "$2" "$SRC" > "$m"
  if cmp -s "$m" "$SRC"; then echo "  ✗ mutación '$1' no cambió nada (canario ciego)"; return; fi
  if comprobar "$m" >/dev/null 2>&1; then echo "  ✗ '$1' ⇒ VERDE (el candado NO muerde)"
  else echo "  ✔ '$1' ⇒ ROJO"; muerde=$((muerde+1)); fi
}
mutar "vuelve a npx next build"           's|^         npm run build > "\$RUN_DIR/frontend-build.log" 2>&1 ) \\$|         npx next build > "$RUN_DIR/frontend-build.log" 2>\&1 ) \\|'
mutar "no exige las marcas"               's|^    for marca in .*|    for marca in ; do :; done; for marca in ; do|'
mutar "hereda el ID del entorno"          's|^    printf .NEXT_PUBLIC_GA4_MEASUREMENT_ID=\\n.$|    printf "NEXT_PUBLIC_GA4_MEASUREMENT_ID=%s\\n" "${NEXT_PUBLIC_GA4_MEASUREMENT_ID:-}"|'
mutar "on no hornea el modo"              's|^    printf .NEXT_PUBLIC_MEASUREMENT_MODE=on\\n.$|    printf "NEXT_PUBLIC_MEASUREMENT_MODE=off\\n"|'
mutar "next start sin el entorno"         's|^         NODE_ENV="\$NEXT_NODE_ENV" "\${FE_ENV\[@\]}" \\$|         NODE_ENV="$NEXT_NODE_ENV" \\|'
mutar "sello sin measurement"             's|^measurement=\$STACK_MEASUREMENT"$|"|'
mutar "acepta cualquier STACK_MEASUREMENT" 's|^case "\$STACK_MEASUREMENT" in on[|]off) ;; \*)|case "$STACK_MEASUREMENT" in *) ;; xx)|'
echo "Canario: $muerde/$total mutaciones salen ROJAS."
[ "$muerde" = "$total" ]

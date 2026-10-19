#!/usr/bin/env bash
#
# check-measurement-publish-gate.sh — C-D1 (API_CONTRACT §MKT.H.11; ARCHITECTURE §14.1 D-MKT2-0b) · devops
# =============================================================================
# EL CANDADO
# ---------------------------------------------------------------------------
# «Build con `on` y el aviso actual (`measurementDisclosure = null`, la frase vieja de
#  `privacidad.es.ts`) ⇒ BUILD ROJO; con el aviso nuevo ⇒ verde.» Así NO EXISTE un despliegue
# encendido con el aviso viejo: Vercel no publica un build fallido.
#
# QUIÉN HACE QUÉ (CLAUDE.md, propiedad de rutas)
#   · frontend: la lógica (`legalPublishProblems(…, { measurement })` en content/legal/publish-check.ts),
#     el script `npm run check:measurement` que la corre con el valor REAL de
#     NEXT_PUBLIC_MEASUREMENT_MODE, y `"prebuild"` que lo invoca — npm corre `prebuild` antes de
#     `npm run build`, que es lo que ejecuta Vercel (y Dockerfile.frontend). La lógica vive en
#     `frontend/` porque Vercel construye con Root Directory = frontend (DEVOPS_NOTES §40.6: un
#     `../scripts/…` en el build es una dependencia frágil justo donde un fallo cuesta no desplegar).
#   · devops (este fichero): demostrar en CI, sin publicar nada, que esa puerta EXISTE, que Vercel la
#     correría, que con `off` no estorba y que con `on` MUERDE con el aviso viejo.
#
# QUÉ MIDE (sobre el árbol real, con node_modules instalados)
#   E1  `scripts.prebuild` de frontend/package.json invoca `check:measurement` (si no, Vercel no la corre).
#   E2  `npm run check:measurement` con el modo SIN definir ⇒ rc 0 (apagado por defecto).
#   E3  … con `off` ⇒ rc 0.     E4  … con `ON` (mayúsculas, inválido ⇒ off) ⇒ rc 0.
#   E5  … con `on`:  si el aviso es el VIEJO (frase «No usamos cookies de publicidad ni de analítica»
#       o `measurementDisclosure: null`) ⇒ tiene que ser rc ≠ 0 — si sale 0, LA PUERTA NO MUERDE ⇒ ROJO.
#       Si el aviso ya es el nuevo ⇒ tiene que ser rc 0 (y si no, ROJO con los problemas que imprimió).
#
# MIENTRAS FRONTEND NO HA ENTREGADO (excepción con dueño, caducidad y candado — scripts/mkt-fase2-dependencia.env)
#   Si NO existe ninguna de las dos piezas (lógica de medición en publish-check.ts y el script
#   `check:measurement`), sale 0 con ::warning «PENDIENTE frontend» hasta la fecha de caducidad, y ROJO
#   después. Si existe UNA sin la otra, ROJO siempre (entrega a medias).
#
# Uso:  ./scripts/check-measurement-publish-gate.sh [--frontend DIR] [--today AAAA-MM-DD]
# Sale 0 verde · 1 rojo · 2 no concluyente (no se pudo ejecutar npm / faltan ficheros).
# Canario: scripts/check-measurement-publish-gate-canary.sh
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FE="$ROOT_DIR/frontend"; HOY="$(date -u +%F)"
while [ $# -gt 0 ]; do
  case "$1" in
    --frontend) FE="$(cd "$2" && pwd)"; shift 2 ;;
    --today)    HOY="$2"; shift 2 ;;
    *) echo "::error::argumento desconocido: $1"; exit 2 ;;
  esac
done
# shellcheck source=mkt-fase2-dependencia.env
. "$ROOT_DIR/scripts/mkt-fase2-dependencia.env"
PKG="$FE/package.json"; CHECK_TS="$FE/src/content/legal/publish-check.ts"; AVISO="$FE/src/content/legal/privacidad.es.ts"
for f in "$PKG" "$CHECK_TS" "$AVISO"; do [ -f "$f" ] || { echo "::error::C-D1: falta $f (NO concluyente)."; exit 2; }; done

ROJOS=0
ok()  { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { ROJOS=$((ROJOS+1)); printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; echo "::error::C-D1: $*"; }
script_de() { node -e 'const s=require(process.argv[1]).scripts||{};process.stdout.write(s[process.argv[2]]||"")' "$PKG" "$1"; }

printf '\n\033[1m== C-D1 · con la medición encendida, el build exige el aviso de privacidad nuevo ==\033[0m\n'
TIENE_LOGICA=0; grep -q 'measurement' "$CHECK_TS" && TIENE_LOGICA=1
SCRIPT="$(script_de check:measurement)"; TIENE_SCRIPT=0; [ -n "$SCRIPT" ] && TIENE_SCRIPT=1

if [ "$TIENE_LOGICA" = 0 ] && [ "$TIENE_SCRIPT" = 0 ]; then
  if [[ "$HOY" < "$MKT_FASE2_FRONTEND_EXPIRY" ]]; then
    echo "::warning title=C-D1 PENDIENTE frontend::Ni publish-check.ts conoce el modo de medición ni existe \`npm run check:measurement\`. La puerta aún no existe; con el modo en off no hay riesgo hoy. Caduca el $MKT_FASE2_FRONTEND_EXPIRY (scripts/mkt-fase2-dependencia.env): desde ese día esto es ROJO. Dueño: frontend."
    printf '  · PENDIENTE frontend (hoy %s < caducidad %s). NO es verde de la puerta: es la excepción declarada.\n' "$HOY" "$MKT_FASE2_FRONTEND_EXPIRY"
    exit 0
  fi
  bad "la puerta del aviso no existe y la excepción caducó el $MKT_FASE2_FRONTEND_EXPIRY (hoy $HOY). Dueño: frontend."
  exit 1
fi
[ "$TIENE_LOGICA" = 1 ] || bad "existe \`check:measurement\` pero publish-check.ts no menciona la medición: el script no puede estar comprobando el aviso de medición. Dueño: frontend."
[ "$TIENE_SCRIPT" = 1 ]  || bad "publish-check.ts conoce la medición pero no existe \`npm run check:measurement\` que la corra. Dueño: frontend."
[ "$ROJOS" -eq 0 ] || exit 1

# E1 — Vercel la correría.
PRE="$(script_de prebuild)"
if [[ "$PRE" == *"check:measurement"* ]]; then ok "E1 · prebuild invoca check:measurement («$PRE»): npm la corre antes de \`npm run build\` (Vercel y Dockerfile.frontend)"
else bad "E1 · scripts.prebuild no invoca check:measurement («${PRE:-ausente}»): Vercel construiría SIN la puerta. Dueño: frontend."; fi

# E2-E4 — con el modo apagado (o inválido) no estorba.
correr() { # <valor|__unset__> → rc; salida en $SALIDA
  if [ "$1" = __unset__ ]; then SALIDA="$(cd "$FE" && env -u NEXT_PUBLIC_MEASUREMENT_MODE npm run --silent check:measurement 2>&1)"
  else SALIDA="$(cd "$FE" && NEXT_PUBLIC_MEASUREMENT_MODE="$1" npm run --silent check:measurement 2>&1)"; fi
}
for v in __unset__ off ON; do
  correr "$v"; rc=$?
  et="$([ "$v" = __unset__ ] && echo 'sin definir' || echo "«$v»")"
  if [ "$rc" -eq 0 ]; then ok "modo $et ⇒ rc 0 (apagado: la puerta no estorba)"
  else bad "modo $et ⇒ rc $rc: con la medición apagada la puerta tumbaría el build. Salida: $(tail -5 <<<"$SALIDA" | tr '\n' ' ')"; fi
done

# E5 — con `on`, muerde con el aviso viejo.
VIEJO=0; MOTIVO=""
if grep -q 'No usamos cookies de publicidad ni de analítica' "$AVISO"; then VIEJO=1; MOTIVO="la frase vieja sigue en privacidad.es.ts"; fi
if grep -Eq 'measurementDisclosure:[[:space:]]*null' "$AVISO"; then VIEJO=1; MOTIVO="${MOTIVO:+$MOTIVO; }measurementDisclosure: null"; fi
correr on; rc=$?
if [ "$VIEJO" = 1 ]; then
  if [ "$rc" -ne 0 ]; then ok "E5 · modo «on» con el aviso VIEJO ($MOTIVO) ⇒ rc $rc: el build se pone ROJO, como debe"
  else bad "E5 · modo «on» con el aviso VIEJO ($MOTIVO) ⇒ rc 0: LA PUERTA NO MUERDE — Vercel publicaría la medición con el aviso viejo. Dueño: frontend."; fi
else
  if [ "$rc" -eq 0 ]; then ok "E5 · modo «on» con el aviso NUEVO (sin la frase vieja y con measurementDisclosure) ⇒ rc 0"
  else bad "E5 · modo «on» con el aviso que parece nuevo ⇒ rc $rc. Problemas: $(tail -8 <<<"$SALIDA" | tr '\n' ' ')"; fi
fi

if [ "$ROJOS" -gt 0 ]; then printf '\n\033[1;31mROJO: %s incumplimiento(s) de C-D1.\033[0m\n' "$ROJOS"; exit 1; fi
printf '\n\033[1;32mVERDE: C-D1 — la puerta existe, Vercel la corre, off no estorba y on %s.\033[0m\n' "$([ "$VIEJO" = 1 ] && echo 'muerde con el aviso viejo' || echo 'pasa con el aviso nuevo')"

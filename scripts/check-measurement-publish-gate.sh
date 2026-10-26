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
#       o la divulgación de medición en `null`, sea literal en el aviso o en la constante
#       `MEASUREMENT_DISCLOSURE` de content/legal/measurement-disclosure.ts) ⇒ tiene que ser rc ≠ 0 — si sale 0, LA PUERTA NO MUERDE ⇒ ROJO.
#       Si el aviso ya es el nuevo ⇒ tiene que ser rc 0, SALVO que TODOS los problemas que imprime el
#       rótulo (`MEASUREMENT_NOTICE_REQUIRED mode=on problems=<N>` + N líneas «  - …») sean
#       «bloqueo de encendido abierto: …» (`ENCENDER_BLOCKERS` de content/legal/measurement-gate.ts,
#       ARCHITECTURE §14.1 D-MKT2-0c): eso es la puerta mordiendo a propósito, no un fallo del aviso ⇒
#       verde. Un solo problema del aviso, un rótulo ilegible o un conteo que no cuadra ⇒ ROJO.
#       Con el aviso viejo, además del rc ≠ 0 se exige que al menos un problema impreso sea del aviso
#       (si solo hubiera bloqueos, la puerta no estaría mirando el aviso).
#
# Si falta una pieza (lógica en publish-check.ts o `check:measurement`) ⇒ ROJO. La excepción
# «PENDIENTE frontend» se retiró el 2026-10-19 al existir las dos (D6 del techlead, DEVOPS_NOTES §101.7).
# Si no sé leer el valor de `measurementDisclosure` ⇒ rc 2 (no concluyente), nunca se adivina.
#
# Uso:  ./scripts/check-measurement-publish-gate.sh [--frontend DIR]
# Sale 0 verde · 1 rojo · 2 no concluyente (no se pudo ejecutar npm / faltan ficheros).
# Canario: scripts/check-measurement-publish-gate-canary.sh
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FE="$ROOT_DIR/frontend"
while [ $# -gt 0 ]; do
  case "$1" in
    --frontend) FE="$(cd "$2" && pwd)"; shift 2 ;;
    *) echo "::error::argumento desconocido: $1"; exit 2 ;;
  esac
done
PKG="$FE/package.json"; CHECK_TS="$FE/src/content/legal/publish-check.ts"; AVISO="$FE/src/content/legal/privacidad.es.ts"
DISC_TS="$FE/src/content/legal/measurement-disclosure.ts"
for f in "$PKG" "$CHECK_TS" "$AVISO"; do [ -f "$f" ] || { echo "::error::C-D1: falta $f (NO concluyente)."; exit 2; }; done

ROJOS=0
ok()  { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { ROJOS=$((ROJOS+1)); printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; echo "::error::C-D1: $*"; }
script_de() { node -e 'const s=require(process.argv[1]).scripts||{};process.stdout.write(s[process.argv[2]]||"")' "$PKG" "$1"; }

printf '\n\033[1m== C-D1 · con la medición encendida, el build exige el aviso de privacidad nuevo ==\033[0m\n'
TIENE_LOGICA=0; grep -q 'measurement' "$CHECK_TS" && TIENE_LOGICA=1
SCRIPT="$(script_de check:measurement)"; TIENE_SCRIPT=0; [ -n "$SCRIPT" ] && TIENE_SCRIPT=1

[ "$TIENE_LOGICA" = 1 ] || bad "publish-check.ts no menciona la medición: ninguna puerta puede estar comprobando el aviso de medición. Dueño: frontend."
[ "$TIENE_SCRIPT" = 1 ]  || bad "no existe \`npm run check:measurement\`: nada corre la puerta del aviso. Dueño: frontend."
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
# ¿Qué vale `measurementDisclosure`? Literal en el aviso, o la constante MEASUREMENT_DISCLOSURE
# (privacidad.es.ts la referencia desde ddcfca49). Cualquier otra forma ⇒ no concluyente.
DISC=""
if grep -Eq 'measurementDisclosure:[[:space:]]*null' "$AVISO"; then DISC=null
elif grep -Eq 'measurementDisclosure:[[:space:]]*\{' "$AVISO"; then DISC=objeto
elif grep -Eq 'measurementDisclosure:[[:space:]]*MEASUREMENT_DISCLOSURE[[:space:]]*,' "$AVISO" && [ -f "$DISC_TS" ]; then
  if grep -Eq '^export const MEASUREMENT_DISCLOSURE\b[^=]*=[[:space:]]*null[[:space:]]*;' "$DISC_TS"; then DISC=null
  elif grep -Eq '^export const MEASUREMENT_DISCLOSURE\b[^=]*=[[:space:]]*\{' "$DISC_TS"; then DISC=objeto; fi
fi
[ -n "$DISC" ] || { echo "::error::C-D1: no sé leer el valor de measurementDisclosure (ni literal en privacidad.es.ts ni MEASUREMENT_DISCLOSURE en measurement-disclosure.ts). NO concluyente: actualiza este lector."; exit 2; }
if [ "$DISC" = null ]; then VIEJO=1; MOTIVO="${MOTIVO:+$MOTIVO; }measurementDisclosure = null"; fi
correr on; rc=$?
# Lee el rótulo MKT2-UX.12: N de `problems=<N>` y las N líneas «  - …» que le siguen.
# BLOQUEOS / DEL_AVISO = cuántas son «bloqueo de encendido abierto: …» y cuántas no. RÓTULO=0 si no
# hay rótulo o el conteo no cuadra (entonces no se puede concluir que solo hay bloqueos).
leer_rotulo() {
  ROTULO=0; BLOQUEOS=0; DEL_AVISO=0; PROB_AVISO=""
  local n linea i=0 en=0
  n="$(grep -oE 'MEASUREMENT_NOTICE_REQUIRED mode=on problems=[0-9]+' <<<"$SALIDA" | head -1 | grep -oE '[0-9]+$')"
  [ -n "$n" ] && [ "$n" -gt 0 ] || return 0
  while IFS= read -r linea; do
    if [ "$en" = 0 ]; then [[ "$linea" == *"MEASUREMENT_NOTICE_REQUIRED mode=on problems=$n"* ]] && en=1; continue; fi
    [ "$i" -lt "$n" ] || break
    [[ "$linea" == "  - "* ]] || continue
    i=$((i+1))
    if [[ "$linea" == "  - bloqueo de encendido abierto: "* ]]; then BLOQUEOS=$((BLOQUEOS+1))
    else DEL_AVISO=$((DEL_AVISO+1)); PROB_AVISO="${PROB_AVISO:+$PROB_AVISO | }${linea#  - }"; fi
  done <<<"$SALIDA"
  [ "$i" -eq "$n" ] && ROTULO=1
}
leer_rotulo
if [ "$VIEJO" = 1 ]; then
  if [ "$rc" -eq 0 ]; then bad "E5 · modo «on» con el aviso VIEJO ($MOTIVO) ⇒ rc 0: LA PUERTA NO MUERDE — Vercel publicaría la medición con el aviso viejo. Dueño: frontend."
  elif [ "$ROTULO" = 1 ] && [ "$DEL_AVISO" -eq 0 ]; then bad "E5 · modo «on» con el aviso VIEJO ($MOTIVO) ⇒ rc $rc, pero solo por $BLOQUEOS bloqueo(s) de encendido: la puerta NO MIRA el aviso. Dueño: frontend."
  else ok "E5 · modo «on» con el aviso VIEJO ($MOTIVO) ⇒ rc $rc: el build se pone ROJO, como debe"; fi
else
  if [ "$rc" -eq 0 ]; then ok "E5 · modo «on» con el aviso NUEVO (sin la frase vieja y con measurementDisclosure) ⇒ rc 0"
  elif [ "$ROTULO" = 1 ] && [ "$DEL_AVISO" -eq 0 ]; then
    SOLO_BLOQUEOS=1
    ok "E5 · modo «on» con el aviso NUEVO ⇒ rc $rc solo por $BLOQUEOS bloqueo(s) de encendido abierto(s) (ENCENDER_BLOCKERS): el aviso no tiene problemas; la puerta muerde a propósito"
    grep -E '^  - bloqueo de encendido abierto: ' <<<"$SALIDA" | sed 's/^  - /      · /'
  elif [ "$ROTULO" = 1 ]; then bad "E5 · modo «on» con el aviso que parece nuevo ⇒ rc $rc con $DEL_AVISO problema(s) del aviso: $PROB_AVISO. Dueño: frontend."
  else bad "E5 · modo «on» con el aviso que parece nuevo ⇒ rc $rc sin un rótulo MEASUREMENT_NOTICE_REQUIRED legible (o con el conteo descuadrado). Salida: $(tail -8 <<<"$SALIDA" | tr '\n' ' ')"; fi
fi

if [ "$ROJOS" -gt 0 ]; then printf '\n\033[1;31mROJO: %s incumplimiento(s) de C-D1.\033[0m\n' "$ROJOS"; exit 1; fi
if [ "$VIEJO" = 1 ]; then FIN='muerde con el aviso viejo'
elif [ "${SOLO_BLOQUEOS:-0}" = 1 ]; then FIN='con el aviso nuevo solo la frenan los bloqueos de encendido abiertos'
else FIN='pasa con el aviso nuevo'; fi
printf '\n\033[1;32mVERDE: C-D1 — la puerta existe, Vercel la corre, off no estorba y on %s.\033[0m\n' "$FIN"

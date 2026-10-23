#!/usr/bin/env bash
#
# e2e-real-suite.sh — la suite `@real` COMPLETA contra el stack nativo, sin 429 de arnés  · devops
# =============================================================================
# DE DÓNDE VIENE (QA-REL-3, medido por QA el 2026-10-19: 103/106 y 102/106, N=2)
# ---------------------------------------------------------------------------
# `POST /checkout/guest/session` está limitado por el PRODUCTO a 5 por hora y por IP
# (`backend/src/modules/orders/guest-orders.controller.ts`, `@Throttle({ ttl: HOUR_MS, limit: 5 })`).
# El almacén del `ThrottlerModule` es EN MEMORIA por proceso (`app.module.ts`, `forRoot` sin storage)
# y desde el arnés todas las peticiones salen de 127.0.0.1. La suite `@real` entera crea 6 o más
# sesiones de invitado ⇒ la sexta da 429 y el caso cae en rojo por el ARNÉS, no por el producto.
#
# ⛔ El límite NO se toca (ni env, ni config, ni NODE_ENV=test): producción sigue con 5/h.
# Lo que hace este script es darle a cada spec que crea sesiones de invitado un PRESUPUESTO PROPIO:
#
#   1. Lista los specs que de verdad corren en modo real (`playwright test --list` con E2E_REAL=1:
#      el mismo filtro `grep: /@real/` del config, no un grep de texto que se equivoque).
#   2. Los parte en dos: los que tocan invitado (su texto casa con GUEST_RE: guest|invitado) y el resto.
#   3. `stack-native.sh restart:backend` ⇒ corre el RESTO en una sola tanda.
#   4. Por cada spec de invitado: `restart:backend` (throttler a cero, datos intactos, procedencia
#      re-verificada) ⇒ corre ESE spec solo. Cada spec tiene así sus 5 sesiones/h enteras.
#   5. Resumen por tanda y rc ≠ 0 si alguna tanda falló. Cada tanda deja su JSON y su informe aparte.
#
# Límites, dichos: (a) un spec que por sí solo cree MÁS de 5 sesiones sigue dando 429: ese hallazgo es
# del spec (frontend), no del arnés. (b) Un spec que cree sesiones de invitado sin decir guest/invitado
# en su texto caería en la tanda común; si la tanda común da 429 en `checkout/guest/session`, el remedio
# es nombrarlo (frontend) o ampliar GUEST_RE aquí (devops). (c) Los casos que consumen datos del seed de
# otros (vault:15, buylist-offer:155, AC-F14) son la otra mitad de QA-REL-3 y son de frontend.
#
# Uso (QA, con el stack arriba: `./scripts/stack-native.sh up --seed --gate`):
#   ./scripts/e2e-real-suite.sh [--dry-run] [--list-file F] [--e2e-dir D] [-- <args extra de playwright>]
#   --dry-run       imprime el plan (RESTART / RUN …) y sale; no reinicia ni corre nada.
#   --list-file F   usa F como salida de `playwright test --list` (lo usa el canario; sin Playwright).
#   --e2e-dir D     carpeta de specs (por defecto frontend/e2e).
# Variables: E2E_BASE_URL (por defecto http://localhost:$FRONTEND_PORT, 3000) · GUEST_RE.
# Salidas: frontend/test-results-real-suite/<n>-<tanda>/{report.json,not-measured.json,html/}.
# rc: 0 todas las tandas verdes · 1 alguna roja · 2 no concluyente (sin specs, sin lista, reinicio fallido).
# Filtro (QA, rechazo de 803c4298, 2026-10-23): Playwright toma cada fichero posicional como REGEX contra la
# ruta absoluta (`forceRegExp`, playwright 1.56 lib/util.js), así que `checkout.spec.ts` recogía también
# `guest-checkout.spec.ts` y los dos corrían a la vez sobre la misma pieza del seed. Cada spec se pasa como
# `^<ruta real absoluta, escapada>$`: casa con ESE fichero y con ningún otro (prefijo, sufijo ni subcarpeta).
# Canario: scripts/e2e-real-suite-canary.sh · DEVOPS_NOTES §103.3.
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"; E2E_DIR="$(cd "$FRONTEND_DIR/e2e" 2>/dev/null && pwd -P || echo "$FRONTEND_DIR/e2e")"
STACK="$ROOT_DIR/scripts/stack-native.sh"
GUEST_RE="${GUEST_RE:-guest|invitado}"
DRY=0; LIST_FILE=""; EXTRA=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)   DRY=1; shift ;;
    --list-file) LIST_FILE="$2"; shift 2 ;;
    --e2e-dir)   E2E_DIR="$(cd "$2" && pwd -P)"; shift 2 ;;
    --)          shift; EXTRA=("$@"); break ;;
    *) echo "::error::argumento desconocido: $1"; exit 2 ;;
  esac
done
export E2E_REAL=1
export E2E_BASE_URL="${E2E_BASE_URL:-http://localhost:${FRONTEND_PORT:-3000}}"

# --- 1. Qué specs corren de verdad en modo real ------------------------------
if [ -n "$LIST_FILE" ]; then
  LISTA="$(cat "$LIST_FILE" 2>/dev/null)" || { echo "NO CONCLUYENTE: no puedo leer $LIST_FILE."; exit 2; }
else
  LISTA="$(cd "$FRONTEND_DIR" && npx playwright test --list 2>&1)" \
    || { echo "NO CONCLUYENTE: \`playwright test --list\` falló:"; tail -20 <<<"$LISTA"; exit 2; }
fi
mapfile -t SPECS < <(grep -oE '[A-Za-z0-9_./-]+\.spec\.ts:[0-9]+:[0-9]+' <<<"$LISTA" | sed -E 's/:[0-9]+:[0-9]+$//' | sort -u)
[ "${#SPECS[@]}" -gt 0 ] || { echo "NO CONCLUYENTE: la lista de Playwright no trae ningún spec @real."; exit 2; }

# --- 2. Partición: invitado (presupuesto propio) / resto (una tanda) ----------
INVITADO=(); RESTO=()
for s in "${SPECS[@]}"; do
  f="$E2E_DIR/$s"
  [ -f "$f" ] || { echo "NO CONCLUYENTE: la lista nombra $s y no existe en $E2E_DIR."; exit 2; }
  if grep -qiE "$GUEST_RE" "$f"; then INVITADO+=("$s"); else RESTO+=("$s"); fi
done

# --- 3. Plan ---------------------------------------------------------------------
PLAN=()
if [ "${#RESTO[@]}" -gt 0 ]; then PLAN+=("RESTART" "RUN comun ${RESTO[*]}"); fi
for s in "${INVITADO[@]}"; do PLAN+=("RESTART" "RUN invitado $s"); done
echo "== suite @real completa: ${#SPECS[@]} specs · ${#INVITADO[@]} con presupuesto propio de invitado · ${#RESTO[@]} en la tanda común =="
printf '%s\n' "${PLAN[@]}"
[ "$DRY" -eq 1 ] && exit 0

# --- 4. Ejecución ------------------------------------------------------------------
# Un spec ⇒ un argumento que Playwright no puede ensanchar: `^/ruta/real/e2e/<spec>$` con los metacaracteres
# escapados. La ruta es la REAL (`pwd -P`): Playwright resuelve enlaces simbólicos y un ancla sobre la ruta
# lógica no casaría con nada (medido con playwright 1.56.1: 0 tests). Si el ancla no casa, Playwright sale ≠ 0
# («No tests found»): la tanda sale roja, nunca verde por no correr.
filtro_exacto() { printf '^%s$' "$(printf '%s' "$E2E_DIR/$1" | sed 's/[][\\.*^$+?(){}|]/\\&/g')"; }
OUT="$FRONTEND_DIR/test-results-real-suite"; mkdir -p "$OUT"
n=0; ROJAS=0; RESUMEN=()
for paso in "${PLAN[@]}"; do
  if [ "$paso" = "RESTART" ]; then
    "$STACK" restart:backend || { echo "NO CONCLUYENTE: restart:backend falló; no sigo (una tanda sobre un backend sin verificar no se cita)."; exit 2; }
    continue
  fi
  n=$((n+1)); read -r _ tanda archivos <<<"$paso"
  nombre="$(printf '%02d' "$n")-$tanda$( [ "$tanda" = invitado ] && printf -- '-%s' "${archivos%.spec.ts}")"
  d="$OUT/$nombre"; mkdir -p "$d"
  FILTROS=(); for a in $archivos; do FILTROS+=("$(filtro_exacto "$a")"); done
  ( cd "$FRONTEND_DIR" && PLAYWRIGHT_JSON_OUTPUT_NAME="$d/report.json" E2E_NOT_MEASURED_JSON="$d/not-measured.json" \
      PLAYWRIGHT_HTML_OUTPUT_DIR="$d/html" PLAYWRIGHT_HTML_REPORT="$d/html" \
      npx playwright test "${FILTROS[@]}" --output="$d/artifacts" \
      --reporter=list,json,./e2e/reporters/not-measured.ts "${EXTRA[@]}" )
  rc=$?
  [ "$rc" -eq 0 ] || ROJAS=$((ROJAS+1))
  RESUMEN+=("$nombre rc=$rc")
done
echo; echo "== resumen (salidas en $OUT) =="; printf '  %s\n' "${RESUMEN[@]}"
[ "$ROJAS" -eq 0 ] && { echo "VERDE: $n/$n tandas."; exit 0; }
echo "ROJO: $ROJAS/$n tandas con rc≠0. Un 429 en checkout/guest/session dentro de una tanda de invitado = el spec crea >5 sesiones (frontend)."
exit 1

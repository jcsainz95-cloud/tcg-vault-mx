#!/usr/bin/env bash
#
# uptime-watch.sh — vigía de disponibilidad de la tienda publicada (LIVE-9)
#                                                                        · devops
# =============================================================================
# POR QUÉ EXISTE (API_CONTRACT §14 LIVE-9, ARCHITECTURE §4.63.6 nivel 0)
# ---------------------------------------------------------------------------
# Con dinero real, «la tienda está caída» o «el backend volvió a modo prueba»
# no se puede descubrir porque un cliente escriba. Lo más simple que avisa, sin
# cuenta nueva: un GET cada 10 min desde GitHub Actions ⇒ si falla, issue ⇒
# GitHub le manda correo al dueño. Las URL son PÚBLICAS: no hay secreto.
#
# QUÉ COMPRUEBA (solo GET, solo rutas públicas; nada que escriba ni que cargue)
#   1. La HOME (`--site`): 200 al final de como mucho 5 redirecciones.
#   2. La SALUD del backend (`--health`, `GET /api/v1/health`): 200, JSON con
#      `status: "ok"`.
#   3. Si se pasa `--expected-stripe-mode live|test|none`: que `stripeMode` de la
#      salud (LIVE-7) sea ESE. Ausente en la respuesta ⇒ ROJO (el backend no trae
#      LIVE-7 o lo perdió: no se puede afirmar el modo). Sin `--expected-stripe-mode`
#      no se compara y se DICE («no comparado»), no se finge verde.
#   Cada comprobación se reintenta (`--attempts`, def. 3, con `--pause` s entre
#   medias) antes de llamarla roja: un parpadeo de red del runner no es una caída.
#
# VEREDICTO
#   rc 0 · VERDICT=OK     todo en verde
#   rc 1 · VERDICT=ROJO   alguna comprobación falló en todos sus intentos
#   rc 2 · NO CONCLUYENTE argumentos mal, sin curl/node, URL no https
#   ⛔ Nunca sale 0 con algo que no midió.
#
# Uso:
#   ./scripts/uptime-watch.sh --site https://tcghunt.mx/ \
#       --health https://<backend>/api/v1/health [--expected-stripe-mode test]
#   [--attempts 3] [--pause 20] [--timeout 15]
#   --allow-local  (SOLO el canario: admite http://127.0.0.1:<p>)
# =============================================================================
set -uo pipefail

SITE=""; HEALTH=""; EXPECTED=""; ATTEMPTS=3; PAUSE=20; TIMEOUT=15; ALLOW_LOCAL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --site) SITE="${2:-}"; shift 2 ;;
    --health) HEALTH="${2:-}"; shift 2 ;;
    --expected-stripe-mode) EXPECTED="${2:-}"; shift 2 ;;
    --attempts) ATTEMPTS="${2:-3}"; shift 2 ;;
    --pause) PAUSE="${2:-20}"; shift 2 ;;
    --timeout) TIMEOUT="${2:-15}"; shift 2 ;;
    --allow-local) ALLOW_LOCAL=1; shift ;;
    -h|--help) sed -n '1,40p' "$0"; exit 0 ;;
    *) echo "::error::opción desconocida '$1'"; echo "VERDICT=NO_CONCLUYENTE"; exit 2 ;;
  esac
done

nc() { echo "::error::$*"; echo "VERDICT=NO_CONCLUYENTE"; exit 2; }
command -v curl >/dev/null 2>&1 || nc "sin curl no puedo medir."
command -v node >/dev/null 2>&1 || nc "sin node no puedo leer el JSON de la salud."
[ -n "$SITE" ] && [ -n "$HEALTH" ] || nc "faltan --site y/o --health."
for n in "$ATTEMPTS" "$PAUSE" "$TIMEOUT"; do case "$n" in ''|*[!0-9]*) nc "--attempts/--pause/--timeout deben ser enteros." ;; esac; done
[ "$ATTEMPTS" -ge 1 ] || nc "--attempts ≥ 1."
case "$EXPECTED" in ''|live|test|none) ;; *) nc "--expected-stripe-mode debe ser live, test o none (llegó '$EXPECTED')." ;; esac
for u in "$SITE" "$HEALTH"; do
  case "$u" in
    https://*) ;;
    http://127.0.0.1:*) [ "$ALLOW_LOCAL" -eq 1 ] || nc "'$u' no es https (solo el canario usa --allow-local)." ;;
    *) nc "'$u' no es https." ;;
  esac
done

TMPD="$(mktemp -d -t uptime-XXXXXX)"; trap 'rm -rf "$TMPD"' EXIT
ROJOS=0

# reintentar <nombre> <función> — corre la función hasta ATTEMPTS veces; la
# función deja su motivo en $MOTIVO y devuelve 0 si pasó.
reintentar() {
  local nombre="$1" fn="$2" i
  for i in $(seq 1 "$ATTEMPTS"); do
    MOTIVO=""
    if "$fn"; then echo "  ✔ $nombre — $MOTIVO (intento $i/$ATTEMPTS)"; return 0; fi
    echo "  · $nombre — intento $i/$ATTEMPTS: $MOTIVO"
    [ "$i" -lt "$ATTEMPTS" ] && [ "$PAUSE" -gt 0 ] && sleep "$PAUSE"
  done
  echo "  ✗ $nombre — ROJO tras $ATTEMPTS intentos: $MOTIVO"
  echo "ROJO_$nombre=$MOTIVO" >> "$TMPD/rojos"
  ROJOS=$((ROJOS+1)); return 1
}

comprobar_home() {
  local code
  code="$(curl -sS -L --max-redirs 5 -o "$TMPD/home" -w '%{http_code}' --max-time "$TIMEOUT" \
          -H 'User-Agent: tcg-uptime-watch (GitHub Actions; LIVE-9)' "$SITE" 2>"$TMPD/home.err")" || code="000"
  if [ "$code" = "200" ]; then MOTIVO="HTTP 200 ($(wc -c < "$TMPD/home") bytes)"; return 0; fi
  MOTIVO="HTTP $code $(head -c 160 "$TMPD/home.err" | tr '\n' ' ')"; return 1
}

SALUD_JSON=""
comprobar_salud() {
  local code
  code="$(curl -sS -o "$TMPD/health" -w '%{http_code}' --max-time "$TIMEOUT" \
          -H 'User-Agent: tcg-uptime-watch (GitHub Actions; LIVE-9)' "$HEALTH" 2>"$TMPD/health.err")" || code="000"
  SALUD_JSON="$(node -e '
    const fs=require("fs"); let j;
    try { j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); } catch { console.log("NOJSON"); process.exit(0); }
    const s=(v)=>v===undefined?"(ausente)":String(v);
    console.log([s(j.status), s(j.db), s(j.redis), s(j.stripeMode)].join("|"));
  ' "$TMPD/health" 2>/dev/null)"
  if [ "$code" != "200" ]; then MOTIVO="HTTP $code · $SALUD_JSON $(head -c 160 "$TMPD/health.err" | tr '\n' ' ')"; return 1; fi
  [ "$SALUD_JSON" != "NOJSON" ] || { MOTIVO="HTTP 200 pero el cuerpo no es JSON"; return 1; }
  local st db rd sm; IFS='|' read -r st db rd sm <<<"$SALUD_JSON"
  [ "$st" = "ok" ] || { MOTIVO="status=$st (db=$db, redis=$rd)"; return 1; }
  MOTIVO="HTTP 200 · status=$st db=$db redis=$rd stripeMode=$sm"; return 0
}

echo "── uptime-watch (LIVE-9) · $(date -u +%FT%TZ) ──"
echo "  home  : $SITE"
echo "  salud : $HEALTH"
echo "  stripeMode esperado: ${EXPECTED:-(no comparado: falta la variable EXPECTED_STRIPE_MODE)}"
reintentar home comprobar_home || true
if reintentar salud comprobar_salud; then
  if [ -n "$EXPECTED" ]; then
    IFS='|' read -r _ _ _ SM <<<"$SALUD_JSON"
    if [ "$SM" = "$EXPECTED" ]; then
      echo "  ✔ stripeMode — $SM = esperado"
    else
      echo "  ✗ stripeMode — la salud dice '$SM' y se espera '$EXPECTED'. ¿Cambio de claves sin actualizar la variable, o claves revertidas?"
      echo "ROJO_stripeMode=$SM≠$EXPECTED" >> "$TMPD/rojos"; ROJOS=$((ROJOS+1))
    fi
  else
    echo "  · stripeMode — NO comparado (sin EXPECTED_STRIPE_MODE). No es un verde de ese punto."
  fi
fi

if [ "$ROJOS" -gt 0 ]; then
  echo "VERDICT=ROJO"
  sed 's/^/  /' "$TMPD/rojos"
  exit 1
fi
echo "VERDICT=OK"
exit 0

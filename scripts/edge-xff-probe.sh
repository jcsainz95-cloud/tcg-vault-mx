#!/usr/bin/env bash
#
# edge-xff-probe.sh — condición C6: ¿el edge de Railway deja pasar la
#          `X-Forwarded-For` del cliente al tracker del throttler?      · devops
# =============================================================================
# QUÉ DECIDE, Y POR QUÉ IMPORTA (SECURITY_NOTES C6 / P-RL-1 / SB-B3 / SEC-SB-2)
# ---------------------------------------------------------------------------
# El backend corre con `app.set('trust proxy', 1)` (backend/src/main.ts:39,
# medido en 5d2c62b). Con `1`, express toma como IP del cliente la **penúltima**
# entrada de `X-Forwarded-For` — es decir, LA QUE AÑADE EL PRIMER PROXY DE
# CONFIANZA (el edge de Railway), no la que el cliente escriba. El `@Throttle`
# de login/register/google (5/min por IP) y el `@Throttle 5/h` del checkout de
# invitado usan ese tracker.
#
#   · Si el edge de Railway **appendea** la IP real como última entrada (lo
#     normal en un LB serio), entonces con trust proxy=1 el tracker es la IP real
#     y rotar `X-Forwarded-For` NO evade el límite ⇒ `P-RL-1` NO es explotable en
#     producción, `SB-B3` se queda en Baja, y este release publica tranquilo.
#   · Si el edge **respeta** la `X-Forwarded-For` entrante y no la fija, entonces
#     un atacante rota ese header y el tope de 5 nunca dispara ⇒ `P-RL-1` sube a
#     ALTA confirmada en producción, `SB-B3` a Media/Alta, y —palabras de
#     seguridad— **este release queda RECHAZADO retroactivamente** hasta `C7`.
#
# Es UNA medición de seis peticiones. Cierra la incertidumbre que seguridad no
# pudo cerrar (egress a docs.railway.com bloqueado; producción prohibida al blue
# team). Es el pivote del release.
#
# ⛔⛔ ESTO PEGA A PRODUCCIÓN. NO SE EJECUTA SIN VENTANA AUTORIZADA POR EL DUEÑO.
# ---------------------------------------------------------------------------
# El script se NIEGA a correr salvo que se le pase `--i-have-a-window`, y aun así
# usa un endpoint que NO crea nada (login con un correo inexistente ⇒ 401
# `INVALID_CREDENTIALS`, sin efecto de lado; NO toca el checkout de invitado, que
# sí tomaría un lock y hablaría con Stripe). No envía ninguna credencial real:
# el correo es sintético y la contraseña es basura fija.
#
# CÓMO LEER EL RESULTADO
# ---------------------------------------------------------------------------
# Serie: 6 POST /api/v1/auth/login desde UNA IP de salida, cada uno con un
# `X-Forwarded-For: 203.0.113.<i>` DISTINTO (rango de documentación RFC5737, no
# es de nadie). Todos con el MISMO correo inexistente.
#   · 6.º intento = 429  ⇒ el tope cuenta por la IP que pone el edge, NO por el
#                          XFF del cliente. EL BYPASS NO EXISTE en producción.
#                          Proporción esperada del disparo: reportar como 429@6.
#   · los 6 intentos = 401 (nunca 429) ⇒ rotar XFF EVADE el límite.
#                          EL BYPASS EXISTE. → C6 FALLA → release rechazado.
# Se corre la serie N veces (por defecto 3) y se reporta la proporción (O-3):
# «429 en el 6.º: 3/3» cierra; «0/3» confirma el bypass.
#
# Uso (SOLO en ventana autorizada, contra producción):
#   TARGET_BASE_URL='https://<host-de-produccion>' \
#     ./scripts/edge-xff-probe.sh --i-have-a-window [--rounds 3] [--login-path /api/v1/auth/login]
#
# El host de producción del backend NO se hornea aquí: lo pone el dueño en la
# ventana. Está documentado en docs/DEVOPS_NOTES.md (servicio Railway
# «marvelous-kindness», entorno production).
#
# Sale 0 si midió y el 6.º fue 429 en TODAS las rondas (bypass ausente);
#       1 si en alguna ronda no disparó el 429 (bypass presente → C6 FALLA);
#       2 si no pudo medir (sin ventana, sin URL, red caída, respuestas raras).
# =============================================================================
set -uo pipefail

WINDOW=0; ROUNDS=3; LOGIN_PATH="/api/v1/auth/login"
while [ $# -gt 0 ]; do
  case "$1" in
    --i-have-a-window) WINDOW=1; shift ;;
    --rounds) ROUNDS="${2:-3}"; shift 2 ;;
    --login-path) LOGIN_PATH="${2:-}"; shift 2 ;;
    -h|--help) sed -n '1,70p' "$0"; exit 0 ;;
    *) echo "::error::opción desconocida '$1'"; exit 2 ;;
  esac
done

if [ "$WINDOW" -ne 1 ]; then
  cat >&2 <<'STOP'
::error::ESTE GUION PEGA A PRODUCCIÓN. No corre sin --i-have-a-window.
  C6 se mide SOLO en una ventana autorizada por el dueño (CLAUDE.md: producción
  solo en ventana autorizada). Antes de correrlo:
    1. El dueño abre la ventana y confirma qué host es producción.
    2. export TARGET_BASE_URL='https://<host-de-produccion-del-backend>'
    3. ./scripts/edge-xff-probe.sh --i-have-a-window
STOP
  exit 2
fi

BASE="${TARGET_BASE_URL:-}"
[ -n "$BASE" ] || { echo "::error::falta TARGET_BASE_URL (el host del backend de producción). NO concluyente."; exit 2; }
case "$BASE" in
  http://localhost*|http://127.*|https://localhost*)
    echo "::error::TARGET_BASE_URL apunta a local. C6 mide el EDGE de Railway: contra local no hay edge y la medición no significa nada."; exit 2 ;;
esac
command -v curl >/dev/null 2>&1 || { echo "::error::sin curl no puedo medir."; exit 2; }

URL="${BASE%/}${LOGIN_PATH}"
CORREO="c6-probe-$(date +%s)@example.invalid"   # inexistente por diseño (TLD .invalid, RFC2606)
BODY="$(printf '{"email":"%s","password":"c6-not-a-real-password"}' "$CORREO")"

echo "── C6 · sonda del edge de Railway (X-Forwarded-For → tracker del throttler) ──"
echo "  objetivo : ${BASE%/}  (login: $LOGIN_PATH)"
echo "  correo   : $CORREO  (inexistente ⇒ 401 sin efecto de lado; NO se crea nada)"
echo "  rondas   : $ROUNDS · 6 peticiones/ronda, XFF rotatorio 203.0.113.1..6"
echo

DISPAROS=0
for r in $(seq 1 "$ROUNDS"); do
  codes=()
  for i in 1 2 3 4 5 6; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' \
      -X POST "$URL" \
      -H 'Content-Type: application/json' \
      -H "X-Forwarded-For: 203.0.113.$i" \
      --max-time 15 \
      --data "$BODY" 2>/dev/null)" || code="ERR"
    codes+=("$code")
  done
  sexto="${codes[5]}"
  printf '  ronda %s: %s' "$r" "${codes[*]}"
  # Sanidad: si NINGUNA de las 6 fue 401/429/403, el endpoint no está haciendo lo que creemos.
  if ! printf '%s\n' "${codes[@]}" | grep -qE '^(401|429|403)$'; then
    echo "   ← ::error:: respuestas inesperadas (ni 401 ni 429). ¿URL o path mal? NO concluyente."
    exit 2
  fi
  if [ "$sexto" = "429" ]; then
    echo "   ← 6.º = 429 ✓ (el tope cuenta por la IP del edge, no por el XFF del cliente)"
    DISPAROS=$((DISPAROS+1))
  elif [ "$sexto" = "401" ]; then
    echo "   ← 6.º = 401 ✗ (el límite NO disparó rotando XFF: EL BYPASS EXISTE)"
  else
    echo "   ← 6.º = $sexto (inesperado)"
  fi
done

echo
echo "  disparo del 429 en el 6.º intento: $DISPAROS/$ROUNDS"
if [ "$DISPAROS" -eq "$ROUNDS" ]; then
  echo "  ✓ C6 CIERRA: rotar X-Forwarded-For NO evade el tope. P-RL-1 no es explotable en producción,"
  echo "    SB-B3 se queda en Baja. Anotar la proporción $DISPAROS/$ROUNDS y la fecha en docs/DEVOPS_NOTES.md."
  exit 0
elif [ "$DISPAROS" -eq 0 ]; then
  echo "  ✗ C6 FALLA: el bypass de P-RL-1 EXISTE en producción."
  echo "    ⇒ P-RL-1 sube a ALTA confirmada, SB-B3 a Media/Alta, y el release queda RECHAZADO"
  echo "      retroactivamente hasta que C7 (backstop por identidad, backend) esté desplegado."
  exit 1
else
  echo "  ▲ RESULTADO MIXTO ($DISPAROS/$ROUNDS): el tope dispara de forma intermitente. No es un cierre."
  echo "    Ampliar rondas y llevarlo a backend+seguridad: puede haber más de un nodo de edge con config distinta."
  exit 1
fi

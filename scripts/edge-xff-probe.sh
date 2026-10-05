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
# ⚠️⚠️ CORRECCIÓN 2026-10-05 (LIVE-11, DEVOPS_NOTES §83.4) — LA VERSIÓN ANTERIOR
# DABA «C6 CIERRA» AUNQUE EL BYPASS EXISTIERA. Desde C7 (v1.80) el login tiene un
# SEGUNDO tope, por CUENTA: `PASSWORD_FREE_ATTEMPTS = 5`
# (backend/src/modules/auth/password-attempts.constants.ts:11) y el 5.º fallo pone
# un candado de 60 s ⇒ el 6.º intento contra el MISMO correo es
# `429 TOO_MANY_PASSWORD_ATTEMPTS` venga de la IP que venga. La sonda usaba UN
# correo para los 6 intentos: el 6.º salía 429 por el candado de la cuenta, no por
# el tope por IP, y se leía como «bypass ausente». Un falso cierre de una
# condición de seguridad. Ahora:
#   · cada petición lleva un correo inexistente DISTINTO (ninguna cuenta llega a 5);
#   · un 429 solo cuenta si su `error.code` es `RATE_LIMITED` (el del throttler por
#     IP); `TOO_MANY_PASSWORD_ATTEMPTS` ⇒ NO concluyente (la sonda se contaminó);
#   · entre rondas se espera a que la ventana de 60 s del throttler se vacíe
#     (`--round-pause`, def. 65 s), para que cada ronda mida desde cero;
#   · RONDA DE CONTROL (`--with-control`), SOLO si rotando XFF no hubo ningún 429:
#     6 peticiones SIN `X-Forwarded-For` propio, que tienen que dar 429
#     `RATE_LIMITED` en el 6.º. Sin control, «nunca 429» no distingue un bypass de
#     un tope apagado ⇒ rc 2 y pide la ronda. Si rotando XFF el 6.º YA es
#     `RATE_LIMITED`, el control sobra: ese código solo lo pone el tope por IP.
# PRESUPUESTO AUTORIZADO: el dueño autorizó **6 intentos fallidos** para C6
# (HECHOS.md, fila 2026-10-05 «Listo para dinero real — respuestas del dueño»).
# Por eso el valor por defecto es UNA ronda (6 peticiones). El control (6 más) y
# rondas extra necesitan autorización nueva. Correos `@example.invalid` (no existen
# ⇒ no hay candado, ni correo, ni bitácora).
#
# Uso (SOLO en ventana autorizada, contra producción):
#   TARGET_BASE_URL='https://<host-de-produccion>' \
#     ./scripts/edge-xff-probe.sh --i-have-a-window [--rounds 1] [--with-control] [--round-pause 65] [--login-path /api/v1/auth/login]
# Canario (sin producción): ./scripts/check-edge-xff-probe-canary.sh — usa
#   `--canary-local`, que permite un host local y NO es una medición de C6.
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

WINDOW=0; ROUNDS=1; LOGIN_PATH="/api/v1/auth/login"; PAUSE=65; CANARY=0; CONTROL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --i-have-a-window) WINDOW=1; shift ;;
    --rounds) ROUNDS="${2:-3}"; shift 2 ;;
    --round-pause) PAUSE="${2:-65}"; shift 2 ;;
    --login-path) LOGIN_PATH="${2:-}"; shift 2 ;;
    --canary-local) CANARY=1; shift ;;
    --with-control) CONTROL=1; shift ;;
    -h|--help) sed -n '1,110p' "$0"; exit 0 ;;
    *) echo "::error::opción desconocida '$1'"; exit 2 ;;
  esac
done
case "$ROUNDS" in ''|*[!0-9]*|0) echo "::error::--rounds debe ser un entero ≥ 1"; exit 2 ;; esac
case "$PAUSE"  in ''|*[!0-9]*)   echo "::error::--round-pause debe ser un entero (segundos)"; exit 2 ;; esac

if [ "$WINDOW" -ne 1 ] && [ "$CANARY" -ne 1 ]; then
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
if [ "$CANARY" -eq 1 ]; then
  case "$BASE" in
    http://127.0.0.1:*|http://localhost:*) echo "  ⚠️  MODO CANARIO (--canary-local): esto NO es una medición de C6." ;;
    *) echo "::error::--canary-local solo admite http://127.0.0.1:<p> o http://localhost:<p>. Para producción usa --i-have-a-window."; exit 2 ;;
  esac
else
  case "$BASE" in
    http://localhost*|http://127.*|https://localhost*)
      echo "::error::TARGET_BASE_URL apunta a local. C6 mide el EDGE de Railway: contra local no hay edge y la medición no significa nada."; exit 2 ;;
  esac
fi
command -v curl >/dev/null 2>&1 || { echo "::error::sin curl no puedo medir."; exit 2; }

URL="${BASE%/}${LOGIN_PATH}"
TAG="c6-$(date +%s)-$RANDOM"
TMPB="$(mktemp -d -t c6-XXXXXX)"; trap 'rm -rf "$TMPB"' EXIT

# Una petición: <n.º de petición global> <XFF o vacío> → imprime «<http>:<code>»
#   code = error.code del cuerpo JSON (RATE_LIMITED, TOO_MANY_PASSWORD_ATTEMPTS,
#   INVALID_CREDENTIALS…) o «-». Correo DISTINTO por petición (ver cabecera).
peticion() {
  local n="$1" xff="$2" http code
  local correo="${TAG}-${n}@example.invalid"
  local body; body="$(printf '{"email":"%s","password":"c6-not-a-real-password"}' "$correo")"
  local -a extra=()
  [ -n "$xff" ] && extra=(-H "X-Forwarded-For: $xff")
  http="$(curl -sS -o "$TMPB/r" -w '%{http_code}' -X POST "$URL" \
    -H 'Content-Type: application/json' "${extra[@]}" --max-time 15 --data "$body" 2>/dev/null)" || http="ERR"
  code="$(sed -n 's/.*"code"[[:space:]]*:[[:space:]]*"\([A-Z_]*\)".*/\1/p' "$TMPB/r" 2>/dev/null | head -1)"
  printf '%s:%s' "$http" "${code:--}"
}

# Clasifica una serie de 6 respuestas → «IP» (6.º = 429 RATE_LIMITED),
# «NO» (ningún 429), «CUENTA» (algún 429 de candado de cuenta: contaminada),
# «RARO» (ni 401/429/403).
clasificar() {
  local -a r=("$@") sexto="${6:-}"
  local x
  for x in "${r[@]}"; do
    case "$x" in 429:TOO_MANY_PASSWORD_ATTEMPTS) echo CUENTA; return ;; esac
  done
  if ! printf '%s\n' "${r[@]}" | grep -qE '^(401|429|403):'; then echo RARO; return; fi
  case "$sexto" in
    429:RATE_LIMITED) echo IP ;;
    429:*) echo RARO ;;
    *) if printf '%s\n' "${r[@]}" | grep -q '^429:'; then echo RARO; else echo NO; fi ;;
  esac
}

echo "── C6 · sonda del edge de Railway (X-Forwarded-For → tracker del throttler) ──"
echo "  objetivo : ${BASE%/}  (login: $LOGIN_PATH)"
echo "  correos  : ${TAG}-<n>@example.invalid — UNO DISTINTO por petición (inexistentes ⇒ 401, sin candado de cuenta)"
echo "  rondas   : $ROUNDS × 6 peticiones, XFF rotatorio 203.0.113.1..6 · pausa entre rondas ${PAUSE}s · control: $([ "$CONTROL" -eq 1 ] && echo 'sí, si hace falta (+6)' || echo 'no autorizado en esta corrida')"
echo

N=0; DISPAROS=0; NUNCA=0
for r in $(seq 1 "$ROUNDS"); do
  [ "$r" -gt 1 ] && [ "$PAUSE" -gt 0 ] && sleep "$PAUSE"
  res=()
  for i in 1 2 3 4 5 6; do N=$((N+1)); res+=("$(peticion "$N" "203.0.113.$i")"); done
  veredicto="$(clasificar "${res[@]}")"
  printf '  ronda %s: %s' "$r" "${res[*]}"
  case "$veredicto" in
    IP)     echo "   ← 6.º = 429 RATE_LIMITED ✓ (el tope cuenta por la IP del edge, no por el XFF del cliente)"; DISPAROS=$((DISPAROS+1)) ;;
    NO)     echo "   ← ningún 429 ✗ (rotando XFF el tope por IP NO disparó)"; NUNCA=$((NUNCA+1)) ;;
    CUENTA) echo "   ← ::error:: 429 TOO_MANY_PASSWORD_ATTEMPTS: respondió el candado de CUENTA, no el tope por IP. Sonda contaminada. NO concluyente."; exit 2 ;;
    *)      echo "   ← ::error:: respuestas inesperadas. ¿URL o path mal? NO concluyente."; exit 2 ;;
  esac
done

# Ronda de control: solo hace falta si rotando XFF no hubo NINGÚN 429 (con un
# 429 RATE_LIMITED el tope por IP ya está demostrado activo).
CTL_TXT="no hizo falta"
if [ "$NUNCA" -eq "$ROUNDS" ]; then
  if [ "$CONTROL" -ne 1 ]; then
    echo
    echo "  ▲ Rotando XFF no hubo NINGÚN 429. Sin ronda de control eso no distingue un bypass de un tope por IP"
    echo "    apagado. NO concluyente. Hace falta autorización para 6 peticiones más y repetir con --with-control."
    exit 2
  fi
  [ "$PAUSE" -gt 0 ] && sleep "$PAUSE"
  ctl=()
  for i in 1 2 3 4 5 6; do N=$((N+1)); ctl+=("$(peticion "$N" "")"); done
  vctl="$(clasificar "${ctl[@]}")"
  printf '  control: %s' "${ctl[*]}"
  if [ "$vctl" = "IP" ]; then
    echo "   ← 6.º = 429 RATE_LIMITED ✓ (el tope por IP está activo y se lee)"; CTL_TXT="sí, activo"
  else
    echo "   ← ::error:: sin XFF el 6.º NO fue 429 RATE_LIMITED ($vctl): el tope por IP no está activo o no se lee."
    echo "  NO concluyente: sin control, «nunca 429» no distingue un bypass de un tope apagado."
    exit 2
  fi
fi

echo
echo "  disparo del 429 RATE_LIMITED en el 6.º intento rotando XFF: $DISPAROS/$ROUNDS (control: $CTL_TXT) · peticiones: $N"
if [ "$DISPAROS" -eq "$ROUNDS" ]; then
  echo "  ✓ C6 CIERRA: rotar X-Forwarded-For NO evade el tope. P-RL-1 no es explotable en producción,"
  echo "    SB-B3 se queda en Baja. Anotar la proporción $DISPAROS/$ROUNDS y la fecha en docs/DEVOPS_NOTES.md."
  exit 0
elif [ "$NUNCA" -eq "$ROUNDS" ]; then
  echo "  ✗ C6 FALLA: el bypass de P-RL-1 EXISTE en producción (control: sin XFF el 6.º SÍ es 429 RATE_LIMITED)."
  echo "    ⇒ el arreglo es de CÓDIGO (saltos de trust-proxy.ts o la cabecera de IP del borde): arquitecto → backend."
  exit 1
else
  echo "  ▲ RESULTADO MIXTO ($DISPAROS/$ROUNDS): el tope dispara de forma intermitente. No es un cierre."
  echo "    Ampliar rondas y llevarlo a backend+seguridad: puede haber más de un nodo de edge con config distinta."
  exit 1
fi

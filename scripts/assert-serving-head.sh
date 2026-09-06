#!/usr/bin/env bash
# =============================================================================
# scripts/assert-serving-head.sh — ¿el binario VIVO es el commit que voy a auditar?
# Propiedad: devops.  ·  TCG Vault MX
# =============================================================================
# POR QUÉ EXISTE (SEC-OPS-1, `docs/SECURITY_NOTES.md` §9 — deuda operativa RECURRENTE):
#
#   Dos pases de seguridad seguidos estuvieron a punto de firmar un veredicto contra
#   un binario MÁS VIEJO que el commit auditado:
#     · SEC-M43-6 (2026-08-29): backend arrancado 20:10, arreglo `1f73654` de 21:34.
#       La primera corrida del PoC devolvió el default de la columna y casi se firma
#       un ALTO abierto que ya estaba cerrado.
#     · v1.56 (2026-09-06): backend arrancado 15:04:03, arreglo `3b2fc87` de 16:16:31
#       (`buylist.service.ts` con mtime 16:18:15). Otra vez.
#   Las dos veces lo cazó una persona mirando la HORA DE UN PID. Un gate que depende
#   de que alguien se acuerde de mirar un PID no es un gate.
#
#   Y falla en la dirección PELIGROSA: la simetría del fallo es que un stack viejo
#   puede dar por BUENA una guarda que el binario no tiene (verde falso → se promueve
#   código no probado), no solo dar un rojo falso.
#
# QUÉ COMPRUEBA, Y SOBRE QUÉ EVIDENCIA
#
#   La única señal de procedencia que el proceso vivo emite hoy es `uptime` de
#   `GET /api/v1/health`, y es `process.uptime()` — MEDIDO en
#   `backend/src/modules/health/health.service.ts` («uptime: Math.round(process.uptime())»),
#   no `os.uptime()`. De ahí sale el instante REAL de arranque del proceso que está
#   sirviendo el puerto:
#
#       arranque_vivo = ahora − uptime
#
#   Eso NO se puede falsificar con un fichero rancio: si otro proceso tomó el puerto,
#   su uptime no cuadra. Sobre ese ancla se hacen hasta cuatro asertos (todos opcionales,
#   se activan por bandera):
#
#     1. --newer-than EPOCH   El proceso vivo arrancó DESPUÉS de EPOCH.
#                             Uso: tras un deploy/arranque, prueba que el proceso es
#                             el que acabo de lanzar y no el que ya estaba.
#     2. --source RUTA        NINGÚN fichero bajo RUTA tiene mtime posterior al
#          (repetible)        arranque del proceso. Uso: ts-node compila al arrancar;
#                             editar el fuente después NO cambia lo que se sirve.
#                             ESTE es el aserto que reproduce a máquina exactamente lo
#                             que seguridad detectó a mano las dos veces.
#     3. --stamp FICHERO      El sello escrito al arrancar (SHA + epoch de arranque)
#                             corresponde al MISMO proceso que responde ahora
#                             (|epoch_sello − arranque_vivo| <= --tolerance).
#                             Si no cuadra: procedencia DESCONOCIDA ⇒ falla.
#     4. --sha SHA / HEAD     El SHA del sello == el SHA esperado (por defecto,
#                             `git rev-parse HEAD`).
#
#   1 y 2 NO necesitan fichero ninguno: salen del proceso. 3 y 4 son los que ponen
#   NOMBRE al commit servido (observabilidad: «esto sirve 3b2fc87»), y por eso el
#   arranque escribe el sello.
#
# LO QUE **NO** PRUEBA (dicho de frente, no se deduzca de más)
#   · No hay prueba criptográfica de que el artefacto contenga el SHA: el backend NO
#     expone commit/version en `/health` (verificado: la respuesta es
#     {status,uptime,timestamp,db,redis} y nada más). La cadena es «desplegué X» +
#     «el proceso vivo nació después de ese despliegue» ⇒ «sirve X». Es sólida bajo
#     `concurrency` (un solo deploy a la vez), no es una firma.
#   · El cierre definitivo es que `/health` devuelva el commit. Eso es
#     `backend/src/modules/health/` ⇒ **rol backend**, no devops. Queda pedido en
#     DEVOPS_NOTES §38.6; mientras tanto, esto.
#
# USO
#   scripts/assert-serving-head.sh --url http://localhost:3099/api/v1/health \
#       --label backend --stamp .native-stack/backend.stamp \
#       --source backend/src --source backend/prisma
#
#   scripts/assert-serving-head.sh --url "$API/health" --newer-than 1757178000 \
#       --label "staging (post-deploy)"
#
# BANDERAS
#   --url URL           (obligatoria) endpoint de salud que devuelve JSON con `uptime`
#   --label NOMBRE      etiqueta para los mensajes (default: "servicio")
#   --stamp FICHERO     sello de procedencia escrito al arrancar (KEY=valor)
#   --sha SHA           SHA esperado (default: git rev-parse HEAD si hay repo)
#   --newer-than EPOCH  el proceso debe haber arrancado en/after EPOCH
#   --source RUTA       repetible; fichero o directorio cuyo mtime se compara
#   --tolerance SEG     margen sello↔proceso (default 45)
#   --timeout SEG       timeout de curl (default 10)
#   --remedy TEXTO      sustituye el bloque «REMEDIO» del fallo (para quien ya lo arregla)
#   --quiet             calla el informe cuando TODO está bien. Un FALLO grita SIEMPRE.
#
# SALIDA
#   0 = el binario vivo corresponde al árbol esperado (o no había con qué contradecirlo
#       y no se pidió ningún aserto: en ese caso lo dice).
#   1 = OBSOLETO o de PROCEDENCIA DESCONOCIDA. Mensaje ruidoso + remedio exacto.
#   2 = error de uso / el servicio no responde.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

URL=""
LABEL="servicio"
STAMP=""
EXPECT_SHA=""
NEWER_THAN=""
TOLERANCE=45
TIMEOUT=10
QUIET=0
REMEDY=""
SOURCES=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --url)         URL="${2:?--url necesita valor}"; shift 2 ;;
    --label)       LABEL="${2:?--label necesita valor}"; shift 2 ;;
    --stamp)       STAMP="${2:?--stamp necesita valor}"; shift 2 ;;
    --sha)         EXPECT_SHA="${2:?--sha necesita valor}"; shift 2 ;;
    --newer-than)  NEWER_THAN="${2:?--newer-than necesita valor}"; shift 2 ;;
    --source)      SOURCES+=("${2:?--source necesita valor}"); shift 2 ;;
    --tolerance)   TOLERANCE="${2:?--tolerance necesita valor}"; shift 2 ;;
    --timeout)     TIMEOUT="${2:?--timeout necesita valor}"; shift 2 ;;
    --remedy)      REMEDY="${2:?--remedy necesita valor}"; shift 2 ;;
    --quiet)       QUIET=1; shift ;;
    -h|--help)     sed -n '2,89p' "$0"; exit 0 ;;
    *) echo "assert-serving-head: opción desconocida '$1'" >&2; exit 2 ;;
  esac
done

[ -n "$URL" ] || { echo "assert-serving-head: falta --url" >&2; exit 2; }
case "$NEWER_THAN" in ''|*[!0-9]*) [ -z "$NEWER_THAN" ] || { echo "assert-serving-head: --newer-than debe ser epoch en segundos" >&2; exit 2; } ;; esac
case "$TOLERANCE" in ''|*[!0-9]*) echo "assert-serving-head: --tolerance debe ser entero" >&2; exit 2 ;; esac

say()  { [ "$QUIET" = 1 ] || printf '%s\n' "$*"; }
fail() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; }

# --- 1. El proceso vivo: ¿desde cuándo? ---------------------------------------
# `now` se toma ANTES del curl a propósito: así `arranque_vivo` queda, si acaso, un
# pelo MÁS TEMPRANO que el real, y los dos asertos que dependen de él (--newer-than
# y --source) se equivocan hacia el lado CONSERVADOR (fallar de más, nunca de menos).
NOW="$(date +%s)"
BODY="$(curl -sS -m "$TIMEOUT" "$URL" 2>/dev/null)" || {
  fail "$LABEL: no respondió $URL (¿está arriba?)."
  exit 2
}

if command -v jq >/dev/null 2>&1; then
  UPTIME="$(printf '%s' "$BODY" | jq -r '.uptime // empty' 2>/dev/null || true)"
else
  UPTIME=""
fi
if [ -z "$UPTIME" ]; then
  # Sin jq (o `uptime` ausente del JSON): extracción por patrón, misma clave.
  UPTIME="$(printf '%s' "$BODY" | sed -nE 's/.*"uptime"[[:space:]]*:[[:space:]]*([0-9]+(\.[0-9]+)?).*/\1/p' | head -1)"
fi
UPTIME="${UPTIME%%.*}"
case "$UPTIME" in
  ''|*[!0-9]*)
    fail "$LABEL: la respuesta de salud NO trae un \`uptime\` numérico; sin él NO se puede
     datar el proceso vivo y este aserto no significaría nada. Respuesta:
     $(printf '%s' "$BODY" | head -c 300)"
    exit 2 ;;
esac

LIVE_STARTED=$(( NOW - UPTIME ))
LIVE_STARTED_H="$(date -d "@$LIVE_STARTED" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "epoch $LIVE_STARTED")"

# --- 2. Qué dice el árbol -----------------------------------------------------
HEAD_SHA=""
if git -C "$ROOT_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  HEAD_SHA="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || true)"
fi
[ -n "$EXPECT_SHA" ] || EXPECT_SHA="$HEAD_SHA"

# --- 3. Qué dice el sello escrito al arrancar ---------------------------------
# Se PARSEA (grep+cut), no se `source`ea: un fichero en disco no debe poder ejecutar
# nada dentro de este script.
stamp_get() {
  [ -n "$STAMP" ] && [ -f "$STAMP" ] || return 0
  grep -E "^$1=" "$STAMP" 2>/dev/null | tail -1 | cut -d= -f2- || true
}
STAMP_SHA="$(stamp_get sha)"
STAMP_STARTED="$(stamp_get started_at)"
STAMP_DIRTY="$(stamp_get dirty)"

# --- 4. Informe de procedencia (esto es la parte OBSERVABLE) ------------------
say "──────────────────────────────────────────────────────────────────────────────"
say " PROCEDENCIA DEL BINARIO VIVO — $LABEL"
say "──────────────────────────────────────────────────────────────────────────────"
say "  endpoint            : $URL"
say "  proceso arrancó     : $LIVE_STARTED_H  (uptime ${UPTIME}s)"
if [ -n "$STAMP" ] && [ -f "$STAMP" ]; then
  DIRTY_NOTE=""
  [ -z "$STAMP_DIRTY" ] || [ "$STAMP_DIRTY" = "0" ] || DIRTY_NOTE="  (+$STAMP_DIRTY fichero(s) sin commitear al arrancar)"
  say "  commit servido      : ${STAMP_SHA:-¿sin sha en el sello?}$DIRTY_NOTE"
  say "  sello               : $STAMP"
elif [ -n "$STAMP" ]; then
  say "  commit servido      : DESCONOCIDO (no existe el sello $STAMP)"
else
  say "  commit servido      : no consultado (sin --stamp)"
fi
[ -z "$HEAD_SHA" ]    || say "  HEAD del árbol      : $HEAD_SHA"
[ -z "$NEWER_THAN" ]  || say "  debe ser posterior a: $(date -d "@$NEWER_THAN" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "epoch $NEWER_THAN")"

PROBLEMS=()
CHECKS=0

# --- Aserto 1: el proceso nació después de X ----------------------------------
if [ -n "$NEWER_THAN" ]; then
  CHECKS=$((CHECKS + 1))
  if [ "$LIVE_STARTED" -lt "$NEWER_THAN" ]; then
    PROBLEMS+=("El proceso vivo arrancó $((NEWER_THAN - LIVE_STARTED))s ANTES del instante exigido:
     está sirviendo el binario ANTERIOR. El arranque/despliegue no tomó efecto (o falló
     y quedó el de antes).")
  fi
fi

# --- Aserto 2: ningún fuente es más nuevo que el proceso ----------------------
# ts-node compila al arrancar y Nest requiere todo el árbol en el boot: un fichero
# editado DESPUÉS del arranque NO está en lo que se sirve. Es el aserto que reproduce
# a máquina lo que seguridad vio a mano (mtime de buylist.service.ts > arranque del PID).
if [ "${#SOURCES[@]}" -gt 0 ]; then
  CHECKS=$((CHECKS + 1))
  NEWER_FILES=""
  for src in "${SOURCES[@]}"; do
    [ -e "$src" ] || [ -e "$ROOT_DIR/$src" ] || continue
    [ -e "$src" ] || src="$ROOT_DIR/$src"
    FOUND="$(find "$src" \
        \( -name node_modules -o -name .next -o -name dist -o -name coverage -o -name .git \) -prune -o \
        -type f ! -name '*.log' -newermt "@$LIVE_STARTED" -print 2>/dev/null | head -20 || true)"
    [ -z "$FOUND" ] || NEWER_FILES="$NEWER_FILES$FOUND"$'\n'
  done
  NEWER_FILES="$(printf '%s' "$NEWER_FILES" | sed '/^$/d')"
  if [ -n "$NEWER_FILES" ]; then
    N="$(printf '%s\n' "$NEWER_FILES" | wc -l | tr -d ' ')"
    PROBLEMS+=("$N fichero(s) de FUENTE son MÁS NUEVOS que el proceso vivo ⇒ el proceso NO los
     está sirviendo. Los primeros:
$(printf '%s\n' "$NEWER_FILES" | head -8 | sed 's#^#       · #')")
  fi
fi

# --- Aserto 3: el sello corresponde a ESTE proceso ----------------------------
if [ -n "$STAMP" ]; then
  CHECKS=$((CHECKS + 1))
  if [ ! -f "$STAMP" ]; then
    PROBLEMS+=("No hay sello de procedencia ($STAMP): quien levantó este servicio no dejó
     constancia de QUÉ commit arrancó. Procedencia DESCONOCIDA — para un gate, eso es
     tan inválido como un binario viejo.")
  elif [ -z "$STAMP_STARTED" ] || [ -n "$(printf '%s' "$STAMP_STARTED" | tr -d '0-9')" ]; then
    PROBLEMS+=("El sello $STAMP no trae un \`started_at\` numérico (leído: '${STAMP_STARTED:-vacío}'):
     no se puede confirmar que hable del proceso que responde ahora.")
  else
    DELTA=$(( LIVE_STARTED > STAMP_STARTED ? LIVE_STARTED - STAMP_STARTED : STAMP_STARTED - LIVE_STARTED ))
    if [ "$DELTA" -gt "$TOLERANCE" ]; then
      PROBLEMS+=("El sello dice que el proceso arrancó $(date -d "@$STAMP_STARTED" '+%H:%M:%S' 2>/dev/null || echo "@$STAMP_STARTED"), pero el que
     responde en el puerto arrancó $(date -d "@$LIVE_STARTED" '+%H:%M:%S' 2>/dev/null || echo "@$LIVE_STARTED") (${DELTA}s de diferencia, tolerancia ${TOLERANCE}s).
     ⇒ el sello NO habla de este proceso: hay OTRO sirviendo el puerto. Procedencia
     DESCONOCIDA.")
    fi
  fi
fi

# --- Aserto 4: el commit servido == el commit esperado ------------------------
if [ -n "$EXPECT_SHA" ] && [ -n "$STAMP" ] && [ -f "$STAMP" ]; then
  CHECKS=$((CHECKS + 1))
  if [ -z "$STAMP_SHA" ]; then
    PROBLEMS+=("El sello no registra \`sha\`: no se puede nombrar el commit servido.")
  elif [ "$STAMP_SHA" != "$EXPECT_SHA" ]; then
    PROBLEMS+=("COMMIT DISTINTO: se está sirviendo \`${STAMP_SHA:0:12}\` y se esperaba
     \`${EXPECT_SHA:0:12}\`. Cualquier medición en vivo contra este proceso es INVÁLIDA.")
  fi
fi

# --- Veredicto ----------------------------------------------------------------
if [ "${#PROBLEMS[@]}" -gt 0 ]; then
  printf '\n\033[1;31m══════════════════════════════════════════════════════════════════════════════\033[0m\n' >&2
  printf '\033[1;31m ⛔ EL BINARIO VIVO NO ES EL ÁRBOL QUE SE VA A MEDIR — %s\033[0m\n' "$LABEL" >&2
  printf '\033[1;31m══════════════════════════════════════════════════════════════════════════════\033[0m\n' >&2
  for p in "${PROBLEMS[@]}"; do printf '  · %s\n' "$p" >&2; done
  cat >&2 <<EOF

  ESTO ES SEC-OPS-1 (docs/SECURITY_NOTES.md §9). No sigas midiendo: un gate contra un
  binario que no es el HEAD auditado no es un gate, y falla en la dirección peligrosa
  (aprobar lo que no se probó).
EOF
  if [ -n "$REMEDY" ]; then
    printf '\n  %s\n\n' "$REMEDY" >&2
  else
    cat >&2 <<EOF

  REMEDIO (local):  ./scripts/stack-native.sh up
     · Reinicia SOLO las apps y las deja sirviendo el árbol de ahora.
     · NO toca Postgres/Redis y NO resiembra: los datos bajo auditoría se conservan.
       Re-sembrar es SIEMPRE explícito (\`--seed\`) — ver DEVOPS_NOTES §38.4.

EOF
  fi
  exit 1
fi

if [ "$CHECKS" -eq 0 ]; then
  say ""
  say "  ⚠ No se pidió ningún aserto (--stamp/--source/--newer-than): esto NO verificó nada,"
  say "    solo informó. No lo cites como prueba de procedencia."
  exit 0
fi

say ""
say "  ✔ El binario vivo corresponde al árbol esperado ($CHECKS aserto(s) en verde)."
exit 0

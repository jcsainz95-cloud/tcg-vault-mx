#!/usr/bin/env bash
#
# dast-ephemeral.sh — DAST contra un stack EFÍMERO levantado aquí mismo. devops.
# =============================================================================
# P-77. Hasta hoy el DAST de este repo apuntaba a `STAGING_BASE_URL`, un secret
# que nunca existió porque el dueño NUNCA TUVO STAGING: solo producción. El
# resultado medido era un gate sin blanco — ni un solo escaneo en toda la vida
# del proyecto — mientras el tablero decía "DAST semanal: cableado".
#
# CLAUDE.md autoriza como blanco «staging (o local)». Este script toma la vía
# local: levanta el MISMO `docker-compose.staging.yml` que ya usa el gate de
# E2E real (29 corridas, la última en verde), lo siembra con datos sintéticos,
# lo escanea y aplica el candado. Sin secrets, sin infraestructura nueva, sin
# depender de que nadie provisione nada.
#
#   ⚠️ ALCANCE DECLARADO: un stack efímero de CI con datos sintéticos NO es
#   producción. No tiene su configuración, ni sus datos, ni su superficie de
#   red, ni su CDN/WAF/DNS. Este gate NO puede citarse como "producción
#   escaneada". El párrafo largo está en docs/DEVOPS_NOTES.md §44.4.
#
# SUBCOMANDOS (cada uno corre a mano; nada vive solo dentro del YAML)
#   up      levanta stack + espera salud + procedencia + seed + paridad I-PP5
#   scan    ZAP (+ nuclei) contra los blancos; deja informes en security/reports
#   gate    aplica security/scripts/dast-gate.py sobre los informes
#   down    apaga y borra volúmenes
#   all     up && scan && gate  (down queda a cargo de quien llama; en CI, always())
#
# VARIABLES
#   SCAN_PROFILE=baseline|full   (def. full)  full = escaneo ACTIVO
#   ACTIVE_MAX_MINS=<n>          (def. 12)    tope duro del escaneo activo
#   SPIDER_MINS=<n>              (def. 3)     tope del araña
#   AJAX_SPIDER=1|0              (def. 1 en full) araña con navegador: es lo
#                                único que mete las llamadas XHR de la SPA en
#                                el árbol de ZAP.
#   ZAP_TARGETS="url…"           (def. SOLO la vitrina — ver la nota de abajo)
#   NUCLEI_TARGETS="url…"        (def. vitrina + API)
#   REPORT_ONLY=1                mide y publica, no bloquea (calibración)
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEC_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${SEC_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.staging.yml}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:3010}"
API_BASE="${API_BASE:-http://localhost:3011/api/v1}"
BACKEND_HEALTH="${BACKEND_HEALTH:-${API_BASE}/health}"
# ------------------------------------------------------------------------
# BLANCOS. Medido en la corrida 34432408600: con ZAP `full` + araña AJAX contra
# DOS blancos, el paso de escaneo pasó de 30 minutos. El segundo blanco (la
# base de la API) es el que sale casi gratis en hallazgos y carísimo en tiempo:
# el backend NestJS NO expone OpenAPI, así que la araña no tiene NADA que
# recorrer ahí — su raíz es un 404 — y se lleva su presupuesto completo de
# araña + escaneo activo para no descubrir superficie.
#
# La API sí se cubre, pero por la vía que funciona: la araña AJAX conduce un
# navegador real contra la vitrina, así que las llamadas XHR de la SPA entran
# en el árbol de ZAP con sus parámetros. Y nuclei —que es rápido y no depende
# de enumerar enlaces— sí apunta a los dos.
#
# Lo que esto NO cubre queda DECLARADO en DEVOPS_NOTES §44.4: los endpoints
# administrativos y los de webhook, que no cuelgan de la vitrina, no se
# enumeran. El cierre sería que backend exponga un spec OpenAPI.
# ------------------------------------------------------------------------
ZAP_TARGETS="${ZAP_TARGETS:-${FRONTEND_URL}}"
NUCLEI_TARGETS="${NUCLEI_TARGETS:-${FRONTEND_URL} ${API_BASE}}"

SCAN_PROFILE="${SCAN_PROFILE:-full}"
ACTIVE_MAX_MINS="${ACTIVE_MAX_MINS:-10}"
SPIDER_MINS="${SPIDER_MINS:-2}"
AJAX_SPIDER="${AJAX_SPIDER:-$([ "${SCAN_PROFILE}" = "full" ] && echo 1 || echo 0)}"
REPORT_DIR="${REPORT_DIR:-${ROOT_DIR}/security/reports}"
ZAP_IMAGE="${ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:stable}"
NUCLEI_IMAGE="${NUCLEI_IMAGE:-projectdiscovery/nuclei:latest}"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠  %s\033[0m\n' "$*"; }
err()  { printf '\033[1;31m✗  %s\033[0m\n' "$*" >&2; }

# Nombre de fichero estable a partir de una URL (para un informe por blanco).
slug() { printf '%s' "$1" | sed -e 's#^https\?://##' -e 's#[^A-Za-z0-9]#-#g' -e 's#-\+#-#g' -e 's#-$##'; }

# ---------------------------------------------------------------------------
# up
# ---------------------------------------------------------------------------
cmd_up() {
  log "Levantando stack efímero (${COMPOSE_FILE}, perfil apps)"

  # --- RESOLVER ANTES DE LEVANTAR (S-88-1) -----------------------------------
  # `docker-compose.staging.yml` ya no trae literales de respaldo: sus secretos son
  # `${VAR:?}`. Un consumidor que no resuelva antes muere en la interpolación, sin
  # haber levantado nada. Este script es la ruta LOCAL del DAST (la de CI resuelve
  # en su propio paso), así que necesita su propia resolución.
  # Se marca el stack como inalcanzable: vive en esta máquina, sin endpoint público.
  # Sin esta llamada, `./security/scripts/dast-ephemeral.sh up` fallaba con
  # «required variable STAGING_… is missing a value» — enumerado y cerrado, no
  # descubierto a base de runs rojos.
  export STRIPE_WEBHOOK_UNREACHABLE=1
  # Se llama «efímero» en el nombre del fichero: que lo diga también donde importa.
  export SECRETS_ENV="${SECRETS_ENV:-desechable}"
  log "Resolviendo secretos del stack (ninguno puede venir escrito en el repo)"
  ./scripts/webhook-secret-preflight.sh assert || { err "preflight del webhook"; return 1; }
  WH="$(./scripts/webhook-secret-preflight.sh resolve)" || { err "preflight del webhook"; return 1; }
  [ -n "${WH}" ] || { err "el preflight del webhook no devolvió valor"; return 1; }
  export STRIPE_TEST_WEBHOOK_SECRET="${WH}"
  export STRIPE_WEBHOOK_SECRET="${WH}"
  # Y el resto de la clase: el fichero es efímero y va al scratch del script.
  SECRETOS_TMP="$(mktemp)"
  ./scripts/secrets-preflight.sh env-file "${SECRETOS_TMP}" >/dev/null || {
    err "no pude resolver los secretos del stack"; rm -f "${SECRETOS_TMP}"; return 1; }
  set -a; . "${SECRETOS_TMP}"; set +a
  rm -f "${SECRETOS_TMP}"

  STACK_UP_EPOCH="$(date +%s)"
  export STACK_UP_EPOCH
  echo "STACK_UP_EPOCH=${STACK_UP_EPOCH}" >> "${GITHUB_ENV:-/dev/null}" 2>/dev/null || true

  docker compose -f "${COMPOSE_FILE}" --profile apps up -d --build || { err "compose up falló"; return 1; }

  log "Esperando salud del backend (${BACKEND_HEALTH})"
  for i in $(seq 1 60); do
    if curl -sf "${BACKEND_HEALTH}" >/dev/null 2>&1; then echo "backend arriba (intento $i)"; break; fi
    [ "$i" = "60" ] && { err "El backend no respondió tras ~5min."
                         docker compose -f "${COMPOSE_FILE}" logs --tail=200 backend || true
                         err "Si es un fallo de ARRANQUE del backend, el hallazgo es del rol backend, no de devops."
                         return 1; }
    sleep 5
  done

  # PROCEDENCIA (SEC-OPS-1): el binario que responde tiene que haber nacido de
  # ESTE arranque. Es el mismo gate que corre el E2E real; aquí importa igual,
  # porque un contenedor superviviente haría que el informe describa otro commit.
  log "Procedencia: ¿el backend vivo nació de este arranque?"
  ./scripts/assert-serving-head.sh \
      --url "${BACKEND_HEALTH}" \
      --label "backend (compose efímero, commit ${GITHUB_SHA:-local})" \
      --newer-than "${STACK_UP_EPOCH}" \
      --remedy "Hay un stack superviviente. Bájalo (docker compose -f ${COMPOSE_FILE} down -v) y repite. NO interpretes este informe." \
    || return 1

  log "Esperando readiness del frontend (${FRONTEND_URL}/es)"
  for i in $(seq 1 40); do
    curl -sf "${FRONTEND_URL}/es" >/dev/null 2>&1 && { echo "frontend arriba (intento $i)"; break; }
    [ "$i" = "40" ] && { err "El frontend no respondió tras ~3min."
                         docker compose -f "${COMPOSE_FILE}" logs --tail=200 frontend || true; return 1; }
    sleep 5
  done

  log "Seed sintético (superficie que el escáner va a recorrer)"
  SEED_CMD="$(docker compose -f "${COMPOSE_FILE}" exec -T backend \
      node -e "process.stdout.write((require('./package.json').scripts||{})['seed:synthetic']||'')" 2>/dev/null)"
  if [ -z "${SEED_CMD}" ]; then
    warn "backend no expone 'seed:synthetic'; se escanea un stack VACÍO (mucho menos superficie)."
  else
    docker compose -f "${COMPOSE_FILE}" exec -T backend \
      sh -c "export PATH=/app/node_modules/.bin:\$PATH; ${SEED_CMD}" || { err "seed sintético falló"; return 1; }
  fi

  # ------------------------------------------------------------------------
  # PARIDAD DEL PROVEEDOR DE PRECIO (I-PP5 / D-PP-2).
  #
  # Este es el gate que en deploy.yml dependía de STAGING_ADMIN_EMAIL /
  # STAGING_ADMIN_PASSWORD: secrets que el dueño no puede dar porque no hay
  # staging al que apuntarlos. Contra el stack efímero SÍ se puede leer el
  # dial, porque el admin lo crea el seed sintético y el script ya cae a esas
  # credenciales por defecto. El gate deja de "depender de secrets" y pasa a
  # "se comprueba solo". D-PP-2 queda EJECUTABLE por esta vía.
  #
  # Importa para el DAST y no es burocracia: el escáner recorre superficies de
  # DINERO (vitrina, cotizador). Si el dial apunta al barrido LEGACY, el
  # informe describe otro sistema del que se promueve.
  # ------------------------------------------------------------------------
  # ⛔ SOLO `--assert`, NUNCA `--ensure`. El puente interino de `--ensure` ya
  # CADUCÓ: `D-PP-1` aterrizó y el seed del código es el primario, así que en una
  # BD FRESCA —y la de este stack lo es siempre, porque cada corrida hace
  # `down -v`— la paridad se cumple sola. Añadir aquí un cuarto call site de
  # `--ensure` sería resucitar un apaño el mismo día que su disparador de retiro
  # se puso rojo. `--assert` NO es interino: es el candado `I-PP5`, y se queda.
  log "Paridad del dial price_provider (I-PP5) — solo lectura"
  ./scripts/price-provider-parity.sh --assert --api-base "${API_BASE}" || {
    err "El stack efímero NO evalúa el proveedor de precio primario."
    err "El informe DAST describiría un barrido distinto del que se promueve: se ABORTA."
    err "Si el seed dejó el dial en LEGACY, el hallazgo es del rol backend (D-PP-1)."
    return 1; }
  return 0
}

# ---------------------------------------------------------------------------
# scan
# ---------------------------------------------------------------------------
cmd_scan() {
  mkdir -p "${REPORT_DIR}"
  # ZAP corre como uid 1000 dentro del contenedor y escribe los informes.
  chmod 777 "${REPORT_DIR}" 2>/dev/null || true

  local zap_script zap_extra=()
  if [ "${SCAN_PROFILE}" = "full" ]; then
    zap_script="zap-full-scan.py"
    # ---------------------------------------------------------------------
    # TOPE DEL ESCANEO ACTIVO. Sin él, un full scan se va a horas y el cron
    # semanal se vuelve impagable — y lo que es impagable se acaba apagando.
    #
    # ⚠️ OJO CON EL PREFIJO. La primera versión usaba `ascan.max…`, que NO
    # existe: las opciones del escáner activo de ZAP viven bajo `scanner.`
    # (org.zaproxy.zap.extension.ascan.ScannerParam). ZAP ignora en silencio
    # una clave desconocida, así que el tope era INERTE y no se notaba: se
    # midió en la corrida 34434882197, donde el paso de escaneo pasó de 36
    # min con un "tope" de 10. Un límite mal escrito es indistinguible de no
    # tener límite, que es la misma familia de error que P-77.
    # ---------------------------------------------------------------------
    zap_extra+=(-z "-config scanner.maxScanDurationInMins=${ACTIVE_MAX_MINS} -config scanner.maxRuleDurationInMins=2")
  else
    zap_script="zap-baseline.py"
  fi
  [ "${AJAX_SPIDER}" = "1" ] && zap_extra+=(-j)

  # CINTURÓN, ADEMÁS DEL TIRANTE: pared de reloj que no depende de que una
  # clave de config de ZAP esté bien escrita. Si ZAP se pasa, se le corta.
  # Un escaneo cortado NO deja informe ⇒ el candado lo lee como ROJO (ver
  # dast-gate.py), que es la lectura correcta: un escáner que no terminó no
  # es un verde.
  local pared=$(( (SPIDER_MINS * 2 + ACTIVE_MAX_MINS + 6) * 60 ))

  local rc_total=0
  for target in ${ZAP_TARGETS}; do
    local name; name="$(slug "${target}")"
    log "ZAP ${SCAN_PROFILE} → ${target}  (araña ${SPIDER_MINS}min · activo ≤${ACTIVE_MAX_MINS}min)"
    local t0; t0="$(date +%s)"
    # --network host: el stack escucha en puertos del HOST (3010/3011). Sin
    # esto, "localhost" dentro del contenedor de ZAP es el propio ZAP.
    # -I: los WARN no deciden el veredicto. El veredicto lo da dast-gate.py
    #     leyendo el JSON con la política de baseline.conf — una sola verdad.
    timeout --signal=INT "${pared}s" \
    docker run --rm --network host \
      -v "${SEC_DIR}/zap:/zap/wrk/conf:ro" \
      -v "${REPORT_DIR}:/zap/wrk/out:rw" \
      "${ZAP_IMAGE}" "${zap_script}" \
        -t "${target}" \
        -c /zap/wrk/conf/baseline.conf \
        -J "/zap/wrk/out/zap-${name}.json" \
        -w "/zap/wrk/out/zap-${name}.md" \
        -r "/zap/wrk/out/zap-${name}.html" \
        -m "${SPIDER_MINS}" -T 5 -I "${zap_extra[@]}"
    local rc=$?
    printf 'ZAP %s %s -> rc=%s  (%ss, pared %ss)\n' "${SCAN_PROFILE}" "${target}" "${rc}" \
      "$(( $(date +%s) - t0 ))" "${pared}" | tee -a "${REPORT_DIR}/timings.txt"
    # rc 1/2 = ZAP encontró cosas; el candado lo decide dast-gate.py.
    # rc 124  = se comió la pared de reloj: el presupuesto está mal calibrado.
    # rc>=3   = el escáner reventó. Los dos son ROJO: un escáner que no terminó
    #           no es un verde (y además no deja informe, que el candado ya lee
    #           como rojo por su cuenta).
    if [ "${rc}" = "124" ]; then
      err "ZAP superó la pared de ${pared}s contra ${target} y se cortó."
      err "Esto NO es un hallazgo: es presupuesto mal calibrado. Sube ACTIVE_MAX_MINS o reduce blancos."
      rc_total=1
    elif [ "${rc}" -ge 3 ]; then
      err "ZAP terminó con rc=${rc} (fallo del escáner, no hallazgo)."
      rc_total=1
    fi
  done

  log "nuclei → ${NUCLEI_TARGETS}"
  local t0; t0="$(date +%s)"
  : > "${REPORT_DIR}/nuclei.jsonl"
  for target in ${NUCLEI_TARGETS}; do
    docker run --rm --network host -v "${REPORT_DIR}:/out:rw" -v "${SEC_DIR}/nuclei:/tpl:ro" \
      "${NUCLEI_IMAGE}" \
        -u "${target}" \
        -tags "$(grep -vE '^\s*#|^\s*$' "${SEC_DIR}/nuclei/templates.txt" | paste -sd, -)" \
        -severity low,medium,high,critical \
        -rate-limit 50 -timeout 5 -retries 1 \
        -jsonl -o "/out/nuclei-$(slug "${target}").jsonl" >/dev/null 2>&1 || true
    cat "${REPORT_DIR}/nuclei-$(slug "${target}").jsonl" >> "${REPORT_DIR}/nuclei.jsonl" 2>/dev/null || true
  done
  printf 'nuclei -> (%ss)\n' "$(( $(date +%s) - t0 ))" | tee -a "${REPORT_DIR}/timings.txt"
  # Los tiempos, en la portada del run. Sin esto había que bajar un artefacto
  # para saber cuánto costó el barrido — y lo que no se ve no se calibra.
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    printf '::notice title=Tiempos del barrido DAST (perfil %s)::%s\n' "${SCAN_PROFILE}" \
      "$(sed 's/$/%0A/' "${REPORT_DIR}/timings.txt" | tr -d '\n')"
  fi
  return "${rc_total}"
}

# ---------------------------------------------------------------------------
# gate
# ---------------------------------------------------------------------------
cmd_gate() {
  local args=()
  for target in ${ZAP_TARGETS}; do
    args+=(--zap-json "${REPORT_DIR}/zap-$(slug "${target}").json")
  done
  [ "${REPORT_ONLY:-0}" = "1" ] && args+=(--report-only)
  python3 "${SCRIPT_DIR}/dast-gate.py" \
    "${args[@]}" \
    --nuclei-jsonl "${REPORT_DIR}/nuclei.jsonl" \
    --policy "${SEC_DIR}/zap/baseline.conf" \
    --nuclei-ignore "${SEC_DIR}/nuclei/ignore.txt" \
    --summary "${REPORT_DIR}/dast-summary.md" \
    --label "DAST semanal — stack efímero de CI" \
    --target "ZAP: ${ZAP_TARGETS}  ·  nuclei: ${NUCLEI_TARGETS}"
}

cmd_down() {
  log "Apagando stack efímero"
  docker compose -f "${COMPOSE_FILE}" --profile apps down -v || true
}

case "${1:-all}" in
  up)   cmd_up ;;
  scan) cmd_scan ;;
  gate) cmd_gate ;;
  down) cmd_down ;;
  all)  cmd_up && cmd_scan; cmd_gate ;;
  *)    err "Uso: $0 {up|scan|gate|down|all}"; exit 64 ;;
esac

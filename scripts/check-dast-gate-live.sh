#!/usr/bin/env bash
#
# check-dast-gate-live.sh — «¿el candado del DAST sigue siendo un candado?» devops
# =============================================================================
# LA MEDICIÓN QUE ORIGINA ESTA GUARDA (P-77, 2026-09-10)
# ---------------------------------------------------------------------------
# El gate DAST de este repo NUNCA corrió contra nada. Apuntaba a
# `secrets.STAGING_BASE_URL`, un secret que nunca existió porque el dueño nunca
# tuvo staging — solo producción. El job detectaba la ausencia, imprimía «modo
# plantilla (no-op)» y salía en VERDE, durante meses, mientras el DoD lo contaba
# como «SAST + DAST cableados en CI».
#
# El arreglo (levantar un stack efímero y escanearlo) resuelve el HOY. Esta
# guarda resuelve el MAÑANA: impide que el gate vuelva a quedarse sin blanco, o
# sin candado, sin que nadie se entere. Es la lección repetida del repo —
# S-PROC-1, el falso verde del preflight de Stripe, SEC-OPS-1— con otra cara:
# una verificación que técnicamente corre, no puede fallar, y nadie lee.
#
# QUÉ COMPRUEBA (estático y barato: lee ficheros, sin red, sin Docker)
#   1. Existe un workflow de DAST con cadencia propia (`schedule`).
#   2. Ese workflow tiene un job de AUTOPRUEBA que escanea el canario vulnerable.
#   3. El barrido de verdad DEPENDE de esa autoprueba (`needs`), para que un
#      candado que no sabe cerrarse no pueda emitir un verde.
#   4. El barrido aplica el CANDADO, no solo el escáner (`... gate`).
#   5. El candado FUNCIONA: se le pasan dos informes de juguete y se exige
#      VERDE con el limpio y ROJO con el que trae un hallazgo bloqueante. Esto
#      es lo que convierte «el gate está cableado» en un hecho comprobado en
#      cada push, sin Docker y en menos de un segundo.
#   5-bis. `--report-only` NO borra el hecho (techlead F1-1, 2026-09-11): con
#      un informe sucio y `--report-only` el candado sale 0 PERO escribe
#      `blocking=true` en `$GITHUB_OUTPUT` y `true` en `--blocking-file`; con
#      el limpio, `false`. Es lo que impide que `report_only` vuelva a dejar
#      abierto por construcción el gate de promoción de deploy.yml.
#   6. Ningún workflow que SÍ corre cuelga su DAST de `STAGING_BASE_URL`. El
#      único sitio donde ese secret puede aparecer es `deploy.yml`, y solo
#      dentro de bloques marcados como INERTES.
#
# Uso:  ./scripts/check-dast-gate-live.sh
# Sale 0 si el candado está vivo; 1 con el motivo exacto y el dueño del arreglo.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}" || exit 1

WF=".github/workflows/security-dast.yml"
FALLOS=0
ok()   { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; FALLOS=$((FALLOS+1)); }
note() { printf '      %s\n' "$*"; }

printf '\n\033[1m== ¿El candado del DAST sigue siendo un candado? (P-77) ==\033[0m\n\n'

# --- 1. el workflow existe y tiene cadencia propia ---------------------------
if [ ! -f "${WF}" ]; then
  bad "No existe ${WF}: el DAST no tiene dónde correr."
  note "Dueño: devops. Ver DEVOPS_NOTES §44."
  exit 1
fi
ok "existe ${WF}"

if grep -qE '^\s*schedule:' "${WF}"; then
  CRON="$(grep -oE '^\s*- cron: *"[^"]+"' "${WF}" | head -1 | sed 's/.*"\(.*\)"/\1/')"
  ok "tiene cadencia propia (\`schedule\`: ${CRON:-?})"
else
  bad "${WF} no declara \`schedule\`: el DAST dejaría de correr solo."
  note "Un DAST que solo corre cuando alguien se acuerda no es un gate."
fi

# --- 2/3/4. autoprueba, dependencia y candado --------------------------------
if grep -q 'dast-selftest\.sh' "${WF}"; then
  ok "hay job de AUTOPRUEBA (escanea el canario con vulnerabilidades plantadas)"
else
  bad "${WF} no invoca security/scripts/dast-selftest.sh."
  note "Sin autoprueba, nadie sabe si el candado puede ponerse rojo. Ver §44.3."
fi

if grep -qE '^\s*needs:\s*\[\s*selftest\s*\]' "${WF}"; then
  ok "el barrido DEPENDE de la autoprueba (\`needs: [selftest]\`)"
else
  bad "El job del barrido no declara \`needs: [selftest]\`."
  note "Un candado que no sabe cerrarse no puede emitir un verde de seguridad."
fi

if grep -qE 'dast-ephemeral\.sh gate' "${WF}"; then
  ok "el barrido aplica el CANDADO (\`dast-ephemeral.sh gate\`), no solo el escáner"
else
  bad "El barrido no aplica el candado: escanear sin gatear es un informe, no un gate."
fi

for f in security/dast-selftest/canary.py docker-compose.dast-selftest.yml \
         security/scripts/dast-gate.py security/scripts/dast-ephemeral.sh; do
  [ -f "$f" ] && ok "existe ${f}" || bad "falta ${f} (el canario/candado está incompleto)"
done

# --- 5. el candado FUNCIONA (prueba con informes de juguete) -----------------
TMP="$(mktemp -d)"; trap 'rm -rf "${TMP}"' EXIT
cat > "${TMP}/limpio.json" <<'J'
{"@version":"guarda","site":[{"@name":"http://ejemplo","alerts":[
 {"pluginid":"10096","alert":"Timestamp Disclosure","riskcode":"0","count":"3","instances":[{"uri":"http://ejemplo/"}]}]}]}
J
cat > "${TMP}/sucio.json" <<'J'
{"@version":"guarda","site":[{"@name":"http://ejemplo","alerts":[
 {"pluginid":"40018","alert":"SQL Injection","riskcode":"3","count":"1","instances":[{"uri":"http://ejemplo/x?id=1"}]}]}]}
J
: > "${TMP}/vacio.jsonl"

GATE=(python3 security/scripts/dast-gate.py --policy security/zap/baseline.conf
      --nuclei-ignore security/nuclei/ignore.txt --nuclei-jsonl "${TMP}/vacio.jsonl")

GITHUB_ACTIONS='' "${GATE[@]}" --zap-json "${TMP}/limpio.json" >/dev/null 2>&1
[ $? -eq 0 ] && ok "el candado deja pasar un informe LIMPIO (exit 0)" \
             || bad "el candado bloquea un informe limpio: se volvería ruido y acabaría desactivado."

GITHUB_ACTIONS='' "${GATE[@]}" --zap-json "${TMP}/sucio.json" >/dev/null 2>&1
if [ $? -ne 0 ]; then
  ok "el candado SE PONE ROJO con un hallazgo bloqueante (regla 40018, exit≠0)"
else
  bad "EL CANDADO NO PUEDE PONERSE ROJO: un SQLi de manual pasó en verde."
  note "Alguien vació las reglas FAIL de security/zap/baseline.conf o rompió dast-gate.py."
  note "Este es exactamente el estado del que viene P-77. Dueño: devops."
fi

GITHUB_ACTIONS='' "${GATE[@]}" --zap-json "${TMP}/no-existe.json" >/dev/null 2>&1
[ $? -ne 0 ] && ok "sin informe, el candado sale ROJO (un escáner que no corrió no es un verde)" \
             || bad "el candado da VERDE cuando no hay informe: es el falso verde original."

# --- 5-bis. report-only separa el HECHO del EXIT CODE (F1-1) ------------------
# hecho <informe> <flags…> → imprime "rc|fichero|output" para comparar de una vez.
hecho() {
  local informe="$1"; shift
  local out="${TMP}/gh_output"; : > "${out}"; rm -f "${TMP}/blocking.txt"
  GITHUB_ACTIONS='' GITHUB_OUTPUT="${out}" "${GATE[@]}" --zap-json "${informe}" \
    --blocking-file "${TMP}/blocking.txt" "$@" >/dev/null 2>&1
  printf '%s|%s|%s' "$?" "$(cat "${TMP}/blocking.txt" 2>/dev/null)" "$(grep -E '^blocking=' "${out}" | tail -1)"
}
H="$(hecho "${TMP}/sucio.json" --report-only)"
if [ "${H}" = "0|true|blocking=true" ]; then
  ok "con --report-only y un hallazgo bloqueante: exit 0 PERO blocking=true (fichero y GITHUB_OUTPUT)"
else
  bad "con --report-only el hecho se pierde o el exit no es 0 (rc|fichero|output = ${H}; se esperaba 0|true|blocking=true)."
  note "Así es como report_only dejaba ABIERTO el gate de promoción: blocking se derivaba del exit. Dueño: devops (F1-1)."
fi
H="$(hecho "${TMP}/limpio.json" --report-only)"
[ "${H}" = "0|false|blocking=false" ] && ok "con --report-only y un informe limpio: exit 0 y blocking=false" \
  || bad "con --report-only e informe limpio se esperaba 0|false|blocking=false y salió ${H}."
H="$(hecho "${TMP}/sucio.json")"
[ "${H}" = "1|true|blocking=true" ] && ok "sin --report-only y un hallazgo bloqueante: exit 1 y blocking=true (mismo hecho, otro exit)" \
  || bad "sin --report-only se esperaba 1|true|blocking=true y salió ${H}."

# ---------------------------------------------------------------------------
# 5-ter) ALCANCE POR ORIGEN (DEVOPS_NOTES §75). El primer dast-release bloqueante
#    (run 36969283231) salió rojo por un 10020 cuyo único caso era el iframe de
#    js.stripe.com. El filtro `--scope-origin` NO puede esconder un 10020 en
#    NUESTRO origen: se decide por instancia, lo de terceros se lista, y un
#    alcance que no casa con nada es ROJO. Cada caso, con su fixture.
# ---------------------------------------------------------------------------
SCOPE=(--scope-origin http://localhost:3010 --scope-origin http://localhost:3011/api/v1)
zap10020() {  # zap10020 <fichero> <uri>... -> un 10020 con esas instancias + un WARN propio
  local f="$1"; shift; local insts="" u
  for u in "$@"; do insts="${insts}${insts:+,}{\"uri\":\"${u}\"}"; done
  cat > "$f" <<J
{"@version":"guarda","site":[
 {"@name":"http://localhost:3010","alerts":[
  {"pluginid":"10037","alert":"X-Powered-By","riskcode":"1","count":"1","instances":[{"uri":"http://localhost:3010/es"}]}]},
 {"@name":"mixto","alerts":[
  {"pluginid":"10020","alert":"Missing Anti-clickjacking Header","riskcode":"2","count":"$#","instances":[${insts}]}]}]}
J
}
rc_scope() { GITHUB_ACTIONS='' "${GATE[@]}" --zap-json "$1" "${@:2}" >/dev/null 2>&1; echo $?; }

zap10020 "${TMP}/s-tercero.json" "https://js.stripe.com/v3/m-outer-3437aaddcdf6922d623e172c2d6f9278.html"
zap10020 "${TMP}/s-propio.json"  "http://localhost:3010/es"
zap10020 "${TMP}/s-mixto.json"   "https://js.stripe.com/v3/m-outer-x.html" "http://localhost:3010/es/catalogo"
zap10020 "${TMP}/s-puerto.json"  "http://localhost:8080/"

R="$(rc_scope "${TMP}/s-tercero.json" "${SCOPE[@]}")"
[ "$R" = 0 ] && ok "10020 SOLO en js.stripe.com con alcance propio: VERDE (tercero, se lista fuera de alcance)" \
             || bad "10020 de tercero (js.stripe.com) sigue bloqueando con --scope-origin (rc=$R)."
R="$(rc_scope "${TMP}/s-tercero.json")"
[ "$R" != 0 ] && ok "el MISMO informe sin --scope-origin sigue ROJO (el filtro solo actúa si se declara alcance)" \
              || bad "sin --scope-origin el 10020 de tercero salió verde: alguien filtró por defecto."
R="$(rc_scope "${TMP}/s-propio.json" "${SCOPE[@]}")"
[ "$R" != 0 ] && ok "10020 en localhost:3010 (NUESTRO origen) con alcance propio: ROJO" \
              || bad "UN 10020 EN NUESTRO ORIGEN PASÓ EN VERDE con --scope-origin. El filtro esconde hallazgos reales."
R="$(rc_scope "${TMP}/s-mixto.json" "${SCOPE[@]}")"
[ "$R" != 0 ] && ok "10020 con una instancia de Stripe (primera) y otra NUESTRA: ROJO (se decide por instancia)" \
              || bad "un 10020 mixto pasó en verde: lo de terceros tapó lo nuestro."
R="$(rc_scope "${TMP}/s-puerto.json" "${SCOPE[@]}")"
[ "$R" = 0 ] && ok "otro puerto del mismo host (localhost:8080) cuenta como TERCERO (origen = esquema+host+puerto)" \
             || bad "localhost:8080 se trató como propio: el origen no compara el puerto (rc=$R)."
R="$(rc_scope "${TMP}/s-tercero.json" --scope-origin http://no-casa:9)"
[ "$R" != 0 ] && ok "alcance que no casa con NINGUNA instancia: ROJO (no hay verde vacío)" \
              || bad "con un --scope-origin que no casa con nada el candado dio VERDE."
R="$(rc_scope "${TMP}/sucio.json" --scope-origin http://ejemplo)"
[ "$R" != 0 ] && ok "el SQLi de manual en el origen declarado sigue ROJO con --scope-origin" \
              || bad "con --scope-origin el SQLi de manual pasó en verde."
# ---------------------------------------------------------------------------
# 5-quater) SUB-ALERTAS (`alertRef`, DEVOPS_NOTES §96 · CL-1). Con la CSP en
#    enforce, 10055 está en FAIL pero tres sub-alertas son deliberadas (§14.3) y
#    van a WARN por clave `10055-<n>`. La clave específica NO puede aflojar las
#    demás: script-src unsafe-inline (10055-5) sigue ROJO, y una alerta sin
#    `alertRef` se juzga por la regla.
# ---------------------------------------------------------------------------
zapref() {  # zapref <fichero> <pluginid> <alertRef|""> -> una alerta en localhost:3010
  local ref=""; [ -n "$3" ] && ref=",\"alertRef\":\"$3\""
  cat > "$1" <<J
{"@version":"guarda","site":[{"@name":"http://localhost:3010","alerts":[
 {"pluginid":"$2"${ref},"alert":"x","riskcode":"2","count":"1","instances":[{"uri":"http://localhost:3010/es"}]}]}]}
J
}
if awk -F'\t' '$1=="10055"{print $2}' security/zap/baseline.conf | grep -qx FAIL; then
  for sub in 10055-3 10055-4 10055-6; do
    zapref "${TMP}/r-${sub}.json" 10055 "${sub}"
    R="$(rc_scope "${TMP}/r-${sub}.json" "${SCOPE[@]}")"
    [ "$R" = 0 ] && ok "${sub} (deliberada en §14.3) con 10055 en FAIL: VERDE (WARN por su clave)" \
                 || bad "${sub} bloquea con la CSP en enforce: el DAST de release saldría rojo por un hallazgo aceptado (rc=$R)."
  done
  zapref "${TMP}/r-10055-5.json" 10055 10055-5
  R="$(rc_scope "${TMP}/r-10055-5.json" "${SCOPE[@]}")"
  [ "$R" != 0 ] && ok "10055-5 (script-src unsafe-inline) sigue ROJO: la clave específica no afloja a sus hermanas" \
                || bad "10055-5 pasó en verde: las sub-claves aflojaron la regla entera."
  zapref "${TMP}/r-10055-sin.json" 10055 ""
  R="$(rc_scope "${TMP}/r-10055-sin.json" "${SCOPE[@]}")"
  [ "$R" != 0 ] && ok "10055 SIN alertRef se juzga por la regla (FAIL): sin dato no se afloja" \
                || bad "10055 sin alertRef pasó en verde."
  zapref "${TMP}/r-10038-3.json" 10038 10038-3
  R="$(rc_scope "${TMP}/r-10038-3.json" "${SCOPE[@]}")"
  [ "$R" != 0 ] && ok "10038-3 (CSP solo Report-Only) es ROJO con la CSP en enforce" \
                || bad "10038-3 pasó en verde: una vuelta a Report-Only no la vería el DAST."
else
  note "10055 no está en FAIL (CSP en report-only): las sub-alertas no aplican."
fi

if grep -q -- '--scope-origin' security/scripts/dast-ephemeral.sh; then
  ok "dast-ephemeral.sh pasa --scope-origin al candado (los orígenes de sus blancos)"
else
  bad "dast-ephemeral.sh no declara alcance: un tercero (js.stripe.com) volvería a bloquear el release."
fi

# --- 6. nadie vuelve a colgar el DAST de un staging inexistente --------------
CULPABLES=""
while IFS= read -r f; do
  case "$f" in .github/workflows/deploy.yml) continue ;; esac
  # Se busca el USO, no la mención: se descartan las líneas de comentario. Los
  # comentarios que explican POR QUÉ ya no se usa son parte del arreglo, no la
  # recaída — y un uso real nunca vive en una línea comentada.
  # Sin `-q`: con `pipefail`, `grep -q` sale al primer match, cierra el pipe y el
  # `grep -v` de delante muere con SIGPIPE (141) -> falso negativo intermitente.
  # Medido en este repo al cerrar P-77 (ver check-e2e-harness-gaps.sh).
  grep -vE '^[[:space:]]*#' "$f" | grep -E 'secrets\.STAGING_BASE_URL' >/dev/null \
    && CULPABLES="${CULPABLES} $f"
done < <(find .github/workflows -name '*.yml')
if [ -z "${CULPABLES}" ]; then
  ok "ningún workflow activo cuelga su DAST de \`secrets.STAGING_BASE_URL\` (secret que nunca existió)"
else
  bad "workflow(s) apuntando a STAGING_BASE_URL:${CULPABLES}"
  note "No hay staging desplegado. Un gate sin blanco sale VERDE sin haber mirado nada."
  note "Blanco autorizado por CLAUDE.md: «staging (o local)» ⇒ usa el stack efímero (§44)."
fi

if grep -q 'INERTE' .github/workflows/deploy.yml; then
  ok "deploy.yml marca sus gates de staging como INERTES (nadie los cita como activos)"
else
  bad "deploy.yml no marca como INERTES sus gates de staging (procedencia, DAST, paridad)."
  note "Viven en un pipeline apagado que apunta a un entorno inexistente. Ver §44.6."
fi

printf '\n'
if [ "${FALLOS}" -gt 0 ]; then
  printf '\033[1;31m✗ %s comprobación(es) fallida(s): el candado del DAST NO está vivo.\033[0m\n' "${FALLOS}"
  echo "::error title=El candado del DAST no está vivo::${FALLOS} comprobación(es) fallida(s). Un gate de seguridad que no puede fallar es peor que ninguno. Ver docs/DEVOPS_NOTES.md §44."
  exit 1
fi
printf '\033[1;32m✔ El candado del DAST está vivo: tiene blanco, tiene autoprueba y sabe ponerse rojo.\033[0m\n'

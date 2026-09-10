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
#   6. Ningún workflow que SÍ corre cuelga su DAST de `STAGING_BASE_URL`. El
#      único sitio donde ese secret puede aparecer es `deploy.yml`, y solo
#      dentro de bloques marcados como INERTES.
#
# Uso:  ./scripts/check-dast-gate-live.sh
# Sale 0 si el candado está vivo; 1 con el motivo exacto y el dueño del arreglo.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

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

# --- 6. nadie vuelve a colgar el DAST de un staging inexistente --------------
CULPABLES=""
while IFS= read -r f; do
  case "$f" in .github/workflows/deploy.yml) continue ;; esac
  # Se busca el USO, no la mención: se descartan las líneas de comentario. Los
  # comentarios que explican POR QUÉ ya no se usa son parte del arreglo, no la
  # recaída — y un uso real nunca vive en una línea comentada.
  grep -vE '^[[:space:]]*#' "$f" | grep -qE 'secrets\.STAGING_BASE_URL' \
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

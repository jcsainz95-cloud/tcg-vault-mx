#!/usr/bin/env bash
#
# check-skydropx-spend-lock-canary.sh — ¿el candado de PS-99 (d) se pone ROJO
# cuando alguien le da a una pila de pruebas las llaves de Skydropx?   · devops
# =============================================================================
# Copia lo que el candado lee a un árbol temporal, comprueba que el PRÍSTINO da
# VERDE (si no, cualquier rojo de abajo sería ruido) y luego planta, una por una,
# cada forma de fuga que el candado dice cerrar. Cada mutación tiene que dar ROJO
# **y** nombrar el bloque correcto (un rojo por otra causa no cuenta).
# Determinista (sin carreras ni reloj): una corrida por mutación basta (O-3 no
# aplica); el resumen trae la proporción N/N igualmente.
#
# Los nombres de variable y los valores plantados se arman por partes para que
# este fichero no sea un hallazgo de check-secret-defaults.sh ni del estático de
# backend (que barre .github/, no scripts/). DEVOPS_NOTES §78.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE_REL="scripts/check-skydropx-spend-lock.sh"
[ -f "$ROOT_DIR/$GATE_REL" ] || { printf '✗ No existe %s: el candado desapareció, eso ya es el rojo.\n' "$GATE_REL"; exit 1; }

FALLOS=0
PASADAS=0
ok()   { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; FALLOS=$((FALLOS+1)); }
note() { printf '      %s\n' "$*"; }

BASE="$(mktemp -d -t sdx-spend-canario-XXXXXX)"
trap 'rm -rf "$BASE"' EXIT
PRISTINO="$BASE/pristino"
mkdir -p "$PRISTINO/scripts/skydropx" "$PRISTINO/security"
cp "$ROOT_DIR/$GATE_REL" "$PRISTINO/$GATE_REL"
cp -r "$ROOT_DIR/.github" "$PRISTINO/.github"
cp "$ROOT_DIR"/docker-compose*.yml "$PRISTINO/"
cp "$ROOT_DIR/.env.example" "$PRISTINO/.env.example"
cp "$ROOT_DIR/scripts/stack-native.sh" "$PRISTINO/scripts/stack-native.sh"
cp "$ROOT_DIR"/security/secretos-exigidos*.txt "$PRISTINO/security/" 2>/dev/null || true
cp "$ROOT_DIR"/scripts/skydropx/prod-probe.ts "$ROOT_DIR"/scripts/skydropx/prod-probe.test.ts \
   "$ROOT_DIR"/scripts/skydropx/run-prod-probe.sh "$PRISTINO/scripts/skydropx/"

P='SKYDROPX_'
GASTO="${P}ALLOW_SPEND"
SEC="${P}CLIENT_""SECRET"
SI='tr''ue'
PLANTADO="$(printf 'canario%s' "$RANDOM")"

correr() { bash "$1/$GATE_REL" --root "$1" 2>&1; }

caso() { # caso <nombre> <texto que el rojo debe nombrar> <función mutadora>
  local nombre="$1" debe="$2" mutador="$3"
  local dir="$BASE/caso$((PASADAS+FALLOS+1))"
  rm -rf "$dir"; cp -a "$PRISTINO" "$dir"
  "$mutador" "$dir"
  local salida rc
  salida="$(correr "$dir")"; rc=$?
  if [ "$rc" -eq 0 ]; then
    bad "$nombre — el candado se quedó VERDE ante la mutación."
    return
  fi
  if ! grep -qF -- "$debe" <<< "$salida"; then
    bad "$nombre — rojo, pero no nombra «$debe»: se puso rojo por otra cosa."
    note "$(grep '✗' <<< "$salida" | head -3)"
    return
  fi
  ok "$nombre — ROJO, y nombra «$debe»."
}

# Inserta una línea tras la primera coincidencia de un patrón (awk: sin sed -i portátil).
insertar_tras() { # fichero patrón línea
  awk -v pat="$2" -v linea="$3" '{print} !hecho && index($0, pat) {print linea; hecho=1}' "$1" > "$1.tmp" && mv "$1.tmp" "$1"
}
quitar_lineas() { # fichero patrón(ERE)
  grep -vE "$2" "$1" > "$1.tmp"; mv "$1.tmp" "$1"
}

# --- (A) workflows ----------------------------------------------------------------
m_wf_secret()  { insertar_tras "$1/.github/workflows/ci.yml" 'runs-on: ubuntu-latest' "    env: { X: \${{ secrets.${SEC} }} }"; }
m_wf_vars()    { insertar_tras "$1/.github/workflows/e2e.yml" 'runs-on: ubuntu-latest' "    env: { X: \${{ vars.skydropx_token }} }"; }
m_wf_spend()   { insertar_tras "$1/.github/workflows/e2e-real.yml" 'runs-on: ubuntu-latest' "    env: { ${GASTO}: '${SI}' }"; }
m_wf_ghenv()   { printf '      - run: echo "%s=%s" >> "$GITHUB_ENV"\n' "$GASTO" "$SI" >> "$1/.github/workflows/deploy.yml"; }
# --- (B) compose --------------------------------------------------------------------
m_cmp_spend()  { insertar_tras "$1/docker-compose.staging.yml" 'SHIPPING_PROVIDER_ADAPTER: fake' "      ${GASTO}: \"${SI}\""; }
m_cmp_pass()   { insertar_tras "$1/docker-compose.yml" 'SHIPPING_PROVIDER_ADAPTER:' "      ${GASTO}: \${${GASTO}:-}"; }
m_cmp_secret() { insertar_tras "$1/docker-compose.staging.yml" 'SHIPPING_PROVIDER_ADAPTER: fake' "      ${SEC}: \${${SEC}:-}"; }
m_cmp_envf()   { insertar_tras "$1/docker-compose.staging.yml" 'SHIPPING_PROVIDER_ADAPTER: fake' "    env_file: .env"; }
# --- (C) .env.example ---------------------------------------------------------------
m_env_true()   { sed -E "s/^${GASTO}=.*/${GASTO}=${SI}/" "$1/.env.example" > "$1/x" && mv "$1/x" "$1/.env.example"; }
m_env_quoted() { sed -E "s/^${GASTO}=.*/${GASTO}='${SI}'   # solo para probar/" "$1/.env.example" > "$1/x" && mv "$1/x" "$1/.env.example"; }
m_env_gone()   { quitar_lineas "$1/.env.example" "^${GASTO}="; }
m_env_dup()    { printf '%s=%s\n' "$GASTO" "$SI" >> "$1/.env.example"; }
m_env_secret() { sed -E "s/^${SEC}=.*/${SEC}=${PLANTADO}/" "$1/.env.example" > "$1/x" && mv "$1/x" "$1/.env.example"; }
# --- (D) pila E2E -------------------------------------------------------------------
m_stg_real()   { sed -E 's/SHIPPING_PROVIDER_ADAPTER: fake/SHIPPING_PROVIDER_ADAPTER: skydropx/' "$1/docker-compose.staging.yml" > "$1/x" && mv "$1/x" "$1/docker-compose.staging.yml"; }
m_stg_interp() { sed -E 's/SHIPPING_PROVIDER_ADAPTER: fake/SHIPPING_PROVIDER_ADAPTER: ${SHIPPING_PROVIDER_ADAPTER:-fake}/' "$1/docker-compose.staging.yml" > "$1/x" && mv "$1/x" "$1/docker-compose.staging.yml"; }
m_nat_export() { quitar_lineas "$1/scripts/stack-native.sh" '^export SHIPPING_PROVIDER_ADAPTER=fake'; }
m_nat_unset()  { quitar_lineas "$1/scripts/stack-native.sh" "^unset .*${GASTO}"; }
# --- (E) catálogo ---------------------------------------------------------------------
m_catalogo()   { printf '%s\n' "$SEC" >> "$1/security/secretos-exigidos.txt"; }
# --- (F) sonda --------------------------------------------------------------------------
m_wf_probe()   { printf '      - run: scripts/skydropx/run-prod-probe.sh run --only M-PRD-1\n' >> "$1/.github/workflows/deploy.yml"; }
m_wf_notest()  { quitar_lineas "$1/.github/workflows/ci.yml" 'run-prod-probe\.sh test'; }
m_probe_test() { rm -f "$1/scripts/skydropx/prod-probe.test.ts"; }
# --- (G) la llave del doble (§19.31.5/.11; el contrato lo llama «candado (E)») -------
FK='SHIPPING_FAKE_''PURCHASE'
AD='SHIPPING_PROVIDER_ADAPTER'
m_g_wf()       { insertar_tras "$1/.github/workflows/e2e-real.yml" 'runs-on: ubuntu-latest' "    env: { ${FK}: '${SI}' }"; }
m_g_stg_real() { sed -E "s/${AD}: fake/${AD}: skydropx/" "$1/docker-compose.staging.yml" > "$1/x" && mv "$1/x" "$1/docker-compose.staging.yml"; }
m_g_dev_true() { sed -E "s/${FK}: \\\$\{${FK}:-\}/${FK}: \"${SI}\"/" "$1/docker-compose.yml" > "$1/x" && mv "$1/x" "$1/docker-compose.yml"; }
m_g_dev_dflt() { sed -E "s/${FK}: \\\$\{${FK}:-\}/${FK}: \\\$\{${FK}:-${SI}\}/" "$1/docker-compose.yml" > "$1/x" && mv "$1/x" "$1/docker-compose.yml"; }
m_g_front()    { # tras el NODE_ENV del servicio frontend (el primero es el de backend)
  awk -v linea="      ${FK}: \"${SI}\"" '{print} /^  frontend:/{f=1} f && !hecho && /^[[:space:]]+NODE_ENV:/ {print linea; hecho=1}' \
    "$1/docker-compose.staging.yml" > "$1/x" && mv "$1/x" "$1/docker-compose.staging.yml"; }
m_g_env_true() { sed -E "s/^${FK}=.*/${FK}=${SI}/" "$1/.env.example" > "$1/x" && mv "$1/x" "$1/.env.example"; }
m_g_env_gone() { quitar_lineas "$1/.env.example" "^${FK}="; }
m_g_env_dup()  { printf '%s=\n' "$FK" >> "$1/.env.example"; }
m_g_scr_real() { # fija `fake`… y luego lo pisa: la línea buena no tapa la mala
  printf '#!/usr/bin/env bash\nexport %s=fake\nexport %s=%s\nexport %s=skydropx\n' "$AD" "$FK" "$SI" "$AD" > "$1/scripts/compra-demo.sh"; }
m_g_scr_bare() { printf '#!/usr/bin/env bash\n%s=%s node dist/main.js\n' "$FK" "$SI" > "$1/scripts/compra-demo.sh"; }
m_g_root_json(){ printf '{ "deploy": { "env": { "%s": "%s" } } }\n' "$FK" "$SI" > "$1/railway.json"; }
m_g_nat_intp() { sed -E "s/^export ${AD}=fake\$/export ${AD}=\\\$\{${AD}:-fake\}/" "$1/scripts/stack-native.sh" > "$1/x" && mv "$1/x" "$1/scripts/stack-native.sh"; }
m_g_stg_off()  { quitar_lineas "$1/docker-compose.staging.yml" "^[[:space:]]+${FK}:"; }
m_g_nat_off()  { quitar_lineas "$1/scripts/stack-native.sh" "^export ${FK}="; }

printf '\n\033[1m== ¿El candado de PS-99 (d) se pone ROJO cuando toca? ==\033[0m\n\n'

# Línea base: el prístino tiene que dar VERDE.
SAL="$(correr "$PRISTINO")"; RC=$?
if [ "$RC" -eq 0 ]; then
  ok "Prístino — VERDE (los rojos de abajo los causa la mutación, no el árbol)."
else
  bad "Prístino — ROJO sin mutar nada: el canario no puede distinguir nada."
  note "$(grep '✗' <<< "$SAL" | head -5)"
  exit 1
fi

caso "(A) un workflow lee la credencial de secrets.*"              "reparte las llaves"       m_wf_secret
caso "(A) un workflow lee vars.skydropx_* (minúsculas)"           "reparte las llaves"       m_wf_vars
caso "(A) un workflow pone la llave de gasto en env:"             "reparte las llaves"       m_wf_spend
caso "(A) un workflow escribe la llave en GITHUB_ENV"             "reparte las llaves"       m_wf_ghenv
caso "(B) el compose E2E define la llave con valor"               "pasa las llaves"          m_cmp_spend
caso "(B) el compose dev la pasa de largo con \${…:-}"            "pasa las llaves"          m_cmp_pass
caso "(B) el compose E2E pasa la credencial"                      "pasa las llaves"          m_cmp_secret
caso "(B) un compose usa env_file:"                               "env_file"                 m_cmp_envf
caso "(C) .env.example con la llave =true"                        "CON VALOR"                m_env_true
caso "(C) .env.example con la llave entre comillas y comentario"  "CON VALOR"                m_env_quoted
caso "(C) .env.example sin la línea de la llave"                  "no trae"                  m_env_gone
caso "(C) .env.example con la llave repetida"                     "veces"                    m_env_dup
caso "(C) .env.example con la credencial con valor"               "CON VALOR"                m_env_secret
caso "(D) la pila E2E con el adaptador real"                      "no fija"                  m_stg_real
caso "(D) la pila E2E con el adaptador encendible desde fuera"    "no fija"                  m_stg_interp
caso "(D) el arnés nativo sin el doble"                           "no exporta"               m_nat_export
caso "(D) el arnés nativo hereda la llave"                        "unset"                    m_nat_unset
caso "(E) el CI genera una credencial de Skydropx"                "catálogo"                 m_catalogo
caso "(F) un workflow lanza la sonda contra la red"               "ejecuta la sonda"         m_wf_probe
caso "(F) ningún workflow corre la prueba de la sonda"            "Ningún workflow corre"    m_wf_notest
caso "(F) la sonda sin su prueba"                                 "Falta"                    m_probe_test
caso "(G) un workflow pone la llave del doble"                    "Un workflow nombra"       m_g_wf
caso "(G) la pila E2E con la llave del doble y adaptador real"     "sin SHIPPING_PROVIDER_ADAPTER: fake literal" m_g_stg_real
caso "(G) el compose dev gira la llave del doble (adaptador \${…})" "sin SHIPPING_PROVIDER_ADAPTER: fake literal" m_g_dev_true
caso "(G) el compose dev con respaldo \${…:-true}"                 "sin SHIPPING_PROVIDER_ADAPTER: fake literal" m_g_dev_dflt
caso "(G) la llave en un servicio sin el doble (frontend)"         "servicio «frontend»"      m_g_front
caso "(G) .env.example con la llave del doble =true"               "PURCHASE\` CON VALOR"     m_g_env_true
caso "(G) .env.example sin la línea de la llave del doble"         "PURCHASE=\`: la plantilla" m_g_env_gone
caso "(G) .env.example con la llave del doble repetida"            "PURCHASE=\` 2 veces"      m_g_env_dup
caso "(G) un script fija fake y luego lo pisa con el real"        "otra cosa"                m_g_scr_real
caso "(G) un script la pone sin fijar el adaptador"                "sin fijar"                m_g_scr_bare
caso "(G) una config de despliegue de la raíz la pone"             "railway.json: pone"       m_g_root_json
caso "(G) el arnés nativo con el adaptador encendible desde fuera" "otra cosa"                m_g_nat_intp
caso "(G) la pila E2E sin girar la llave del doble"                "no gira"                  m_g_stg_off
caso "(G) el arnés nativo sin girar la llave del doble"            "no exporta SHIPPING_FAKE_PURCHASE=true" m_g_nat_off

TOTAL=$((PASADAS+FALLOS))
echo
if [ "$FALLOS" -eq 0 ]; then
  printf '\033[1;32m✓ Canario: %d/%d (prístino VERDE + %d mutaciones en ROJO nombrando su bloque).\033[0m\n' "$PASADAS" "$TOTAL" "$((TOTAL-1))"
  exit 0
fi
printf '\033[1;31m✗ Canario: %d/%d. El candado NO muerde donde dice morder.\033[0m\n' "$PASADAS" "$TOTAL"
exit 1

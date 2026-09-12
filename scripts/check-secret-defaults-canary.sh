#!/usr/bin/env bash
#
# check-secret-defaults-canary.sh — «¿el candado de la CLASE muerde con secretos
# que no conoce?»                                                      · devops
# =============================================================================
# POR QUÉ ESTE CANARIO ES DISTINTO DEL DE P-WH-1
# ---------------------------------------------------------------------------
# El canario hermano (`check-stripe-webhook-failclosed-canary.sh`) prueba 31
# variantes… de UN secreto: `STRIPE_WEBHOOK_SECRET`. Seguridad midió su límite y
# la medición es la que da sentido a este fichero:
#
#     ► «tu canario prueba 31 variantes de un secreto; NO ve los otros siete.»
#     ► «la cirugía fue a una variable, no a la clase.»
#
# Un canario que solo conoce el caso que ya se arregló no protege de nada nuevo.
# Así que este canario tiene una regla propia, y es la razón entera de que exista:
#
#     ★ TODAS las mutaciones usan nombres de secreto que NO EXISTEN EN ESTE REPO.
#       Ni uno solo de los ocho conocidos. Si el candado se pone rojo con
#       `HSM_UNSEAL_KEY` —que nadie ha escrito nunca aquí— entonces está mirando
#       la FORMA, no una lista; y el octavo secreto que alguien añada mañana
#       nacerá rojo sin que nadie toque nada.
#
# Los nombres inventados que se plantan (comprobado con `grep -r`: ninguno aparece
# en el árbol antes de esta corrida):
#     HSM_UNSEAL_KEY   VAULT_ROOT_TOKEN   SENDGRID_API_KEY   PAYOUT_SIGNING_SECRET
#     KYC_PROVIDER_PASSWORD   LEDGER_HMAC   TWILIO_AUTH_TOKEN   DB_REPLICA_PASSWORD
#     SMTP_RELAY_PASS  VAULT_ADMIN_PIN  MASTER_PEPPER  SESSION_SEED  RECOVERY_CODE  CLABE_CIPHER
#     (los seis últimos: S-CLASE-1, sufijos que la forma vieja no reconocía)
#
# QUÉ SE COMPRUEBA
#   Bloques A–F: el candado estático, sobre una COPIA del árbol, mutada.
#   Bloque G: el preflight en RUNTIME, con valores publicados que no son ninguno
#             de los ocho (incluido el punto ciego exacto que midió seguridad).
#   Verdes: el candado tiene que DEJAR PASAR lo legítimo. Uno que siempre cierra
#           tampoco es un candado, y uno que se pone rojo al documentar el bug
#           hace que la gente deje de documentarlo.
#
# Uso:  ./scripts/check-secret-defaults-canary.sh
# Sale 0 si muerde donde debe. 1 con el caso exacto. Sin red, sin Docker, sin node.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE_REL="scripts/check-secret-defaults.sh"

FALLOS=0; PASADAS=0
ok()   { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; FALLOS=$((FALLOS+1)); }
nota() { printf '      %s\n' "$*"; }

printf '\n\033[1m== ¿El candado de la CLASE (S-88-1) muerde con secretos que no conoce? ==\033[0m\n\n'

[ -f "$ROOT_DIR/$GATE_REL" ] || { bad "No existe $GATE_REL. El candado desapareció: eso ya es el rojo."; exit 1; }

# --- Los nombres inventados NO pueden existir ya en el árbol -----------------
# Si alguno existiera, el canario estaría probando un caso conocido y volvería a
# ser el canario de una variable. Se comprueba, no se supone.
INVENTADOS=(HSM_UNSEAL_KEY VAULT_ROOT_TOKEN SENDGRID_API_KEY PAYOUT_SIGNING_SECRET
            KYC_PROVIDER_PASSWORD LEDGER_HMAC TWILIO_AUTH_TOKEN DB_REPLICA_PASSWORD
            # S-CLASE-1 (seguridad, 2026-09-11): nombres FUERA de la forma vieja.
            SMTP_RELAY_PASS VAULT_ADMIN_PIN MASTER_PEPPER SESSION_SEED RECOVERY_CODE CLABE_CIPHER)
printf '\033[1mPrecondición — los nombres del canario son DESCONOCIDOS para el repo\033[0m\n'
# Se busca SOLO donde el candado mira (config y código), no en `docs/`. Documentar
# el canario —§50.5 nombra estos ocho— no puede romperlo: es la misma trampa que ya
# tiene su control en verde («documentar el bug no pone rojo el candado»), y se
# cazó porque este canario se puso rojo al escribirse la nota que lo explica.
YA=0
for nombre in "${INVENTADOS[@]}"; do
  # `^[^#]*` = el nombre aparece en CÓDIGO, no en un comentario. Sin esto, la nota
  # que explica de dónde salen estos ocho nombres —dentro de `gen-…-manifest.sh`—
  # bastaba para poner rojo el canario. Es la tercera vez hoy que explicar el bug
  # rompe el candado del bug: se comprueba lo que EJECUTA, no lo que se lee.
  if grep -rqIE --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs \
       --exclude='*.md' --exclude="$(basename "${BASH_SOURCE[0]}")" \
       "^[^#]*$nombre" "$ROOT_DIR" 2>/dev/null; then
    bad "\`$nombre\` YA aparece en la CONFIG o el CÓDIGO del árbol: el canario dejaría de probar «un secreto nuevo»."
    nota "Elige otro nombre inventado. (En docs/ sí puede aparecer: ahí no hay secretos que cerrar.)"
    YA=$((YA+1))
  fi
done
[ "$YA" -eq 0 ] && ok "Los ${#INVENTADOS[@]} nombres del canario no existen en la config ni el código del repo."

# --- Copia real del árbol ----------------------------------------------------
BASE="$(mktemp -d -t s881-canario-XXXXXX)"
trap 'rm -rf "$BASE"' EXIT
PRISTINO="$BASE/pristino"

COPIAR=(
  "$GATE_REL"
  "scripts/gen-published-secrets-manifest.sh"
  "scripts/secrets-preflight.sh"
  "scripts/webhook-secret-preflight.sh"
  "security/secretos-publicados.sha256"
  "security/secretos-retirados.sha256"
  "docker-compose.yml"
  "docker-compose.staging.yml"
  ".github/workflows/ci.yml"
  ".github/workflows/e2e-real.yml"
  "scripts/dev-up.sh"
  "security/scripts/dast-ephemeral.sh"
  ".env.example"
  "Dockerfile.backend"
)
mkdir -p "$PRISTINO"
for rel in "${COPIAR[@]}"; do
  if [ ! -f "$ROOT_DIR/$rel" ]; then
    bad "Falta $rel en el árbol real: el canario no puede probar lo que dice probar."
    exit 1
  fi
  mkdir -p "$PRISTINO/$(dirname "$rel")"
  cp "$ROOT_DIR/$rel" "$PRISTINO/$rel"
done
# Un fichero de otro dueño, para poder ejercitar el bloque F (inventario).
mkdir -p "$PRISTINO/backend/test" "$PRISTINO/frontend/e2e"
printf '%s\n' "export const x = 1;" > "$PRISTINO/backend/test/dummy.ts"
printf '%s\n' "export const y = 1;" > "$PRISTINO/frontend/e2e/dummy.ts"
chmod +x "$PRISTINO/$GATE_REL" "$PRISTINO/scripts/gen-published-secrets-manifest.sh"

# La copia es un subconjunto del árbol real, así que su manifiesto correcto NO es
# el del repo: se regenera una vez sobre la copia. Sin esto, el control «árbol
# íntegro» saldría rojo por un artefacto del canario y no por el candado — un
# falso rojo que enseña a ignorar al canario.
(cd "$PRISTINO" && bash scripts/gen-published-secrets-manifest.sh >/dev/null 2>&1)

correr() { bash "$1/$GATE_REL" --root "$1" 2>&1; }

# `caso ROJO|VERDE <nombre> <debe-nombrar|-> <mutador>`
caso() {
  local esperado="$1" nombre="$2" debe="$3" mutador="$4"
  local dir="$BASE/caso$((PASADAS+FALLOS+1))"
  rm -rf "$dir"; cp -a "$PRISTINO" "$dir"
  "$mutador" "$dir"
  local salida rc
  salida="$(correr "$dir")"; rc=$?
  if [ "$esperado" = "ROJO" ]; then
    if [ "$rc" -eq 0 ]; then
      bad "$nombre — el candado se quedó VERDE (rc=0)."
      nota "Un secreto NUEVO acaba de nacer con el defecto y nadie se enteró: es S-88-1 otra vez."
      return
    fi
    if [ "$debe" != "-" ] && ! grep -qF "$debe" <<< "$salida"; then
      bad "$nombre — rojo, pero NO nombra \`$debe\`: se puso rojo por otra cosa."
      nota "$(grep -E '✗' <<< "$salida" | head -3)"
      return
    fi
    ok "$nombre — ROJO, y señala $debe."
  else
    if [ "$rc" -ne 0 ]; then
      bad "$nombre — ROJO sobre algo legítimo (rc=$rc). Falso positivo."
      nota "$(grep -E '✗' <<< "$salida" | head -3)"
      return
    fi
    ok "$nombre — VERDE, como debe."
  fi
}

# `regenerar <dir>` — deja el manifiesto del árbol mutado al día, para que el
# bloque (E) no enmascare el caso que se está probando.
regenerar() { (cd "$1" && bash scripts/gen-published-secrets-manifest.sh >/dev/null 2>&1); }

# =============================================================================
# MUTACIONES — todas con secretos que este repo NUNCA ha tenido
# =============================================================================
m_compose_secreto_nuevo() {   # ★ EL CASO CENTRAL: el octavo secreto de mañana
  sed -i 's|^      NODE_ENV: .*|      HSM_UNSEAL_KEY: ${HSM_UNSEAL_KEY:-unseal_2f9c_prod_2026}\n&|' \
    "$1/docker-compose.staging.yml"
  regenerar "$1"
}
m_compose_local_secreto_nuevo() {
  sed -i 's|^      REDIS_URL: .*|      VAULT_ROOT_TOKEN: ${VAULT_ROOT_TOKEN:-hvs.CAESIJmockrootoken}\n&|' \
    "$1/docker-compose.yml"
  regenerar "$1"
}
m_compose_literal_pelado() {
  sed -i 's|^      NODE_ENV: .*|      PAYOUT_SIGNING_SECRET: firma_de_pagos_2026\n&|' \
    "$1/docker-compose.staging.yml"
  regenerar "$1"
}
m_workflow_literal_nuevo() {
  printf '      %s\n' "SENDGRID_API_KEY: SG.abcdefghij0123456789" >> "$1/.github/workflows/ci.yml"
  regenerar "$1"
}
m_workflow_respaldo_nuevo() {  # `${{ secrets.X || 'literal' }}` con nombre nuevo
  printf '      %s\n' "TWILIO_AUTH_TOKEN: \${{ secrets.TWILIO_AUTH_TOKEN || 'twilio_fallback_2026' }}" \
    >> "$1/.github/workflows/ci.yml"
  regenerar "$1"
}
m_script_export_nuevo() {
  printf '\n%s\n' 'export LEDGER_HMAC="clave_hmac_del_libro_mayor_2026"' \
    >> "$1/scripts/secrets-preflight.sh"
  # `secrets-preflight.sh` es autorreferente para el candado: se planta en otro.
  mkdir -p "$1/scripts"
  printf '%s\n' '#!/bin/sh' 'export LEDGER_HMAC="clave_hmac_del_libro_mayor_2026"' \
    > "$1/scripts/arnes-nuevo.sh"
  regenerar "$1"
}
m_script_default_nuevo() {
  mkdir -p "$1/scripts"
  printf '%s\n' '#!/bin/sh' \
    'KYC_PROVIDER_PASSWORD="${KYC_PROVIDER_PASSWORD:-kyc_proveedor_2026}"' \
    > "$1/scripts/arnes-nuevo.sh"
  regenerar "$1"
}
m_url_con_credencial() {       # el punto ciego de mirar NOMBRES
  mkdir -p "$1/scripts"
  printf '%s\n' '#!/bin/sh' \
    'REPLICA_URL="postgresql://lector:DbReplica2026@replica.interno:5432/tcg"' \
    > "$1/scripts/arnes-nuevo.sh"
  regenerar "$1"
}
m_envexample_valor_usable() {
  printf '\n%s\n' 'DB_REPLICA_PASSWORD=DbReplica2026' >> "$1/.env.example"
  regenerar "$1"
}
m_manifiesto_desfasado() {     # se añade un literal y NO se regenera
  printf '\n%s\n' 'SENDGRID_API_KEY=SG.zzzzzzzzzz9876543210' >> "$1/.env.example"
  # a propósito: sin `regenerar`
}
m_manifiesto_borrado() {
  rm -f "$1/security/secretos-publicados.sha256"
}
m_ajeno_no_neutralizado() {    # bloque F: literal de otro dueño fuera del manifiesto
  printf '%s\n' "export const t = process.env.PAYOUT_SIGNING_SECRET || 'firma_pagos_no_registrada';" \
    > "$1/backend/test/dummy.ts"
  # sin regenerar: el valor NO está en el manifiesto ⇒ no está neutralizado
}
m_forma_secreto_amputada() {   # alguien «arregla» el candado vaciándole la forma
  sed -i "s/^FORMA_SECRETO='.*'$/FORMA_SECRETO='(NOMBRE_QUE_NO_EXISTE)'/" \
    "$1/scripts/gen-published-secrets-manifest.sh"
  sed -i 's|^      NODE_ENV: .*|      HSM_UNSEAL_KEY: ${HSM_UNSEAL_KEY:-unseal_2f9c_prod_2026}\n&|' \
    "$1/docker-compose.staging.yml"
  regenerar "$1"
}

# --- Controles en VERDE ------------------------------------------------------
m_nada() { : ; }
m_vacio_declarado() {          # incapacitación deliberada: legítima
  sed -i 's|^      NODE_ENV: .*|      HSM_UNSEAL_KEY: ${HSM_UNSEAL_KEY:-}\n&|' \
    "$1/docker-compose.staging.yml"
  regenerar "$1"
}
m_forma_obligatoria() {        # `:?`: la forma correcta
  sed -i 's|^      NODE_ENV: .*|      HSM_UNSEAL_KEY: ${HSM_UNSEAL_KEY:?falta HSM_UNSEAL_KEY}\n&|' \
    "$1/docker-compose.staging.yml"
  regenerar "$1"
}
m_no_es_secreto() {            # nombres que suenan pero no lo son
  sed -i 's|^      NODE_ENV: .*|      HSM_KEY_ROTATED_AT: 2026-09-10\n      MIN_JWT_SECRET_LENGTH: 32\n&|' \
    "$1/docker-compose.staging.yml"
  regenerar "$1"
}
m_publicable() {               # una clave PÚBLICA por definición
  sed -i 's|^      NODE_ENV: .*|      NEXT_PUBLIC_MAPS_API_KEY: ${NEXT_PUBLIC_MAPS_API_KEY:-AIzaSyPublicaPorDefinicion}\n&|' \
    "$1/docker-compose.staging.yml"
  regenerar "$1"
}
m_documentar_el_bug() {        # citar el bug en un comentario NO puede poner rojo
  {
    printf '%s\n' '# S-88-1: aquí decía `HSM_UNSEAL_KEY: ${HSM_UNSEAL_KEY:-unseal_2f9c_prod_2026}`,'
    printf '%s\n' '# un literal en un repo público. NO volver a esa forma.'
  } >> "$1/docker-compose.staging.yml"
  regenerar "$1"
}
m_ajeno_neutralizado() {       # literal ajeno, pero registrado en el manifiesto
  printf '%s\n' "export const t = process.env.PAYOUT_SIGNING_SECRET || 'firma_pagos_registrada';" \
    > "$1/backend/test/dummy.ts"
  regenerar "$1"
}

printf '\n\033[1m★ Bloque A — un secreto NUEVO (nunca visto en este repo) en un compose\033[0m\n'
caso ROJO  "HSM_UNSEAL_KEY con \`:-literal\` en staging"      "HSM_UNSEAL_KEY"        m_compose_secreto_nuevo
caso ROJO  "VAULT_ROOT_TOKEN con \`:-literal\` en local"      "VAULT_ROOT_TOKEN"      m_compose_local_secreto_nuevo
caso ROJO  "PAYOUT_SIGNING_SECRET escrito a pelo"            "PAYOUT_SIGNING_SECRET" m_compose_literal_pelado

printf '\n\033[1mBloque B — workflows, con nombres nuevos\033[0m\n'
caso ROJO  "SENDGRID_API_KEY literal en un workflow"         "SENDGRID_API_KEY"      m_workflow_literal_nuevo
caso ROJO  "TWILIO_AUTH_TOKEN con respaldo \`|| '…'\`"        "TWILIO_AUTH_TOKEN"     m_workflow_respaldo_nuevo

printf '\n\033[1mBloque C — scripts, con nombres nuevos\033[0m\n'
caso ROJO  "LEDGER_HMAC exportado con literal"               "LEDGER_HMAC"           m_script_export_nuevo
caso ROJO  "KYC_PROVIDER_PASSWORD con \`:-literal\`"          "KYC_PROVIDER_PASSWORD" m_script_default_nuevo
caso ROJO  "URL con credencial (nombre que NO suena)"        "arnes-nuevo.sh"        m_url_con_credencial

printf '\n\033[1mBloque D — la plantilla\033[0m\n'
caso ROJO  "DB_REPLICA_PASSWORD usable en .env.example"      "DB_REPLICA_PASSWORD"   m_envexample_valor_usable

printf '\n\033[1mBloque E — el lado del VALOR\033[0m\n'
caso ROJO  "literal nuevo sin regenerar el manifiesto"       "DESFASADO"             m_manifiesto_desfasado
caso ROJO  "el manifiesto desaparece"                        "-"                     m_manifiesto_borrado
caso ROJO  "alguien amputa FORMA_SECRETO para callar el rojo" "-"                    m_forma_secreto_amputada

printf '\n\033[1mBloque F — literales de otros dueños\033[0m\n'
caso ROJO  "literal ajeno NO neutralizado por el manifiesto" "PAYOUT_SIGNING_SECRET" m_ajeno_no_neutralizado
caso VERDE "literal ajeno SÍ neutralizado (se inventaría)"   "-"                     m_ajeno_neutralizado

# =============================================================================
# ★ BLOQUE G — EL CASO QUE SE NOS ESCAPÓ
# =============================================================================
# Este canario daba 31/31 en verde mientras el gate de dinero no podía arrancar
# (`e2e-real.yml`, run 34498068945). El motivo es exactamente el que hay que dejar
# probado aquí: **el candado comprobaba la forma del CÓDIGO, no que el sistema
# siguiera pudiendo levantar**. Hacer `fail-closed` el compose obliga a que cada
# consumidor resuelva antes; si uno se queda sin resolver, muere en la
# interpolación — y ningún bloque estático de forma lo veía.
m_consumidor_sin_resolver() {   # ★ el caso del run rojo
  sed -i '/preflight\.sh/d' "$1/.github/workflows/e2e-real.yml"
  regenerar "$1"
}
m_consumidor_local_sin_resolver() {
  sed -i '/preflight\.sh/d' "$1/security/scripts/dast-ephemeral.sh"
  regenerar "$1"
}
m_consumidor_nuevo_sin_resolver() {  # un consumidor que alguien añade mañana
  mkdir -p "$1/scripts"
  printf '%s\n' '#!/usr/bin/env bash' \
    'docker compose -f docker-compose.staging.yml --profile apps up -d --build' \
    > "$1/scripts/levantar-nuevo.sh"
  regenerar "$1"
}
m_compose_sin_exigencias() {    # se revierte el arreglo: el bloque pierde su blanco
  sed -i 's/:?[^}]*}/:-}/g' "$1/docker-compose.staging.yml"
  sed -i 's/:?[^}]*}/:-}/g' "$1/docker-compose.yml"
  regenerar "$1"
}

printf '\n\033[1m★ Bloque G — el sistema tiene que poder LEVANTAR (el caso del run 34498068945)\033[0m\n'
caso ROJO  "e2e-real deja de resolver antes del \`up\`"       "e2e-real.yml"      m_consumidor_sin_resolver
caso ROJO  "la ruta local del DAST deja de resolver"         "dast-ephemeral.sh" m_consumidor_local_sin_resolver
caso ROJO  "un consumidor NUEVO que no resuelve"             "levantar-nuevo.sh" m_consumidor_nuevo_sin_resolver
caso ROJO  "se revierte el \`:?\` (el bloque sin blanco)"     "-"                m_compose_sin_exigencias

# =============================================================================
# ★ BLOQUE S-CLASE-1 — LOS 7 CASOS QUE SEGURIDAD MIDIÓ ESCAPANDO (2026-09-11)
# =============================================================================
# «19 mutaciones: muerde 3, escapan 16». El candado cubría UNA grafía del
# default (`:-`), una forma de asignación (`export`) y una lista de sufijos.
# Estos casos son literalmente los suyos, con nombres que el repo no ha tenido.
m_default_un_guion() {          # 1. `${VAR-lit}`: un solo guion, sin `:` (Compose lo soporta)
  sed -i 's|^      NODE_ENV: .*|      HSM_UNSEAL_KEY: ${HSM_UNSEAL_KEY-unseal_un_guion_2026}\n&|' "$1/docker-compose.staging.yml"
  regenerar "$1"
}
m_default_asigna() {            # 2. `${VAR:=lit}`: asignar-por-defecto
  sed -i 's|^      NODE_ENV: .*|      HSM_UNSEAL_KEY: ${HSM_UNSEAL_KEY:=unseal_asigna_2026}\n&|' "$1/docker-compose.staging.yml"
  regenerar "$1"
}
m_script_colon_asigna() {       # 3. `: "${VAR:=lit}"` en un .sh
  mkdir -p "$1/scripts"
  printf '%s\n' '#!/bin/sh' ': "${KYC_PROVIDER_PASSWORD:=kyc_asigna_2026}"' > "$1/scripts/arnes-nuevo.sh"
  regenerar "$1"
}
m_nombre_pass() {               # 4a. `SMTP_RELAY_PASS` (sufijo _PASS)
  sed -i 's|^      NODE_ENV: .*|      SMTP_RELAY_PASS: ${SMTP_RELAY_PASS:-relay_2026_secreto}\n&|' "$1/docker-compose.staging.yml"
  regenerar "$1"
}
m_nombre_pin() {                # 4b. `VAULT_ADMIN_PIN` escrito a pelo en compose
  sed -i 's|^      NODE_ENV: .*|      VAULT_ADMIN_PIN: 482913\n&|' "$1/docker-compose.yml"
  regenerar "$1"
}
m_nombre_pepper() {             # 4c. `MASTER_PEPPER` con default en script
  mkdir -p "$1/scripts"
  printf '%s\n' '#!/bin/sh' 'MASTER_PEPPER="${MASTER_PEPPER:-pepper_maestro_2026}"' > "$1/scripts/arnes-nuevo.sh"
  regenerar "$1"
}
m_nombre_salt() {               # 4c-bis. `MASTER_SALT` — el término que se ANCLÓ
  # 2026-09-11: `FORMA_SECRETO` llevaba `SALT` SIN anclar y marcaba como secreto
  # cualquier palabra española que lo contuviera («SALTADA», «SALTADOS»). Se
  # ancló a `SALT(_|$)`. Este caso existe para que ese estrechamiento NO pueda
  # convertirse en un agujero sin que algo se ponga rojo: una sal de verdad
  # sigue teniendo que cazarse.
  mkdir -p "$1/scripts"
  printf '%s\n' '#!/bin/sh' 'MASTER_SALT="${MASTER_SALT:-sal_maestra_2026}"' > "$1/scripts/arnes-nuevo.sh"
  regenerar "$1"
}
m_espanol_saltada() {           # VERDE. Español que CONTIENE «SALT» y no es una sal
  mkdir -p "$1/scripts"
  printf '%s\n' '#!/bin/sh' 'N_VERIF_SALTADA=3' 'PASOS_SALTADOS=7' > "$1/scripts/arnes-nuevo.sh"
  regenerar "$1"
}
m_prefijo_resend_real() {       # 4c-quater. Clave Resend REAL: el ancla no la afloja
  # 2026-09-12: `PREFIJOS_RE` llevaba `re_` SIN anclar y capturaba trozos de
  # identificador (`nomb`+`re_producto`, `requi`+`re_real_stripe`). Se ancló con
  # `\b`. Este caso existe para que el ancla no pueda convertirse en un agujero:
  # una clave de Resend de verdad —que siempre va tras comilla, `=` o espacio—
  # tiene que seguir capturándose.
  mkdir -p "$1/scripts"
  printf '%s\n' '#!/bin/sh' 'export RESEND_API_KEY=re_AbCd123456XyZ' > "$1/scripts/arnes-nuevo.sh"
  regenerar "$1"
}
m_prefijo_dentro_de_palabra() { # VERDE. `re_` DENTRO de un identificador no es una clave
  mkdir -p "$1/scripts"
  printf '%s\n' '#!/bin/sh' 'nombre_producto=x' 'require_real_stripe=y' 'ensure_wiring=z' > "$1/scripts/arnes-nuevo.sh"
  regenerar "$1"
}
m_nombre_seed() {               # 4d. `SESSION_SEED` exportado en script
  mkdir -p "$1/scripts"
  printf '%s\n' '#!/bin/sh' 'export SESSION_SEED="semilla_de_sesion_2026"' > "$1/scripts/arnes-nuevo.sh"
  regenerar "$1"
}
m_nombre_code() {               # 4e. `RECOVERY_CODE` usable en .env.example
  printf '\n%s\n' 'RECOVERY_CODE=7731-9902-4410' >> "$1/.env.example"
  regenerar "$1"
}
m_nombre_cipher() {             # 4f. `CLABE_CIPHER` con respaldo `|| '…'` en un workflow
  printf '      %s\n' "CLABE_CIPHER: \${{ secrets.CLABE_CIPHER || 'clabe_cifra_2026' }}" >> "$1/.github/workflows/ci.yml"
  regenerar "$1"
}
m_env_staging_versionado() {    # 5. `.env.staging` versionado con un secreto
  printf '%s\n' 'NODE_ENV=production' 'HSM_UNSEAL_KEY=unseal_env_staging_2026' > "$1/.env.staging"
  regenerar "$1"
}
m_dockerfile_fabrica_env() {    # 6. `RUN echo "VAR=lit" >> /app/.env` en el Dockerfile
  printf '%s\n' 'RUN echo "HSM_UNSEAL_KEY=unseal_desde_dockerfile_2026" >> /app/.env' >> "$1/Dockerfile.backend"
  regenerar "$1"
}
m_compose_lista() {             # 7. `environment:` en forma de LISTA
  sed -i 's|^      NODE_ENV: .*|      - HSM_UNSEAL_KEY=unseal_en_lista_2026\n&|' "$1/docker-compose.staging.yml"
  regenerar "$1"
}
m_asignacion_sin_export() {     # 8a. `LEDGER_HMAC=lit` sin `export`
  mkdir -p "$1/scripts"
  printf '%s\n' '#!/bin/sh' 'LEDGER_HMAC=hmac_sin_export_2026' 'echo "$LEDGER_HMAC"' > "$1/scripts/arnes-nuevo.sh"
  regenerar "$1"
}
m_declare_x() {                 # 8b. `declare -x VAR=lit`
  mkdir -p "$1/scripts"
  printf '%s\n' '#!/bin/bash' 'declare -x VAULT_ROOT_TOKEN=hvs.declarado_2026' > "$1/scripts/arnes-nuevo.sh"
  regenerar "$1"
}
# Controles en VERDE de esta familia: lo legítimo que las formas nuevas rozan.
m_default_un_guion_vacio() {    # `${VAR-}`: vacío declarado con un guion
  sed -i 's|^      NODE_ENV: .*|      HSM_UNSEAL_KEY: ${HSM_UNSEAL_KEY-}\n&|' "$1/docker-compose.staging.yml"
  regenerar "$1"
}
m_sufijos_no_secretos() {       # HTTP_CODE / DO_SEED / EXIT_CODE: suenan y no son
  mkdir -p "$1/scripts"
  printf '%s\n' '#!/bin/sh' 'HTTP_CODE=200' 'DO_SEED=1' 'EXIT_CODE=0' 'export COUNTRY_CODE=MX' > "$1/scripts/arnes-nuevo.sh"
  regenerar "$1"
}
m_array_y_referencia() {        # `KEYS=(…)` es un array; `echo "VAR=$X" >> .env` es una referencia
  mkdir -p "$1/scripts"
  printf '%s\n' '#!/bin/bash' 'PENDING_KEYS=(a b c)' 'echo "HSM_UNSEAL_KEY=$HSM_UNSEAL_KEY" >> .env' 'printf "LEDGER_HMAC=%s\n" "$V"' > "$1/scripts/arnes-nuevo.sh"
  regenerar "$1"
}
m_env_staging_placeholder() {   # un .env.* versionado SOLO con placeholders no es un secreto publicado
  printf '%s\n' 'HSM_UNSEAL_KEY=CHANGE_ME' > "$1/.env.staging"
  regenerar "$1"
}

printf '\n\033[1m★ Bloque S-CLASE-1 — las grafías y sufijos que escapaban (los 7 casos de seguridad)\033[0m\n'
caso ROJO  "1. \`\${HSM_UNSEAL_KEY-lit}\` (un guion, sin dos puntos)"      "HSM_UNSEAL_KEY"        m_default_un_guion
caso ROJO  "2. \`\${HSM_UNSEAL_KEY:=lit}\` (asignar-por-defecto)"         "HSM_UNSEAL_KEY"        m_default_asigna
caso ROJO  "3. \`: \"\${KYC_PROVIDER_PASSWORD:=lit}\"\` en un .sh"          "KYC_PROVIDER_PASSWORD" m_script_colon_asigna
caso ROJO  "4a. SMTP_RELAY_PASS (sufijo _PASS) con \`:-literal\`"          "SMTP_RELAY_PASS"       m_nombre_pass
caso ROJO  "4b. VAULT_ADMIN_PIN (sufijo _PIN) escrito a pelo"              "VAULT_ADMIN_PIN"       m_nombre_pin
caso ROJO  "4c. MASTER_PEPPER (PEPPER) con \`:-literal\` en script"        "MASTER_PEPPER"         m_nombre_pepper
caso ROJO  "4c-bis. MASTER_SALT (SALT anclado) sigue cazandose"            "MASTER_SALT"           m_nombre_salt
caso VERDE "4c-ter. Espanol con SALT (SALTADA/SALTADOS) NO es secreto"     ""                      m_espanol_saltada
caso ROJO  "4c-quater. Clave Resend real (re_ anclado) sigue cazandose"    "RESEND_API_KEY"        m_prefijo_resend_real
caso VERDE "4c-quinquies. re_ DENTRO de identificador NO es clave"         ""                      m_prefijo_dentro_de_palabra
caso ROJO  "4d. SESSION_SEED (sufijo _SEED) exportado con literal"         "SESSION_SEED"          m_nombre_seed
caso ROJO  "4e. RECOVERY_CODE (sufijo _CODE) usable en .env.example"       "RECOVERY_CODE"         m_nombre_code
caso ROJO  "4f. CLABE_CIPHER (CIPHER) con respaldo \`|| '…'\` en workflow"  "CLABE_CIPHER"          m_nombre_cipher
caso ROJO  "5. .env.staging VERSIONADO con HSM_UNSEAL_KEY=literal"         ".env.staging"          m_env_staging_versionado
caso ROJO  "6. Dockerfile: RUN echo \"HSM_UNSEAL_KEY=lit\" >> /app/.env"    "Dockerfile.backend"    m_dockerfile_fabrica_env
caso ROJO  "7. environment en forma de LISTA: - HSM_UNSEAL_KEY=lit"        "HSM_UNSEAL_KEY"        m_compose_lista
caso ROJO  "8a. LEDGER_HMAC=lit SIN export"                                "LEDGER_HMAC"           m_asignacion_sin_export
caso ROJO  "8b. declare -x VAULT_ROOT_TOKEN=lit"                           "VAULT_ROOT_TOKEN"      m_declare_x
caso VERDE "\`\${HSM_UNSEAL_KEY-}\` (vacío declarado, un guion)"            "-" m_default_un_guion_vacio
caso VERDE "HTTP_CODE / DO_SEED / EXIT_CODE / COUNTRY_CODE (suenan, no son)"  "-" m_sufijos_no_secretos
caso VERDE "array \`KEYS=(…)\`, \`echo \"VAR=\$X\"\` y \`printf VAR=%s\` (referencias)" "-" m_array_y_referencia
caso VERDE ".env.staging versionado SOLO con CHANGE_ME (no es un valor usable)" "-" m_env_staging_placeholder

printf '\n\033[1mControles en verde — el candado tiene que dejar pasar lo legítimo\033[0m\n'
caso VERDE "Árbol íntegro"                                   "-" m_nada
caso VERDE "\`\${HSM_UNSEAL_KEY:-}\` (vacío declarado)"        "-" m_vacio_declarado
caso VERDE "\`\${HSM_UNSEAL_KEY:?…}\` (forma obligatoria)"     "-" m_forma_obligatoria
caso VERDE "HSM_KEY_ROTATED_AT / MIN_JWT_SECRET_LENGTH"      "-" m_no_es_secreto
caso VERDE "NEXT_PUBLIC_MAPS_API_KEY (pública a propósito)"   "-" m_publicable
caso VERDE "documentar el bug en un comentario"              "-" m_documentar_el_bug

# =============================================================================
# BLOQUE G — el preflight EJERCITADO, con valores que no son de los ocho
# =============================================================================
# Los bloques anteriores son estáticos. La mitad que de verdad para el residual es
# de RUNTIME. Aquí se le ponen al preflight entornos concretos y se mira el color.
printf '\n\033[1mBloque G — el preflight en runtime (valores publicados, no de los ocho)\033[0m\n'
PRE="$ROOT_DIR/scripts/webhook-secret-preflight.sh"
SEC="$ROOT_DIR/scripts/secrets-preflight.sh"

limpio_env() {
  env -u STRIPE_SECRET_KEY -u STRIPE_TEST_SECRET_KEY -u STRIPE_WEBHOOK_SECRET \
      -u STRIPE_TEST_WEBHOOK_SECRET -u SECRETS_ENV -u RAILWAY_ENVIRONMENT "$@"
}

# G.1 — EL PUNTO CIEGO EXACTO QUE MIDIÓ SEGURIDAD.
# `whsec_e2e_test_secret` no contiene ninguna palabra de PATRONES_PUBLICOS: la
# heurística de nombres lo dejaba pasar junto a una `sk_live_`. El manifiesto lo
# rechaza por identidad.
if limpio_env STRIPE_SECRET_KEY=sk_live_51ClaveRealDelDueno \
              STRIPE_WEBHOOK_SECRET=whsec_e2e_test_secret \
              sh "$PRE" assert >/dev/null 2>&1; then
  bad "sk_live_ + \`whsec_e2e_test_secret\` — PASA. Es el punto ciego que midió seguridad, sin cerrar."
else
  ok "sk_live_ + \`whsec_e2e_test_secret\` (publicado, sin palabra sospechosa) — ABORTA."
fi

# G.2 — el mismo caso con un valor publicado que NO tiene prefijo `whsec_`.
if limpio_env STRIPE_SECRET_KEY=sk_live_51ClaveRealDelDueno \
              STRIPE_WEBHOOK_SECRET=e2e_access_secret \
              sh "$PRE" assert >/dev/null 2>&1; then
  bad "sk_live_ + un literal publicado del repo (sin prefijo) — PASA."
else
  ok "sk_live_ + otro literal publicado del repo — ABORTA."
fi

# G.3 — un secreto PROPIO tiene que poder pasar. Un candado que siempre cierra no
# es un candado: es una avería.
if limpio_env STRIPE_SECRET_KEY=sk_live_51ClaveRealDelDueno \
              STRIPE_WEBHOOK_SECRET=whsec_9f2b7c1d4e5a6b8c9d0e1f2a3b4c \
              sh "$PRE" assert >/dev/null 2>&1; then
  ok "sk_live_ + secreto PROPIO (no publicado) — deja arrancar."
else
  bad "sk_live_ + secreto propio — abortó. El candado cierra siempre: inservible."
fi

# G.4 — un valor JUBILADO (salió del árbol) sigue rechazándose. En un repo público
# lo que se borra sigue en el historial: «ya no está en el fichero» no es «ya no
# lo tiene nadie».
RETIRADO="$(grep -m1 '^[0-9a-f]' "$ROOT_DIR/security/secretos-retirados.sha256" 2>/dev/null | cut -d' ' -f1)"
if [ -n "${RETIRADO:-}" ]; then
  if grep -q "^$RETIRADO  " "$ROOT_DIR/security/secretos-publicados.sha256"; then
    ok "Un valor JUBILADO del árbol sigue en el manifiesto (se borró del código, no del mundo)."
  else
    bad "Un valor jubilado desapareció del manifiesto: al limpiar el código se debilitó el rechazo."
  fi
else
  ok "Todavía no hay valores jubilados (nada ha salido del árbol)."
fi

# G.5 — el resolutor de la clase: sin entorno real GENERA; con entorno real y sin
# valor propio, ABORTA. Un secreto INVENTADO, para probar que no depende de listas.
if limpio_env SECRETS_ENV=real sh "$SEC" resolve HSM_UNSEAL_KEY >/dev/null 2>&1; then
  bad "Entorno REAL y sin HSM_UNSEAL_KEY — el resolutor se inventó un valor en vez de abortar."
else
  ok "Entorno REAL + secreto NUEVO ausente — ABORTA (no se inventa nada en producción)."
fi

V1="$(limpio_env SECRETS_ENV=local sh "$SEC" resolve HSM_UNSEAL_KEY 2>/dev/null)"
V2="$(limpio_env SECRETS_ENV=local sh "$SEC" resolve HSM_UNSEAL_KEY 2>/dev/null)"
if [ -n "$V1" ] && [ "$V1" != "$V2" ]; then
  ok "Entorno desechable + secreto NUEVO — genera uno DISTINTO cada vez (nadie puede firmar contra él)."
else
  bad "El valor generado se repite: vuelve a ser adivinable."
fi

if limpio_env SECRETS_ENV=real HSM_UNSEAL_KEY=whsec_e2e_test_secret \
              sh "$SEC" resolve HSM_UNSEAL_KEY >/dev/null 2>&1; then
  bad "Entorno REAL + un secreto NUEVO con valor PUBLICADO — pasa."
else
  ok "Entorno REAL + secreto NUEVO cuyo valor está publicado — ABORTA (identidad, no heurística)."
fi

# =============================================================================
# ★★ BLOQUE H — EL PASO COMPLETO DEL GATE DE DINERO, EXTRAÍDO DEL WORKFLOW
# =============================================================================
# DE DÓNDE VIENE, y es la lección más cara del pase:
#
#   Medí `webhook-secret-preflight.sh` «en tres direcciones» y reporté que en CI
#   resolvía. El paso real tiene CUATRO comandos y yo había probado DOS. El cuarto
#   —`secrets-preflight.sh github-env`, que añadí en este mismo pase— abortaba,
#   porque `es_desechable` preguntaba `hay_stripe_real` y el gate de dinero SÍ
#   tiene clave de Stripe real. Run `34512132641`: paso 3 en FAILURE, 10 s, los
#   tres flujos de dinero sin correr.
#
#   Mi medición estaba en verde y el sistema no arrancaba. Es exactamente el
#   defecto que este canario existe para cazar, cometido POR el canario.
#
# Por eso este bloque no prueba comandos sueltos: **extrae el `run:` del paso real
# del workflow y lo ejecuta entero**. Si mañana alguien añade un quinto comando al
# paso, este bloque lo ejercita sin que nadie lo actualice — que es justo lo que
# falló antes (el canario de P-WH-1 tenía una mutación anclada a un título viejo).
printf '\n\033[1m★★ Bloque H — el PASO ENTERO del gate de dinero, tal como está en el workflow\033[0m\n'

WF="$ROOT_DIR/.github/workflows/e2e-real.yml"
PASO="$BASE/paso-gate-dinero.sh"
if ! command -v python3 >/dev/null 2>&1; then
  bad "sin python3 no puedo extraer el paso real del workflow: este bloque probaría una copia, y una copia es lo que ya falló."
else
  python3 - "$WF" "$PASO" <<'PYEOF' || true
import sys, yaml
wf, destino = sys.argv[1], sys.argv[2]
d = yaml.safe_load(open(wf, encoding='utf-8'))
paso = None
for j in d['jobs'].values():
    for s in (j.get('steps') or []):
        r = str(s.get('run', ''))
        if 'webhook-secret-preflight' in r and 'GITHUB_ENV' in r:
            paso = s
            break
    if paso:
        break
if paso is None:
    sys.exit(1)
# El `env:` del paso que NO viene de `secrets.*` se conserva tal cual (p. ej.
# STRIPE_WEBHOOK_UNREACHABLE): es parte del paso, no del entorno de prueba.
fijas = []
for k, v in (paso.get('env') or {}).items():
    v = str(v)
    if '${{' not in v:
        fijas.append(f'export {k}={v!r}'.replace("'", '"'))
open(destino, 'w', encoding='utf-8').write(
    '#!/usr/bin/env bash\nset -eo pipefail\n' + '\n'.join(fijas) + '\n' + paso['run'] + '\n')
PYEOF

  if [ ! -s "$PASO" ]; then
    bad "no encontré el paso del resolver en e2e-real.yml: o cambió de forma, o desapareció."
    nota "Si desapareció, el gate de dinero levanta el stack sin resolver y muere en la interpolación."
  else
    ok "paso extraído del workflow real ($(grep -cE '^[^#[:space:]]' "$PASO") comandos), no una copia escrita a mano."
    chmod +x "$PASO"

    # `paso_en <esperado> <nombre> [VAR=valor…]` — corre el PASO ENTERO.
    paso_en() {
      local esperado="$1" nombre="$2"; shift 2
      local out rc
      out="$(cd "$ROOT_DIR" && env -i PATH="$PATH" HOME="$HOME" \
              GITHUB_ENV="$BASE/gh_env_$$.txt" "$@" bash "$PASO" 2>&1)"; rc=$?
      : > "$BASE/gh_env_$$.txt"
      if [ "$esperado" = "OK" ]; then
        if [ "$rc" -eq 0 ]; then ok "$nombre — el paso COMPLETO pasa (rc=0)."
        else
          bad "$nombre — el paso completo FALLA (rc=$rc). El gate de dinero no arrancaría."
          nota "$(grep -E '✗|Falta|error' <<< "$out" | head -3)"
        fi
      else
        if [ "$rc" -ne 0 ]; then ok "$nombre — el paso completo ABORTA, como debe (rc=$rc)."
        else bad "$nombre — el paso completo pasó y NO debía: se inventarían secretos donde no toca."
        fi
      fi
    }

    CLAVE_TEST="sk_test_51QrEaLtEsTkEyDeLdUeNo00000000000000000000000000000000000"

    # ── La línea que separa «efímero de CI» de «entorno real», MEDIDA ──────────
    paso_en OK      "runner de CI + clave Stripe REAL + sin whsec  (el run 34512132641)" \
            CI=true GITHUB_ACTIONS=true STRIPE_TEST_SECRET_KEY="$CLAVE_TEST" STRIPE_TEST_WEBHOOK_SECRET=""
    paso_en OK      "runner de CI + clave Stripe REAL + CON whsec propio" \
            CI=true GITHUB_ACTIONS=true STRIPE_TEST_SECRET_KEY="$CLAVE_TEST" \
            STRIPE_TEST_WEBHOOK_SECRET=whsec_9f2b7c1d4e5a6b8c9d0e1f
    paso_en OK      "runner de CI sin ninguna clave de Stripe" \
            CI=true GITHUB_ACTIONS=true
    paso_en ABORTA  "runner de CI pero desplegando a RAILWAY" \
            CI=true GITHUB_ACTIONS=true RAILWAY_ENVIRONMENT=production STRIPE_TEST_SECRET_KEY="$CLAVE_TEST"
    paso_en ABORTA  "runner de CI pero con SECRETS_ENV=real" \
            CI=true GITHUB_ACTIONS=true SECRETS_ENV=real STRIPE_TEST_SECRET_KEY="$CLAVE_TEST"
    paso_en ABORTA  "máquina pelada, sin CI y sin declarar nada" \
            STRIPE_TEST_SECRET_KEY="$CLAVE_TEST"
    paso_en ABORTA  "runner de CI + VERCEL_ENV (otra plataforma)" \
            CI=true VERCEL_ENV=production STRIPE_TEST_SECRET_KEY="$CLAVE_TEST"

    # Y que un secreto PUBLICADO no se cuele ni siquiera en el caso permisivo.
    paso_en ABORTA  "runner de CI + whsec PUBLICADO por el repo" \
            CI=true GITHUB_ACTIONS=true STRIPE_TEST_SECRET_KEY="$CLAVE_TEST" \
            STRIPE_TEST_WEBHOOK_SECRET=whsec_e2e_test_secret
  fi
fi

# =============================================================================
# ★★★ BLOQUE I — EL ENTRYPOINT DE LA IMAGEN, EJERCITADO SIN DOCKER
# =============================================================================
# LA PREGUNTA DE MÉTODO QUE ORIGINA ESTE BLOQUE
# ---------------------------------------------------------------------------
# Durante dos pases escribí «que el CMD de la imagen corra los preflights» en la
# lista de NO MEDIDO, con la excusa de que aquí no hay demonio de Docker. Y la
# causa del run 34531002011 estaba **exactamente ahí**: el catálogo que metí en la
# imagen llevaba los nombres del HOST (`STAGING_JWT_ACCESS_SECRET`) y dentro del
# contenedor solo existen los del CONTENEDOR (`JWT_ACCESS_SECRET`). 12 de 15
# «faltaban», el `assert` abortaba, el `&&` cortaba y `node` no llegaba a correr:
# un contenedor que muere sin servir nada y un job esperando 5 minutos.
#
# La excusa era falsa. **Para probar el entrypoint no hace falta un demonio:**
#   · el sistema de ficheros de la imagen se reconstruye leyendo los `COPY` del
#     PROPIO Dockerfile (así no puede quedarse desfasado si alguien añade uno);
#   · el entorno del contenedor sale de `docker compose config`, que es CLIENTE
#     puro y no necesita demonio;
#   · el comando a ejecutar se extrae del `CMD` del PROPIO Dockerfile, quedándose
#     con la parte de preflights (lo de antes del primer `node`).
# Lo único que no se prueba así es que la imagen construya — eso sí necesita
# demonio, y lo mide el `build` de CI.
printf '\n\033[1m★★★ Bloque I — el entrypoint de la imagen (el camino que «no se podía medir»)\033[0m\n'

if ! command -v docker >/dev/null 2>&1; then
  bad "no hay CLI de docker: no puedo renderizar el entorno del contenedor."
  nota "Este bloque NO se salta en silencio: sin él, el arranque del contenedor vuelve a ser un camino que ningún candado mira."
else
  IMGDIR="$BASE/imagen"; ENVSH="$BASE/env-contenedor.sh"; ENVFILE="$BASE/env.host"
  rm -rf "$IMGDIR"; mkdir -p "$IMGDIR"
  ( cd "$ROOT_DIR" && ./scripts/secrets-preflight.sh env-file "$ENVFILE" >/dev/null 2>&1 )

  # (1) El sistema de ficheros de la imagen, según los COPY del propio Dockerfile.
  COPIADOS=0
  while read -r rel; do
    [ -n "$rel" ] || continue
    [ -f "$ROOT_DIR/$rel" ] || continue
    mkdir -p "$IMGDIR/$(dirname "$rel")"
    cp "$ROOT_DIR/$rel" "$IMGDIR/$rel"
    COPIADOS=$((COPIADOS+1))
  done < <(grep -oE '^COPY --chown=[^ ]+ [^ ]+' "$ROOT_DIR/Dockerfile.backend" | awk '{print $3}' | grep -E '^(scripts|security)/')

  # (2) El entorno del contenedor, renderizado por el cliente de compose.
  ( cd "$ROOT_DIR" && env -i PATH="$PATH" HOME="$HOME" \
      docker compose -f docker-compose.staging.yml --profile apps --env-file "$ENVFILE" config 2>/dev/null ) \
    | python3 -c "
import sys, yaml, shlex
d = yaml.safe_load(sys.stdin)
e = d['services']['backend']['environment']
print('\n'.join('export %s=%s' % (k, shlex.quote('' if v is None else str(v))) for k, v in e.items()))
" > "$ENVSH" 2>/dev/null

  # (3) El comando: la parte de preflights del CMD real.
  CMD_PRE="$(grep -E '^CMD ' "$ROOT_DIR/Dockerfile.backend" \
             | sed -E 's/^CMD \[[^,]*, *"-c", *"//; s/"\]$//' \
             | awk -F' && node' '{print $1}')"

  if [ "$COPIADOS" -eq 0 ] || [ ! -s "$ENVSH" ] || [ -z "$CMD_PRE" ]; then
    bad "no pude reconstruir la imagen simulada (copias=$COPIADOS, env=$( [ -s "$ENVSH" ] && echo sí || echo no ), cmd='${CMD_PRE:0:40}')."
    nota "Si esto falla, el bloque no está probando el entrypoint: es un candado sin blanco."
  else
    ok "imagen simulada desde los COPY del Dockerfile ($COPIADOS ficheros) y CMD extraído del propio Dockerfile."

    # `entrypoint <OK|ABORTA> <nombre> [mutación del env]`
    entrypoint() {
      local esperado="$1" nombre="$2" mut="${3:-}"
      local dir="$BASE/img$((PASADAS+FALLOS))" rc
      rm -rf "$dir"; cp -a "$IMGDIR" "$dir"
      cp "$ENVSH" "$dir/.env.sh"
      [ -n "$mut" ] && printf '%s\n' "$mut" >> "$dir/.env.sh"
      ( cd "$dir" && env -i PATH="$PATH" HOME="$HOME" \
          sh -c ". ./.env.sh; $CMD_PRE" ) >/dev/null 2>&1
      rc=$?
      if [ "$esperado" = "OK" ]; then
        if [ "$rc" -eq 0 ]; then ok "$nombre — el entrypoint pasa (rc=0): \`node\` llegaría a arrancar."
        else bad "$nombre — el entrypoint ABORTA (rc=$rc): el contenedor muere sin servir nada."
             nota "Es el run 34531002011: 5 minutos esperando salud de un proceso que nunca existió."
        fi
      else
        if [ "$rc" -ne 0 ]; then ok "$nombre — el entrypoint aborta, como debe (rc=$rc)."
        else bad "$nombre — el entrypoint PASA y no debía: arrancaría con la configuración mal."
        fi
      fi
    }

    entrypoint OK     "entorno real del contenedor (el que entrega el compose)"
    entrypoint ABORTA "le falta un secreto que el catálogo del contenedor exige" \
               'export JWT_ACCESS_SECRET=""'
    entrypoint ABORTA "un secreto del contenedor con valor PUBLICADO por el repo" \
               'export JWT_ACCESS_SECRET=e2e_access_secret'
    entrypoint ABORTA "el secreto del webhook, en blanco" \
               'export STRIPE_WEBHOOK_SECRET="   "'

    # Y el catálogo que NO viaja: el `assert` no puede salir verde sin blanco.
    dir_sin="$BASE/img-sin-catalogo"; rm -rf "$dir_sin"; cp -a "$IMGDIR" "$dir_sin"
    rm -f "$dir_sin"/security/secretos-exigidos-contenedor.txt
    cp "$ENVSH" "$dir_sin/.env.sh"
    if ( cd "$dir_sin" && env -i PATH="$PATH" HOME="$HOME" sh -c ". ./.env.sh; $CMD_PRE" ) >/dev/null 2>&1; then
      bad "sin catálogo en la imagen, el entrypoint sale VERDE: candado sin blanco (§44) en el arranque."
    else
      ok "sin catálogo en la imagen, el entrypoint ABORTA en vez de aprobar sin mirar nada."
    fi

    # El error concreto de este pase: meter el catálogo del HOST en la imagen.
    dir_host="$BASE/img-catalogo-host"; rm -rf "$dir_host"; cp -a "$IMGDIR" "$dir_host"
    if [ -f "$ROOT_DIR/security/secretos-exigidos.txt" ]; then
      cp "$ROOT_DIR/security/secretos-exigidos.txt" "$dir_host/security/secretos-exigidos-contenedor.txt"
      cp "$ENVSH" "$dir_host/.env.sh"
      if ( cd "$dir_host" && env -i PATH="$PATH" HOME="$HOME" sh -c ". ./.env.sh; $CMD_PRE" ) >/dev/null 2>&1; then
        bad "con el catálogo del HOST en la imagen el entrypoint pasa: el canario no vería el bug del run 34531002011."
      else
        ok "con el catálogo del HOST metido en la imagen — ABORTA (es el bug exacto del run 34531002011)."
      fi
    fi
  fi
fi

TOTAL=$((PASADAS+FALLOS))
printf '\n'
if [ "$FALLOS" -gt 0 ]; then
  printf '\033[1;31m✗ CANARIO ROJO — %s/%s correctos. El candado de la CLASE no muerde como dice.\033[0m\n\n' "$PASADAS" "$TOTAL"
  exit 1
fi
printf '\033[1;32m✓ %s/%s — el candado muerde con secretos que NUNCA ha visto, y deja pasar lo legítimo.\033[0m\n' "$PASADAS" "$TOTAL"
printf '  Eso es lo que distingue cerrar la CLASE de arreglar siete líneas: el octavo\n'
printf '  secreto de mañana nace rojo sin que nadie toque un candado. (DEVOPS_NOTES §50.)\n\n'
exit 0

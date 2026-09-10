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
            KYC_PROVIDER_PASSWORD LEDGER_HMAC TWILIO_AUTH_TOKEN DB_REPLICA_PASSWORD)
printf '\033[1mPrecondición — los nombres del canario son DESCONOCIDOS para el repo\033[0m\n'
# Se busca SOLO donde el candado mira (config y código), no en `docs/`. Documentar
# el canario —§50.5 nombra estos ocho— no puede romperlo: es la misma trampa que ya
# tiene su control en verde («documentar el bug no pone rojo el candado»), y se
# cazó porque este canario se puso rojo al escribirse la nota que lo explica.
YA=0
for nombre in "${INVENTADOS[@]}"; do
  if grep -rqI --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs \
       --exclude='*.md' --exclude="$(basename "${BASH_SOURCE[0]}")" \
       "$nombre" "$ROOT_DIR" 2>/dev/null; then
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

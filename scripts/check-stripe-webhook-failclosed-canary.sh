#!/usr/bin/env bash
#
# check-stripe-webhook-failclosed-canary.sh — «¿el candado de P-WH-1 MUERDE?» · devops
# =============================================================================
# POR QUÉ EXISTE ESTE FICHERO
# ---------------------------------------------------------------------------
# El defecto que originó el candado hermano (`check-stripe-webhook-failclosed.sh`)
# es de una familia concreta: **un control que degradaba en silencio a cero**. La
# firma del webhook de Stripe se «verificaba» con clave vacía y el sistema
# respondía 200, liquidaba el pedido y movía la carta a la bóveda del comprador.
# Nada se puso rojo. Nadie se enteró.
#
# Un candado contra ese defecto que nunca se ha visto ponerse rojo es exactamente
# el mismo problema una capa más arriba. Este canario existe para que el rojo se
# haya VISTO — igual que el self-test de `trivy-fs` (§47) y el canario de paridad
# (§48.1). No lee el candado: lo EJERCITA, con el candado real copiado byte a byte
# sobre una copia del árbol, plantando en ella las mutaciones que corresponden al
# bug histórico y a sus variantes cercanas.
#
# QUÉ SE COMPRUEBA (bloques A/B/C estáticos + D en runtime; rojos Y verdes)
# ---------------------------------------------------------------------------
# Los verdes importan tanto como los rojos: un candado que siempre cierra tampoco
# es un candado, y uno que se pone rojo al DOCUMENTAR el bug hace que la gente
# deje de documentarlo.
#
# Uso:   ./scripts/check-stripe-webhook-failclosed-canary.sh
# Sale 0 si muerde donde debe y deja pasar lo legítimo. 1 con el caso exacto.
# Barato: sin red, sin Docker, sin node. ~2 s.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE_REL="scripts/check-stripe-webhook-failclosed.sh"
GATE="$ROOT_DIR/$GATE_REL"

FALLOS=0
PASADAS=0
ok()   { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; FALLOS=$((FALLOS+1)); }
note() { printf '      %s\n' "$*"; }

printf '\n\033[1m== ¿El candado de P-WH-1 se pone ROJO cuando toca? ==\033[0m\n\n'

[ -f "$GATE" ] || { bad "No existe $GATE. El candado desapareció: eso ya es el rojo."; exit 1; }

BASE="$(mktemp -d -t pwh1-canario-XXXXXX)"
trap 'rm -rf "$BASE"' EXIT
PRISTINO="$BASE/pristino"

# --- Copia mínima pero REAL del árbol ----------------------------------------
# Solo los ficheros que el candado mira. Se copian TAL CUAL (no se reescriben):
# si mañana alguno cambia de forma, el canario lo ejercita en su forma nueva.
COPIAR=(
  "$GATE_REL"
  "scripts/webhook-secret-preflight.sh"
  "backend/src/modules/payments/stripe.service.ts"
  "docker-compose.yml"
  "docker-compose.staging.yml"
  ".github/workflows/e2e.yml"
  "scripts/stack-native.sh"
  ".env.example"
  "Dockerfile.backend"
  ".dockerignore"
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
chmod +x "$PRISTINO/$GATE_REL"

# `correr <dir>` → imprime la salida y devuelve el rc del candado real.
correr() { bash "$1/$GATE_REL" --root "$1" 2>&1; }

# `caso ROJO|VERDE <nombre> <fichero-que-debe-nombrar|-> <mutador…>`
# El mutador recibe el directorio de la copia como $1.
caso() {
  local esperado="$1" nombre="$2" debe_nombrar="$3" mutador="$4"
  local dir="$BASE/caso$((PASADAS+FALLOS+1))"
  rm -rf "$dir"; cp -a "$PRISTINO" "$dir"
  "$mutador" "$dir"
  local salida rc
  salida="$(correr "$dir")"; rc=$?
  if [ "$esperado" = "ROJO" ]; then
    if [ "$rc" -eq 0 ]; then
      bad "$nombre — el candado se quedó VERDE ante la mutación (rc=0)."
      note "Esta es la forma exacta en que un candado deja de proteger sin avisar."
      return
    fi
    if [ "$debe_nombrar" != "-" ] && ! grep -qF "$debe_nombrar" <<< "$salida"; then
      bad "$nombre — rojo, pero NO nombra \`$debe_nombrar\`: se puso rojo por otra cosa."
      note "Un rojo que señala el fichero equivocado manda a arreglar donde no es."
      return
    fi
    ok "$nombre — ROJO, y señala $debe_nombrar."
  else
    if [ "$rc" -ne 0 ]; then
      bad "$nombre — el candado se puso ROJO sobre algo legítimo (rc=$rc). Falso positivo."
      note "$(grep -E '✗|:[0-9]+:' <<< "$salida" | head -4)"
      return
    fi
    ok "$nombre — VERDE, como debe."
  fi
}

# =============================================================================
# MUTACIONES DE CÓDIGO (bloque A del candado)
# =============================================================================
TS="backend/src/modules/payments/stripe.service.ts"

m_bug_historico() {   # el bug EXACTO que explotó el pentester (stripe.service.ts:173)
  printf '\n%s\n' "const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';" >> "$1/$TS"
}
m_or_comillas_dobles() {
  printf '\n%s\n' 'const secret = process.env.STRIPE_WEBHOOK_SECRET || "";' >> "$1/$TS"
}
m_literal_no_vacio() { # una clave por defecto ESCRITA EN EL REPO es una clave pública
  printf '\n%s\n' "return this.stripe.webhooks.constructEvent(raw, sig, secret ?? 'whsec_dev');" >> "$1/$TS"
}
m_tras_comentario() {  # el fallback con un comentario detrás, en la misma línea
  printf '\n%s\n' "const secret = cfg.get('STRIPE_WEBHOOK_SECRET') ?? ''; // temporal" >> "$1/$TS"
}
m_otro_fichero() {     # el bug movido a otro módulo de payments
  mkdir -p "$1/backend/src/modules/payments"
  printf '%s\n' "export const s = env.STRIPE_WEBHOOK_SECRET ?? '';" \
    > "$1/backend/src/modules/payments/otro-verificador.ts"
}
m_sin_blanco() {       # el candado se queda sin nada que mirar
  rm -rf "$1/backend"
}

# =============================================================================
# MUTACIONES DE CONFIG (bloque B del candado)
# =============================================================================
m_compose_sin_default() {   # el estado histórico de docker-compose.yml:179
  sed -i 's|STRIPE_WEBHOOK_SECRET: "${STRIPE_WEBHOOK_SECRET:?[^}]*}"|STRIPE_WEBHOOK_SECRET: ${STRIPE_WEBHOOK_SECRET}|' "$1/docker-compose.yml"
}
m_compose_default_vacio() {
  sed -i 's|STRIPE_WEBHOOK_SECRET: "${STRIPE_WEBHOOK_SECRET:?[^}]*}"|STRIPE_WEBHOOK_SECRET: ${STRIPE_WEBHOOK_SECRET:-}|' "$1/docker-compose.yml"
}
m_envexample_vacio() {
  sed -i 's|^STRIPE_WEBHOOK_SECRET=.*|STRIPE_WEBHOOK_SECRET=|' "$1/.env.example"
}
m_envexample_borrado() {
  sed -i '/^STRIPE_WEBHOOK_SECRET=/d' "$1/.env.example"
}
m_nativo_export_condicional() {  # el idioma histórico de stack-native.sh:233
  sed -i 's|^export STRIPE_WEBHOOK_SECRET=.*|[ -z "${STRIPE_WEBHOOK_SECRET:-}" ]  \|\| export STRIPE_WEBHOOK_SECRET|' "$1/scripts/stack-native.sh"
}

# =============================================================================
# MUTACIONES DEL RESIDUAL — «el secreto EXISTE» no basta si es PÚBLICO
# =============================================================================
# Backend cerró su mitad (fail-closed incondicional, sin depender de NODE_ENV) y
# dejó dicho el límite del código: «puede exigir que el secreto exista y no esté
# vacío; no puede distinguir un secreto de un no-secreto». Para un HMAC cualquier
# cadena es una clave válida. Estas mutaciones son ese residual, y son de config.
m_compose_default_literal() {   # el estado INTERMEDIO: no vacío, pero publicado
  sed -i 's|STRIPE_WEBHOOK_SECRET: "${STRIPE_WEBHOOK_SECRET:?[^}]*}"|STRIPE_WEBHOOK_SECRET: ${STRIPE_WEBHOOK_SECRET:-whsec_local_placeholder_no_verifica_nada}|' "$1/docker-compose.yml"
}
m_staging_default_literal() {
  sed -i 's|STRIPE_WEBHOOK_SECRET: "${STRIPE_TEST_WEBHOOK_SECRET:?[^}]*}"|STRIPE_WEBHOOK_SECRET: ${STRIPE_TEST_WEBHOOK_SECRET:-whsec_staging_dummy}|' "$1/docker-compose.staging.yml"
}
m_workflow_respaldo_publico() { # `|| 'whsec_e2e_dummy'` — el literal gana en ausencia
  # Se ancla en `- name: Resolver` (no en el título completo del paso): el título
  # cambió al ampliar el paso a S-88-1 y la mutación se volvió un NO-OP silencioso.
  # Un canario cuya mutación no muta no prueba nada — y encima se lee como rojo.
  # Se comprueba que la sustitución OCURRIÓ; si no, el canario lo dice.
  sed -i "s|^      - name: Resolver .*|      STRIPE_WEBHOOK_SECRET: \${{ secrets.STRIPE_TEST_WEBHOOK_SECRET \|\| 'whsec_e2e_dummy' }}|" "$1/.github/workflows/e2e.yml"
  grep -q "whsec_e2e_dummy" "$1/.github/workflows/e2e.yml" || {
    printf '\033[1;31m  ✗ la mutación no se aplicó a e2e.yml (¿cambió la forma del paso?)\033[0m\n'
    return 1
  }
}
m_workflow_literal_pelado() {   # `STRIPE_WEBHOOK_SECRET: whsec_ci_dummy`
  printf '      %s\n' "STRIPE_WEBHOOK_SECRET: whsec_ci_dummy" >> "$1/.github/workflows/e2e.yml"
}
m_workflow_sin_preflight() {    # `${{ secrets.X }}` puro en un fichero que NO cablea el preflight
  mkdir -p "$1/.github/workflows"
  printf '%s\n' "jobs:" "  x:" "    env:" "      STRIPE_WEBHOOK_SECRET: \${{ secrets.STRIPE_TEST_WEBHOOK_SECRET }}" \
    > "$1/.github/workflows/otro.yml"
}
m_dockerfile_sin_preflight() {  # se borra la llamada del CMD: Railway deja de comprobar
  sed -i 's|sh ./scripts/webhook-secret-preflight.sh assert && ||' "$1/Dockerfile.backend"
}
m_dockerignore_sin_excepcion() {
  sed -i '/^!scripts\/webhook-secret-preflight\.sh$/d' "$1/.dockerignore"
}
m_nativo_sin_preflight() {
  sed -i 's|sh "$SCRIPT_DIR/webhook-secret-preflight.sh" resolve|echo whsec_local_dummy|' "$1/scripts/stack-native.sh"
}
m_preflight_borrado() {
  rm -f "$1/scripts/webhook-secret-preflight.sh"
}
m_envexample_parece_secreto() { # un placeholder que el preflight NO reconocería
  sed -i 's|^STRIPE_WEBHOOK_SECRET=.*|STRIPE_WEBHOOK_SECRET=whsec_9f2b7c1d4e5a6b8c9d0e|' "$1/.env.example"
}

# =============================================================================
# CONTROLES EN VERDE
# =============================================================================
m_nada() { : ; }
m_workflow_pura_con_preflight() {  # la forma CORRECTA en un workflow
  mkdir -p "$1/.github/workflows"
  {
    printf '%s\n' "jobs:"
    printf '%s\n' "  x:"
    printf '%s\n' "    steps:"
    printf '%s\n' "      - name: Resolver"
    printf '%s\n' "        env:"
    printf '%s\n' "          STRIPE_WEBHOOK_SECRET: \${{ secrets.STRIPE_TEST_WEBHOOK_SECRET }}"
    printf '%s\n' "        run: ./scripts/webhook-secret-preflight.sh assert"
  } > "$1/.github/workflows/bien.yml"
}
m_documentar_el_bug() {  # citar el bug en un comentario NO puede poner rojo el candado
  {
    printf '\n%s\n' "/**"
    printf '%s\n' " * P-WH-1: aquí había \`config.get('STRIPE_WEBHOOK_SECRET') ?? ''\`, que verificaba"
    printf '%s\n' " * la firma con clave VACÍA. Se corrigió a fail-closed incondicional."
    printf '%s\n' " */"
    printf '%s\n' "// const secret = this.config.get('STRIPE_WEBHOOK_SECRET') ?? '';   <- NO volver a esto"
  } >> "$1/$TS"
}

printf '\033[1mBloque A — código\033[0m\n'
caso ROJO  "El bug histórico exacto (\`?? ''\`)"            "$TS" m_bug_historico
caso ROJO  "Variante \`|| \"\"\` sobre process.env"          "$TS" m_or_comillas_dobles
caso ROJO  "Fallback a literal NO vacío (clave pública)"     "$TS" m_literal_no_vacio
caso ROJO  "Fallback con comentario \`//\` detrás"           "$TS" m_tras_comentario
caso ROJO  "El bug mudado a otro fichero de payments"        "otro-verificador.ts" m_otro_fichero
caso ROJO  "backend/src desaparece (candado sin blanco)"     "backend/src" m_sin_blanco

printf '\n\033[1mBloque B — config\033[0m\n'
caso ROJO  "compose sin default (estado histórico)"          "docker-compose.yml" m_compose_sin_default
caso ROJO  "compose con default DECLARADO VACÍO"             "docker-compose.yml" m_compose_default_vacio
caso ROJO  ".env.example con la variable VACÍA"              ".env.example" m_envexample_vacio
caso ROJO  ".env.example sin la variable"                    ".env.example" m_envexample_borrado
caso ROJO  "arnés nativo: export condicional (histórico)"    "stack-native.sh" m_nativo_export_condicional

printf '\n\033[1mBloque C — el residual: secretos que EXISTEN pero están publicados\033[0m\n'
caso ROJO  "compose con default literal (publicado)"         "docker-compose.yml" m_compose_default_literal
caso ROJO  "staging con \`whsec_staging_dummy\`"              "docker-compose.staging.yml" m_staging_default_literal
caso ROJO  "workflow con respaldo público \`|| 'whsec_…'\`"   "e2e.yml" m_workflow_respaldo_publico
caso ROJO  "workflow con literal pelado (\`whsec_ci_dummy\`)"  "e2e.yml" m_workflow_literal_pelado
caso ROJO  "workflow con \`secrets.X\` y SIN preflight"        "otro.yml" m_workflow_sin_preflight
caso ROJO  "Dockerfile deja de llamar al preflight"          "Dockerfile.backend" m_dockerfile_sin_preflight
caso ROJO  ".dockerignore deja el COPY sin fichero"          ".dockerignore" m_dockerignore_sin_excepcion
caso ROJO  "arnés nativo deja de llamar al preflight"        "stack-native.sh" m_nativo_sin_preflight
caso ROJO  "el preflight desaparece"                         "webhook-secret-preflight.sh" m_preflight_borrado
caso ROJO  ".env.example con placeholder que parece secreto" ".env.example" m_envexample_parece_secreto

printf '\n\033[1mControles en verde\033[0m\n'
caso VERDE "Árbol íntegro"                                   "-" m_nada
caso VERDE "Documentar el bug en un comentario"              "-" m_documentar_el_bug
caso VERDE "workflow con \`secrets.X\` puro Y con preflight"   "-" m_workflow_pura_con_preflight


# =============================================================================
# BLOQUE D — el preflight, EJERCITADO (no leído)
# =============================================================================
# Los bloques A/B/C son estáticos. La mitad que de verdad para el residual es de
# RUNTIME: `webhook-secret-preflight.sh` decidiendo sobre un entorno concreto.
# Aquí se le ponen los entornos que importan y se mira el color.
PRE="$PRISTINO/scripts/webhook-secret-preflight.sh"
printf '\n\033[1mBloque D — el preflight ejercitado sobre entornos reales\033[0m\n'

pre() { env -u STRIPE_SECRET_KEY -u STRIPE_TEST_SECRET_KEY -u STRIPE_WEBHOOK_SECRET \
            -u STRIPE_TEST_WEBHOOK_SECRET "$@" sh "$PRE" assert >/dev/null 2>&1; }

if pre STRIPE_SECRET_KEY=sk_live_51realkey STRIPE_WEBHOOK_SECRET=whsec_staging_dummy; then
  bad "Stripe LIVE + \`whsec_staging_dummy\` — el preflight dejó arrancar (ESTE es el residual)."
else
  ok "Stripe LIVE + literal público del repo — ABORTA."
fi

if pre STRIPE_TEST_SECRET_KEY=sk_test_51realtestkey STRIPE_TEST_WEBHOOK_SECRET=whsec_e2e_dummy; then
  bad "Stripe TEST real + \`whsec_e2e_dummy\` — el preflight dejó arrancar. Staging recibe webhooks de VERDAD: forjable igual."
else
  ok "Stripe TEST real (staging) + literal público — ABORTA."
fi

if pre STRIPE_SECRET_KEY=sk_live_51realkey; then
  bad "Stripe LIVE sin secreto de webhook — el preflight dejó arrancar."
else
  ok "Stripe LIVE sin secreto — ABORTA."
fi

if pre STRIPE_SECRET_KEY=sk_live_51realkey STRIPE_WEBHOOK_SECRET='   '; then
  bad "Stripe LIVE + secreto en BLANCO — el preflight dejó arrancar (\`' '\` es truthy: el fallo que backend cazó)."
else
  ok "Stripe LIVE + secreto de solo espacios — ABORTA."
fi

if pre STRIPE_SECRET_KEY=sk_live_51realkey STRIPE_WEBHOOK_SECRET=whsec_9f2b7c1d4e5a6b8c; then
  ok "Stripe LIVE + secreto propio — DEJA arrancar (el candado tiene que poder pasar)."
else
  bad "Stripe LIVE + secreto propio — abortó. Un candado que siempre cierra no es un candado."
fi

if pre STRIPE_SECRET_KEY=sk_test_ci_dummy; then
  ok "Sin Stripe real (dummy de CI) y sin secreto — DEJA arrancar: correr sin Stripe es legítimo."
else
  bad "Sin Stripe real — abortó. El arnés local y CI tienen que poder levantar sin claves."
fi

A="$(env -u STRIPE_SECRET_KEY -u STRIPE_WEBHOOK_SECRET -u STRIPE_TEST_SECRET_KEY -u STRIPE_TEST_WEBHOOK_SECRET sh "$PRE" resolve)"
B="$(env -u STRIPE_SECRET_KEY -u STRIPE_WEBHOOK_SECRET -u STRIPE_TEST_SECRET_KEY -u STRIPE_TEST_WEBHOOK_SECRET sh "$PRE" resolve)"
if [ -n "$A" ] && [ "$A" != "$B" ]; then
  ok "Sin Stripe, el secreto generado es DISTINTO en cada corrida (nadie puede firmar contra él, ni quien lea el repo)."
else
  bad "El secreto generado se repite entre corridas: vuelve a ser una clave adivinable."
fi

TOTAL=$((PASADAS+FALLOS))
printf '\n'
if [ "$FALLOS" -gt 0 ]; then
  printf '\033[1;31m✗ CANARIO ROJO — %s/%s casos correctos. El candado NO muerde como dice.\033[0m\n\n' "$PASADAS" "$TOTAL"
  exit 1
fi
printf '\033[1;32m✓ %s/%s — el candado de P-WH-1 y su preflight: rojos donde toca, verdes donde toca.\033[0m\n' "$PASADAS" "$TOTAL"
printf '  (Lo que esto prueba es el CABLE. Que la variable exista en Railway no es\n'
printf '   medible desde el repo: DEVOPS_NOTES §49.1.)\n\n'
exit 0

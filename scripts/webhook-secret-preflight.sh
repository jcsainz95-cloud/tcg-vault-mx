#!/bin/sh
#
# webhook-secret-preflight.sh — «un Stripe REAL no puede convivir con una clave
# de webhook que está escrita en un repositorio público»      ·  devops
# =============================================================================
# POSIX sh a propósito: esto corre también DENTRO de la imagen del backend
# (`Dockerfile.backend`, alpine/busybox), donde no hay bash.
#
# DE DÓNDE VIENE (residual de P-WH-1)
# ---------------------------------------------------------------------------
# Backend cerró su mitad: `constructEvent` ya lanza si el secreto es `undefined`,
# vacío o solo espacios, y la exigencia dejó de depender de `NODE_ENV` (pasa a
# depender del hecho relevante: si hay `STRIPE_SECRET_KEY`, el secreto de webhook
# es obligatorio). Pero su frase es exacta y marca el límite del código:
#
#     «el backend puede exigir que el secreto EXISTA y no esté vacío;
#      no puede distinguir un secreto de un no-secreto.»
#
# Para un HMAC cualquier cadena es una clave válida. Y este repo tenía —commiteados,
# en público— `whsec_ci_dummy`, `whsec_e2e_dummy`, `whsec_staging_dummy`,
# `whsec_CHANGE_ME`… Un entorno con Stripe REAL y cualquiera de esos valores
# arranca en verde, pasa el fail-closed de backend, y sigue siendo forjable por
# cualquiera que sepa leer. Peor: los cuatro estaban puestos como RESPALDO
# (`|| 'whsec_e2e_dummy'`, `:-whsec_staging_dummy`), o sea que **el valor público
# es el que gana justo cuando alguien creyó configurar Stripe y no lo hizo**. Es
# el `?? ''` otra vez, una capa más arriba: la ausencia degrada a algo que no
# protege.
#
# LA ASIMETRÍA QUE HAY QUE RESPETAR
# ---------------------------------------------------------------------------
#   · CI y el arnés local DEBEN poder correr sin Stripe.  → legítimo, no se toca.
#   · Un entorno con Stripe REAL NO puede heredar un valor público. → prohibido.
# Hoy compartían mecanismo (un literal por defecto). Aquí se separan: sin Stripe
# se GENERA un secreto efímero irrepetible (nadie puede firmar contra él, ni
# quien lea el repo); con Stripe real y sin secreto propio, se ABORTA.
#
# MODOS
#   assert   Comprueba el emparejamiento y no imprime el secreto. rc=1 si es
#            inseguro. Lo usan el arranque del contenedor y los arneses.
#   resolve  Imprime por stdout un secreto usable (el que ya haya, o uno EFÍMERO
#            aleatorio si no hay Stripe real). Aborta en el caso prohibido.
#
# NUNCA imprime el valor del secreto en los mensajes de error.
# Candado estático que vigila que esto siga cableado:
#   scripts/check-stripe-webhook-failclosed.sh (bloque C)
# =============================================================================
set -u

MODO="${1:-assert}"

# --- ¿El valor es un no-secreto conocido? -----------------------------------
# Fuente ÚNICA de la lista (el candado estático la lee de aquí, no la copia).
# Se acierta por exceso a propósito: preferimos rechazar un secreto real de
# aspecto sospechoso —el operador lo cambia en dos minutos— a aceptar uno público.
# INICIO_PATRONES_PUBLICOS
PATRONES_PUBLICOS='dummy placeholder change_me changeme changed_me fake sample example test_me foobar xxxxx secreto no_verifica'
# FIN_PATRONES_PUBLICOS

es_publico() {
  # $1 = valor. Comparación en minúsculas, por subcadena.
  v="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  [ -z "$v" ] && return 1
  for p in $PATRONES_PUBLICOS; do
    case "$v" in *"$p"*) return 0 ;; esac
  done
  return 1
}

# --- ¿Hay una clave de Stripe DE VERDAD? ------------------------------------
# `sk_live_…` o `sk_test_…` que no sea uno de los no-secretos de este repo.
# Una `sk_test_` cuenta como REAL: staging con claves de prueba habla con Stripe
# igual, recibe webhooks de verdad, y un forjador puede liquidar pedidos igual.
hay_stripe_real() {
  k="${STRIPE_SECRET_KEY:-}"
  [ -n "$k" ] || k="${STRIPE_TEST_SECRET_KEY:-}"
  # Espacios en blanco no cuentan como clave.
  k="$(printf '%s' "$k" | tr -d '[:space:]')"
  [ -n "$k" ] || return 1
  case "$k" in sk_live_*|sk_test_*|rk_live_*|rk_test_*) ;; *) return 1 ;; esac
  es_publico "$k" && return 1
  return 0
}

aleatorio() {
  if command -v openssl >/dev/null 2>&1; then
    printf 'whsec_efimero_%s' "$(openssl rand -hex 24)"
  else
    printf 'whsec_efimero_%s' "$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
}

SECRETO="${STRIPE_WEBHOOK_SECRET:-}"
[ -n "$(printf '%s' "$SECRETO" | tr -d '[:space:]')" ] || SECRETO=""
if [ -z "$SECRETO" ]; then
  SECRETO="${STRIPE_TEST_WEBHOOK_SECRET:-}"
  [ -n "$(printf '%s' "$SECRETO" | tr -d '[:space:]')" ] || SECRETO=""
fi

abortar() {
  echo "" >&2
  echo "✗ PREFLIGHT DEL WEBHOOK DE STRIPE — ARRANQUE ABORTADO (P-WH-1, residual)" >&2
  echo "" >&2
  echo "  $1" >&2
  echo "" >&2
  echo "  Este entorno tiene una clave de Stripe REAL. Con ella se cobran y se" >&2
  echo "  liquidan pedidos: un webhook forjado mueve cartas a la bóveda de quien" >&2
  echo "  lo mande, sin cobro. El pentester lo hizo, no es una hipótesis." >&2
  echo "" >&2
  echo "  QUÉ HACER (2 min):" >&2
  echo "    Stripe Dashboard > Developers > Webhooks > tu endpoint > Signing secret" >&2
  echo "    y pon ese \`whsec_…\` en STRIPE_WEBHOOK_SECRET del entorno:" >&2
  echo "      · Railway  → servicio \`backend\` → Variables (DEVOPS_NOTES §11.G)" >&2
  echo "      · local    → tu \`.env\` (o \`export\` antes de levantar el arnés)" >&2
  echo "" >&2
  echo "  QUÉ **NO** HACER: poner otro literal. Cualquier valor escrito en el repo" >&2
  echo "  es una clave que el atacante también tiene." >&2
  echo "" >&2
  echo "  Si de verdad querías correr SIN Stripe, quita STRIPE_SECRET_KEY y este" >&2
  echo "  preflight generará un secreto efímero: el arnés levanta y rechaza todo" >&2
  echo "  webhook. Ver DEVOPS_NOTES §49.3." >&2
  exit 1
}

if hay_stripe_real; then
  [ -n "$SECRETO" ] || abortar "Hay STRIPE_SECRET_KEY real y NO hay STRIPE_WEBHOOK_SECRET."
  es_publico "$SECRETO" && abortar "STRIPE_WEBHOOK_SECRET es uno de los valores PÚBLICOS de este repo (contiene un patrón de no-secreto: '$PATRONES_PUBLICOS')."
  RESULTADO="$SECRETO"
  ESTADO="secreto propio del entorno, junto a una clave de Stripe real"
else
  if [ -n "$SECRETO" ]; then
    RESULTADO="$SECRETO"
    ESTADO="secreto declarado, sin clave de Stripe real (no se verifica contra Stripe)"
  else
    RESULTADO="$(aleatorio)"
    ESTADO="SIN Stripe: se generó un secreto EFÍMERO; todo webhook entrante se rechaza"
  fi
fi

case "$MODO" in
  assert)  echo "· preflight webhook Stripe: OK — $ESTADO." ;;
  resolve) printf '%s\n' "$RESULTADO" ;;
  *) echo "uso: $0 [assert|resolve]" >&2; exit 2 ;;
esac
exit 0

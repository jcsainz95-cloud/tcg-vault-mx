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

# --- ¿El valor está PUBLICADO por el repo? (lado del VALOR, S-88-1) ---------
# EL PUNTO CIEGO QUE SEGURIDAD MIDIÓ, y por qué la lista de arriba no bastaba:
#
#     sk_live_…  +  whsec_e2e_test_secret   →   PASABA.
#
# `whsec_e2e_test_secret` no contiene `dummy`, ni `change_me`, ni ninguna de las
# palabras de PATRONES_PUBLICOS. Pero estaba commiteado en
# `backend/test/integration/setup.ts:32` de un repo PÚBLICO. O sea: una clave de
# Stripe REAL conviviendo con un secreto de webhook que cualquiera puede leer, y
# este preflight decía OK.
#
# La lección es que una lista de palabras ADIVINA si un valor es secreto. El hecho
# que importa es comprobable y no hay que adivinarlo: **¿está ese valor escrito en
# este repositorio?** `security/secretos-publicados.sha256` responde por identidad
# (sha256), incluye los valores que YA salieron del árbol (fichero de retirados: en
# un repo público, lo que se borra sigue en el historial) y se regenera solo con
# `scripts/gen-published-secrets-manifest.sh`. Por eso cubre también el literal que
# alguien commitee mañana, sin tocar este fichero.
MANIFIESTO="${SECRETS_MANIFEST:-$(dirname "$0")/../security/secretos-publicados.sha256}"

hash_de() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1
  else
    printf '%s' "$1" | openssl dgst -sha256 | sed 's/.*= *//'
  fi
}

esta_publicado() {
  [ -n "${1:-}" ] || return 1
  [ -f "$MANIFIESTO" ] || return 1
  grep -q "^$(hash_de "$1")  " "$MANIFIESTO" 2>/dev/null
}

es_publico() {
  # $1 = valor.
  [ -z "${1:-}" ] && return 1
  # (1) El hecho: ¿está escrito en el repo? Identidad exacta, sin heurística.
  esta_publicado "$1" && return 0
  # (2) La red de debajo: patrones de no-secreto. Sirve para el literal que alguien
  #     inventa en su entorno sin commitearlo, que el manifiesto no puede conocer.
  v="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
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

# --- LA EXCEPCIÓN QUE MIDIÓ UN RUN ROJO, no una teoría ----------------------
# `e2e-real.yml` (run 34498068945) murió en el PASO 3 —este preflight— con una
# clave `sk_test_` REAL presente y sin `STRIPE_TEST_WEBHOOK_SECRET` en los secrets.
# El candado hizo lo que se le pidió. Pero al hacerlo bloqueó el gate de dinero
# entero, y merece la pena mirar QUÉ estaba defendiendo ahí:
#
#   · La regla «clave real ⇒ secreto de webhook propio» defiende dos cosas
#     distintas: (a) que nadie firme webhooks con un valor público —seguridad—, y
#     (b) que el operador no CREA que los webhooks funcionan cuando no —correctitud.
#   · En el stack efímero de CI, (a) se satisface MEJOR con un secreto generado
#     (irrepetible, nadie lo tiene) que con uno real compartido. Y (b) no aplica:
#     ese stack vive en el runner, sin endpoint público — Stripe no puede
#     entregarle un webhook aunque quisiera.
#
# Así que ahí, y SOLO ahí, se genera uno efímero y se avisa a gritos. La excepción
# no se concede por accidente: hay que pedirla explícitamente (`STRIPE_WEBHOOK_UNREACHABLE=1`),
# NO puede haber marcas de plataforma de despliegue, y tiene que ser un runner de CI
# o un entorno declarado desechable. En Railway esta rama no se alcanza jamás.
entorno_inalcanzable() {
  [ "${STRIPE_WEBHOOK_UNREACHABLE:-}" = "1" ] || return 1
  [ -n "${GITHUB_ACTIONS:-}" ] || [ "${SECRETS_ENV:-}" = "desechable" ] || return 1
  [ -z "${RAILWAY_ENVIRONMENT:-}${RAILWAY_SERVICE_ID:-}${RAILWAY_PROJECT_ID:-}${VERCEL_ENV:-}${RENDER:-}${FLY_APP_NAME:-}${DYNO:-}" ] || return 1
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
  if [ -z "$SECRETO" ] && entorno_inalcanzable; then
    RESULTADO="$(aleatorio)"
    ESTADO="clave de Stripe real en un stack EFÍMERO SIN endpoint público: secreto de webhook GENERADO"
    echo "⚠ AVISO (P-WH-1): hay una clave de Stripe real y no hay secreto de webhook propio." >&2
    echo "  Este stack es efímero y no es alcanzable desde Stripe, así que se GENERA uno" >&2
    echo "  irrepetible en vez de abortar. Consecuencia que hay que tener presente:" >&2
    echo "  **ningún webhook entrante de Stripe se aceptará en esta corrida** (firma inválida)." >&2
    echo "  Los smokes que firman sus propios payloads sí funcionan. Si necesitas webhooks" >&2
    echo "  REALES en CI, carga el secret STRIPE_TEST_WEBHOOK_SECRET. DEVOPS_NOTES §50.4." >&2
    case "$MODO" in
      assert)  echo "· preflight webhook Stripe: OK — $ESTADO." ;;
      resolve) printf '%s\n' "$RESULTADO" ;;
      *) echo "uso: $0 [assert|resolve]" >&2; exit 2 ;;
    esac
    exit 0
  fi
  [ -n "$SECRETO" ] || abortar "Hay STRIPE_SECRET_KEY real y NO hay STRIPE_WEBHOOK_SECRET."
  if esta_publicado "$SECRETO"; then
    abortar "STRIPE_WEBHOOK_SECRET trae un valor que ESTE REPOSITORIO PUBLICA (coincide, byte a byte, con un literal commiteado). No importa que lo hayas puesto tu en el entorno: lo tiene cualquiera que clone el repo."
  fi
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

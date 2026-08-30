#!/usr/bin/env bash
# =============================================================================
# scripts/stripe-test-key-preflight.sh — Propiedad: devops
# TCG Vault MX — clasifica las claves de PRUEBA de Stripe POR SU FORMA y decide
#                qué smokes de dinero puede correr `e2e-real.yml`.
# =============================================================================
# POR QUÉ EXISTE (el defecto que cierra, con log real):
#
#   El paso «Preflight — ¿hay clave de PRUEBA de Stripe real?» de `e2e-real.yml`
#   comprobaba PRESENCIA, no VALIDEZ: sólo miraba si el valor era exactamente el
#   literal `sk_test_e2e_dummy`. Cualquier otro relleno con el prefijo correcto
#   (`sk_test_CHANGE_ME`, `sk_test_xxx`, el valor que ponga quien copie el
#   `.env.example`) caía en la rama `sk_test_*` e imprimía en VERDE:
#
#       ::notice title=Stripe en modo TEST::Clave de prueba presente;
#                los smokes de dinero son gate real.
#
#   …y a continuación los tres smokes de dinero morían 6 minutos después con
#   `element(s) not found` porque el modal de Stripe nunca monta. Falso verde
#   dentro de la puerta que decide la promoción a producción. Mismo patrón que
#   el seed que no pisa lo existente (§32) y el test que fijaba su propia
#   configuración (§30.1): un detector que se cree a sí mismo.
#
# QUÉ HACE
#   1. Clasifica `STRIPE_TEST_SECRET_KEY` y `STRIPE_TEST_PUBLISHABLE_KEY` por su
#      FORMA: prefijo + longitud + alfabeto + lista de palabras de relleno.
#      «Existe» deja de ser sinónimo de «sirve».
#   2. Decide el modo del gate de dinero (`on` / `off`) y, si está `off`, FILTRA
#      los specs de dinero de la lista de smoke, declarándolos SALTADOS por falta
#      de credencial (no los borra, no los marca opcionales: siguen siendo
#      obligatorios en cuanto la credencial exista).
#   3. Escribe el veredicto en `$GITHUB_STEP_SUMMARY` (visible en la página del
#      run, sin abrir logs), en `$GITHUB_OUTPUT`/`$GITHUB_ENV` y en stdout.
#
# QUÉ NO HACE
#   · No llama a `api.stripe.com`. Es un juicio de FORMA, no de autenticación.
#     Razón: (a) desde la máquina de trabajo del equipo el egress a Stripe está
#     bloqueado (§31.2) y un preflight que dependiera de red sería inestable;
#     (b) una clave con forma real y revocada la caza el propio smoke, que es
#     donde debe caerse. Lo que este script promete es exactamente: «esto no es
#     un relleno». Nada más.
#   · No imprime NUNCA el valor de una clave. Sólo prefijo, longitud y veredicto.
#   · No toca `frontend/e2e/`. Los specs son del rol frontend (CLAUDE.md).
#
# USO
#   STRIPE_TEST_SECRET_KEY=… STRIPE_TEST_PUBLISHABLE_KEY=… \
#   SMOKE_SPECS="checkout.spec.ts …" REQUIRE_REAL_STRIPE=false \
#     scripts/stripe-test-key-preflight.sh
#
# SALIDA (stdout + $GITHUB_OUTPUT si existe)
#   money_gate      on | off
#   secret_verdict  real | relleno | ausente | live | formato
#   pub_verdict     idem
#   specs           lista de specs que SÍ se van a correr
#   skipped_specs   specs de dinero saltados (vacío si money_gate=on)
#
# CÓDIGOS DE SALIDA
#   0  Decisión tomada (gate ON, o gate OFF con specs restantes por correr).
#   1  Abortar: clave `sk_live_`, formato desconocido, `REQUIRE_REAL_STRIPE=true`
#      sin credencial utilizable, o no queda ni un solo spec que correr.
# =============================================================================
set -uo pipefail

SECRET_KEY="${STRIPE_TEST_SECRET_KEY:-}"
PUB_KEY="${STRIPE_TEST_PUBLISHABLE_KEY:-}"
SMOKE_SPECS="${SMOKE_SPECS:-}"
# Los tres smokes que exigen proveedor de pago REAL (abren el modal de Stripe).
# Fuente única de verdad: si mañana hay un cuarto flujo de dinero, se añade aquí.
MONEY_SPECS="${MONEY_SPECS:-checkout.spec.ts guest-checkout.spec.ts shipments.spec.ts}"
REQUIRE_REAL_STRIPE="${REQUIRE_REAL_STRIPE:-false}"

# Longitud mínima del sufijo (lo que va DESPUÉS de `sk_test_`) para que el valor
# pueda ser una credencial. Las claves legacy de Stripe traen 24 caracteres; las
# actuales (`sk_test_51…`) rondan los 100. `e2e_dummy` trae 9 y `CHANGE_ME` 9.
MIN_SUFIJO=24

# Palabras que delatan un relleno aunque el prefijo y la longitud sean plausibles.
# Se comparan sin distinguir mayúsculas, como subcadena del sufijo, y SOLO después
# de las reglas de longitud y alfabeto.
#
# POR QUÉ NO HAY TOKENS DE 3 LETRAS AQUÍ (`xxx`, `foo`, `bar`, `tbd`), que era mi
# primera versión: una clave AUTÉNTICA de Stripe es una cadena alfanumérica de ~99
# caracteres, y la probabilidad de que contenga por azar alguna de esas secuencias
# es ~2%. Un preflight que declara «relleno» una clave buena una de cada cincuenta
# veces es otro detector que miente, sólo que en la dirección contraria — y encima
# bloquearía una promoción a prod sin motivo. Con palabras de 4+ caracteres el azar
# baja a ~1e-4, y los rellenos cortos de verdad (`e2e_dummy`, `CHANGE_ME`, `xxx`)
# los caza antes la regla de longitud o la de alfabeto, que no tienen falsos
# positivos posibles. Prefiero dos reglas exactas y una heurística conservadora
# que una heurística agresiva que haya que ir excepcionando.
RELLENOS='dummy|changeme|placeholder|example|ejemplo|sample|fake|falso|redacted|replace|notset|unset|invalid|testkey|miclave|relleno|ponaqui|secreto|password|tuclave|yourkey|aqui'
# Cuatro caracteres idénticos seguidos: `xxxx…`, `0000…`, `aaaa…`. Firma inequívoca
# de relleno tecleado a mano; en una clave real es ~4e-4.
REPETIDOS='(.)\1\1\1'

# --- clasificador -------------------------------------------------------------
# clasificar <valor> <prefijo_test> <prefijo_live>  ->  eco del veredicto
#   ausente | live | formato | relleno | real
clasificar() {
  local valor="$1" pref_test="$2" pref_live="$3" sufijo minus
  [ -z "$valor" ] && { echo "ausente"; return; }
  case "$valor" in
    "$pref_live"*) echo "live"; return ;;
  esac
  case "$valor" in
    "$pref_test"*) sufijo="${valor#"$pref_test"}" ;;
    # `rk_test_` = clave RESTRINGIDA de test. DEVOPS_NOTES §31.1 la ofrece como
    # alternativa válida (basta escritura en PaymentIntents); el preflight viejo
    # la habría abortado como «formato inesperado». Se acepta.
    rk_test_*) sufijo="${valor#rk_test_}" ;;
    *) echo "formato"; return ;;
  esac
  # El orden importa: primero las dos reglas EXACTAS (sin falsos positivos
  # posibles) y sólo al final la heurística de vocabulario.
  #
  # 1) Longitud. Las claves legacy de Stripe traen 24 caracteres tras el prefijo;
  #    las actuales (`sk_test_51…`) rondan los 100. `e2e_dummy` trae 9, `CHANGE_ME`
  #    trae 9. Nada por debajo de 24 puede ser una credencial.
  if [ "${#sufijo}" -lt "$MIN_SUFIJO" ]; then echo "relleno"; return; fi
  # 2) Alfabeto. Las claves de Stripe son alfanuméricas puras. Un `_`, un guion, un
  #    espacio o una comilla significan «esto lo escribió una persona», no Stripe.
  if printf '%s' "$sufijo" | grep -Eqv '^[A-Za-z0-9]+$'; then echo "relleno"; return; fi
  # 3) Vocabulario y repeticiones: relleno largo y alfanumérico, del tipo
  #    `sk_test_dummydummydummydummy` o `sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxx`.
  minus="$(printf '%s' "$sufijo" | tr '[:upper:]' '[:lower:]')"
  if printf '%s' "$minus" | grep -Eq "$RELLENOS"; then echo "relleno"; return; fi
  if printf '%s' "$minus" | grep -Eq "$REPETIDOS"; then echo "relleno"; return; fi
  echo "real"
}

# describir <veredicto> <nombre_var> -> frase corta para humanos
describir() {
  case "$1" in
    real)    echo "clave con forma de credencial real" ;;
    relleno) echo "VALOR DE RELLENO (no es una credencial)" ;;
    ausente) echo "secret NO configurado en GitHub" ;;
    live)    echo "CLAVE LIVE — prohibida en staging/E2E" ;;
    formato) echo "formato desconocido (no es sk_test_/pk_test_/rk_test_)" ;;
  esac
}

# huella <valor> -> pista NO sensible para el log (prefijo + longitud)
huella() {
  local v="${1:-}"
  [ -z "$v" ] && { echo "(vacío)"; return; }
  printf '%s… (%s caracteres en total)\n' "$(printf '%s' "$v" | cut -c1-8)" "${#v}"
}

SECRET_VERDICT="$(clasificar "$SECRET_KEY" "sk_test_" "sk_live_")"
PUB_VERDICT="$(clasificar "$PUB_KEY" "pk_test_" "pk_live_")"

# --- salidas ------------------------------------------------------------------
resumen() { [ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '%s\n' "$1" >> "$GITHUB_STEP_SUMMARY"; printf '%s\n' "$1"; }
salida()  { [ -n "${GITHUB_OUTPUT:-}" ] && printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"; printf '::out:: %s=%s\n' "$1" "$2"; }
entorno() { [ -n "${GITHUB_ENV:-}" ] && printf '%s=%s\n' "$1" "$2" >> "$GITHUB_ENV"; }

resumen "## Preflight de Stripe (claves de PRUEBA)"
resumen ""
resumen "| Variable | Qué llegó | Veredicto |"
resumen "|---|---|---|"
resumen "| \`STRIPE_TEST_SECRET_KEY\` | $(huella "$SECRET_KEY") | **$(describir "$SECRET_VERDICT")** |"
resumen "| \`STRIPE_TEST_PUBLISHABLE_KEY\` | $(huella "$PUB_KEY") | **$(describir "$PUB_VERDICT")** |"
resumen ""

# --- aborto duro 1: clave LIVE (nunca, en ninguna rama) -----------------------
for par in "STRIPE_TEST_SECRET_KEY:$SECRET_VERDICT" "STRIPE_TEST_PUBLISHABLE_KEY:$PUB_VERDICT"; do
  if [ "${par#*:}" = "live" ]; then
    resumen "> **ABORTADO — clave LIVE en staging.** \`${par%%:*}\` trae una clave \`*_live_\`. Staging y E2E NUNCA usan claves live."
    echo "::error title=CLAVE LIVE EN STAGING::${par%%:*} trae una clave live. Staging y E2E nunca usan claves live. Abortado sin imprimir el valor. Ver DEVOPS_NOTES §31.1."
    exit 1
  fi
done

# --- aborto duro 2: formato desconocido ---------------------------------------
if [ "$SECRET_VERDICT" = "formato" ] || [ "$PUB_VERDICT" = "formato" ]; then
  resumen "> **ABORTADO — formato desconocido.** Se esperaba \`sk_test_…\` (o \`rk_test_…\`) y \`pk_test_…\`."
  echo "::error title=Clave de Stripe con formato desconocido::STRIPE_TEST_SECRET_KEY debe empezar con sk_test_ (o rk_test_) y STRIPE_TEST_PUBLISHABLE_KEY con pk_test_. Abortado sin imprimir el valor. Ver DEVOPS_NOTES §31.1."
  exit 1
fi

# --- ¿hay proveedor de pago utilizable? ---------------------------------------
# Las DOS claves tienen que ser reales: sin `pk_test_` el modal de Stripe no monta
# en el navegador aunque el backend cree la sesión, y los tres smokes fallarían
# igual — con el agravante de parecer un bug de producto.
GATE_ON=false
[ "$SECRET_VERDICT" = "real" ] && [ "$PUB_VERDICT" = "real" ] && GATE_ON=true

MOTIVO=""
if [ "$GATE_ON" != "true" ]; then
  if [ "$SECRET_VERDICT" != "real" ]; then
    MOTIVO="STRIPE_TEST_SECRET_KEY: $(describir "$SECRET_VERDICT")"
  fi
  if [ "$PUB_VERDICT" != "real" ]; then
    [ -n "$MOTIVO" ] && MOTIVO="$MOTIVO; "
    MOTIVO="${MOTIVO}STRIPE_TEST_PUBLISHABLE_KEY: $(describir "$PUB_VERDICT")"
  fi
fi

# --- separar specs de dinero del resto ----------------------------------------
CORREN=""; SALTADOS=""
for spec in $SMOKE_SPECS; do
  base="${spec##*/}"
  es_dinero=false
  for m in $MONEY_SPECS; do [ "$base" = "$m" ] && es_dinero=true; done
  if [ "$es_dinero" = "true" ] && [ "$GATE_ON" != "true" ]; then
    SALTADOS="${SALTADOS:+$SALTADOS }$spec"
  else
    CORREN="${CORREN:+$CORREN }$spec"
  fi
done

# --- rama A: hay credencial -> TODO corre, gate de dinero ACTIVO --------------
if [ "$GATE_ON" = "true" ]; then
  resumen "**Gate de dinero: ACTIVO.** Las dos claves tienen forma de credencial real, así que los tres smokes de dinero corren y son OBLIGATORIOS."
  resumen ""
  resumen "- Specs que corren: \`$CORREN\`"
  resumen "- Specs saltados: **ninguno**"
  resumen ""
  resumen "> Un rojo en \`checkout\` · \`guest-checkout\` · \`shipments\` a partir de aquí **es un bug de producto**, no falta de entorno."
  echo "::notice title=Gate de dinero ACTIVO::Claves de prueba de Stripe con forma real. Los 3 smokes de dinero (checkout · guest-checkout · shipments) corren y son obligatorios."
  salida money_gate on
  salida secret_verdict "$SECRET_VERDICT"
  salida pub_verdict "$PUB_VERDICT"
  salida specs "$CORREN"
  salida skipped_specs ""
  entorno EFFECTIVE_SMOKE_SPECS "$CORREN"
  entorno MONEY_GATE on
  entorno MONEY_SKIPPED ""
  exit 0
fi

# --- rama B: no hay credencial y ESTA corrida la exige -> abortar YA ----------
if [ "$REQUIRE_REAL_STRIPE" = "true" ]; then
  resumen "**Gate de dinero: EXIGIDO Y NO DISPONIBLE. Abortado.**"
  resumen ""
  resumen "- Motivo: $MOTIVO"
  resumen "- Esta corrida es el **gate de promoción a producción** (\`require_real_stripe: true\`), y ahí los tres smokes de dinero **no son saltables**."
  resumen "- Dónde se arregla: GitHub → *Settings > Secrets and variables > Actions* → secrets \`STRIPE_TEST_SECRET_KEY\` (\`sk_test_…\`) y \`STRIPE_TEST_PUBLISHABLE_KEY\` (\`pk_test_…\`), del dashboard de Stripe **en Test mode**. Instrucciones exactas: \`docs/DEVOPS_NOTES.md\` §31.1. **NUNCA una clave live.**"
  echo "::error title=Gate de promocion sin clave de PRUEBA real::$MOTIVO. Esta corrida promueve a produccion y exige los 3 smokes de dinero. Pon los secrets STRIPE_TEST_SECRET_KEY (sk_test_...) y STRIPE_TEST_PUBLISHABLE_KEY (pk_test_...) en Settings > Secrets and variables > Actions. Ver DEVOPS_NOTES 31.1. Nunca una clave live."
  exit 1
fi

# --- rama C: no hay credencial y NO se exige -> saltar los 3, correr el resto --
if [ -z "$CORREN" ]; then
  resumen "**Abortado: no queda ningún smoke que correr.**"
  resumen ""
  resumen "- Motivo: $MOTIVO"
  resumen "- Todos los specs pedidos (\`$SMOKE_SPECS\`) son de dinero, así que saltarlos dejaría el job **vacío**. Un job vacío en verde es exactamente el falso verde que este preflight vino a quitar."
  echo "::error title=Sin specs ejecutables::Todos los smokes pedidos son de dinero y no hay clave de prueba real ($MOTIVO). Un job vacio en verde seria un falso verde: se aborta. Ver DEVOPS_NOTES 31.7."
  exit 1
fi

resumen "**Gate de dinero: INACTIVO — los smokes de dinero se SALTAN por falta de credencial.**"
resumen ""
resumen "- Motivo: $MOTIVO"
resumen "- **Saltados (no ejecutados, NO aprobados):** \`$SALTADOS\`"
resumen "- Sí se ejecutan: \`$CORREN\`"
resumen ""
resumen "> **Qué significa el verde de este run:** que los flujos NO monetarios funcionan contra el stack real."
resumen "> **NO significa** que comprar, comprar-como-invitado y retirar funcionen: hoy **nadie los ha probado** en este run."
resumen "> Se ejecutan solos, sin tocar nada, en cuanto existan los secrets \`STRIPE_TEST_SECRET_KEY\` y \`STRIPE_TEST_PUBLISHABLE_KEY\` (§31.1)."
resumen "> La ruta de promoción a producción (\`require_real_stripe: true\`) **no los salta jamás**: allí esto es un rojo inmediato."
echo "::warning title=SIN GATE DE DINERO — 3 smokes SALTADOS::$MOTIVO. Se saltan checkout · guest-checkout · shipments (no ejecutados, NO aprobados) y corre el resto del E2E real. Este verde NO cubre los flujos de dinero. Arreglo: secrets STRIPE_TEST_SECRET_KEY y STRIPE_TEST_PUBLISHABLE_KEY (DEVOPS_NOTES 31.1)."
salida money_gate off
salida secret_verdict "$SECRET_VERDICT"
salida pub_verdict "$PUB_VERDICT"
salida specs "$CORREN"
salida skipped_specs "$SALTADOS"
entorno EFFECTIVE_SMOKE_SPECS "$CORREN"
entorno MONEY_GATE off
entorno MONEY_SKIPPED "$SALTADOS"
exit 0

#!/usr/bin/env bash
# =============================================================================
# scripts/check-e2e-harness-gaps.sh — Propiedad: devops
# TCG Vault MX — el arnés E2E no puede volver a SALTARSE el cobro ni la subida
#                (§39 de docs/DEVOPS_NOTES.md)
# =============================================================================
# POR QUÉ EXISTE ESTE CHECK
#   QA midió sobre el release del ciclo de compra: 35 verdes, 3 rojos, y los tres
#   rojos eran el modal de pago con `STRIPE_SECRET_KEY ausente`. Además, sin MinIO
#   en la ruta nativa, el smoke de infraestructura se AUTO-SALTABA el PUT
#   presignado del INE. Dos flujos —COBRAR y SUBIR EL INE— quedaban sin ejercitar,
#   y la corrida no lo decía en su código de salida.
#
#   Y lleva DOS releases así. La frase del gate, que es el motivo de que esto sea
#   un check y no una nota: «una deuda que se acepta cada vez deja de ser una
#   excepción y pasa a ser el estado normal».
#
#   El arreglo (una variable de entorno en un YAML, una llamada en un script) es
#   exactamente el tipo de línea que alguien quita un martes «porque el job estaba
#   rojo». Y su ausencia NO produce un rojo: produce un VERDE que no significa
#   nada. Mismo criterio y misma forma que `check-provenance-gate.sh` y
#   `check-e2e-provider-incapacitation.sh`.
#
# QUÉ VERIFICA (estático: lee ficheros, sin red, sin stack)
#   1. Existe y es ejecutable `scripts/e2e-capability-gate.sh`.
#   2. `stack-native.sh` levanta object storage (`start_s3`) como parte de la infra.
#   3. `stack-native.sh up --gate` EXIGE las capacidades (no se limita a avisar).
#   4. `stack-native.sh test:integration` corre con `E2E_STRICT_INFRA` en true.
#   5. `.github/workflows/e2e.yml` declara `E2E_STRICT_INFRA: "true"` en el job
#      que corre la integración del backend.
#   6. La promoción a producción (`deploy.yml`) llama a `e2e-real.yml` con
#      `require_real_stripe: true` — sin eso, los tres smokes de dinero se filtran
#      y prod se promueve con el cobro sin probar.
#
# QUÉ **NO** verifica: que las capacidades ESTÉN presentes en la máquina donde se
#   corra (eso lo mide `e2e-capability-gate.sh`, que sí necesita red y stack). Esto
#   solo verifica que el candado SIGUE CABLEADO.
#
# USO:  ./scripts/check-e2e-harness-gaps.sh     (exit 0 = cableado; 1 = falta algo)
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

ok()  { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { printf '\033[1;31m  ✖ %s\033[0m\n' "$*" >&2; FAILED=1; }
FAILED=0

# -----------------------------------------------------------------------------
# ⚠️ NO USAR `grep -q` AL FINAL DE UN PIPELINE EN ESTE FICHERO (medido, 2026-09-10)
# Razón entera y números: docs/DEVOPS_NOTES.md §45.2.
#
# `set -o pipefail` (arriba) + `grep -q` = carrera SIGPIPE. `grep -q` sale en
# cuanto encuentra el patrón y cierra el pipe; si el escritor (awk/grep) todavía
# tenía cola por volcar, se lleva un SIGPIPE y sale 141. Con `pipefail`, el
# estado del PIPELINE pasa a 141 **aunque el patrón SÍ estuviera**, el `if` toma
# la rama ELSE y la guarda inventa un rojo.
#
# No es teórico: el bloque del check 2 son 4 483 B y `start_s3` cae en el byte
# 747, así que mawk vuelca un primer bloque de 4 096 B —que ya contiene el
# match—, grep sale, y el segundo write (387 B) muere. Medido en este repo:
# **10 falsos rojos de 300 corridas (3,3 %)** del pipeline real. Eso es lo que
# tumbó `e2e-harness-gaps` en el run 34441149856 con el árbol INTACTO.
#
# Una guarda intermitente es tan mala como una que nunca falla: enseña al equipo
# a re-lanzar hasta que salga verde, y entonces el día que el rojo sea de verdad
# también se re-lanza. Es la misma enfermedad que este repo vino arreglando.
#
# EL ARREGLO: `grep PATRÓN >/dev/null` en vez de `grep -q PATRÓN`. Sin `-q`,
# grep CONSUME toda la entrada antes de salir, así que el escritor nunca escribe
# contra un pipe cerrado. Mismo código de salida, misma semántica, sin carrera.
# -----------------------------------------------------------------------------

printf '\n\033[1;36m▸ Guarda del arnés E2E: ¿sigue siendo IMPOSIBLE saltarse cobro y subida?\033[0m\n'

CAP="scripts/e2e-capability-gate.sh"
STACK="scripts/stack-native.sh"
E2E_WF=".github/workflows/e2e.yml"
DEPLOY_WF=".github/workflows/deploy.yml"

# --- 1. El medidor de capacidades existe --------------------------------------
if [ -x "$CAP" ]; then
  ok "$CAP existe y es ejecutable."
else
  bad "FALTA $CAP (o no es ejecutable). Es quien decide si este entorno PUEDE
     ejercitar cobro y subida; sin él, 'up --gate' no puede exigir nada."
fi

# --- 2. La ruta nativa levanta object storage ---------------------------------
if [ -f "$STACK" ]; then
  if awk '/^start_infra\(\)/,/^}/' "$STACK" | grep 'start_s3' >/dev/null; then
    ok "'start_infra' levanta object storage (start_s3)."
  else
    bad "'start_infra' de $STACK ya NO levanta object storage. Sin él, el PUT
     presignado del INE vuelve a no tener contra qué correr y el smoke se salta
     solo: la subida de PII deja de estar cubierta y la corrida sale verde."
  fi

  # --- 3. `up --gate` EXIGE, no avisa ----------------------------------------
  # Se acota al cuerpo del verbo `up)` para no dar verde por una mención en un
  # comentario de otra parte del fichero — mismo criterio que check-provenance-gate.
  UP_BODY="$(awk '/^  up\)/,/^  test:integration\)/' "$STACK")"
  # La comilla de cierre de "$SCRIPT_DIR/…" queda entre el nombre y la bandera.
  if printf '%s' "$UP_BODY" | grep -E 'e2e-capability-gate\.sh"? +--require-all' >/dev/null; then
    ok "'up --gate' EXIGE las capacidades (--require-all), no solo las informa."
  else
    bad "'up --gate' ya no llama a e2e-capability-gate.sh --require-all. Un aviso que
     no cambia el código de salida no gatea nada: lo lee quien ya lo sabía. Ésa era
     la forma EXACTA del hueco anterior (tres 'warn' y exit 0)."
  fi

  # --- 4. La integración corre en modo estricto ------------------------------
  INT_BODY="$(awk '/^  test:integration\)/,/^  verify:head\)/' "$STACK")"
  if printf '%s' "$INT_BODY" | grep 'E2E_STRICT_INFRA' >/dev/null; then
    ok "'test:integration' fija E2E_STRICT_INFRA (el smoke de infra no puede saltarse)."
  else
    bad "'test:integration' de $STACK ya no fija E2E_STRICT_INFRA. Sin él,
     infra-smoke.e2e-spec.ts vuelve a saltarse Redis y el PUT presignado con un
     console.warn, y la suite sale VERDE con la subida del INE sin ejercitar."
  fi
else
  bad "FALTA $STACK."
fi

# --- 5. CI: el smoke de infra es estricto -------------------------------------
if grep -qE '^\s*E2E_STRICT_INFRA:\s*"?true"?\s*$' "$E2E_WF" 2>/dev/null; then
  ok "$E2E_WF declara E2E_STRICT_INFRA: true."
else
  bad "$E2E_WF ya NO declara E2E_STRICT_INFRA: \"true\". El job tiene MinIO como
     service, así que sin esta línea un bucket mal aprovisionado (403) se salta con
     un warn y el job sale verde sin haber subido nada. Medido: mismo spec, misma
     infra rota, 3 passed sin la variable y 1 failed con ella."
fi

# --- 6. La promoción a prod exige clave de Stripe real ------------------------
# Se mira la vecindad del `uses:` de e2e-real.yml, no el fichero entero: si se
# mirara el fichero entero, un `require_real_stripe` mencionado en un comentario de
# otro job daría verde — verde por mencionar, que es el modo de fallo que estos
# checks existen para no repetir.
if grep -A8 'uses: ./.github/workflows/e2e-real.yml' "$DEPLOY_WF" 2>/dev/null \
     | grep -E '^\s*require_real_stripe:\s*true\s*$' >/dev/null; then
  ok "$DEPLOY_WF promueve a prod exigiendo clave de PRUEBA real (require_real_stripe: true)."
else
  bad "$DEPLOY_WF ya NO pasa 'require_real_stripe: true' al gate E2E. Sin eso, el
     preflight FILTRA los tres smokes de dinero (checkout · guest-checkout ·
     shipments) y la promoción a producción sale verde SIN haber probado cobrar.
     Es el mismo falso verde de §33, con otra puerta."
fi

echo ""
if [ "$FAILED" -ne 0 ]; then
  printf '\033[1;31m✖ El arnés E2E puede volver a SALTARSE un flujo crítico sin decirlo.\033[0m\n' >&2
  printf '  Contexto y mediciones: docs/DEVOPS_NOTES.md §39.\n' >&2
  printf '  Si el desmontaje es DELIBERADO, no lo hagas en silencio: dilo en DEVOPS_NOTES y\n' >&2
  printf '  que lo firme quien acepte publicar con el cobro o la subida del INE sin verificar.\n' >&2
  exit 1
fi
printf '\033[1;32m✔ Cobro y subida no se pueden saltar en silencio: los 6 puntos siguen cableados.\033[0m\n'

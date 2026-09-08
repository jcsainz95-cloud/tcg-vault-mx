#!/usr/bin/env bash
# =============================================================================
# scripts/check-provenance-gate.sh — Propiedad: devops
# TCG Vault MX — el gate NO puede medir un binario distinto del HEAD auditado
#                (SEC-OPS-1 · docs/SECURITY_NOTES.md §9 · DEVOPS_NOTES §38)
# =============================================================================
# POR QUÉ ESTE CHECK EXISTE Y NO ES PARANOIA
#   SEC-OPS-1 no es un bug: es un defecto de PROCESO que ya se materializó DOS
#   veces, y las dos lo cazó una persona por casualidad mirando la hora de un PID:
#     · 2026-08-29 (SEC-M43-6): backend de las 20:10 auditando el arreglo de las 21:34.
#     · 2026-09-06 (v1.56):     backend de las 15:04 auditando el arreglo de las 16:16.
#   El arreglo (el comprobador de procedencia y sus tres puntos de cableado) es
#   justo el tipo de código que alguien quita «porque estorbaba» un martes, y el
#   síntoma de haberlo quitado no es un rojo: es un VERDE que no significa nada.
#   Por eso hay un check estático que se niega a dejarlo desaparecer en silencio.
#   Mismo criterio y misma forma que `check-e2e-provider-incapacitation.sh`.
#
# QUÉ VERIFICA (estático: lee ficheros, sin red, sin stack)
#   1. Existe y es ejecutable `scripts/assert-serving-head.sh`.
#   2. `stack-native.sh` NO reutiliza un backend vivo sin comprobar procedencia:
#      la rama de reutilización de `start_backend()` pasa por el comprobador.
#   3. `stack-native.sh up` termina PROBANDO el resultado (`verify_head`), y
#      expone el subcomando `verify:head` para que QA/seguridad lo corran solos.
#   4. El harness E2E (`e2e-real.yml`) exige que el backend medido haya nacido de
#      su propio arranque (`--newer-than`).
#   5. La promoción a prod pasa por `staging-serves-head` ANTES del DAST.
#
# QUÉ **NO** verifica: que el comprobador funcione (eso es su propio trabajo, y se
#   midió a mano — DEVOPS_NOTES §38.2). Esto solo verifica que SIGUE CABLEADO.
#
# USO:  ./scripts/check-provenance-gate.sh        (exit 0 = cableado; 1 = falta algo)
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

ok()   { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad()  { printf '\033[1;31m  ✖ %s\033[0m\n' "$*" >&2; FAILED=1; }
FAILED=0

printf '\n\033[1;36m▸ Guarda SEC-OPS-1: ¿sigue cableado el comprobador de procedencia?\033[0m\n'

ASSERT="scripts/assert-serving-head.sh"
STACK="scripts/stack-native.sh"
E2E_WF=".github/workflows/e2e-real.yml"
DEPLOY_WF=".github/workflows/deploy.yml"

# --- 1. El comprobador existe -------------------------------------------------
if [ -x "$ASSERT" ]; then
  ok "$ASSERT existe y es ejecutable."
else
  bad "FALTA $ASSERT (o no es ejecutable). Sin él, ninguno de los tres puntos de
     cableado de abajo puede funcionar. Es la pieza central de SEC-OPS-1."
fi

# --- 2. El arranque local no reutiliza a ciegas -------------------------------
# El bug original era literalmente: «¿responde? ⇒ ok, return 0». Se comprueba que
# entre el `curl` de salud y el `return 0` de reutilización hay una llamada al
# comprobador. Se acota al cuerpo de `start_backend()` para no dar verde por una
# mención en un comentario de otra parte del fichero.
if [ -f "$STACK" ]; then
  BODY="$(awk '/^start_backend\(\)/,/^}/' "$STACK")"
  if printf '%s' "$BODY" | grep -q 'ASSERT_HEAD'; then
    ok "start_backend() comprueba la procedencia antes de reutilizar un backend vivo."
  else
    bad "start_backend() de $STACK reutiliza el backend vivo SIN comprobar qué sirve.
     Eso es EXACTAMENTE SEC-OPS-1: el gate mide un binario que no es el HEAD auditado,
     y falla en la dirección peligrosa (aprobar lo que no se probó).
     Restaura la llamada a \$ASSERT_HEAD en la rama de reutilización."
  fi
  if printf '%s' "$BODY" | grep -q 'write_stamp'; then
    ok "start_backend() deja constancia del commit servido (sello de procedencia)."
  else
    bad "start_backend() ya no escribe el sello: el arranque deja de decir QUÉ commit
     sirve y el siguiente auditor tiene que deducirlo de la hora de un PID otra vez."
  fi
else
  bad "FALTA $STACK."
fi

# --- 3. `up` lo PRUEBA, y hay verbo para verificar a mano ---------------------
if grep -q 'verify:head)' "$STACK" 2>/dev/null; then
  ok "$STACK expone el subcomando 'verify:head' (lo corren QA/seguridad/pentester)."
else
  bad "$STACK ya no expone 'verify:head'. Es el comando que un auditor corre ANTES
     de su primera medición; sin él vuelve a depender de acordarse."
fi
if awk '/^  up\)/,/^  test:integration\)/' "$STACK" 2>/dev/null | grep -q 'verify_head'; then
  ok "'up' termina PROBANDO que el stack sirve el árbol de ahora (no lo afirma)."
else
  bad "'up' ya no corre 'verify_head' al final: vuelve a AFIRMAR que el stack está
     al día en vez de PROBARLO."
fi

# --- 4. Harness E2E -----------------------------------------------------------
if grep -q 'assert-serving-head.sh' "$E2E_WF" 2>/dev/null && grep -q 'newer-than' "$E2E_WF" 2>/dev/null; then
  ok "$E2E_WF exige que el backend medido haya nacido de su propio arranque."
else
  bad "$E2E_WF ya no comprueba la procedencia del stack que mide. Un contenedor
     superviviente de otra corrida daría el mismo verde falso."
fi

# --- 5. Gate DAST → prod ------------------------------------------------------
if grep -qE '^  staging-serves-head:' "$DEPLOY_WF" 2>/dev/null; then
  ok "$DEPLOY_WF define el job 'staging-serves-head'."
else
  bad "$DEPLOY_WF ya no define 'staging-serves-head': el DAST puede volver a escanear
     la revisión ANTERIOR de staging y promover a prod un commit que nadie escaneó."
fi
# El `needs:` de `dast-staging`, no el fichero entero: si se mira el fichero entero,
# la propia DEFINICIÓN del job `staging-serves-head` haría pasar el check aunque el
# DAST no lo esperase — verde por mencionar, que es el modo de fallo que este script
# existe para no repetir.
if grep -A6 '^  dast-staging:' "$DEPLOY_WF" 2>/dev/null | grep -E '^    needs:' | grep -q 'staging-serves-head'; then
  ok "'dast-staging' depende de 'staging-serves-head' (escanea un binario identificado)."
else
  bad "'dast-staging' ya NO depende de 'staging-serves-head'. Aunque el job exista,
     si el DAST no lo espera, no protege nada."
fi

echo ""
if [ "$FAILED" -ne 0 ]; then
  printf '\033[1;31m✖ El gate de procedencia (SEC-OPS-1) está INCOMPLETO.\033[0m\n' >&2
  printf '  Contexto y motivo: docs/DEVOPS_NOTES.md §38 · docs/SECURITY_NOTES.md §9.\n' >&2
  printf '  Si el desmontaje es DELIBERADO, no lo hagas en silencio: dilo en DEVOPS_NOTES\n' >&2
  printf '  y que lo firme quien acepte el riesgo de volver a auditar un binario viejo.\n' >&2
  exit 1
fi
printf '\033[1;32m✔ Gate de procedencia SEC-OPS-1 cableado en los tres puntos.\033[0m\n'

#!/usr/bin/env bash
# =============================================================================
# scripts/check-secret-absence-wording.sh — Propiedad: devops
# TCG Vault MX — un script que no consulta GitHub no puede AFIRMAR nada sobre
#                los secrets de GitHub.
# =============================================================================
# POR QUÉ EXISTE (B-3, medido el 2026-09-14 — DEVOPS_NOTES §60)
#
#   `scripts/stripe-test-key-preflight.sh` clasifica lo que le llega POR EL
#   ENTORNO. No tiene token, no llama a la API, no sabe qué secrets existen.
#   Su rama `ausente` decía, literal: «secret NO configurado en GitHub».
#
#   En la máquina de un agente esa frase se imprime SIEMPRE —allí no hay ninguna
#   variable de GitHub, por construcción—, así que era una afirmación constante
#   sobre un sistema que el script nunca miró.
#
#   Coste real, no hipotético: QA corrió `stack-native.sh up --seed --gate` en
#   local, leyó esa frase propagada por `e2e-capability-gate.sh`, y reportó como
#   BLOQUEANTE que «el gate de dinero tampoco corre en CI». Medido contra la API
#   de GitHub: era falso. Las nocturnas de `e2e-real.yml` del 11, 12 y 13 de
#   septiembre corrieron con el gate de dinero **ON** (no subieron el artefacto
#   `SIN-MEDIR-comprar-invitado-retirar`, que se sube si y solo si está `off`, y
#   que existía en los tres SHA). Un mensaje mandó a investigar un hueco que no
#   existía, y tapó el que sí: esas tres nocturnas están ROJAS.
#
#   Es la misma clase que el propio preflight persigue (§31.7, «un detector que
#   se cree a sí mismo»), movida del criterio al mensaje.
#
# QUÉ COMPRUEBA
#   1. Fuera de GitHub Actions, el preflight NO afirma nada sobre GitHub en su
#      veredicto de ausencia: ni «NO configurado en GitHub» ni equivalentes.
#   2. Fuera de GitHub Actions, el veredicto dice DÓNDE se midió (nombra que es
#      el entorno local / este proceso). Un mensaje que calla el dónde vuelve a
#      leerse como universal.
#   3. Dentro de GitHub Actions (simulado con `GITHUB_ACTIONS=true`), el
#      veredicto SÍ puede hablar del runner — ahí la medición aplica.
#   4. CANARIO: sobre una COPIA del script con la frase vieja reinyectada, este
#      candado se pone ROJO. Sin esto, el candado podría estar comprobando nada.
#
# QUÉ NO COMPRUEBA
#   · Si los secrets existen de verdad en GitHub. Eso NO se puede medir desde un
#     script sin token — que es justamente el punto. Se mide con la API de
#     Actions (`/actions/runs/<id>/artifacts`), y el procedimiento está en
#     DEVOPS_NOTES §60.
#   · No toca `backend/` ni `frontend/`.
#
# USO       ./scripts/check-secret-absence-wording.sh
# SALIDA    0 = el veredicto de ausencia no miente · 1 = miente · 2 = no se pudo medir
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PREFLIGHT="$SCRIPT_DIR/stripe-test-key-preflight.sh"

ok()   { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
no()   { printf '\033[1;31m  ✖ %s\033[0m\n' "$*"; }
log()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }

FALLOS=0
fallo() { no "$*"; FALLOS=$((FALLOS + 1)); }

[ -x "$PREFLIGHT" ] || { echo "no encuentro $PREFLIGHT (o no es ejecutable)"; exit 2; }

# Frases que afirman un hecho sobre GitHub. Si aparecen en una corrida LOCAL, el
# script está afirmando lo que no midió. Se comparan sin distinguir mayúsculas.
PATRONES_PROHIBIDOS_EN_LOCAL='no configurado en github|no existe en github|not configured in github|sin configurar en github'
# Marcas de que el mensaje dice DÓNDE se midió.
PATRONES_EXIGIDOS_EN_LOCAL='entorno local|este proceso|esta m[aá]quina'

# ---------------------------------------------------------------------------
# Corre el preflight con las dos claves VACÍAS y devuelve solo la línea de
# veredicto de `STRIPE_TEST_SECRET_KEY` (la fila de la tabla). Se aísla esa línea
# a propósito: el resto del resumen SÍ puede (y debe) explicar cómo se arregla en
# GitHub — lo que no puede es AFIRMAR que allí falta.
# ---------------------------------------------------------------------------
veredicto_ausencia() {
  local guion="$1"; shift
  env -u STRIPE_TEST_SECRET_KEY -u STRIPE_TEST_PUBLISHABLE_KEY \
      -u STRIPE_SECRET_KEY -u STRIPE_PUBLISHABLE_KEY \
      -u GITHUB_OUTPUT -u GITHUB_ENV -u GITHUB_STEP_SUMMARY \
      "$@" \
      SMOKE_SPECS="catalog.spec.ts checkout.spec.ts" \
      MONEY_SPECS="checkout.spec.ts" \
      REQUIRE_REAL_STRIPE=false \
      bash "$guion" 2>&1 | grep -E '^\| `STRIPE_TEST_SECRET_KEY`' | head -1
}

# `evaluar <guion> <etiqueta>` -> 0 si el veredicto local es honesto, 1 si miente.
# Es la MISMA función que usa el canario sobre la copia mutada: un solo criterio,
# para que candado y canario no puedan divergir.
evaluar_local() {
  local guion="$1" linea
  linea="$(veredicto_ausencia "$guion" GITHUB_ACTIONS=)"
  [ -n "$linea" ] || return 2
  printf '%s' "$linea" | grep -Eiq "$PATRONES_PROHIBIDOS_EN_LOCAL" && return 1
  printf '%s' "$linea" | grep -Eiq "$PATRONES_EXIGIDOS_EN_LOCAL"   || return 1
  return 0
}

log "¿El veredicto de ausencia afirma algo que el script no midió?"

# --- 1 y 2: corrida LOCAL -----------------------------------------------------
LINEA_LOCAL="$(veredicto_ausencia "$PREFLIGHT" GITHUB_ACTIONS=)"
if [ -z "$LINEA_LOCAL" ]; then
  no "el preflight no emitió la fila de STRIPE_TEST_SECRET_KEY: no se pudo medir."
  exit 2
fi
printf '    local  → %s\n' "$LINEA_LOCAL"

if printf '%s' "$LINEA_LOCAL" | grep -Eiq "$PATRONES_PROHIBIDOS_EN_LOCAL"; then
  fallo "fuera de GitHub Actions el veredicto AFIRMA que el secret no está en GitHub. El script no consulta GitHub: no puede saberlo."
else
  ok "fuera de GitHub Actions no se afirma nada sobre los secrets de GitHub."
fi

if printf '%s' "$LINEA_LOCAL" | grep -Eiq "$PATRONES_EXIGIDOS_EN_LOCAL"; then
  ok "el veredicto local dice DÓNDE se midió (no se puede leer como universal)."
else
  fallo "el veredicto local no nombra el entorno en el que se midió. Sin el dónde, vuelve a leerse como «en todas partes»."
fi

# --- 3: corrida SIMULANDO runner ---------------------------------------------
LINEA_CI="$(veredicto_ausencia "$PREFLIGHT" GITHUB_ACTIONS=true)"
printf '    runner → %s\n' "$LINEA_CI"
if printf '%s' "$LINEA_CI" | grep -Eiq 'runner|github'; then
  ok "dentro de GitHub Actions el veredicto sí habla del runner (ahí la medición aplica)."
else
  fallo "dentro de GitHub Actions el veredicto no distingue su entorno: las dos ramas dicen lo mismo y la distinción es decorativa."
fi

# --- 4: CANARIO ---------------------------------------------------------------
# Sobre una COPIA (O-9: nunca sobre el árbol vivo) con la frase vieja reinyectada.
log "Canario — con la frase vieja reinyectada, ¿este candado se pone ROJO?"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
COPIA="$TMP/preflight-mutado.sh"
cp "$PREFLIGHT" "$COPIA"
# La mutación reproduce el defecto exacto: la rama `ausente` vuelve a ser una
# frase constante que afirma un hecho sobre GitHub.
# Se REDEFINE `describir` justo antes del primer uso en vez de editar la función
# original: en bash gana la última definición, así que el mutante es válido
# sintácticamente pase lo que pase con el formato del original. Un mutante que
# no arranca no demuestra que el candado muerda — demuestra que se rompió.
ANCLA='SECRET_VERDICT="$(clasificar'
python3 - "$COPIA" "$ANCLA" <<'PY'
import sys
ruta, ancla = sys.argv[1], sys.argv[2]
s = open(ruta, encoding='utf-8').read()
if ancla not in s:
    sys.exit("CANARIO NO APLICABLE: no encontré el ancla '%s'" % ancla)
viejo = 'describir() { echo "secret NO configurado en GitHub"; }\n'
s = s.replace(ancla, viejo + ancla, 1)
open(ruta, 'w', encoding='utf-8').write(s)
PY
if [ $? -ne 0 ]; then
  no "no se pudo construir el mutante: el canario no midió nada."
  exit 2
fi

evaluar_local "$COPIA"; RC_CANARIO=$?
case "$RC_CANARIO" in
  1) ok "el mutante sale ROJO: el candado muerde." ;;
  0) fallo "el mutante con la frase vieja pasa VERDE. Este candado no vigila nada." ;;
  *) no "el mutante no se pudo evaluar (rc=$RC_CANARIO): el canario no midió nada."; exit 2 ;;
esac

echo
if [ "$FALLOS" -eq 0 ]; then
  printf '\033[1;32m✔ El veredicto de ausencia dice solo lo que midió, y dice dónde lo midió.\033[0m\n'
  exit 0
fi
printf '\033[1;31m✖ %s comprobación(es) en rojo.\033[0m\n' "$FALLOS"
echo "::error title=Veredicto que afirma lo que no midió::scripts/stripe-test-key-preflight.sh afirma un estado de los secrets de GitHub desde un entorno que no consulta GitHub. Ese mensaje ya costó un bloqueante falso (B-3). Ver DEVOPS_NOTES 60."
exit 1

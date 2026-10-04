#!/usr/bin/env bash
#
# check-skydropx-spend-lock.sh — 💰🔒 «ningún CI, compose ni plantilla puede darle
# a una pila de pruebas las llaves de Skydropx»                          · devops
# =============================================================================
# DE DÓNDE VIENE
# ---------------------------------------------------------------------------
# API_CONTRACT §M4-SHIP.19.19.17, PS-99 capa (d) (`C-SDX-8`), y §19.19.15 D0'.
# La compra de una guía real exige DOS llaves (dial `shipping_label_purchase` +
# env `SKYDROPX_ALLOW_SPEND`) y un candado de ejecución (`evaluateMutationGate`,
# que niega con `CI`, `NODE_ENV=test` o `JEST_WORKER_ID`). Este candado vigila la
# parte que NO es código del backend: que la configuración del repo no reparta
# las llaves. Las otras tres capas de PS-99 (a, b, c) viven en
# `backend/test/skydropx.no-real-purchase.spec.ts` (dueño: backend).
#
# Ojo con el caso que importa: la pila E2E (`docker-compose.staging.yml`, la que
# levanta e2e-real.yml y el DAST) corre el backend con NODE_ENV=production y SIN
# `CI` dentro del contenedor. Ahí el candado de ejecución solo queda cerrado
# porque `SKYDROPX_ALLOW_SPEND` NO llega. Por eso este fichero existe.
#
# QUÉ COMPRUEBA (cada bloque, su rojo)
#   (A) `.github/`: ningún fichero nombra SKYDROPX_CLIENT_ID / _CLIENT_SECRET /
#       _ALLOW_SPEND, ni lee `secrets.*`/`vars.*` con «skydropx» en el nombre.
#   (B) `docker-compose*.yml`: ninguno nombra esas tres variables (ni como clave
#       ni como `${…}`), y ninguno usa `env_file:` (pasaría un `.env` entero, y
#       con él la llave, saltándose la allow-list de `environment:`).
#   (C) `.env.example`: `SKYDROPX_ALLOW_SPEND=` presente UNA vez y VACÍA;
#       `SKYDROPX_CLIENT_ID=` y `SKYDROPX_CLIENT_SECRET=` presentes y vacías.
#   (D) La pila E2E usa el DOBLE: `docker-compose.staging.yml` fija
#       `SHIPPING_PROVIDER_ADAPTER: fake` (literal, sin `${…}`), y
#       `scripts/stack-native.sh` exporta `SHIPPING_PROVIDER_ADAPTER=fake` y
#       quita la llave del entorno heredado.
#   (E) El catálogo de secretos que el CI GENERA (`security/secretos-exigidos*.txt`)
#       no lista ninguna SKYDROPX_*: el CI no tiene credenciales, ni inventadas.
#   (F) La sonda D0 (`scripts/skydropx/prod-probe.ts`) existe con su prueba, un
#       workflow corre la prueba (`run-prod-probe.sh test`) y NINGUNO la ejecuta
#       contra la red (`run-prod-probe.sh run`).
#
# Uso:  scripts/check-skydropx-spend-lock.sh [--root <árbol>]
# Canario: scripts/check-skydropx-spend-lock-canary.sh. DEVOPS_NOTES §78.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "${1:-}" = "--root" ] && [ -n "${2:-}" ]; then ROOT_DIR="$(cd "$2" && pwd)"; fi
cd "$ROOT_DIR" || exit 1

FALLOS=0
ok()   { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
mal()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; FALLOS=$((FALLOS+1)); }
nota() { printf '      %s\n' "$*"; }

# Los nombres se arman por partes: así este fichero no es, él mismo, un hallazgo
# de otros candados que buscan el nombre literal.
P='SKYDROPX_'
LLAVES="${P}(CLIENT_ID|CLIENT_SECRET|ALLOW_SPEND)"
GASTO="${P}ALLOW_SPEND"

# --- (A) workflows ------------------------------------------------------------
printf '\n\033[1m(A) .github/ — el CI no recibe credenciales ni la llave de gasto\033[0m\n'
if [ ! -d .github ]; then
  mal "No existe .github/ en $ROOT_DIR: el candado no puede mirar lo que dice mirar."
else
  A_HITS="$(grep -rnE "$LLAVES" .github 2>/dev/null || true)"
  A_CTX="$(grep -rniE '\$\{\{[^}]*(secrets|vars)\.[A-Za-z0-9_]*skydropx' .github 2>/dev/null || true)"
  if [ -z "$A_HITS$A_CTX" ]; then
    ok "Ningún fichero de .github/ nombra las credenciales de Skydropx ni la llave de gasto."
  else
    mal "Un workflow reparte las llaves de Skydropx (PS-99 (d), C-SDX-8):"
    while IFS= read -r l; do [ -n "$l" ] && nota "$l"; done <<< "$A_HITS"$'\n'"$A_CTX"
    nota "El CI NUNCA habla con Skydropx: ni credenciales ni ${GASTO}. Las pruebas usan dobles."
  fi
fi

# --- (B) compose --------------------------------------------------------------
printf '\n\033[1m(B) docker-compose*.yml — ninguna pila local/E2E/DAST recibe las llaves\033[0m\n'
mapfile -t COMPOSES < <(ls docker-compose*.yml 2>/dev/null)
if [ "${#COMPOSES[@]}" -eq 0 ]; then
  mal "No hay docker-compose*.yml en $ROOT_DIR: el candado no puede mirar lo que dice mirar."
else
  B_HITS="$(grep -nE "$LLAVES" "${COMPOSES[@]}" 2>/dev/null | grep -vE '^[^:]+:[0-9]+:[[:space:]]*#' || true)"
  B_ENVF="$(grep -nE '^[[:space:]]*env_file[[:space:]]*:' "${COMPOSES[@]}" 2>/dev/null || true)"
  if [ -z "$B_HITS" ]; then
    ok "Ningún compose (${#COMPOSES[@]}) pasa credenciales de Skydropx ni ${GASTO}."
  else
    mal "Un compose pasa las llaves de Skydropx a una pila que NO es producción:"
    while IFS= read -r l; do [ -n "$l" ] && nota "$l"; done <<< "$B_HITS"
    nota "La pila E2E corre con NODE_ENV=production y sin CI: ahí la llave de gasto abriría el candado."
  fi
  if [ -z "$B_ENVF" ]; then
    ok "Ningún compose usa env_file: (la allow-list de environment: se respeta)."
  else
    mal "Un compose usa env_file: — pasaría un .env entero, con la llave de gasto incluida:"
    while IFS= read -r l; do [ -n "$l" ] && nota "$l"; done <<< "$B_ENVF"
  fi
fi

# --- (C) .env.example -----------------------------------------------------------
printf '\n\033[1m(C) .env.example — la plantilla trae las llaves VACÍAS\033[0m\n'
valor_de() { # $1 = nombre → imprime «n=<veces>» y, por línea, el valor sin comentario
  grep -nE "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" .env.example 2>/dev/null \
    | sed -E "s/^([0-9]+):[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=//; s/[[:space:]]#.*$//; s/^[\"']?//; s/[\"']?[[:space:]]*$//"
}
if [ ! -f .env.example ]; then
  mal "No existe .env.example."
else
  for var in "${P}ALLOW_SPEND" "${P}CLIENT_ID" "${P}CLIENT_SECRET"; do
    mapfile -t VALS < <(valor_de "$var")
    if [ "${#VALS[@]}" -eq 0 ]; then
      mal ".env.example no trae \`$var=\`: la plantilla tiene que DECIR que existe y que va vacía."
    elif [ "${#VALS[@]}" -gt 1 ]; then
      mal ".env.example trae \`$var=\` ${#VALS[@]} veces: la última gana al copiarla, y nadie lee la última."
    elif [ -n "${VALS[0]}" ]; then
      mal ".env.example trae \`$var\` CON VALOR. Va vacía: $( [ "$var" = "$GASTO" ] && echo 'solo producción la pone, y solo por instrucción del dueño (HECHOS.md:48)' || echo 'es una credencial')."
    else
      ok "\`$var=\` presente una vez y vacía."
    fi
  done
fi

# --- (D) la pila E2E con el doble ----------------------------------------------
printf '\n\033[1m(D) La pila E2E corre con SHIPPING_PROVIDER_ADAPTER=fake\033[0m\n'
STG="docker-compose.staging.yml"
if [ ! -f "$STG" ]; then
  mal "No existe $STG (la pila de e2e-real.yml y del DAST)."
elif grep -qE '^[[:space:]]+SHIPPING_PROVIDER_ADAPTER:[[:space:]]*["'"'"']?fake["'"'"']?[[:space:]]*(#.*)?$' "$STG"; then
  ok "$STG fija SHIPPING_PROVIDER_ADAPTER: fake (literal, no se enciende desde fuera)."
else
  mal "$STG no fija SHIPPING_PROVIDER_ADAPTER: fake como literal."
  nota "Con \`skydropx\` (o con \`\${…}\` que el host pueda cambiar) la E2E podría construir el cliente real."
fi
NAT="scripts/stack-native.sh"
if [ ! -f "$NAT" ]; then
  mal "No existe $NAT (el arnés E2E nativo de QA)."
else
  if grep -qE '^[[:space:]]*export[[:space:]]+SHIPPING_PROVIDER_ADAPTER=fake[[:space:]]*(#.*)?$' "$NAT"; then
    ok "$NAT exporta SHIPPING_PROVIDER_ADAPTER=fake."
  else
    mal "$NAT no exporta SHIPPING_PROVIDER_ADAPTER=fake (fijo, sin \`:-\`)."
  fi
  if grep -qE "^[[:space:]]*unset[[:space:]].*\b${GASTO}\b" "$NAT"; then
    ok "$NAT quita ${GASTO} del entorno heredado."
  else
    mal "$NAT no hace \`unset ${GASTO}\`: un entorno con la llave puesta la heredaría."
  fi
fi

# --- (E) catálogo de secretos generados en CI -----------------------------------
printf '\n\033[1m(E) El CI no GENERA credenciales de Skydropx\033[0m\n'
mapfile -t CATS < <(ls security/secretos-exigidos*.txt 2>/dev/null)
E_HITS="$( [ "${#CATS[@]}" -gt 0 ] && grep -nE "^[[:space:]]*${P}" "${CATS[@]}" 2>/dev/null || true)"
if [ -z "$E_HITS" ]; then
  ok "Ningún catálogo de security/secretos-exigidos*.txt lista ${P}*."
else
  mal "El catálogo de secretos del CI lista variables de Skydropx:"
  while IFS= read -r l; do [ -n "$l" ] && nota "$l"; done <<< "$E_HITS"
fi

# --- (F) la sonda D0 ------------------------------------------------------------
printf '\n\033[1m(F) La sonda de solo lectura existe, su prueba corre en CI y nadie la lanza contra la red\033[0m\n'
for f in scripts/skydropx/prod-probe.ts scripts/skydropx/prod-probe.test.ts scripts/skydropx/run-prod-probe.sh; do
  [ -f "$f" ] && ok "$f existe." || mal "Falta $f (D0, §19.19.15)."
done
if [ -d .github ]; then
  if grep -rqE 'run-prod-probe\.sh[[:space:]]+test\b' .github; then
    ok "Un workflow corre la prueba de la sonda (run-prod-probe.sh test)."
  else
    mal "Ningún workflow corre \`run-prod-probe.sh test\`: la prueba de PS-99 (d) para la sonda no corre."
  fi
  F_RUN="$(grep -rnE 'run-prod-probe\.sh[[:space:]]+(run|dry-run)\b|prod-probe\.ts' .github 2>/dev/null || true)"
  if [ -z "$F_RUN" ]; then
    ok "Ningún workflow ejecuta la sonda (ni contra la red ni directa)."
  else
    mal "Un workflow ejecuta la sonda: el CI no habla con Skydropx."
    while IFS= read -r l; do [ -n "$l" ] && nota "$l"; done <<< "$F_RUN"
  fi
fi

echo
if [ "$FALLOS" -eq 0 ]; then
  printf '\033[1;32m✓ VERDE — ninguna pila de pruebas puede recibir las llaves de Skydropx (PS-99 (d)).\033[0m\n'
  exit 0
fi
printf '\033[1;31m✗ ROJO — %d incumplimiento(s) de PS-99 (d). Dueño: devops.\033[0m\n' "$FALLOS"
exit 1

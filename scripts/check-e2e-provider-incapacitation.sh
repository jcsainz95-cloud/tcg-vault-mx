#!/usr/bin/env bash
# =============================================================================
# scripts/check-e2e-provider-incapacitation.sh — Propiedad: devops
# TCG Vault MX — el entorno donde corre la suite E2E NO puede escribir precios
# automáticos contra un proveedor DE PAGA (ARCHITECTURE §4.38(r.6.1), NORMATIVO)
# =============================================================================
# QUÉ PROBLEMA CIERRA
#   Desde v1.51 (M-46) hay **un solo dial**: `PUT /admin/settings
#   {"gradingHookEnabled":"on"}` publica las cifras **y** autoriza al barrido a
#   pedir datos a PokemonPriceTracker (2 créditos/carta) y a escribir precios.
#   El arnés E2E enciende ese dial **en CADA corrida**. Si el entorno del gate
#   tuviera credencial viva, el gate de CI se convertiría en un consumidor de la
#   cuota de un proveedor de paga, en silencio.
#
#   Frontend ya puso el guardarraíl en tiempo de ejecución
#   (`frontend/e2e/utils/paid-provider-guard.ts`: contra API local OBSERVA el
#   entorno; contra API remota exige la constancia de devops). Este script es la
#   otra mitad, la de devops, y es **estática**: verifica que los workflows que
#   corren E2E declaren la incapacitación **en el YAML**, para que la protección
#   no dependa de que nadie escriba la variable «por si acaso».
#
# QUÉ EXIGE, workflow por workflow (los que corren E2E: e2e-real.yml, e2e.yml)
#   1. NINGÚN job E2E inyecta `POKEMONPRICETRACKER_API_KEY` con un valor que
#      pueda ser una credencial (`secrets.*`, o un literal que no sea vacío).
#      Que hoy no esté no basta: se exige que esté **declarada vacía**, para que
#      añadirla sea un cambio visible en un diff y no un olvido reversible.
#   2. `POKEMONPRICETRACKER_API_KEY: ''` está DECLARADA (ausencia = decisión,
#      no casualidad).
#   3. `E2E_GRADING_PROVIDER_INCAPACITATED: '1'` está declarada — la constancia
#      que el guardarraíl del arnés exige cuando la API bajo prueba es remota y
#      su entorno no es observable desde el runner.
#
# QUÉ **NO** HACE
#   No mira `.env` de nadie ni intenta adivinar el entorno de staging: eso no es
#   observable desde aquí y fingir que sí lo es sería el falso verde que este
#   pase existe para quitar. Solo verifica lo que está escrito en el repo.
#
# USO
#   bash scripts/check-e2e-provider-incapacitation.sh            # todos
#   WORKFLOWS='.github/workflows/e2e-real.yml' bash scripts/…    # uno
#
# SALIDA: 0 todo declarado · 1 falta/está mal declarada alguna · 2 error de uso.
# =============================================================================
set -uo pipefail

ok()   { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad()  { printf '\033[1;31m  ✖ %s\033[0m\n' "$*"; }
log()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || { echo "No pude entrar a $REPO_ROOT" >&2; exit 2; }

KEY_VAR='POKEMONPRICETRACKER_API_KEY'
ATTEST_VAR='E2E_GRADING_PROVIDER_INCAPACITATED'

# Workflows que LEVANTAN o CORREN la suite E2E (la que enciende el dial).
DEFAULT_WORKFLOWS='.github/workflows/e2e-real.yml .github/workflows/e2e.yml'
WORKFLOWS="${WORKFLOWS:-$DEFAULT_WORKFLOWS}"

RC=0
log "Incapacitación del entorno E2E frente al proveedor de PAGA (§4.38r.6.1)"

for wf in $WORKFLOWS; do
  printf '\n  \033[1m%s\033[0m\n' "$wf"
  if [ ! -f "$wf" ]; then
    bad "No existe. Si se renombró, actualiza DEFAULT_WORKFLOWS de este script."
    RC=1
    continue
  fi

  # --- (1) ¿Se inyecta la credencial con algo que pueda ser una llave? --------
  # Se buscan las líneas `POKEMONPRICETRACKER_API_KEY: <algo>` y se rechaza todo
  # lo que no sea comilla-comilla vacía. `secrets.*` es el caso que más duele:
  # basta con que alguien cargue el secret en el repo para que el gate empiece a
  # gastar sin que este archivo cambie.
  mapfile -t key_lines < <(grep -nE "^[[:space:]]*${KEY_VAR}[[:space:]]*:" "$wf" || true)
  live=0
  declared_empty=0
  for line in "${key_lines[@]}"; do
    value="${line#*:}"; value="${value#*:}"           # nº de línea, luego la clave
    value="$(printf '%s' "$value" | sed -E 's/#.*$//; s/^[[:space:]]+//; s/[[:space:]]+$//')"
    case "$value" in
      "''"|'""')
        declared_empty=1
        ok "$KEY_VAR declarada VACÍA (línea ${line%%:*}) ⇒ la ausencia es una decisión." ;;
      *)
        live=1
        bad "$KEY_VAR con valor NO vacío en la línea ${line%%:*}: «$value»"
        echo "      Un entorno E2E con credencial viva PAGA CRÉDITOS en cada corrida del gate"
        echo "      (el arnés enciende el dial único al arrancar). §4.38r.6.1." ;;
    esac
  done
  if [ "$live" = 1 ]; then RC=1; fi
  if [ "$declared_empty" = 0 ] && [ "$live" = 0 ]; then
    RC=1
    bad "$KEY_VAR NO está declarada en este workflow."
    echo "      Que hoy no esté es una CASUALIDAD, no un diseño: el compose la interpola"
    echo "      del entorno del runner. Declárala vacía en el \`env:\` del job E2E:"
    echo "          $KEY_VAR: ''"
  fi

  # --- (2) La constancia de devops para API remota ---------------------------
  if grep -qE "^[[:space:]]*${ATTEST_VAR}[[:space:]]*:[[:space:]]*'?1'?[[:space:]]*(#.*)?$" "$wf"; then
    ok "$ATTEST_VAR declarada ⇒ el arnés puede encender el dial contra una API remota."
  else
    RC=1
    bad "Falta $ATTEST_VAR: '1' en el \`env:\` del job E2E."
    echo "      Sin ella, el guardarraíl del arnés SE NIEGA a encender el dial cuando la API"
    echo "      bajo prueba es remota (su entorno no es observable desde el runner), y el job"
    echo "      muere a mitad. Es constancia de DEVOPS: la firma quien conoce ese entorno."
  fi
done

echo
if [ "$RC" = 0 ]; then
  ok "Los workflows E2E declaran su incapacitación frente al proveedor de paga."
else
  bad "El entorno E2E NO está declarado incapacitado. Ver DEVOPS_NOTES §32.12."
fi
exit "$RC"

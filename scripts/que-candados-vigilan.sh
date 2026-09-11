#!/usr/bin/env bash
#
# que-candados-vigilan.sh — «antes de reescribir este fichero: ¿qué candados se
#                            apoyan en su forma?»                        · devops
# =============================================================================
# DE DÓNDE VIENE (2026-09-11) — y es una CLASE, no un incidente
# ---------------------------------------------------------------------------
# Reescribí `.github/workflows/e2e.yml` para sacar MinIO. **TRES** candados míos
# estaban anclados a la forma exacta de ese fichero:
#
#     check-db-pool-limit.sh ·  check-e2e-harness-gaps.sh
#     check-e2e-provider-incapacitation.sh
#
# Ninguno me avisó **mientras escribía el cambio**. Me avisaron **después**, en
# CI, cuando ya estaba commiteado. Y tenían razón: el cambio había borrado el
# bloque `env:` entero del job —incluido el `connection_limit=5` que hace
# VISIBLE el fallo de dinero de `398c58a`—. El aviso llegó tarde porque **no hay
# forma barata de saber qué candado mira qué fichero**: el anclaje vive dentro
# del candado, no al lado de lo anclado.
#
#     ► «Un candado anclado a la forma de un fichero es una dependencia
#        INVISIBLE desde el fichero.»
#
# Esto es esa forma barata. **NO es un gate** —no falla nada, no bloquea nada—:
# es la pregunta que hay que hacerse ANTES de tocar un fichero con historia.
# Se declara como ayuda a propósito: un gate que exigiera «declara tus anclajes»
# sería otro anclaje más que mantener.
#
# Uso:
#   ./scripts/que-candados-vigilan.sh .github/workflows/e2e.yml
#   ./scripts/que-candados-vigilan.sh docker-compose.staging.yml
#   ./scripts/que-candados-vigilan.sh            # sin argumento: lo que cambió vs HEAD
#
# Sale 0 siempre que pueda mirar (es informativo); 2 si no puede.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR" || exit 2

OBJETIVOS=("$@")
if [ "${#OBJETIVOS[@]}" -eq 0 ]; then
  mapfile -t OBJETIVOS < <(git diff --name-only HEAD 2>/dev/null; git diff --cached --name-only 2>/dev/null)
  # únicos, sin vacíos
  mapfile -t OBJETIVOS < <(printf '%s\n' "${OBJETIVOS[@]}" | awk 'NF' | sort -u)
  [ "${#OBJETIVOS[@]}" -gt 0 ] || { echo "No hay cambios respecto a HEAD y no diste fichero. Nada que mirar."; exit 0; }
  echo "(sin argumento: miro lo que has cambiado respecto a HEAD)"
fi

hubo=0
for objetivo in "${OBJETIVOS[@]}"; do
  [ -n "$objetivo" ] || continue
  base="$(basename "$objetivo")"
  printf '\n\033[1m== %s ==\033[0m\n' "$objetivo"

  # Un candado «vigila» el fichero si lo nombra: por ruta completa o por nombre.
  # Se excluye a sí mismo y se excluyen los canarios (que copian el árbol).
  mapfile -t vigilantes < <(
    grep -rl -F -e "$objetivo" -e "$base" scripts/ security/scripts/ 2>/dev/null \
      | grep -vE 'que-candados-vigilan\.sh' \
      | sort -u
  )
  if [ "${#vigilantes[@]}" -eq 0 ]; then
    echo "  · ningún guion de scripts/ ni security/scripts/ lo nombra."
    continue
  fi
  hubo=1
  for v in "${vigilantes[@]}"; do
    # Se distingue el que lo ANCLA (lo busca para comprobar su forma) del que
    # simplemente lo menciona en prosa: si la mención está solo en comentarios,
    # se dice, porque no es lo mismo romper un anclaje que desactualizar una nota.
    codigo="$(grep -n -F -e "$objetivo" -e "$base" "$v" | grep -vE '^[0-9]+:[[:space:]]*#' | head -3)"
    if [ -n "$codigo" ]; then
      printf '  \033[1;33m⚑ %s\033[0m  — lo usa en CÓDIGO (probable ANCLAJE):\n' "$v"
      printf '      %s\n' "$codigo" | cut -c1-150
    else
      printf '  \033[2m· %s — solo lo menciona en comentarios\033[0m\n' "$v"
    fi
  done
done

if [ "$hubo" -eq 1 ]; then
  cat <<'FIN'

  ────────────────────────────────────────────────────────────────────────────
  Si vas a cambiar la FORMA de alguno de estos ficheros (renombrar un job, mover
  un `env:`, quitar un servicio), CORRE ESOS CANDADOS ANTES DE COMMITEAR.
  Y decide, midiendo, cuál de las dos cosas pasó:
    · el candado tiene un anclaje DESFASADO  ⇒ se actualiza el anclaje **y** se
      añade al canario el caso que lo habría cazado;
    · el cambio PERDIÓ algo que el candado protegía ⇒ se arregla el cambio.
  No son lo mismo y el arreglo es OPUESTO. Aflojar el anclaje para que pase es
  la respuesta equivocada a la segunda.
FIN
fi
exit 0

#!/usr/bin/env bash
#
# check-cardshow-secret-terms.sh — «ningún nombre de patrocinador del Card Show vive en el repo» · devops
# =============================================================================
# POR QUÉ EXISTE (condición de seguridad, marketing RONDA 2, 2026-10-17)
# ---------------------------------------------------------------------------
# El ÚNICO secreto vivo del Card Show son los NOMBRES DE PATROCINADOR
# (CARDSHOW_LANDING_ESTADO §77; decisión JC 2026-10-16). Fecha, sede y precios
# YA SON PÚBLICOS y viven en el código; los nombres de patrocinador NO pueden
# aparecer en ningún fuente, ni en backend/, ni en docs/, ni en frontend/.
#
# El guard que había (frontend/src/content/card-show.secrets.test.ts) tenía DOS
# defectos que lo volvían inerte:
#   1. SIEMPRE se saltaba — el workflow de CI nunca le pasaba la env
#      CARDSHOW_SECRET_TERMS, así que el test caía en su rama `it.skip` «sin env».
#   2. Aunque recibiera la env, SOLO escaneaba `frontend/src/app/card-show` y
#      `frontend/src/content` — un nombre filtrado en backend/ o en docs/ pasaba.
# Este candado es el arreglo de raíz: escanea los TRES árboles y falla el job si
# un término aparece. El secreto se cablea en el workflow (DEVOPS_NOTES §CARDSHOW-SCAN).
#
# QUÉ COMPRUEBA
#   - Lee CARDSHOW_SECRET_TERMS (lista separada por comas; secreto de CI, nunca en el repo).
#   - Cada término se busca como SUBCADENA LITERAL, case-insensitive (grep -iF), en
#     backend/, docs/ y frontend/ bajo RAIZ (saltando node_modules/.git/.next/dist/
#     build/coverage y los lock-files).
#   - rc=0  limpio (ningún término aparece).
#   - rc=1  FUGA: un término aparece ⇒ se listan los FICHEROS (nunca el término ni la línea).
#   - rc=2  NO CABLEADO: la env está vacía/ausente ⇒ FALLA CERRADO. Un guard de fuga
#           que no puede leer los términos no se salta en silencio: se pone rojo.
#
# Uso:  ./scripts/check-cardshow-secret-terms.sh [RAIZ]   (RAIZ = árbol a medir; por defecto el repo)
#       CARDSHOW_SECRET_TERMS="nombre1,nombre2" ./scripts/check-cardshow-secret-terms.sh
# Barato: sin red ni Docker.
# =============================================================================
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SUBDIRS=(backend docs frontend)

raw="${CARDSHOW_SECRET_TERMS:-}"
# Normaliza: separa por comas, recorta espacios, descarta vacíos.
terms=()
IFS=',' read -ra _parts <<<"$raw"
for p in "${_parts[@]:-}"; do
  t="$(printf '%s' "$p" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
  [ -n "$t" ] && terms+=("$t")
done

if [ "${#terms[@]}" -eq 0 ]; then
  echo "::error title=CARDSHOW_SECRET_TERMS no cableada::El escaneo anti-regresión de nombres de patrocinador NO puede correr sin el secreto CARDSHOW_SECRET_TERMS. Falla CERRADO (no se salta). Cablea el secreto del repo (Settings → Secrets and variables → Actions). Detalle: docs/DEVOPS_NOTES.md §CARDSHOW-SCAN."
  exit 2
fi

# Dirs de verdad presentes bajo RAIZ (tolerante a greenfield, como el resto de CI).
scan_dirs=()
for d in "${SUBDIRS[@]}"; do
  [ -d "$ROOT/$d" ] && scan_dirs+=("$ROOT/$d")
done
if [ "${#scan_dirs[@]}" -eq 0 ]; then
  echo "::error::ninguno de ${SUBDIRS[*]} existe bajo $ROOT: el escaneo no tiene nada que leer (un candado que no lee no protege)."
  exit 2
fi

rc=0
# ⛔ Nunca se imprime el término ni la línea que lo contiene (filtraría el secreto al
# log público): solo el ÍNDICE del término y los FICHEROS donde apareció.
i=0
for term in "${terms[@]}"; do
  i=$((i + 1))
  # grep -iF: subcadena literal, case-insensitive. -r recursivo, -l solo nombres, -I salta binarios.
  # Sin pipe a grep (SIGPIPE bajo pipefail da falsos rojos, DEVOPS_NOTES §86): `|| true` captura rc=1 (sin match).
  hits="$(grep -riIlF \
            --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next \
            --exclude-dir=dist --exclude-dir=build --exclude-dir=coverage \
            --exclude='*-lock.json' --exclude='*.lock' \
            -e "$term" "${scan_dirs[@]}" 2>/dev/null || true)"
  if [ -n "$hits" ]; then
    n="$(printf '%s\n' "$hits" | grep -c .)"
    echo "::error title=Nombre de patrocinador en el repo::El término secreto #$i apareció en $n fichero(s). ⛔ Ningún nombre de patrocinador puede vivir en el repo (CARDSHOW_LANDING_ESTADO §77). Ficheros:"
    printf '%s\n' "$hits" | sed "s#^$ROOT/#  - #"
    rc=1
  fi
done

if [ "$rc" -eq 0 ]; then
  echo "OK: ${#terms[@]} término(s) de patrocinador, 0 apariciones en ${SUBDIRS[*]} (bajo $ROOT)."
fi
exit "$rc"

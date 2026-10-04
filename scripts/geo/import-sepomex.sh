#!/usr/bin/env bash
#
# import-sepomex.sh — lanzador del importador del catálogo de códigos postales de SEPOMEX a `PostalCode`
# (M-64, API_CONTRACT §M4-SHIP.19.5).                                                           · devops
#
#   scripts/geo/import-sepomex.sh manifest --file F [--out M]     # sin base: el manifiesto que se commitea
#   scripts/geo/import-sepomex.sh boot   [--file F] [--strict]     # C-GEO-2: arranque (tras migrate deploy, antes de servir)
#   scripts/geo/import-sepomex.sh verify [--file F] [--strict]     # C-GEO-1, solo lectura (salida 3 si no se cumple)
#   scripts/geo/import-sepomex.sh import --file F [--dry-run] [--allow-shrink]   # recarga EXPLÍCITA (fuera del arranque)
#   scripts/geo/import-sepomex.sh test                             # su prueba (BD solo si SEPOMEX_TEST_DATABASE_URL)
#
# Modo por BLANCO (assertSeedTarget): arnés (local/compose/staging) o ESTRICTO (el resto; --strict lo fuerza).
# El archivo va fijado por el manifiesto (sha256 + setDigest). Pisos de C-GEO-1: constantes.
# Base: DATABASE_URL (boot: tal cual; verify/import: DATABASE_PUBLIC_URL si es *.railway.internal). Nunca se imprime.
# Runbook de la ventana, de dónde sale el fichero y rollback: docs/DEVOPS_NOTES.md §79–§80.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BK="$ROOT/backend"
[ -x "$BK/node_modules/.bin/ts-node" ] || { echo "Falta backend/node_modules (cd backend && npm ci && npx prisma generate)." >&2; exit 2; }
export TS_NODE_PROJECT="$BK/tsconfig.json" TS_NODE_TRANSPILE_ONLY=1
NODE=(node --require "$BK/node_modules/ts-node/register")
# Rutas de fichero relativas: relativas a donde se invocó, no a backend/.
args=(); prev=""
for a in "$@"; do
  case "$prev" in --file|--out|--manifest) [ "${a#/}" = "$a" ] && a="$PWD/$a" ;; esac
  args+=("$a"); prev="$a"
done
modo="${args[0]:-}"
case "$modo" in
  manifest|boot|import|verify) cd "$BK" && exec "${NODE[@]}" "$ROOT/scripts/geo/import-sepomex.ts" "${args[@]}" ;;
  test)          cd "$BK" && exec "${NODE[@]}" "$ROOT/scripts/geo/import-sepomex.test.ts" ;;
  *) sed -n '3,15p' "$0"; exit 2 ;;
esac

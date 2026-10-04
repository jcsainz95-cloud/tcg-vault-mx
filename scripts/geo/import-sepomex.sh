#!/usr/bin/env bash
#
# import-sepomex.sh — lanzador del importador del catálogo de códigos postales de SEPOMEX a `PostalCode`
# (M-64, API_CONTRACT §M4-SHIP.19.5).                                                           · devops
#
#   scripts/geo/import-sepomex.sh boot   --file F            # C-GEO-2: arranque (tras migrate deploy, antes de servir)
#   scripts/geo/import-sepomex.sh verify --file F            # C-GEO-1, solo lectura (salida 3 si no se cumple)
#   scripts/geo/import-sepomex.sh import --file F [--dry-run] [--allow-shrink]   # recarga EXPLÍCITA (fuera del arranque)
#   scripts/geo/import-sepomex.sh test                       # su prueba (BD solo si SEPOMEX_TEST_DATABASE_URL)
#
# El archivo va fijado por sha256: `--sha256 HEX` o el hermano `F.sha256`. Pisos de C-GEO-1: constantes.
# Base: DATABASE_URL (o DATABASE_PUBLIC_URL si la primera es *.railway.internal). Nunca se imprime.
# Runbook de la ventana, de dónde sale el fichero y rollback: docs/DEVOPS_NOTES.md §79.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BK="$ROOT/backend"
[ -x "$BK/node_modules/.bin/ts-node" ] || { echo "Falta backend/node_modules (cd backend && npm ci && npx prisma generate)." >&2; exit 2; }
export TS_NODE_PROJECT="$BK/tsconfig.json" TS_NODE_TRANSPILE_ONLY=1
NODE=(node --require "$BK/node_modules/ts-node/register")
# Rutas de fichero relativas: relativas a donde se invocó, no a backend/.
args=(); prev=""
for a in "$@"; do
  if [ "$prev" = "--file" ] && [ "${a#/}" = "$a" ]; then a="$PWD/$a"; fi
  args+=("$a"); prev="$a"
done
modo="${args[0]:-}"
case "$modo" in
  boot|import|verify) cd "$BK" && exec "${NODE[@]}" "$ROOT/scripts/geo/import-sepomex.ts" "${args[@]}" ;;
  test)          cd "$BK" && exec "${NODE[@]}" "$ROOT/scripts/geo/import-sepomex.test.ts" ;;
  *) sed -n '3,13p' "$0"; exit 2 ;;
esac

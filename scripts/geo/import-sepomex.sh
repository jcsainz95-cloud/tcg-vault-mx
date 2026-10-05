#!/usr/bin/env bash
#
# import-sepomex.sh — lanzador del importador del catálogo de códigos postales de SEPOMEX a `PostalCode`
# (M-64, API_CONTRACT §M4-SHIP.19.24 con la errata v1.80.12.5 §19.25.4: el catálogo AYUDA, no bloquea).   · devops
#
#   scripts/geo/import-sepomex.sh manifest --file F [--out M]                           # sin base: el manifiesto que se commitea
#   scripts/geo/import-sepomex.sh import --file F [--dry-run] [--allow-shrink] [--strict]   # carga EXPLÍCITA (la corre el dueño)
#   scripts/geo/import-sepomex.sh verify [--file F] [--strict]                          # informe C-GEO-1, solo lectura
#   scripts/geo/import-sepomex.sh test                                                  # su prueba (BD solo si SEPOMEX_TEST_DATABASE_URL)
#
# ⛔ Ningún arranque lo llama (candado G-BOOT: scripts/check-boot-no-geo.sh). Modo por BLANCO (assertSeedTarget).
# Base: DATABASE_URL, o DATABASE_PUBLIC_URL si DATABASE_URL es *.railway.internal. Nunca se imprime.
# Salida: 0 bien · 1 error/alarma/no cumple (nada escrito) · 2 verify con la tabla vacía · 64 uso.
# Runbook, de dónde sale el fichero y rollback: docs/DEVOPS_NOTES.md §79–§81.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BK="$ROOT/backend"
[ -x "$BK/node_modules/.bin/ts-node" ] || { echo "Falta backend/node_modules (cd backend && npm ci && npx prisma generate)." >&2; exit 64; }
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
  manifest|import|verify) cd "$BK" && exec "${NODE[@]}" "$ROOT/scripts/geo/import-sepomex.ts" "${args[@]}" ;;
  test)                   cd "$BK" && exec "${NODE[@]}" "$ROOT/scripts/geo/import-sepomex.test.ts" ;;
  *) sed -n '3,14p' "$0"; exit 64 ;;
esac

#!/usr/bin/env bash
#
# run-prod-probe.sh — lanzador de la sonda de SOLO LECTURA de Skydropx (D0,
# API_CONTRACT §M4-SHIP.19.19.15/.18) y de su prueba.              · devops
#
#   scripts/skydropx/run-prod-probe.sh test            # la prueba propia (sin red)
#   scripts/skydropx/run-prod-probe.sh dry-run         # ensayo contra el doble (sin red)
#   scripts/skydropx/run-prod-probe.sh run [args…]     # ⚠ RED: API de producción, cero gasto
#
# `run` solo desde un entorno con salida a Internet y las credenciales en el
# entorno (HECHOS.md:48). Nunca desde CI: la propia sonda se niega con `CI`
# puesto. Argumentos de `run`: --only M-PRD-1,M-PRD-3 · --values 2500,3000 ·
# --height-base 20 · --state <fichero> · --followup · --out <fichero>.
# Runbook, qué mide y rollback: docs/DEVOPS_NOTES.md §78.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BK="$ROOT/backend"
[ -x "$BK/node_modules/.bin/ts-node" ] || { echo "Falta backend/node_modules (cd backend && npm ci)." >&2; exit 2; }
export TS_NODE_PROJECT="$BK/tsconfig.json" TS_NODE_TRANSPILE_ONLY=1
NODE=(node --require "$BK/node_modules/ts-node/register")
modo="${1:-}"; shift || true
case "$modo" in
  test)    cd "$BK" && exec "${NODE[@]}" "$ROOT/scripts/skydropx/prod-probe.test.ts" ;;
  dry-run) cd "$BK" && exec "${NODE[@]}" "$ROOT/scripts/skydropx/prod-probe.ts" --dry-run "$@" ;;
  run)     cd "$BK" && exec "${NODE[@]}" "$ROOT/scripts/skydropx/prod-probe.ts" "$@" ;;
  *) sed -n '3,14p' "$0"; exit 2 ;;
esac

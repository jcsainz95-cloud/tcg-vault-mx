#!/usr/bin/env bash
#
# check-measurement-e2e-specs.sh — ¿existen los specs E2E de medición que corre el job
# `measurement-e2e` (e2e.yml)? C-F2 (off) y C-F3/C-F5 (on), API_CONTRACT §MKT.H.11.   · devops
# =============================================================================
# Los specs los escribe FRONTEND (CLAUDE.md: «Playwright en frontend/»); el contrato no les da nombre,
# así que devops lo fija aquí y en DEVOPS_NOTES §101.4 (una sola fuente):
#     frontend/e2e/measurement-off.spec.ts   C-F2 — build con NEXT_PUBLIC_MEASUREMENT_MODE=off
#     frontend/e2e/measurement-on.spec.ts    C-F3 y C-F5 — build con `on` y terceros interceptados
# Uso:  ./scripts/check-measurement-e2e-specs.sh <off|on> [--root DIR] [--today AAAA-MM-DD]
# Escribe `run=true|false` en $GITHUB_OUTPUT (si existe) y en stdout.
#   · los dos specs existen            ⇒ run=true, rc 0 (el job corre el del modo pedido);
#   · falta uno solo                   ⇒ rc 1 (entrega a medias: el otro modo quedaría sin medir);
#   · faltan los dos, antes de caducar ⇒ run=false, rc 0, ::warning PENDIENTE frontend;
#   · faltan los dos, ya caducado      ⇒ rc 1. Caducidad: scripts/mkt-fase2-dependencia.env.
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODO="${1:-}"; shift || true
HOY="$(date -u +%F)"
while [ $# -gt 0 ]; do
  case "$1" in
    --root)  ROOT_DIR="$(cd "$2" && pwd)"; shift 2 ;;
    --today) HOY="$2"; shift 2 ;;
    *) echo "::error::argumento desconocido: $1"; exit 2 ;;
  esac
done
[[ "$MODO" =~ ^(off|on)$ ]] || { echo "uso: $0 <off|on> [--root DIR] [--today AAAA-MM-DD]"; exit 2; }
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/mkt-fase2-dependencia.env"
salida() { echo "run=$1"; [ -n "${GITHUB_OUTPUT:-}" ] && echo "run=$1" >> "$GITHUB_OUTPUT"; return 0; }
OFF="frontend/e2e/measurement-off.spec.ts"; ON="frontend/e2e/measurement-on.spec.ts"
hay_off=0; [ -f "$ROOT_DIR/$OFF" ] && hay_off=1
hay_on=0;  [ -f "$ROOT_DIR/$ON" ]  && hay_on=1
if [ "$hay_off" = 1 ] && [ "$hay_on" = 1 ]; then
  echo "C-F2/C-F3: los dos specs existen; el job corre frontend/e2e/measurement-$MODO.spec.ts."; salida true; exit 0
fi
if [ "$hay_off" != "$hay_on" ]; then
  falta="$([ "$hay_off" = 0 ] && echo "$OFF" || echo "$ON")"
  echo "::error::E2E de medición a medias: falta $falta. Un modo sin spec queda sin medir. Dueño: frontend."; salida false; exit 1
fi
if [[ "$HOY" < "$MKT_FASE2_FRONTEND_EXPIRY" ]]; then
  echo "::warning title=E2E de medición PENDIENTE frontend::No existen $OFF ni $ON (C-F2/C-F3/C-F5). El job queda preparado y no mide nada aún: NO es un verde de privacidad. Caduca el $MKT_FASE2_FRONTEND_EXPIRY (scripts/mkt-fase2-dependencia.env). Dueño: frontend."
  salida false; exit 0
fi
echo "::error::No existen los specs E2E de medición y la excepción caducó el $MKT_FASE2_FRONTEND_EXPIRY (hoy $HOY). Dueño: frontend."
salida false; exit 1

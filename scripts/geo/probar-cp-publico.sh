#!/usr/bin/env bash
#
# probar-cp-publico.sh — ¿la API publicada resuelve los CP? Lectura pública, sin credenciales.   · devops
#
#   scripts/geo/probar-cp-publico.sh [BASE_API]        # por defecto la API de producción en Railway
#
# Pide GET /api/v1/geo/postal-codes/{03100,06700,01000,64000} y exige 200 en los cuatro (los cuatro que el
# orquestador midió en 404 POSTAL_CODE_UNKNOWN el 2026-11-02). Salida: 0 los cuatro 200 · 1 si no.
# DEVOPS_NOTES §107.
set -uo pipefail
BASE="${1:-https://tcg-vault-mx-production.up.railway.app}"
BASE="${BASE%/}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
fallos=0
printf '\n#### Comprobación pública (API publicada)\n\n| CP | HTTP | colonias |\n|---|---|---|\n' >> "$SUMMARY"
for cp in 03100 06700 01000 64000; do
  cuerpo="$(curl -sS --max-time 20 -o - -w '\n%{http_code}' "$BASE/api/v1/geo/postal-codes/$cp" 2>/dev/null)" || true
  code="$(printf '%s' "$cuerpo" | tail -n1)"
  json="$(printf '%s' "$cuerpo" | sed '$d')"
  n="$(printf '%s' "$json" | python3 -I -c 'import json,sys
try: print(len(json.load(sys.stdin).get("neighborhoods") or []))
except Exception: print(0)' 2>/dev/null || echo 0)"
  printf '[probar-cp] %s ⇒ HTTP %s · %s colonias\n' "$cp" "${code:-000}" "$n"
  printf '| %s | %s | %s |\n' "$cp" "${code:-000}" "$n" >> "$SUMMARY"
  [ "$code" = 200 ] || fallos=$((fallos+1))
done
if [ "$fallos" -ne 0 ]; then
  echo "[probar-cp] ⛔ $fallos de 4 CP no dan 200."
  exit 1
fi
echo "[probar-cp] los 4 CP dan 200."

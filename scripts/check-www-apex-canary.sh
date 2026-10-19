#!/usr/bin/env bash
#
# check-www-apex-canary.sh — ¿la sonda www→apex distingue permanente bien hecho de lo demás?   · devops
# =============================================================================
# Sin red: alimenta a check-www-apex.sh con cabeceras fabricadas (WWW_APEX_CABECERAS) y exige:
#   VERDE · 301 al apex con ruta y query · 308 al apex con ruta y query (el que configuró el dueño,
#           medido 2026-10-19) · 308 detrás de un proxy (línea «HTTP/1.1 200 Connection Established» delante)
#   ROJO  · 302 · 307 · 308 que pierde la query · 301 a www (bucle) · 200 sin redirigir
#   rc 2  · sin línea de estado
# Uso: ./scripts/check-www-apex-canary.sh [N]
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$ROOT_DIR/scripts/check-www-apex.sh"; N="${1:-1}"
BASE="$(mktemp -d -t www-apex-canario-XXXXXX)"; trap 'rm -rf "$BASE"' EXIT
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }
R='/es/catalogo?utm_source=e2'
caso() { # <rc> <nombre> <cabeceras>
  local f; f="$(mktemp "$BASE/c-XXXXXX")"; printf '%b' "$3" > "$f"
  local rc; WWW_APEX_CABECERAS="$f" "$CHECK" "$R" >/dev/null 2>&1; rc=$?
  [ "$rc" -eq "$1" ] && ok "$2 — rc=$rc" || bad "$2 — rc=$rc, esperaba $1"
}
for ((r=1;r<=N;r++)); do
  printf '\n\033[1m== www→apex canario, ronda %s/%s ==\033[0m\n' "$r" "$N"
  caso 0 "301 al apex, ruta y query intactas" "HTTP/2 301\r\nlocation: https://tcghunt.mx$R\r\n"
  caso 0 "308 al apex, ruta y query intactas" "HTTP/2 308\r\nlocation: https://tcghunt.mx$R\r\n"
  caso 0 "308 detrás de proxy (CONNECT delante)" "HTTP/1.1 200 Connection Established\r\n\r\nHTTP/2 308\r\nLocation: https://tcghunt.mx$R\r\n"
  caso 1 "302 (temporal)" "HTTP/2 302\r\nlocation: https://tcghunt.mx$R\r\n"
  caso 1 "307 (temporal)" "HTTP/2 307\r\nlocation: https://tcghunt.mx$R\r\n"
  caso 1 "308 que pierde la query" "HTTP/2 308\r\nlocation: https://tcghunt.mx/es/catalogo\r\n"
  caso 1 "301 a www (bucle)" "HTTP/2 301\r\nlocation: https://www.tcghunt.mx$R\r\n"
  caso 1 "200 sin redirigir" "HTTP/2 200\r\nserver: Vercel\r\n"
  caso 2 "sin línea de estado" "server: Vercel\r\n"
done
printf '\n'
if [ "$FALLOS" -gt 0 ]; then printf '\033[1;31mROJO: %s/%s casos fallaron.\033[0m\n' "$FALLOS" "$((FALLOS+PASADAS))"; exit 1; fi
printf '\033[1;32mVERDE: %s/%s casos (N=%s): 301 y 308 permanentes pasan; temporales, query perdida y bucles no.\033[0m\n' "$PASADAS" "$PASADAS" "$N"

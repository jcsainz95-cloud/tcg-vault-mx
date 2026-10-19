#!/usr/bin/env bash
#
# check-measurement-artifact-canary.sh — ¿C-F1 sabe ponerse rojo?                        · devops
# =============================================================================
# Fabrica directorios de build FALSOS (nunca toca un .next real) y exige a
# check-measurement-artifact.sh:
#   off · limpio ⇒ 0 · cada uno de los 5 patrones plantado en static/ ⇒ 1 · uno en server/ ⇒ 1
#       · un host parecido que NO es de medición (accounts.google.com, www.google.com) ⇒ 0
#   on  · con el cargador ⇒ 0 · sin nada ⇒ 1 (el grep tiene que poder ver)
#   sin static/ o sin server/ ⇒ 2 (no concluyente ≠ verde)
# Uso: ./scripts/check-measurement-artifact-canary.sh [N]
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$ROOT_DIR/scripts/check-measurement-artifact.sh"
N="${1:-1}"
BASE="$(mktemp -d -t cf1-canario-XXXXXX)"; trap 'rm -rf "$BASE"' EXIT
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }
build() { local d; d="$(mktemp -d "$BASE/b-XXXXXX")"; mkdir -p "$d/static/chunks" "$d/server/app"
  echo 'self.__next_f.push([1,"hola"]);fetch("https://accounts.google.com/gsi/client");' > "$d/static/chunks/main.js"
  echo 'export default function P(){return "https://www.google.com/maps/embed"}' > "$d/server/app/page.js"; echo "$d"; }
caso() { local esp="$1" nombre="$2" d="$3" modo="$4" rc; "$CHECK" "$d" "$modo" >/dev/null 2>&1; rc=$?
  [ "$rc" -eq "$esp" ] && ok "$nombre — rc=$rc" || bad "$nombre — rc=$rc, esperaba $esp"; }

for ((r=1;r<=N;r++)); do
  printf '\n\033[1m== C-F1 canario, ronda %s/%s ==\033[0m\n' "$r" "$N"
  d="$(build)"; caso 0 "off · build limpio (con accounts.google.com y www.google.com, que no son de medición)" "$d" off
  for p in 'https://www.googletagmanager.com/gtag/js?id=G-X' 'https://region1.google-analytics.com/g/collect' 'https://connect.facebook.net/en_US/fbevents.js' 'fbevents' 'gtag/js'; do
    d="$(build)"; echo "var s=\"$p\";" >> "$d/static/chunks/main.js"; caso 1 "off · «$p» plantado en static/" "$d" off
  done
  d="$(build)"; echo 'const u="connect.facebook.net";' >> "$d/server/app/page.js"; caso 1 "off · connect.facebook.net plantado en server/" "$d" off
  d="$(build)"; echo 'var l="https://www.googletagmanager.com/gtag/js";' > "$d/static/chunks/loader.js"; caso 0 "on · con el cargador" "$d" on
  d="$(build)"; caso 1 "on · sin cargador (el grep no ve nada ⇒ rojo)" "$d" on
  d="$(build)"; rm -rf "$d/server"; caso 2 "sin server/ ⇒ no concluyente" "$d" off
  d="$(build)"; rm -rf "$d/static"; caso 2 "sin static/ ⇒ no concluyente" "$d" on
done
printf '\n'
if [ "$FALLOS" -gt 0 ]; then printf '\033[1;31mROJO: %s/%s casos fallaron.\033[0m\n' "$FALLOS" "$((FALLOS+PASADAS))"; exit 1; fi
printf '\033[1;32mVERDE: %s/%s casos (N=%s rondas): C-F1 muerde en off y ve en on.\033[0m\n' "$PASADAS" "$PASADAS" "$N"

#!/usr/bin/env bash
#
# check-boot-no-geo.sh — G-BOOT: «la tienda nunca deja de vender por el catálogo de CP», al nivel del ARRANQUE · devops
# =============================================================================
# Norma: API_CONTRACT §M4-SHIP.19.25.4 (errata v1.80.12.5), que sale de la decisión del dueño HECHOS.md:57 («la
# colonia como Mercado Libre»): con `PostalCode` vacía la tienda VENDE (colonias escritas a mano). Por eso ⛔ ningún
# arranque lee, carga ni verifica el catálogo. Hasta v1.80.12.4 el `CMD` corría `import-sepomex.ts boot`, que en
# Railway (modo estricto, sin manifiesto) salía 1 ⇒ la imagen no arrancaba (DEVOPS_NOTES §80.0): cambiaba «no vender
# un envío» por «no vender nada». Este candado impide que vuelva. Sustituye al test 19 de §80.2, que exigía lo contrario.
#
# Qué comprueba (líneas de comentario fuera: documentar el porqué no lo pone rojo):
#   (A) `Dockerfile.backend`: hay CMD (si no, candado sin blanco ⇒ rojo) y ningún CMD/ENTRYPOINT —con sus líneas de
#       continuación unidas— nombra `import-sepomex`, `scripts/geo` ni `/opt/geo`.
#   (B) `Dockerfile.backend`: ninguna instrucción (COPY/ADD/RUN/…) nombra `scripts/geo`, `/opt/geo` ni
#       `import-sepomex`: la imagen no lleva el importador.
#   (C) `.dockerignore`: `scripts` sigue excluido y nada lo reincluye entero ni reincluye `scripts/geo`.
#   (D) `railway.json` y `docker-compose*.yml`: ningún comando de arranque (`startCommand`, `command`, `entrypoint`)
#       nombra el importador.
#
# Uso:   ./scripts/check-boot-no-geo.sh [--root DIR]     (--root: sobre una COPIA; lo usa el canario)
# Sale 0 si se cumple; 1 con fichero:línea. Sin red, sin Docker, sin node. Canario: check-boot-no-geo-canary.sh.
# DEVOPS_NOTES §81.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "${1:-}" = "--root" ]; then
  [ -n "${2:-}" ] || { echo "--root necesita un directorio"; exit 2; }
  ROOT_DIR="$(cd "$2" && pwd)"
fi

FALLOS=0
ok()  { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; FALLOS=$((FALLOS+1)); }

PAT='import-sepomex|scripts/geo|/opt/geo'

printf '\n\033[1m== G-BOOT: ¿algún arranque carga o verifica el catálogo de CP? (§M4-SHIP.19.25.4) ==\033[0m\n\n'

DKF="$ROOT_DIR/Dockerfile.backend"
if [ ! -f "$DKF" ]; then
  bad "no existe Dockerfile.backend: el candado no tiene blanco."
else
  # Instrucciones lógicas: se unen las continuaciones `\` y se quitan los comentarios. Cada salida: «línea<TAB>texto».
  instr="$(awk '
    /^[[:space:]]*#/ && cur == "" { next }
    {
      line = $0
      if (cur == "") start = NR
      if (line ~ /\\[[:space:]]*$/) { sub(/\\[[:space:]]*$/, "", line); cur = cur line " "; next }
      cur = cur line
      if (cur ~ /[^[:space:]]/) printf "%d\t%s\n", start, cur
      cur = ""
    }
    END { if (cur != "") printf "%d\t%s\n", start, cur }
  ' "$DKF")"

  cmds="$(printf '%s\n' "$instr" | awk -F'\t' 'toupper($2) ~ /^[[:space:]]*(CMD|ENTRYPOINT)[[:space:]]/')"
  if [ -z "$cmds" ]; then
    bad "(A) Dockerfile.backend no tiene CMD: el candado no tiene blanco."
  else
    malos="$(printf '%s\n' "$cmds" | grep -E "$PAT" || true)"
    if [ -n "$malos" ]; then
      while IFS=$'\t' read -r n _; do
        bad "(A) Dockerfile.backend:$n — el CMD/ENTRYPOINT corre el importador de CP: el arranque vuelve a depender del catálogo."
      done <<< "$malos"
    else
      ok "(A) el CMD/ENTRYPOINT no nombra import-sepomex, scripts/geo ni /opt/geo."
    fi
  fi

  otros="$(printf '%s\n' "$instr" | awk -F'\t' 'toupper($2) !~ /^[[:space:]]*(CMD|ENTRYPOINT)[[:space:]]/' | grep -E "$PAT" || true)"
  if [ -n "$otros" ]; then
    while IFS=$'\t' read -r n _; do
      bad "(B) Dockerfile.backend:$n — la imagen vuelve a llevar el importador de CP (scripts/geo)."
    done <<< "$otros"
  else
    ok "(B) ninguna instrucción de Dockerfile.backend copia ni prepara scripts/geo."
  fi
fi

DI="$ROOT_DIR/.dockerignore"
if [ ! -f "$DI" ]; then
  bad "(C) no existe .dockerignore: \`scripts\` entero entraría al contexto."
else
  if ! grep -nE '^[[:space:]]*/?scripts/?[[:space:]]*$' "$DI" >/dev/null; then
    bad "(C) .dockerignore ya no excluye \`scripts\`: scripts/geo entraría al contexto de build."
  fi
  reinc="$(grep -nE '^[[:space:]]*!/?scripts(/geo.*|/?|/\*+.*)[[:space:]]*$' "$DI" || true)"
  if [ -n "$reinc" ]; then
    while IFS=: read -r n _; do bad "(C) .dockerignore:$n — reincluye scripts/geo (o scripts entero) en el contexto de build."; done <<< "$reinc"
  fi
  [ -z "$reinc" ] && grep -qE '^[[:space:]]*/?scripts/?[[:space:]]*$' "$DI" && ok "(C) .dockerignore excluye scripts y no reincluye scripts/geo."
fi

d_ok=1
for f in "$ROOT_DIR/railway.json" "$ROOT_DIR"/docker-compose*.yml; do
  [ -f "$f" ] || continue
  hits="$(grep -nE "$PAT" "$f" | grep -vE '^[0-9]+:[[:space:]]*#' || true)"
  if [ -n "$hits" ]; then
    d_ok=0
    while IFS=: read -r n _; do bad "(D) ${f#"$ROOT_DIR"/}:$n — un comando de arranque nombra el importador de CP."; done <<< "$hits"
  fi
done
[ "$d_ok" -eq 1 ] && ok "(D) railway.json y docker-compose*.yml no arrancan el importador."

echo
if [ "$FALLOS" -gt 0 ]; then
  printf '\033[1;31mG-BOOT ROJO: %d fallo(s). El catálogo de CP AYUDA, no bloquea: ningún arranque lo carga (HECHOS.md:57, §M4-SHIP.19.25.4, DEVOPS_NOTES §81).\033[0m\n' "$FALLOS"
  exit 1
fi
printf '\033[1;32mG-BOOT verde: ningún arranque carga ni verifica el catálogo de CP.\033[0m\n'
exit 0

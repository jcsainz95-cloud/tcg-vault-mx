#!/usr/bin/env bash
#
# check-boot-no-geo-canary.sh — ¿el candado G-BOOT se pone ROJO cuando alguien vuelve a cablear el catálogo de CP
# en el arranque?                                                                                          · devops
# =============================================================================
# Copia lo que el candado lee a un árbol temporal, exige VERDE en el prístino (si no, todo rojo de abajo es ruido) y
# planta, una por una, las formas de volver a meter el importador en el arranque. Cada mutación tiene que dar ROJO
# **y** nombrar el bloque correcto. Incluye el canario literal del contrato (§M4-SHIP.19.25.6): reponer
# `… import-sepomex.ts boot &&` en el `CMD`, tal como estaba en v1.80.12.4. Y un VERDE: documentarlo en un comentario
# no lo pone rojo. Determinista (sin carreras ni reloj): una corrida por caso basta (O-3 no aplica). DEVOPS_NOTES §81.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE_REL="scripts/check-boot-no-geo.sh"
[ -f "$ROOT_DIR/$GATE_REL" ] || { printf '✗ No existe %s: el candado desapareció, eso ya es el rojo.\n' "$GATE_REL"; exit 1; }

FALLOS=0
PASADAS=0
ok()   { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; FALLOS=$((FALLOS+1)); }
note() { printf '      %s\n' "$*"; }

BASE="$(mktemp -d -t gboot-canario-XXXXXX)"
trap 'rm -rf "$BASE"' EXIT
PRISTINO="$BASE/pristino"
mkdir -p "$PRISTINO/scripts"
cp "$ROOT_DIR/$GATE_REL" "$PRISTINO/$GATE_REL"
cp "$ROOT_DIR/Dockerfile.backend" "$ROOT_DIR/.dockerignore" "$ROOT_DIR/railway.json" "$PRISTINO/"
cp "$ROOT_DIR"/docker-compose*.yml "$PRISTINO/"

correr() { bash "$1/$GATE_REL" --root "$1" 2>&1; }

caso() { # caso ROJO|VERDE <nombre> <texto que el rojo debe nombrar|-> <mutador>
  local esperado="$1" nombre="$2" debe="$3" mutador="$4"
  local dir="$BASE/caso$((PASADAS+FALLOS+1))"
  rm -rf "$dir"; cp -a "$PRISTINO" "$dir"
  "$mutador" "$dir"
  local salida rc
  salida="$(correr "$dir")"; rc=$?
  if [ "$esperado" = VERDE ]; then
    if [ "$rc" -eq 0 ]; then ok "$nombre — VERDE (legítimo)."; else bad "$nombre — ROJO ante algo legítimo."; note "$(grep '✗' <<< "$salida" | head -3)"; fi
    return
  fi
  if [ "$rc" -eq 0 ]; then bad "$nombre — el candado se quedó VERDE ante la mutación."; return; fi
  if ! grep -qF -- "$debe" <<< "$salida"; then
    bad "$nombre — rojo, pero no nombra «$debe»: se puso rojo por otra cosa."
    note "$(grep '✗' <<< "$salida" | head -3)"
    return
  fi
  ok "$nombre — ROJO, y nombra «$debe»."
}

sustituir() { # fichero python-regex plantilla  (python: sin sed -i portátil; la plantilla admite \1 y \n)
  python3 - "$1" "$2" "$3" <<'PY'
import re, sys
p, pat, rep = sys.argv[1:4]
s = open(p, encoding='utf8').read()
n = re.subn(pat, lambda m: m.expand(rep), s, count=1, flags=re.M)
if n[1] != 1: sys.exit(f"mutador sin efecto en {p}: {pat}")
open(p, 'w', encoding='utf8').write(n[0])
PY
}

BOOT='TS_NODE_PROJECT=/app/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register /opt/geo/scripts/geo/import-sepomex.ts boot'
# --- (A) el CMD ---------------------------------------------------------------------------------------------
m_cmd_boot()   { sustituir "$1/Dockerfile.backend" '(^CMD .*migrate deploy) && node dist/main\.js' "\\1 && $BOOT && node dist/main.js"; }
m_cmd_verify() { sustituir "$1/Dockerfile.backend" '(^CMD .*migrate deploy) && node dist/main\.js' "\\1 && sh scripts/geo/import-sepomex.sh verify && node dist/main.js"; }
m_cmd_cont()   { sustituir "$1/Dockerfile.backend" '^CMD \["sh", "-c", "(.*)"\]$' "CMD [\"sh\", \"-c\", \\\\\n  \"\\1 && node /opt/geo/x.js\"]"; }
m_entry()      { printf 'ENTRYPOINT ["sh", "-c", "node -r ts-node/register /opt/geo/scripts/geo/import-sepomex.ts boot && exec \\"$@\\"", "--"]\n' >> "$1/Dockerfile.backend"; }
# --- (B) la imagen ---------------------------------------------------------------------------------------------
m_copy()       { sustituir "$1/Dockerfile.backend" '^(USER nestjs)$' "COPY --chown=nestjs:nodejs scripts/geo/ /opt/geo/scripts/geo/\n\\1"; }
# --- (C) .dockerignore ------------------------------------------------------------------------------------------
m_di_geo()     { printf '!scripts/geo\n' >> "$1/.dockerignore"; }
m_di_all()     { printf '!scripts/**\n' >> "$1/.dockerignore"; }
m_di_noexcl()  { grep -vE '^scripts$' "$1/.dockerignore" > "$1/x"; mv "$1/x" "$1/.dockerignore"; }
# --- (D) otros arranques -----------------------------------------------------------------------------------------
m_railway()    { sustituir "$1/railway.json" '("deploy": \{)' '\1\n    "startCommand": "sh scripts/geo/import-sepomex.sh import --file /data/CPdescarga.txt && node dist/main.js",'; }
m_compose()    { sustituir "$1/docker-compose.yml" '^(    command: sh -c "npm ci)' '    command: sh -c "node /opt/geo/scripts/geo/import-sepomex.ts boot"\n#\1'; }
# --- VERDE -------------------------------------------------------------------------------------------------------
v_comentario() { sustituir "$1/Dockerfile.backend" '^(USER nestjs)$' "# Historia: v1.80.12.4 corría import-sepomex.ts boot desde /opt/geo/scripts/geo (retirado, §81).\n\\1"; }

printf '\n\033[1m== ¿G-BOOT se pone ROJO cuando toca? ==\033[0m\n\n'

SAL="$(correr "$PRISTINO")"; RC=$?
if [ "$RC" -eq 0 ]; then
  ok "Prístino — VERDE (los rojos de abajo los causa la mutación, no el árbol)."
else
  bad "Prístino — ROJO sin mutar nada: el canario no puede distinguir nada."
  note "$(grep '✗' <<< "$SAL" | head -5)"
  exit 1
fi

caso ROJO "(A) reponer \`import-sepomex.ts boot &&\` en el CMD (canario del contrato)" "(A) Dockerfile.backend" m_cmd_boot
caso ROJO "(A) el CMD corre \`import-sepomex.sh verify\`"                               "(A) Dockerfile.backend" m_cmd_verify
caso ROJO "(A) el CMD partido en varias líneas con \`\\\`"                               "(A) Dockerfile.backend" m_cmd_cont
caso ROJO "(A) un ENTRYPOINT que corre el importador"                                  "(A) Dockerfile.backend" m_entry
caso ROJO "(B) la imagen vuelve a copiar scripts/geo"                                  "(B) Dockerfile.backend" m_copy
caso ROJO "(C) .dockerignore reincluye scripts/geo"                                    "(C) .dockerignore"      m_di_geo
caso ROJO "(C) .dockerignore reincluye scripts/** entero"                              "(C) .dockerignore"      m_di_all
caso ROJO "(C) .dockerignore deja de excluir scripts"                                  "(C) .dockerignore"      m_di_noexcl
caso ROJO "(D) railway.json con startCommand que importa"                              "(D) railway.json"       m_railway
caso ROJO "(D) docker-compose.yml con command que corre boot"                          "(D) docker-compose.yml" m_compose
caso VERDE "un comentario que documenta el boot retirado"                              -                        v_comentario

echo
TOTAL=$((PASADAS+FALLOS))
if [ "$FALLOS" -gt 0 ]; then
  printf '\033[1;31mCanario G-BOOT: %d/%d casos como se esperaba. El candado NO muerde donde debe.\033[0m\n' "$PASADAS" "$TOTAL"
  exit 1
fi
printf '\033[1;32mCanario G-BOOT: %d/%d casos como se esperaba (prístino verde, mutaciones en ROJO con su bloque, comentario en verde).\033[0m\n' "$PASADAS" "$TOTAL"
exit 0

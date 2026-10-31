#!/usr/bin/env bash
# =============================================================================
# check-stack-down-all.sh — DOWN-ALL-SHARED (orquestador, 2026-10-29) · devops
# -----------------------------------------------------------------------------
# `stack-native.sh down --all` paraba Postgres, Redis y s3-local aunque OTROS clones
# los estuvieran usando: el 2026-10-29 tumbó la infra de agentes que corrían suites.
# Ahora `--all` se NIEGA si `usuarios_ajenos_infra` encuentra a alguien (procesos de
# otro clon, conexiones a Postgres, clientes de Redis) y solo para con `--force-shared`.
#
# Este candado ejecuta el `down --all` REAL del script, en una copia de scripts/ +
# security/ SIN .git, con la infra sustituida por señuelos que solo dejan constancia
# (pg_ctlcluster, su→psql, redis-cli, pg_isready): nunca para nada de verdad. Los
# «otros stacks» son procesos de verdad (`sleep` renombrado con `exec -a`) con su cwd
# en OTRO directorio. `pgrep` se filtra a los procesos de este candado, para que los
# stacks reales de la máquina no cambien el resultado (en CI no hay; aquí sí).
#   1. nadie más                          ⇒ rc 0 y para Postgres y Redis;
#   2. un backend de otro clon            ⇒ rc ≠ 0, lo nombra, NO para nada;
#   3. Postgres con 3 conexiones          ⇒ rc ≠ 0, NO para nada;
#   4. Redis con 2 clientes               ⇒ rc ≠ 0, NO para nada;
#   5. caso 2 con `--force-shared`        ⇒ rc 0 y para;
#   6. un proceso de ESTE clon            ⇒ no cuenta como ajeno (rc 0).
#
# Uso:  ./scripts/check-stack-down-all.sh            # candado
#       ./scripts/check-stack-down-all.sh --canary   # mutaciones ⇒ todas ROJAS
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d -t stack-downall-XXXXXX)"
DECOYS=()
limpiar() { for p in "${DECOYS[@]}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$TMP"; }
trap limpiar EXIT
PORTS=(BACKEND_PORT=39985 FRONTEND_PORT=39986 S3_LOCAL_PORT=39987)

SHIM="$TMP/shim"; mkdir -p "$SHIM"
REAL_PGREP="$(command -v pgrep)"
cat > "$SHIM/pg_isready" <<'EOF'
#!/bin/sh
exit 0
EOF
cat > "$SHIM/pg_ctlcluster" <<EOF
#!/bin/sh
echo "pg_ctlcluster \$*" >> "\$PARADAS"
EOF
cat > "$SHIM/su" <<'EOF'
#!/bin/sh
cat > /dev/null
echo "${TEST_PG_CONNS:-0}"
EOF
cat > "$SHIM/redis-cli" <<'EOF'
#!/bin/sh
case "$1" in
  ping) echo PONG ;;
  client) i=0; while [ "$i" -lt "${TEST_REDIS_CLIENTS:-0}" ]; do echo "id=$i addr=127.0.0.1:1 cmd=get"; i=$((i+1)); done
          echo "id=99 addr=127.0.0.1:2 cmd=client|list" ;;
  shutdown) echo "redis-cli shutdown" >> "$PARADAS" ;;
esac
EOF
# pgrep real, filtrado a procesos cuyo cwd cuelga de $TMP (los señuelos de este candado).
# Sin el `$$`, el propio shell del señuelo (su línea dice «pgrep -f jest») casaba el patrón.
cat > "$SHIM/pgrep" <<EOF
#!/bin/sh
for p in \$("$REAL_PGREP" "\$@"); do
  [ "\$p" = "\$\$" ] && continue
  case "\$(readlink -f /proc/\$p/cwd 2>/dev/null)" in "$TMP"/*) echo "\$p" ;; esac
done
EOF
chmod +x "$SHIM"/*

copia() {  # $1 destino, $2 stack-native.sh
  mkdir -p "$1"
  ( cd "$ROOT_DIR" && tar --exclude=node_modules --exclude=.native-stack -cf - scripts security ) | tar -xf - -C "$1"
  cp "$2" "$1/scripts/stack-native.sh"
}
senuelo() {  # $1 cwd, $2 línea de comando visible ; deja el pid en $SPID
  mkdir -p "$1"
  ( cd "$1" && exec -a "$2" sleep 300 ) & SPID=$!; DECOYS+=("$SPID")
  sleep 0.3
}
down_all() {  # $1 dir, resto: args extra ; RC, OUT y PARO (qué se paró)
  local d="$1"; shift
  export PARADAS="$TMP/paradas-$RANDOM"; : > "$PARADAS"
  OUT="$(cd "$d" && env PATH="$SHIM:$PATH" "${PORTS[@]}" TEST_PG_CONNS="${PGC:-0}" TEST_REDIS_CLIENTS="${RDC:-0}" \
         timeout 90 ./scripts/stack-native.sh down --all "$@" 2>&1)"; RC=$?
  PARO="$(cat "$PARADAS")"
}

comprobar() {  # $1 stack-native.sh
  local d="$TMP/c-$RANDOM" fallos=0 p
  ok() { echo "  ✔ $*"; }
  ko() { echo "  ✗ $*"; fallos=$((fallos+1)); }
  copia "$d" "$1"

  PGC=0 RDC=0 down_all "$d"
  { [ "$RC" = 0 ] && printf '%s' "$PARO" | grep -q pg_ctlcluster && printf '%s' "$PARO" | grep -q 'redis-cli shutdown'; } \
    && ok "nadie más ⇒ rc 0 y para Postgres y Redis" || ko "nadie más: rc=$RC paro=[$PARO] — $(printf '%s' "$OUT" | tail -n 2 | tr '\n' ' ')"

  senuelo "$TMP/otro-clon/backend" "node /otro/node_modules/.bin/ts-node --transpile-only src/main.ts"; p=$SPID
  PGC=0 RDC=0 down_all "$d"
  { [ "$RC" != 0 ] && [ -z "$PARO" ] && printf '%s' "$OUT" | grep -q "proceso $p"; } \
    && ok "backend de otro clon ⇒ rc=$RC, lo nombra y NO para nada" || ko "backend de otro clon: rc=$RC paro=[$PARO]"

  PGC=0 RDC=0 down_all "$d" --force-shared
  { [ "$RC" = 0 ] && printf '%s' "$PARO" | grep -q pg_ctlcluster; } \
    && ok "con --force-shared ⇒ rc 0 y para" || ko "--force-shared: rc=$RC paro=[$PARO]"
  kill "$p" 2>/dev/null; wait "$p" 2>/dev/null

  PGC=3 RDC=0 down_all "$d"
  { [ "$RC" != 0 ] && [ -z "$PARO" ] && printf '%s' "$OUT" | grep -q 'postgres: 3 conexión'; } \
    && ok "Postgres con 3 conexiones ⇒ rc=$RC, NO para nada" || ko "Postgres con conexiones: rc=$RC paro=[$PARO]"

  PGC=0 RDC=2 down_all "$d"
  { [ "$RC" != 0 ] && [ -z "$PARO" ] && printf '%s' "$OUT" | grep -q 'redis: 2 cliente'; } \
    && ok "Redis con 2 clientes ⇒ rc=$RC, NO para nada" || ko "Redis con clientes: rc=$RC paro=[$PARO]"

  senuelo "$d/backend" "node dist/main.js"; p=$SPID
  PGC=0 RDC=0 down_all "$d"
  [ "$RC" = 0 ] && ok "proceso de ESTE clon ⇒ no es ajeno (rc 0)" || ko "proceso de este clon contado como ajeno: rc=$RC"
  kill "$p" 2>/dev/null; wait "$p" 2>/dev/null
  [ "$fallos" = 0 ]
}

SRC="$ROOT_DIR/scripts/stack-native.sh"
if [ "${1:-}" != "--canary" ]; then
  echo "== DOWN-ALL-SHARED: down --all no para la infra que usan otros =="
  comprobar "$SRC" && { echo "✓ OK"; exit 0; }
  echo "✗ ROJO"; exit 1
fi
echo "== Canario de check-stack-down-all =="
comprobar "$SRC" >/dev/null 2>&1 || { echo "✗ el original ya está rojo: el canario no concluye"; exit 2; }
muerde=0; total=0
mutar() {
  total=$((total+1)); local m="$TMP/m$total.sh"
  sed "$2" "$SRC" > "$m"
  if cmp -s "$m" "$SRC"; then echo "  ✗ mutación '$1' no cambió nada (canario ciego)"; return; fi
  if comprobar "$m" >/dev/null 2>&1; then echo "  ✗ '$1' ⇒ VERDE (el candado NO muerde)"
  else echo "  ✔ '$1' ⇒ ROJO"; muerde=$((muerde+1)); fi
}
mutar "down --all no pregunta"            's|^      AJENOS="\$(usuarios_ajenos_infra)"$|      AJENOS=""|'
mutar "--force-shared siempre puesto"     's|^    DOWN_ALL=0; FORCE_SHARED=0$|    DOWN_ALL=0; FORCE_SHARED=1|'
mutar "no mira los procesos ajenos"       's|^      pid_es_de_este_clon "\$pid" \&\& continue$|      continue|'
mutar "no cuenta Postgres"                's|^    elif \[ "\$n" != "0" \]; then$|    elif false; then|'
mutar "no cuenta Redis"                   's|^    \[ "\${n:-0}" = "0" \] \|\| printf .redis.*|    :|'
mutar "cuenta como ajeno lo de este clon" 's|^      pid_es_de_este_clon "\$pid" \&\& continue$|      :|'
echo "Canario: $muerde/$total mutaciones salen ROJAS."
[ "$muerde" = "$total" ]

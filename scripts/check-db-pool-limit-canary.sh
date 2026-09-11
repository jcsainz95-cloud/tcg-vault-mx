#!/usr/bin/env bash
#
# check-db-pool-limit-canary.sh — «¿el candado del pool (SB-D2) MUERDE?» · devops
# =============================================================================
# El candado hermano (`check-db-pool-limit.sh`) nace de un candado que dependía
# del hardware: el `connection_limit=5` con el que se mide el defecto de dinero
# de `398c58a` NO estaba escrito en ningún sitio — era el default de Prisma
# (`num_cpus*2+1`) sobre el runner que GitHub diera ese día. Un candado contra
# eso que nunca se ha visto en rojo es el mismo problema una capa más arriba
# (mismo criterio que §44, §47, §48.1, §49, §50, §52). Este canario lo EJERCITA
# sobre una COPIA del árbol —workflows reales + `scripts/stack-native.sh` real—
# y le planta, entre otras, la mutación EXACTA de SB-D2: devolver `ci.yml` al
# estado de `7766296` (sin `connection_limit`).
#
# Casos (rojos Y verdes — un candado que siempre cierra tampoco es un candado):
#    1. copia intacta                                         -> VERDE
#    2. ci.yml SIN connection_limit (SB-D2 literal, = 7766296) -> ROJO
#    3. e2e.yml con connection_limit=20                        -> ROJO
#    4. ci.yml con pool_timeout=60                             -> ROJO
#    5. ci.yml con connection_limit=3 y pool_timeout=5         -> VERDE (apretar ≠ aflojar)
#    6. stack-native.sh con default 50                         -> ROJO
#    7. stack-native.sh que declara el pool y NO lo aplica     -> ROJO
#    8. with_pool_params devuelve la URL tal cual              -> ROJO (se ejecuta, no se lee)
#    9. el job `backend-e2e` renombrado (anclaje perdido)      -> ROJO
#   10. un DATABASE_URL a un host REMOTO en otro job           -> VERDE + «no evaluada»
#   11. sin workflows                                          -> rc=2, NUNCA 0
#
# Uso:  ./scripts/check-db-pool-limit-canary.sh
# Sale 0 si los 11 casos salen como deben. Sin red, sin BD. ~3 s.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE="$ROOT_DIR/scripts/check-db-pool-limit.sh"

FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; FALLOS=$((FALLOS+1)); }

printf '\n\033[1m== ¿El candado del pool de Prisma (SB-D2) muerde? ==\033[0m\n\n'
[ -x "$GATE" ] || { bad "No existe/ejecuta $GATE"; exit 1; }
python3 -c 'import yaml' 2>/dev/null || { bad "python3+PyYAML no disponible: el canario no puede medir"; exit 1; }

BASE="$(mktemp -d -t sbd2-canary-XXXXXX)"
trap 'rm -rf "$BASE"' EXIT

# Copia: workflows reales + el arnés nativo real (el candado lo lee y ejecuta una
# de sus funciones). Nada más hace falta: el gate es estático salvo esa función.
copia() {
  local d="$1"; rm -rf "$d"; mkdir -p "$d/.github/workflows" "$d/scripts"
  cp "$ROOT_DIR"/.github/workflows/*.yml "$d/.github/workflows/"
  cp "$ROOT_DIR/scripts/stack-native.sh" "$d/scripts/"
}

# caso <ROJO|VERDE|RC2> <nombre> <dir> [<texto que debe aparecer>…]
caso() {
  local esperado="$1" nombre="$2" dir="$3"; shift 3
  local salida rc
  salida="$("$GATE" --root "$dir" 2>&1)"; rc=$?
  case "$esperado" in
    ROJO)  [ "$rc" -eq 1 ] || { bad "$nombre — esperaba ROJO (rc=1), salió rc=$rc"; return; } ;;
    VERDE) [ "$rc" -eq 0 ] || { bad "$nombre — esperaba VERDE (rc=0), salió rc=$rc"; printf '      %s\n' "$(grep -E '✗|error' <<<"$salida" | head -3)"; return; } ;;
    RC2)   [ "$rc" -eq 2 ] || { bad "$nombre — esperaba NO CONCLUYENTE (rc=2), salió rc=$rc"; return; } ;;
  esac
  for txt in "$@"; do
    grep -qF -- "$txt" <<<"$salida" || { bad "$nombre — rc correcto pero la salida no nombra «$txt»"; return; }
  done
  ok "$nombre — $esperado"
}

# Mutador YAML: carga, aplica una función python sobre el doc, vuelca.
muta() {  # muta <fichero.yml> <código python que modifica `d`>
  python3 - "$1" "$2" <<'PY'
import sys, yaml
f, code = sys.argv[1], sys.argv[2]
d = yaml.safe_load(open(f, encoding='utf-8'))
exec(code)
yaml.safe_dump(d, open(f, 'w', encoding='utf-8'), sort_keys=False, allow_unicode=True)
PY
}

# ---- 1. intacta -------------------------------------------------------------
D="$BASE/c1"; copia "$D"
caso VERDE "Copia intacta del árbol" "$D"

# ---- 2. SB-D2 literal: ci.yml vuelve al estado de 7766296 --------------------
D="$BASE/c2"; copia "$D"
muta "$D/.github/workflows/ci.yml" '
e = d["jobs"]["backend"]["env"]
u = e["DATABASE_URL"]
assert "connection_limit" in u, "la copia ya venía sin el pin: el canario no mide nada"
e["DATABASE_URL"] = u.split("&connection_limit")[0]
'
caso ROJO "SB-D2 literal: ci.yml sin connection_limit (el 5 lo decidiría el runner)" "$D" \
  "ci.yml" "SIN connection_limit" "num_cpus*2+1"

# ---- 3. aflojarlo a 20 en e2e.yml -------------------------------------------
D="$BASE/c3"; copia "$D"
muta "$D/.github/workflows/e2e.yml" '
e = d["jobs"]["backend-e2e"]["env"]
e["DATABASE_URL"] = e["DATABASE_URL"].replace("connection_limit=5", "connection_limit=20")
'
caso ROJO "e2e.yml con connection_limit=20 (R-3 dejaría de ver el defecto)" "$D" \
  "e2e.yml" "connection_limit=20 > 5"

# ---- 4. pool_timeout=60: el 500 se vuelve lentitud ---------------------------
D="$BASE/c4"; copia "$D"
muta "$D/.github/workflows/ci.yml" '
e = d["jobs"]["backend"]["env"]
e["DATABASE_URL"] = e["DATABASE_URL"].replace("pool_timeout=10", "pool_timeout=60")
'
caso ROJO "ci.yml con pool_timeout=60 (el agotamiento se vuelve espera)" "$D" "pool_timeout=60 > 10"

# ---- 5. apretarlo NO es aflojarlo -------------------------------------------
D="$BASE/c5"; copia "$D"
muta "$D/.github/workflows/ci.yml" '
e = d["jobs"]["backend"]["env"]
e["DATABASE_URL"] = e["DATABASE_URL"].replace("connection_limit=5", "connection_limit=3").replace("pool_timeout=10", "pool_timeout=5")
'
caso VERDE "ci.yml con connection_limit=3 / pool_timeout=5 (apretar el candado se permite)" "$D"

# ---- 6. el arnés local afloja el default ------------------------------------
D="$BASE/c6"; copia "$D"
sed -i 's/NATIVE_TEST_CONNECTION_LIMIT:-5/NATIVE_TEST_CONNECTION_LIMIT:-50/' "$D/scripts/stack-native.sh"
caso ROJO "stack-native.sh con connection_limit por defecto 50" "$D" "connection_limit=50 (> 5)"

# ---- 7. lo declara y NO lo aplica (el peor caso: parece que está) ------------
D="$BASE/c7"; copia "$D"
# shellcheck disable=SC2016  # el `$(` es literal: es el patrón que busca sed en el fichero, no una expansión.
sed -i '/DATABASE_URL="\$(with_pool_params /d' "$D/scripts/stack-native.sh"
caso ROJO "stack-native.sh declara el pool pero no lo aplica a DATABASE_URL" "$D" "NO lo aplica"

# ---- 8. with_pool_params rota: devuelve la URL tal cual ----------------------
D="$BASE/c8"; copia "$D"
python3 - "$D/scripts/stack-native.sh" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
roto = 'with_pool_params() {\n  printf \'%s\' "$1"\n}\n'
s2 = re.sub(r'with_pool_params\(\) \{.*?\n\}\n', roto, s, count=1, flags=re.S)
assert s2 != s, "no pude romper with_pool_params: el canario no mide nada"
open(p, 'w', encoding='utf-8').write(s2)
PY
caso ROJO "with_pool_params devuelve la URL sin tocar (se EJECUTA, no se lee)" "$D" "no fija el pool"

# ---- 9. anclaje perdido: el job de e2e renombrado ---------------------------
D="$BASE/c9"; copia "$D"
muta "$D/.github/workflows/e2e.yml" '
d["jobs"]["backend-e2e-renombrado"] = d["jobs"].pop("backend-e2e")
'
caso ROJO "job \`backend-e2e\` renombrado: el anclaje se pierde y el gate lo dice" "$D" \
  "falta el anclaje" "backend-e2e"

# ---- 10. un DATABASE_URL remoto no se juzga, se declara ----------------------
D="$BASE/c10"; copia "$D"
muta "$D/.github/workflows/ci.yml" '
d["jobs"]["canario-remoto"] = {"runs-on":"ubuntu-latest",
  "env":{"DATABASE_URL":"postgresql://sin_credencial@monorail.proxy.rlwy.net:1234/railway?schema=public"},
  "steps":[{"uses":"actions/checkout@v5"},{"name":"nada","run":"true"}]}
'
caso VERDE "DATABASE_URL a un host remoto: «no evaluada», no verde fingido" "$D" \
  "No evaluadas" "monorail.proxy.rlwy.net"

# ---- 11. sin workflows -> rc=2 ----------------------------------------------
D="$BASE/c11"; copia "$D"; rm -f "$D"/.github/workflows/*.yml
caso RC2 "Sin workflows: no concluyente, nunca verde" "$D"

echo
if [ "$FALLOS" -ne 0 ]; then
  printf '\033[1;31m✗ Canario SB-D2: %s/%s casos fallaron. El candado del pool NO muerde donde debe.\033[0m\n' "$FALLOS" "$((PASADAS+FALLOS))"
  exit 1
fi
printf '\033[1;32m✓ Canario SB-D2: %s/%s — muerde en los rojos y deja pasar los verdes.\033[0m\n' "$PASADAS" "$((PASADAS+FALLOS))"
exit 0

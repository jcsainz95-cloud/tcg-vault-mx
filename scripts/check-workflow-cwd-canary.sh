#!/usr/bin/env bash
#
# check-workflow-cwd-canary.sh — «¿el candado de S-CI-1 MUERDE?» · devops
# =============================================================================
# El candado hermano (`check-workflow-cwd.sh`) nace de un job deploy-blocking
# que estuvo muerto nueve corridas seguidas sin que nadie lo diagnosticara. Un
# candado contra eso que nunca se ha visto en rojo es el mismo problema una capa
# más arriba (mismo criterio que §44, §47, §48.1, §49, §50). Este canario lo
# EJERCITA sobre una COPIA del árbol: workflows reales + esqueleto de scripts, y
# le planta, entre otras, la mutación EXACTA de S-CI-1: quitar el override del
# paso «Resolver secretos» de `e2e.yml`.
#
# Casos (rojos Y verdes — un candado que siempre cierra tampoco es un candado):
#   1. copia intacta                                        -> VERDE
#   2. e2e.yml sin el override del paso «Resolver secretos» -> ROJO (S-CI-1 literal)
#   3. job nuevo con defaults cwd=frontend y ./scripts/x.sh -> ROJO
#   4. el mismo job con working-directory: github.workspace -> VERDE
#   5. ./scripts/no-existe.sh desde la raíz                 -> ROJO (127 sin cwd)
#   6. la invocación en un COMENTARIO                       -> VERDE
#   7. `cd backend && ./scripts/x.sh` (límite declarado)    -> VERDE + «no evaluada»
#   8. sin workflows                                        -> rc=2, NUNCA 0
#
# Uso:  ./scripts/check-workflow-cwd-canary.sh
# Sale 0 si los 8 casos salen como deben. Sin red, sin Docker. ~2 s.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE="$ROOT_DIR/scripts/check-workflow-cwd.sh"

FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; FALLOS=$((FALLOS+1)); }

printf '\n\033[1m== ¿El candado de S-CI-1 (scripts fuera del cwd del paso) muerde? ==\033[0m\n\n'
[ -x "$GATE" ] || { bad "No existe/ejecuta $GATE"; exit 1; }
python3 -c 'import yaml' 2>/dev/null || { bad "python3+PyYAML no disponible: el canario no puede medir"; exit 1; }

BASE="$(mktemp -d -t sci1-canary-XXXXXX)"
trap 'rm -rf "$BASE"' EXIT

# Copia: workflows reales + ESQUELETO de todos los scripts (ficheros vacíos con el
# mismo nombre). El candado sólo mira existencia, así que basta con eso y es rápido.
copia() {
  local d="$1"; rm -rf "$d"; mkdir -p "$d/.github/workflows"
  cp "$ROOT_DIR"/.github/workflows/*.yml "$d/.github/workflows/"
  ( cd "$ROOT_DIR" && find scripts security -name '*.sh' -o -name '*.py' 2>/dev/null ) | while read -r f; do
    mkdir -p "$d/$(dirname "$f")"; : > "$d/$f"
  done
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

# ---- 2. S-CI-1 literal: quitar el override del paso «Resolver secretos» --------
D="$BASE/c2"; copia "$D"
muta "$D/.github/workflows/e2e.yml" '
steps = d["jobs"]["backend-e2e"]["steps"]
hit = [s for s in steps if str(s.get("name","")).startswith("Resolver secretos")]
assert hit, "no encuentro el paso «Resolver secretos» en e2e.yml"
hit[0].pop("working-directory", None)
'
caso ROJO "S-CI-1 literal: e2e.yml/backend-e2e sin override en «Resolver secretos»" "$D" \
  "e2e.yml" "backend-e2e" "webhook-secret-preflight.sh" "backend/scripts/"

# ---- 3. job nuevo con defaults cwd=frontend y ./scripts/dev-up.sh --------------
D="$BASE/c3"; copia "$D"
muta "$D/.github/workflows/ci.yml" '
d["jobs"]["canario-cwd"] = {"runs-on":"ubuntu-latest","defaults":{"run":{"working-directory":"frontend"}},
  "steps":[{"uses":"actions/checkout@v4"},{"name":"invoca desde frontend","run":"./scripts/dev-up.sh"}]}
'
caso ROJO "Job nuevo con defaults cwd=frontend invocando ./scripts/dev-up.sh" "$D" "canario-cwd" "frontend/scripts/dev-up.sh"

# ---- 4. el mismo job, con el override en el paso --------------------------------
D="$BASE/c4"; copia "$D"
muta "$D/.github/workflows/ci.yml" '
d["jobs"]["canario-cwd"] = {"runs-on":"ubuntu-latest","defaults":{"run":{"working-directory":"frontend"}},
  "steps":[{"uses":"actions/checkout@v4"},{"name":"invoca con override","working-directory":"${{ github.workspace }}","run":"./scripts/dev-up.sh"}]}
'
caso VERDE "El mismo job con working-directory: \${{ github.workspace }} en el paso" "$D"

# ---- 5. script inexistente desde la raíz ----------------------------------------
D="$BASE/c5"; copia "$D"
muta "$D/.github/workflows/ci.yml" '
d["jobs"]["canario-cwd"] = {"runs-on":"ubuntu-latest",
  "steps":[{"uses":"actions/checkout@v4"},{"name":"no existe","run":"./scripts/no-existe-jamas.sh --check"}]}
'
caso ROJO "./scripts/no-existe-jamas.sh desde la raíz (127 sin cwd de por medio)" "$D" "no-existe-jamas.sh"

# ---- 6. la invocación sólo en un comentario ------------------------------------
D="$BASE/c6"; copia "$D"
muta "$D/.github/workflows/ci.yml" '
d["jobs"]["canario-cwd"] = {"runs-on":"ubuntu-latest","defaults":{"run":{"working-directory":"backend"}},
  "steps":[{"uses":"actions/checkout@v4"},{"name":"comentario","run":"# antes: ./scripts/no-existe-jamas.sh\nnpm test"}]}
'
caso VERDE "Invocación que sólo aparece en un comentario" "$D"

# ---- 7. límite declarado: cd + invocación -> no evaluada, no rojo ----------------
D="$BASE/c7"; copia "$D"
muta "$D/.github/workflows/ci.yml" '
d["jobs"]["canario-cwd"] = {"runs-on":"ubuntu-latest","defaults":{"run":{"working-directory":"backend"}},
  "steps":[{"uses":"actions/checkout@v4"},{"name":"cd","run":"cd .. && ./scripts/dev-up.sh"}]}
'
caso VERDE "cd … && ./scripts/x.sh se declara «no evaluada» en vez de fingir" "$D" "No evaluadas" "dev-up.sh"

# ---- 8. sin workflows -> rc=2 ----------------------------------------------------
D="$BASE/c8"; copia "$D"; rm -f "$D"/.github/workflows/*.yml
caso RC2 "Sin workflows: no concluyente, nunca verde" "$D"

echo
if [ "$FALLOS" -ne 0 ]; then
  printf '\033[1;31m✗ Canario de S-CI-1: %s/%s casos fallaron. El candado NO muerde donde debe.\033[0m\n' "$FALLOS" "$((PASADAS+FALLOS))"
  exit 1
fi
printf '\033[1;32m✓ Canario de S-CI-1: %s/%s — muerde en los rojos y deja pasar los verdes.\033[0m\n' "$PASADAS" "$((PASADAS+FALLOS))"
exit 0

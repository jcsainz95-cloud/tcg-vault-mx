#!/usr/bin/env bash
#
# check-doc-size-canary.sh — ¿el trinquete DOC-SIZE sabe ponerse rojo, y solo baja?   · devops
# =============================================================================
# Planta casos en árboles temporales (nunca en el repo) y exige a check-doc-size.sh el rc correcto
# Y la línea que nombra el documento. Casos:
#   VERDE  · control: árbol idéntico al baseline · documento nuevo dentro del tope de su clase ·
#            --update tras compactar baja el umbral y sigue verde · --against-ref con umbrales iguales
#            o más bajos.
#   ROJO   · un documento con UNA línea más que su umbral (y el rojo dice cuál y «+1») ·
#            documento nuevo de 1501 líneas en docs/specs/ · PROJECT.md nuevo con 401 ·
#            --update NO sube el umbral de un documento que creció (sigue rojo) ·
#            --against-ref con un umbral subido a mano.
#   rc 2   · sin baseline · baseline mal formado · ref ilegible (no concluyente ≠ verde).
# Uso: ./scripts/check-doc-size-canary.sh [N]   (N repeticiones del conjunto; por defecto 1)
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$ROOT_DIR/scripts/check-doc-size.sh"
N="${1:-1}"
BASE="$(mktemp -d -t doc-size-canario-XXXXXX)"; trap 'rm -rf "$BASE"' EXIT
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }

lineas_de() { local n="$1" i; for ((i=1;i<=n;i++)); do echo "línea $i"; done; }

arbol() {
  # mktemp y no un contador: `arbol` corre en $(…), un subshell — un contador no sobreviviría y todos
  # los casos compartirían árbol (medido: así salían 16/45 falsos rojos en la primera versión).
  local d; d="$(mktemp -d "$BASE/t-XXXXXX")"; mkdir -p "$d/docs/specs" "$d/scripts"
  lineas_de 10 > "$d/PROJECT.md"; lineas_de 30 > "$d/docs/API_CONTRACT.md"; lineas_de 5 > "$d/docs/specs/A.md"
  printf '%s\t%s\n' 10 PROJECT.md 30 docs/API_CONTRACT.md 5 docs/specs/A.md > "$d/scripts/doc-size.baseline"
  echo "$d"
}
# caso <rc_esperado> <nombre> <dir> [texto que la salida debe contener] [args extra]
caso() {
  local esperado="$1" nombre="$2" d="$3" debe="${4:-}"; shift 4 || shift $#
  local out rc; out="$("$CHECK" --root "$d" "$@" 2>&1)"; rc=$?
  if [ "$rc" -ne "$esperado" ]; then bad "$nombre — rc=$rc, esperaba $esperado. Salida: $(tail -2 <<<"$out" | tr '\n' ' ')"; return; fi
  if [ -n "$debe" ] && [[ "$out" != *"$debe"* ]]; then bad "$nombre — rc correcto ($rc) pero la salida no dice «$debe»"; return; fi
  ok "$nombre — rc=$rc${debe:+ y dice «$debe»}"
}

for ((r=1;r<=N;r++)); do
  printf '\n\033[1m== DOC-SIZE canario, ronda %s/%s ==\033[0m\n' "$r" "$N"
  d="$(arbol)"; caso 0 "control: árbol igual al baseline" "$d" "VERDE"
  d="$(arbol)"; echo extra >> "$d/docs/API_CONTRACT.md"
  caso 1 "API_CONTRACT con una línea más" "$d" "docs/API_CONTRACT.md CRECIÓ: 31 líneas > 30"
  d="$(arbol)"; echo extra >> "$d/PROJECT.md"; caso 1 "PROJECT.md con una línea más" "$d" "PROJECT.md CRECIÓ"
  d="$(arbol)"; lineas_de 1500 > "$d/docs/specs/NUEVO.md"; caso 0 "documento nuevo de 1500 (tope de su clase)" "$d" "VERDE"
  d="$(arbol)"; lineas_de 1501 > "$d/docs/specs/NUEVO.md"; caso 1 "documento nuevo de 1501 líneas" "$d" "docs/specs/NUEVO.md CRECIÓ: 1501 líneas > 1500 (documento nuevo"
  d="$(arbol)"; lineas_de 3001 > "$d/docs/ARCHITECTURE.md"; caso 1 "ARCHITECTURE nuevo de 3001 (tope 3000)" "$d" "docs/ARCHITECTURE.md CRECIÓ"
  # --update baja tras compactar…
  d="$(arbol)"; lineas_de 20 > "$d/docs/API_CONTRACT.md"
  "$CHECK" --root "$d" --update >/dev/null 2>&1
  if grep -qP '^20\tdocs/API_CONTRACT.md$' "$d/scripts/doc-size.baseline"; then ok "--update bajó el umbral de 30 a 20 tras compactar"; else bad "--update NO bajó el umbral (baseline: $(tr '\n' ' ' < "$d/scripts/doc-size.baseline"))"; fi
  echo extra >> "$d/docs/API_CONTRACT.md"; caso 1 "tras bajar, volver a crecer (+1 sobre 20) es rojo" "$d" "21 líneas > 20"
  # …y nunca sube.
  d="$(arbol)"; lineas_de 40 > "$d/docs/API_CONTRACT.md"
  "$CHECK" --root "$d" --update >/dev/null 2>&1
  caso 1 "--update NO sube el umbral de un documento que creció" "$d" "40 líneas > 30"
  # No concluyente.
  d="$(arbol)"; rm "$d/scripts/doc-size.baseline"; caso 2 "sin baseline" "$d" "NO concluyente"
  d="$(arbol)"; printf 'treinta\tdocs/API_CONTRACT.md\n' > "$d/scripts/doc-size.baseline"; caso 2 "baseline mal formado" "$d" "mal formada"
  # --against-ref: umbral subido a mano respecto al commit anterior.
  d="$(arbol)"
  ( cd "$d" && git init -q . && git -c user.email=c@c -c user.name=c add -A && git -c user.email=c@c -c user.name=c commit -qm base ) >/dev/null 2>&1
  REF="$(git -C "$d" rev-parse HEAD 2>/dev/null)"
  caso 0 "--against-ref con los mismos umbrales" "$d" "VERDE" --against-ref "$REF"
  sed -i 's/^30\t/31\t/' "$d/scripts/doc-size.baseline"
  caso 1 "--against-ref con un umbral subido a mano (30→31)" "$d" "SUBIÓ de 30 a 31" --against-ref "$REF"
  sed -i 's/^31\t/29\t/' "$d/scripts/doc-size.baseline"; lineas_de 29 > "$d/docs/API_CONTRACT.md"
  caso 0 "--against-ref con un umbral bajado (30→29) y el documento compactado" "$d" "VERDE" --against-ref "$REF"
  caso 2 "--against-ref con una ref que no existe" "$d" "NO es concluyente" --against-ref "0000000000000000000000000000000000000001"
  # Re-medición declarada (`# base-sha:`, §101.5): A = baseline 30; B = el documento creció a 35 en la
  # rama base ANTES de que el candado la midiera.
  d="$(arbol)"; G=(git -C "$d" -c user.email=c@c -c user.name=c)
  ( "${G[@]}" init -q . && "${G[@]}" add -A && "${G[@]}" commit -qm A ) >/dev/null 2>&1; A="$(git -C "$d" rev-parse HEAD)"
  lineas_de 35 > "$d/docs/API_CONTRACT.md"; ( "${G[@]}" add -A && "${G[@]}" commit -qm B ) >/dev/null 2>&1; B="$(git -C "$d" rev-parse HEAD)"
  remedir() { printf '# base-sha: %s\n%s\t%s\n%s\t%s\n%s\t%s\n' "$1" 10 PROJECT.md "$2" docs/API_CONTRACT.md 5 docs/specs/A.md > "$d/scripts/doc-size.baseline"; }
  remedir "$B" 35; caso 0 "re-medición declarada sobre B (35 = wc en B, B ancestro de la ref)" "$d" "re-medición declarada" --against-ref "$B"
  remedir "$B" 36; caso 1 "re-medición que sube MÁS que wc en el sha declarado (36 ≠ 35)" "$d" "SUBIÓ de 30 a 36" --against-ref "$B"
  remedir "$B" 35; caso 1 "re-medición con un sha que NO es ancestro de la ref (crecimiento traído por el cambio)" "$d" "SUBIÓ de 30 a 35" --against-ref "$A"
  ( "${G[@]}" add -A && "${G[@]}" commit -qm C ) >/dev/null 2>&1; C="$(git -C "$d" rev-parse HEAD)"
  lineas_de 40 > "$d/docs/API_CONTRACT.md"; remedir "$B" 40
  caso 1 "segunda subida con el MISMO base-sha que ya tenía la ref" "$d" "SUBIÓ de 35 a 40" --against-ref "$C"
  # R3 (techlead, 2026-10-19) (b): segunda re-medición con OTRO sha — la ref C ya declaraba base-sha B.
  # D: en la rama base el documento llegó a 38 con el baseline (base-sha B, 35) intacto. Una segunda
  # re-medición sobre D cumpliría todo lo demás (D ancestro de la ref, 38 = wc en D = wc en la ref).
  lineas_de 38 > "$d/docs/API_CONTRACT.md"; remedir "$B" 35
  ( "${G[@]}" add -A && "${G[@]}" commit -qm D ) >/dev/null 2>&1; D="$(git -C "$d" rev-parse HEAD)"
  remedir "$D" 38; caso 1 "segunda re-medición con otro sha (D) cuando la ref ya declaraba B" "$d" "base-sha cambió" --against-ref "$D"
  # R3 (a): ancestro ANTERIOR a una compactación. P0: 30 · P1: creció a 60 · P2: compactado a 20.
  d="$(arbol)"; G=(git -C "$d" -c user.email=c@c -c user.name=c)
  ( "${G[@]}" init -q . && "${G[@]}" add -A && "${G[@]}" commit -qm P0 ) >/dev/null 2>&1
  lineas_de 60 > "$d/docs/API_CONTRACT.md"; ( "${G[@]}" add -A && "${G[@]}" commit -qm P1 ) >/dev/null 2>&1; P1="$(git -C "$d" rev-parse HEAD)"
  lineas_de 20 > "$d/docs/API_CONTRACT.md"; ( "${G[@]}" add -A && "${G[@]}" commit -qm P2 ) >/dev/null 2>&1; P2="$(git -C "$d" rev-parse HEAD)"
  remedir "$P1" 60; caso 1 "re-medición sobre un ancestro previo a la compactación (60 > 20 en la ref)" "$d" "SUBIÓ de 30 a 60" --against-ref "$P2"
  remedir "$P1" 20; caso 0 "control: con base-sha declarado, BAJAR al compactado sigue verde" "$d" "VERDE" --against-ref "$P2"
done

printf '\n'
if [ "$FALLOS" -gt 0 ]; then printf '\033[1;31mROJO: %s/%s casos del canario fallaron.\033[0m\n' "$FALLOS" "$((FALLOS+PASADAS))"; exit 1; fi
printf '\033[1;32mVERDE: %s/%s casos (N=%s rondas): el trinquete muerde, nombra el documento y solo baja.\033[0m\n' "$PASADAS" "$PASADAS" "$N"

#!/usr/bin/env bash
#
# check-e2e-skip-census-canary.sh — «¿el censo de salvaguardas E2E cuenta bien y
# se pone rojo si crece?» · devops (techlead N7, 2026-09-11)
# =============================================================================
# POR QUÉ ESTE CANARIO **NO** USA EL ÁRBOL NI EL BASELINE VIVOS (2026-09-11)
# ---------------------------------------------------------------------------
# La primera versión copiaba `frontend/e2e` y la comparaba contra el baseline
# COMMITEADO. Medido en CI (run 34624748863, job `e2e-skip-census`, `18f2b01`):
# frontend añadió tres specs de Stream B, el baseline quedó por debajo del
# conteo real y el canario cayó a **3/5** — «copia intacta = baseline» y
# «-1 needsSeed ⇒ verde» en rojo. Y con ellos cayó `ci-ok`.
#
#     ► Un baseline desfasado es un hecho del GATE, no del canario.
#
# Son dos preguntas distintas y necesitan dos señales distintas:
#   · GATE  (`check-e2e-skip-census.sh`): ¿el número de salvaguardas creció
#     respecto a lo acordado? — rojo legítimo, se cierra regenerando con motivo.
#   · CANARIO (esto): ¿el instrumento SABE contar y SABE ponerse rojo? — si esto
#     está rojo, el instrumento está roto, y eso no se arregla regenerando nada.
# Cuando una sola causa apagaba las dos, el rojo no distinguía «el mecanismo se
# rompió» de «el número subió», que es la enfermedad que este repo persigue.
#
# Por eso el canario trabaja sobre un árbol SINTÉTICO propio con conteos
# CONOCIDOS y un baseline que él mismo fabrica. No depende de `frontend/` (ruta
# de otro rol, que cambia cada día) ni del baseline commiteado. Del baseline
# vivo solo comprueba la ESTRUCTURA (que tenga las cuatro claves), nunca sus
# números: esos son del gate.
#
# QUÉ EXIGE
#   1. Cuenta EXACTO sobre un árbol de conteos conocidos (valida el método
#      `grep -rwo` por palabra completa: `mockOnlyX` no es `mockOnly`).
#   2. Árbol == baseline                         → rc=0
#   3. MUTACIÓN: +1 `mockOnly`                   → rc=1 (y lo dice)
#   4. MUTACIÓN: +1 en cada una de las 4 claves  → rc=1
#   5. -1 `needsSeed`                            → rc=0 (bajar no es delito)
#   6. baseline ausente                          → rc=2 (no concluyente)
#   7. baseline sin una de las claves            → rc=2 (no concluyente)
#   8. `--update` sin `--motivo`                 → rc=2 (un techo sin motivo no)
#   9. `--update --motivo` deja el gate en verde y el motivo escrito en el fichero
#  10. el baseline COMMITEADO tiene las 4 claves (estructura, no números)
#
# Uso:  ./scripts/check-e2e-skip-census-canary.sh
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE="$ROOT_DIR/scripts/check-e2e-skip-census.sh"
BL_VIVO="$ROOT_DIR/scripts/e2e-skip-census.baseline"
[ -x "$GATE" ] || { echo "✗ falta $GATE"; exit 1; }
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }
printf '\n\033[1m== ¿El censo de salvaguardas E2E cuenta bien y muerde si crece? ==\033[0m\n'
printf '   (árbol SINTÉTICO y baseline propio: un baseline desfasado es rojo del GATE, no de aquí)\n\n'

TMP="$(mktemp -d -t e2e-census-canario-XXXXXX)"; trap 'rm -rf "$TMP"' EXIT
DIR="$TMP/e2e"; BL="$TMP/baseline"

# --- Árbol sintético con conteos CONOCIDOS -----------------------------------
#   mockOnly 4/3 · needsSeed 3/3 · harnessLimit 2/2 · skipIfSeedMissing 1/1
# (los valores de ESPERADO están MEDIDOS sobre este mismo árbol, no escritos a
# ojo: la primera versión los puso a mano y este caso 1 cazó el error.)
# Incluye señuelos que NO deben contar (`mockOnlyX`, `_mockOnly`, `.md`).
sembrar() {
  rm -rf "$DIR"; mkdir -p "$DIR/utils"
  cat > "$DIR/a.spec.ts" <<'T'
test.skip(mockOnly, 'x');
if (mockOnly && needsSeed) { }
const mockOnlyX = 1;      // señuelo: sufijo, no la palabra
T
  cat > "$DIR/b.spec.ts" <<'T'
const o = { mockOnly: true, harnessLimit: 'sin-google' };
test(needsSeed ? 'a' : 'b', () => {});
const notThis = _mockOnlyZ;  // señuelo: prefijo y sufijo
T
  cat > "$DIR/c.spec.ts" <<'T'
skipIfSeedMissing(test);
harnessLimit;
mockOnly;
needsSeed;
T
  cat > "$DIR/utils/env.ts" <<'T'
export const helpers = 1;  // sin salvaguardas
T
  cat > "$DIR/README.md" <<'T'
mockOnly mockOnly mockOnly   (fichero .md: fuera del censo)
T
}
ESPERADO="mockOnly 4 3
needsSeed 3 3
harnessLimit 2 2
skipIfSeedMissing 1 1"

fabricar_bl() { "$GATE" --dir "$DIR" --baseline "$BL" --update --motivo "canario" >/dev/null 2>&1; }
# caso <rc_esperado> <nombre> [baseline]
caso() { local rc; "$GATE" --dir "$DIR" --baseline "${3:-$BL}" >/dev/null 2>&1; rc=$?
  [ "$rc" -eq "$1" ] && ok "$2 — rc=$rc" || bad "$2 — rc=$rc, esperaba $1"; }

# 1. cuenta exacto (y los señuelos no cuentan)
sembrar; fabricar_bl
VISTO="$(grep -vE '^#' "$BL" | grep -v '^$')"
if [ "$VISTO" = "$ESPERADO" ]; then ok "cuenta EXACTO sobre conteos conocidos (mockOnly 4/3, needsSeed 3/3, harnessLimit 2/2, skipIfSeedMissing 1/1; señuelos mockOnlyX/_mockOnly/.md fuera)"
else bad "conteo incorrecto:"; printf '      esperado: %s\n' "$(tr '\n' '|' <<<"$ESPERADO")"; printf '      visto:    %s\n' "$(tr '\n' '|' <<<"$VISTO")"; fi

# 2. intacto
caso 0 "árbol == baseline ⇒ verde"

# 3. +1 mockOnly
printf '\nconst extra = { mockOnly: true };\n' >> "$DIR/a.spec.ts"
caso 1 "MUTACIÓN: +1 mockOnly ⇒ ROJO"
SALIDA="$("$GATE" --dir "$DIR" --baseline "$BL" 2>&1)"
grep -F 'CRECIÓ' >/dev/null <<<"$SALIDA" && ok "el rojo dice qué clave creció y con qué números" \
  || bad "el rojo no dice «CRECIÓ»: $(tail -2 <<<"$SALIDA" | tr -d '\033')"
sembrar

# 4. +1 en cada clave
for k in mockOnly needsSeed harnessLimit skipIfSeedMissing; do
  printf '\nconst z = %s;\n' "$k" >> "$DIR/c.spec.ts"
done
caso 1 "MUTACIÓN: +1 en las CUATRO claves ⇒ ROJO"
sembrar

# 5. bajar no es delito
sed -i '0,/\bneedsSeed\b/s//needsSeedX/' "$DIR/a.spec.ts"
caso 0 "-1 needsSeed ⇒ verde (bajar el techo no bloquea; avisa de regenerar)"
sembrar

# 6. baseline ausente
caso 2 "baseline ausente ⇒ rc=2 (no concluyente, nunca verde)" "$TMP/no-existe"

# 7. baseline sin una de las claves
grep -v '^harnessLimit ' "$BL" > "$TMP/bl-incompleto"
caso 2 "baseline sin la clave harnessLimit ⇒ rc=2" "$TMP/bl-incompleto"

# 8. --update sin --motivo
"$GATE" --dir "$DIR" --baseline "$TMP/bl-sin-motivo" --update >/dev/null 2>&1; rc=$?
[ "$rc" -eq 2 ] && ok "--update sin --motivo ⇒ rc=2 (un techo que nadie defiende no se escribe)" \
  || bad "--update sin motivo ⇒ rc=$rc, esperaba 2"
[ -f "$TMP/bl-sin-motivo" ] && bad "--update sin motivo ESCRIBIÓ el fichero igualmente" \
  || ok "--update sin motivo no escribe nada"

# 9. --update con motivo: deja verde y el motivo queda escrito
printf '\nconst extra2 = { mockOnly: true };\n' >> "$DIR/b.spec.ts"
"$GATE" --dir "$DIR" --baseline "$BL" --update --motivo "MOTIVO-CANARIO-9" >/dev/null 2>&1
caso 0 "tras --update --motivo, el gate vuelve a verde"
grep -F 'MOTIVO-CANARIO-9' >/dev/null < "$BL" && ok "el motivo queda ESCRITO en el baseline (quien lo suba deja su firma)" \
  || bad "el baseline regenerado no conserva el motivo"

# 10. el baseline COMMITEADO: estructura, no números (los números son del gate)
if [ -f "$BL_VIVO" ]; then
  FALTAN=""
  for k in mockOnly needsSeed harnessLimit skipIfSeedMissing; do
    grep -E "^$k [0-9]+ [0-9]+$" >/dev/null < "$BL_VIVO" || FALTAN="$FALTAN $k"
  done
  [ -z "$FALTAN" ] && ok "el baseline commiteado tiene las 4 claves bien formadas (sus NÚMEROS los juzga el gate, no este canario)" \
    || bad "el baseline commiteado no tiene bien formada(s):$FALTAN"
else
  bad "falta $BL_VIVO (el gate saldría rc=2)"
fi

TOTAL=$((PASADAS+FALLOS)); echo
[ "$FALLOS" -eq 0 ] && { printf '\033[1;32m✓ Canario censo E2E: %s/%s — cuenta exacto, muerde al crecer y no depende del baseline vivo.\033[0m\n' "$PASADAS" "$TOTAL"; exit 0; }
printf '\033[1;31m✗ Canario censo E2E: %s/%s — el INSTRUMENTO está roto (esto no se arregla regenerando el baseline).\033[0m\n' "$PASADAS" "$TOTAL"; exit 1

#!/usr/bin/env bash
#
# check-measurement-publish-gate-canary.sh — ¿C-D1 sabe ponerse rojo?                       · devops
# =============================================================================
# Copia frontend/ a un temporal (node_modules por enlace, nunca se toca el árbol real), le hace
# mutaciones y exige a check-measurement-publish-gate.sh el rc y el motivo correctos:
#   C0  control: el árbol tal cual ⇒ rc 0.
#   M1  sin `prebuild` ⇒ rc 1 «E1» (Vercel construiría sin la puerta).
#   M2  `check:measurement` = `true` (una puerta que no muerde) con el aviso viejo ⇒ rc 1 «NO MUERDE».
#   M3  `check:measurement` = `exit 1` (una puerta que tumba todo) ⇒ rc 1 «tumbaría el build» (off estorba).
#   M4  entrega a medias: lógica sin `check:measurement` ⇒ rc 1 · M4b sin ninguna de las dos ⇒ rc 1.
#   M5  la frase vieja quitada pero MEASUREMENT_DISCLOSURE = null, con puerta `true` ⇒ rc 1 «NO MUERDE»
#       (prueba que el lector de la constante está vivo: el regex viejo, muerto, lo daba por aviso nuevo).
#   M6  MEASUREMENT_DISCLOSURE con una forma que no sé leer ⇒ rc 2 (no concluyente, no adivina).
#   M7  frase quitada y MEASUREMENT_DISCLOSURE = { … }, puerta `true` ⇒ rc 0 (el lector ve «objeto»).
# El lado VERDE con el aviso nuevo no se simula aquí (fabricar un aviso «válido» sería adivinar las
# reglas de frontend): lo mide C0 el día que el aviso del abogado entre en el árbol, y las pruebas
# unitarias de frontend sobre publish-check.ts.
# Uso: ./scripts/check-measurement-publish-gate-canary.sh   (requiere npm ci en frontend/)
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$ROOT_DIR/scripts/check-measurement-publish-gate.sh"
BASE="$(mktemp -d -t cd1-canario-XXXXXX)"; trap 'rm -rf "$BASE"' EXIT
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }

copia() {
  local d; d="$(mktemp -d "$BASE/fe-XXXXXX")"
  ( cd "$ROOT_DIR/frontend" && tar --exclude=./node_modules --exclude='./.next*' --exclude=./playwright-report --exclude=./test-results -cf - . ) | tar -xf - -C "$d"
  [ -d "$ROOT_DIR/frontend/node_modules" ] && ln -s "$ROOT_DIR/frontend/node_modules" "$d/node_modules"
  echo "$d"
}
script_set() { # <dir> <nombre> <valor|__borrar__>
  node -e 'const fs=require("fs"),p=process.argv[1]+"/package.json",j=JSON.parse(fs.readFileSync(p));j.scripts=j.scripts||{};if(process.argv[3]==="__borrar__")delete j.scripts[process.argv[2]];else j.scripts[process.argv[2]]=process.argv[3];fs.writeFileSync(p,JSON.stringify(j,null,2))' "$1" "$2" "$3"
}
caso() { # <rc esperado> <nombre> <dir> [texto] [args]
  local esp="$1" nombre="$2" d="$3" debe="${4:-}"; shift 4 || shift $#
  local out rc; out="$("$CHECK" --frontend "$d" "$@" 2>&1)"; rc=$?
  if [ "$rc" -ne "$esp" ]; then bad "$nombre — rc=$rc, esperaba $esp. $(grep -E '✗|::warning|VERDE|ROJO' <<<"$out" | head -3 | tr '\n' ' ')"; return; fi
  if [ -n "$debe" ] && [[ "$out" != *"$debe"* ]]; then bad "$nombre — rc=$rc correcto pero no dice «$debe»"; return; fi
  ok "$nombre — rc=$rc${debe:+ («$debe»)}"
}

printf '\n\033[1m== C-D1 canario ==\033[0m\n'
FE0="$(copia)"
[ -d "$ROOT_DIR/frontend/node_modules" ] || { echo "✗ falta frontend/node_modules (npm ci): el canario no puede ejecutar la puerta. NO es verde."; exit 2; }
L=src/content/legal
sin_frase() { sed -i 's/No usamos cookies de publicidad ni de analítica\./Usamos medición con tu consentimiento./' "$1/$L/privacidad.es.ts"; }
disc() { sed -i -E "s/^(export const MEASUREMENT_DISCLOSURE\b[^=]*=).*$/\1 $2/" "$1/$L/measurement-disclosure.ts"; }
caso 0 "C0 · control: el árbol real" "$FE0" "VERDE"
d="$(copia)"; script_set "$d" prebuild __borrar__;              caso 1 "M1 · sin prebuild" "$d" "E1"
d="$(copia)"; script_set "$d" check:measurement 'exit 1';        caso 1 "M3 · la puerta tumba también con off" "$d" "tumbaría el build"
d="$(copia)"; script_set "$d" check:measurement __borrar__;      caso 1 "M4 · lógica sin check:measurement" "$d" "no existe"
d="$(copia)"; script_set "$d" check:measurement __borrar__; sed -i 's/measurement/medicion/g' "$d/$L/publish-check.ts"
caso 1 "M4b · sin lógica ni script (ya no hay excepción PENDIENTE)" "$d" "no menciona la medición"
if grep -q 'No usamos cookies de publicidad ni de analítica' "$FE0/$L/privacidad.es.ts"; then
  d="$(copia)"; script_set "$d" check:measurement 'true';        caso 1 "M2 · puerta que no muerde, con el aviso viejo" "$d" "NO MUERDE"
fi
d="$(copia)"; sin_frase "$d"; disc "$d" 'null;'; script_set "$d" check:measurement 'true'
caso 1 "M5 · sin la frase pero MEASUREMENT_DISCLOSURE = null, puerta que no muerde" "$d" "measurementDisclosure = null"
d="$(copia)"; disc "$d" 'construirDivulgacion();'; caso 2 "M6 · forma de MEASUREMENT_DISCLOSURE ilegible" "$d" "no sé leer"
d="$(copia)"; sin_frase "$d"; disc "$d" "{ version: 'canario' } as MeasurementDisclosure | null;"; script_set "$d" check:measurement 'true'
caso 0 "M7 · sin la frase y MEASUREMENT_DISCLOSURE = { … } ⇒ el lector lo ve como aviso nuevo" "$d" "pasa con el aviso nuevo"
printf '\n'
if [ "$FALLOS" -gt 0 ]; then printf '\033[1;31mROJO: %s/%s casos del canario de C-D1 fallaron.\033[0m\n' "$FALLOS" "$((FALLOS+PASADAS))"; exit 1; fi
printf '\033[1;32mVERDE: %s/%s casos: C-D1 muerde.\033[0m\n' "$PASADAS" "$PASADAS"

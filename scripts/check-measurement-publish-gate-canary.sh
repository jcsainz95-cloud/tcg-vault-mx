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
#   Bloqueos de encendido (ENCENDER_BLOCKERS, ARCHITECTURE §14.1 D-MKT2-0c), con la puerta REAL:
#   M8  aviso nuevo + un bloqueo de canario añadido ⇒ rc 0 «solo la frenan los bloqueos» (aviso sano).
#   M9  aviso nuevo + bloqueo + un problema del aviso (sin «14 meses») ⇒ rc 1 «problema(s) del aviso».
#   M10 aviso viejo (MEASUREMENT_DISCLOSURE = null) ⇒ rc 0 «muerde con el aviso viejo».
#   Con una puerta de canario que imprime el rótulo a mano (sale 0 con off, 1 con on):
#   M11 aviso viejo + rótulo con SOLO bloqueos ⇒ rc 1 «NO MIRA el aviso».
#   M12 aviso nuevo + rc 1 sin rótulo ⇒ rc 1 · M13 rótulo problems=2 con una sola línea ⇒ rc 1.
# El aviso nuevo y válido lo trae el árbol desde 2f1d189d (aviso 0.6): C0 y M8 lo miden con la puerta real.
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
bloqueo_canario() { # añade un bloqueo de encendido a la COPIA de measurement-gate.ts
  sed -i "/^export const ENCENDER_BLOCKERS: readonly EncenderBlocker\[\] = \[/a\\  { id: 'CANARIO-1', what: 'bloqueo de canario', owner: 'devops', closedBy: 'canario' }," "$1/$L/measurement-gate.ts"
  grep -q "id: 'CANARIO-1'" "$1/$L/measurement-gate.ts" || { bad "no pude inyectar el bloqueo de canario en measurement-gate.ts (¿cambió la declaración?)"; return 1; }
}
puerta_canario() { # <dir> <rótulo con \n> — check:measurement que sale 0 con off y, con on, imprime el rótulo y sale 1
  printf '%b' "$2" >"$1/canario-rotulo.txt"
  script_set "$1" check:measurement '[ "$NEXT_PUBLIC_MEASUREMENT_MODE" = on ] || exit 0; cat canario-rotulo.txt; exit 1'
}
R1='MEASUREMENT_NOTICE_REQUIRED mode=on problems=1\n  - bloqueo de encendido abierto: CANARIO-1 (devops) — x\n'
R2='MEASUREMENT_NOTICE_REQUIRED mode=on problems=2\n  - bloqueo de encendido abierto: CANARIO-1 (devops) — x\n'
d="$(copia)"; bloqueo_canario "$d" && caso 0 "M8 · aviso nuevo + solo bloqueos de encendido (puerta real)" "$d" "solo la frenan los bloqueos"
d="$(copia)"; if bloqueo_canario "$d"; then sed -i 's/14 meses/catorce meses/g' "$d/$L/privacidad.es.ts"
  caso 1 "M9 · aviso nuevo + bloqueo + un problema del aviso (puerta real)" "$d" "problema(s) del aviso"; fi
d="$(copia)"; disc "$d" 'null;'; caso 0 "M10 · aviso viejo (MEASUREMENT_DISCLOSURE = null, puerta real)" "$d" "muerde con el aviso viejo"
d="$(copia)"; disc "$d" 'null;'; puerta_canario "$d" "$R1"; caso 1 "M11 · aviso viejo + rótulo con solo bloqueos" "$d" "NO MIRA el aviso"
d="$(copia)"; puerta_canario "$d" 'algo falló\n';            caso 1 "M12 · aviso nuevo + rc 1 sin rótulo" "$d" "sin un rótulo"
d="$(copia)"; puerta_canario "$d" "$R2";                      caso 1 "M13 · rótulo problems=2 con una sola línea" "$d" "sin un rótulo"
printf '\n'
if [ "$FALLOS" -gt 0 ]; then printf '\033[1;31mROJO: %s/%s casos del canario de C-D1 fallaron.\033[0m\n' "$FALLOS" "$((FALLOS+PASADAS))"; exit 1; fi
printf '\033[1;32mVERDE: %s/%s casos: C-D1 muerde.\033[0m\n' "$PASADAS" "$PASADAS"

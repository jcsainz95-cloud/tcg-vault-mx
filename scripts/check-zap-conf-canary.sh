#!/usr/bin/env bash
#
# check-zap-conf-canary.sh — el canario de check-zap-conf.sh  · devops · §96.7
# =============================================================================
# Corre el candado REAL sobre copias del árbol (security/, .github/workflows,
# docker-compose*.yml) con UNA mutación cada una, y exige rojo. La copia sin
# mutar tiene que salir verde. Cada mutación es una forma concreta de volver al
# defecto de §96.7 (ZAP recibe claves `<n>-<n>` y revienta sin informe, y nadie
# lo dice) o de soltar la imagen fijada.
#
# Uso:  ./scripts/check-zap-conf-canary.sh
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHK="$ROOT_DIR/scripts/check-zap-conf.sh"
FALLOS=0; PASADAS=0; TOTAL=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
mal() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }
TMP="$(mktemp -d -t zap-conf-canario-XXXXXX)"; trap 'rm -rf "$TMP"' EXIT

arbol() { # <dir>  copia mínima de lo que lee el candado
  mkdir -p "$1/.github"
  cp -r "$ROOT_DIR/security" "$1/security"
  rm -rf "$1/security/reports"
  cp -r "$ROOT_DIR/.github/workflows" "$1/.github/workflows"
  cp "$ROOT_DIR"/docker-compose*.yml "$1/" 2>/dev/null || true
}
muta() { # <fichero> <python: s = s.replace(...)>  (falla si el anclaje no está)
  python3 - "$1" "$2" <<'PY'
import sys
p, code = sys.argv[1], sys.argv[2]
s = open(p, encoding="utf-8").read(); antes = s
exec(code)
assert s != antes, "la mutación no cambió nada (anclaje perdido): " + p
open(p, "w", encoding="utf-8").write(s)
PY
}
caso() { # <nombre> <esperado 0|1> <fichero relativo> <mutación python | ->
  TOTAL=$((TOTAL+1))
  local d="$TMP/c$TOTAL"; arbol "$d"
  if [ "$4" != "-" ]; then muta "$d/$3" "$4" || { mal "$1: no pude aplicar la mutación"; return; }; fi
  local out rc; out="$(GITHUB_ACTIONS='' bash "$CHK" "$d" 2>&1)"; rc=$?
  if { [ "$2" = 0 ] && [ "$rc" -eq 0 ]; } || { [ "$2" = 1 ] && [ "$rc" -ne 0 ]; }; then
    ok "$1 ⇒ rc $rc"
  else
    mal "$1 ⇒ rc $rc (esperaba $([ "$2" = 0 ] && echo 0 || echo '≠0'))"; grep '✗' <<<"$out" | head -3 | sed 's/^/      /'
  fi
  rm -rf "$d"
}

printf '\n\033[1m== Canario de §96.7 · ¿el candado de la política de ZAP muerde? ==\033[0m\n\n'

caso "árbol sin mutar (verde)" 0 - -

# M1 — el defecto original: ZAP recibe la política ORIGINAL (con 10055-3…).
caso "M1 dast-ephemeral vuelve a montar y pasar el original" 1 security/scripts/dast-ephemeral.sh \
  's = s.replace("-v \"${zap_conf_dir}:${ZAP_CONF_MOUNT}:ro\"", "-v \"${SEC_DIR}/zap:/zap/wrk/conf:ro\"").replace("-c \"${ZAP_CONF_MOUNT}/baseline.conf\"", "-c /zap/wrk/conf/baseline.conf")'

# M2 — el filtro deja de filtrar (las sub-claves llegan a ZAP).
caso "M2 el filtro deja pasar las claves <n>-<n>" 1 security/scripts/dast-zap-policy.py \
  's = s.replace("if val == \"OUTOFSCOPE\" or _es_entero(key):", "if True:")'

# M3 — el emulador deja de imitar el int(id) de ZAP (instrumento inerte).
caso "M3 el emulador ya no hace int(id)" 1 security/scripts/dast-zap-policy.py \
  's = s.replace("            int(key)\n", "            pass\n")'

# M4 — la imagen vuelve a la etiqueta móvil.
caso "M4 ZAP_IMAGE_FIJADA vuelve a :stable" 1 security/scripts/dast-zap-lib.sh \
  's = s.replace(s[s.index("ZAP_IMAGE_FIJADA=\""):s.index("\n", s.index("ZAP_IMAGE_FIJADA=\""))], "ZAP_IMAGE_FIJADA=\"ghcr.io/zaproxy/zaproxy:stable\"")'

# M5 — un script se salta la librería y fija su propia imagen por etiqueta.
caso "M5 dast-zap-full.sh vuelve a ghcr.io/zaproxy/zaproxy:stable" 1 security/scripts/dast-zap-full.sh \
  's = s.replace("\"${ZAP_IMAGE}\" \\", "ghcr.io/zaproxy/zaproxy:stable \\")'

# M6 — «rc 1 sin informe» vuelve a leerse como «ZAP encontró cosas».
caso "M6 dast-ephemeral pierde la rama «ZAP reventó»" 1 security/scripts/dast-ephemeral.sh \
  's = s.replace("elif [ \"${rc}\" -ne 0 ] && [ ! -s \"${REPORT_DIR}/zap-${name}.json\" ]; then", "elif false; then")'

# M7 — la autoprueba vuelve a celebrar un rojo sin informe.
caso "M7 dast-gate --expect-red vuelve a ok = red" 1 security/scripts/dast-gate.py \
  's = s.replace("ok = bool(blocking) and not missing_input", "ok = red")'

# M8 — la autoprueba vuelve a pasar el original a ZAP.
caso "M8 dast-selftest vuelve a pasar el original" 1 security/scripts/dast-selftest.sh \
  's = s.replace("-c \"${ZAP_CONF_MOUNT}/baseline.conf\"", "-c /zap/wrk/conf/baseline.conf")'

echo
MUT=$((TOTAL-1)); CAZ=$((PASADAS-1))
[ "$FALLOS" -eq 0 ] && { printf '\033[1;32m✓ §96.7 canario: %s/%s casos; mutaciones cazadas %s/%s.\033[0m\n' "$PASADAS" "$TOTAL" "$CAZ" "$MUT"; exit 0; }
printf '\033[1;31m✗ §96.7 canario: %s fallo(s) de %s casos.\033[0m\n' "$FALLOS" "$TOTAL"; exit 1

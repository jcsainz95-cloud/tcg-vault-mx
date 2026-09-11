#!/usr/bin/env bash
#
# check-candidate-checks-canary.sh — «¿el instrumento de C5 distingue "no pude
# leer" de "no hay nada"?»                                              · devops
# =============================================================================
# DE DÓNDE VIENE (2026-09-11)
# ---------------------------------------------------------------------------
# `check-candidate-checks.sh` pasaba la respuesta de la API (~200 KB con 47
# check-runs) por `argv` a `node -e`. `execve` la rechazaba («Argument list too
# long»), el `$(…)` quedaba vacío y el script imprimía «el commit no tiene NINGÚN
# check-run» — sobre un commit con 47, 45 en verde. Un instrumento que confunde
# un fallo propio con un hecho del mundo miente con cara de medir.
#
# Este canario NO toca la red: pone un `curl` y un `node` de mentira por delante
# en el PATH y ejercita el script REAL (copiado a un repo git temporal) con
# respuestas controladas, incluidas las que rompen el parser. Exige:
#   · verde con todo en success, y también con una respuesta GRANDE (>300 KB) y
#     PAGINADA (más de 100 check-runs);
#   · rc=2 + «NINGÚN check-run» SOLO cuando la API dice total_count=0;
#   · rc=2 + mensaje de PARSEO (nunca «NINGÚN») cuando la respuesta no es JSON;
#   · rc=2 + mensaje de parser (nunca «NINGÚN») cuando `node` no puede ejecutar
#     (la mutación literal del fallo original);
#   · rc=1 con un check-run en rojo; rc=2 con uno sin terminar;
#   · rc=3 con un `skipped` SIN motivo escrito (F1-2: skipped no es verde) y
#     rc=0 con un `skipped` de la lista cerrada SKIPPED_ESPERADOS, diciendo
#     «esperado» y su motivo.
#
# Uso:  ./scripts/check-candidate-checks-canary.sh
# Sale 0 si los casos salen como deben; 1 con el caso exacto. Sin red.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/check-candidate-checks.sh"
[ -f "$SCRIPT" ] || { echo "✗ falta scripts/check-candidate-checks.sh"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "✗ sin node no puedo ejercitar el script (lo usa el script real)"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "✗ sin python3 no puedo fabricar las respuestas"; exit 1; }

FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }

printf '\n\033[1m== ¿check-candidate-checks.sh distingue «no pude leer» de «no hay nada»? ==\033[0m\n\n'

BASE="$(mktemp -d -t c5-canario-XXXXXX)"; trap 'rm -rf "$BASE"' EXIT
REPO="$BASE/repo"; STUB="$BASE/stub"; RESP="$BASE/resp"
mkdir -p "$REPO/scripts" "$STUB" "$RESP"

# Repo git mínimo: el script resuelve el SHA y lee `remote.origin.url` de ahí.
git -C "$REPO" init -q
git -C "$REPO" -c user.email=c@c -c user.name=c commit -q --allow-empty -m "x"
git -C "$REPO" remote add origin https://github.com/ejemplo/repo.git
cp "$SCRIPT" "$REPO/scripts/check-candidate-checks.sh"; chmod +x "$REPO/scripts/check-candidate-checks.sh"
# N4: el script valida SKIPPED_ESPERADOS contra deploy.yml; el repo de juguete lleva el real.
mkdir -p "$REPO/.github/workflows"; cp "$ROOT_DIR/.github/workflows/deploy.yml" "$REPO/.github/workflows/deploy.yml"

# `curl` de mentira: sirve el fichero de $RESP que toque según la URL.
#   …/check-runs?…page=N  -> $RESP/pageN   (si no existe, $RESP/page1)
#   …/annotations         -> []
cat > "$STUB/curl" <<'EOF'
#!/usr/bin/env bash
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift ;;
    -H) shift ;;
    -sS|-s) ;;
    http*) url="$1" ;;
  esac
  shift
done
body='[]'
case "$url" in
  *check-runs*)
    page="$(sed -n 's/.*page=\([0-9]*\).*/\1/p' <<<"$url")"; page="${page:-1}"
    f="$CANARY_RESP/page$page"; [ -f "$f" ] || f="$CANARY_RESP/page1"
    if [ -n "$out" ]; then cp "$f" "$out"; else cat "$f"; fi; exit 0 ;;
esac
if [ -n "$out" ]; then printf '%s' "$body" > "$out"; else printf '%s' "$body"; fi
EOF
chmod +x "$STUB/curl"

# Fábrica de respuestas: `fabricar <fichero> <n_total> <n_en_esta_pagina> <estado> <conclusion> [padding_bytes]`
fabricar() {
  python3 - "$@" <<'PY'
import json, sys
f, total, n, status, concl = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5]
pad = int(sys.argv[6]) if len(sys.argv) > 6 else 0
runs = []
for i in range(n):
    runs.append({"id": 1000+i, "name": f"job-{i}", "status": status,
                 "conclusion": (None if status != "completed" else concl),
                 "html_url": "https://github.com/ejemplo/repo/runs/" + str(1000+i),
                 "output": {"text": "x" * pad}})
json.dump({"total_count": total, "check_runs": runs}, open(f, "w"))
PY
}

# `caso <rc_esperado> <debe_contener|-> <no_debe_contener|-> <nombre> [PATH_extra]`
caso() {
  local rc_esp="$1" debe="$2" nodebe="$3" nombre="$4" extra="${5:-}"
  local out rc
  out="$(cd "$REPO" && CANARY_RESP="$RESP" PATH="${extra:+$extra:}$STUB:$PATH" GITHUB_TOKEN=canario \
         bash scripts/check-candidate-checks.sh HEAD 2>&1)"; rc=$?
  if [ "$rc" -ne "$rc_esp" ]; then
    bad "$nombre — rc=$rc, esperaba $rc_esp."; printf '      %s\n' "$(tail -2 <<<"$out" | tr -d '\033')"; return
  fi
  if [ "$debe" != "-" ] && ! grep -qF -- "$debe" <<<"$out"; then
    bad "$nombre — rc correcto pero NO dice «$debe»."; printf '      %s\n' "$(tail -2 <<<"$out" | tr -d '\033')"; return
  fi
  if [ "$nodebe" != "-" ] && grep -qF -- "$nodebe" <<<"$out"; then
    bad "$nombre — dice «$nodebe», y eso es la mentira original."; return
  fi
  ok "$nombre — rc=$rc$( [ "$debe" != "-" ] && printf ', dice «%s»' "$debe" )."
}

limpiar() { rm -f "$RESP"/page*; }

# 1) todo en verde, tamaño normal
limpiar; fabricar "$RESP/page1" 49 49 completed success
caso 0 "49 check-runs" "NINGÚN" "49 check-runs, todos success"

# 2) respuesta GRANDE (>300 KB): el caso que rompía el argv
limpiar; fabricar "$RESP/page1" 47 47 completed success 7000
BYTES="$(wc -c < "$RESP/page1")"
caso 0 "47 check-runs" "NINGÚN" "respuesta de $((BYTES/1024)) KB (la que rompía \`execve\`)"

# 3) paginada: 150 check-runs en dos páginas
limpiar; fabricar "$RESP/page1" 150 100 completed success; fabricar "$RESP/page2" 150 50 completed success
caso 0 "150 check-runs" "NINGÚN" "150 check-runs en dos páginas"

# 4) de verdad sin check-runs: total_count=0
limpiar; fabricar "$RESP/page1" 0 0 completed success
caso 2 "NINGÚN check-run" "-" "total_count=0 (la única rama legítima de «sin check-runs»)"

# 5) la API devuelve algo que no es JSON (p. ej. una página HTML de rate-limit)
limpiar; printf '<html><body>API rate limit exceeded</body></html>' > "$RESP/page1"
caso 2 "NO parseable" "NINGÚN" "respuesta no-JSON ⇒ error de parseo, nunca «sin check-runs»"

# 6) JSON con otra forma (sin check_runs)
limpiar; printf '{"message":"Bad credentials"}' > "$RESP/page1"
caso 2 "respuesta inesperada" "NINGÚN" "JSON sin \`check_runs\` ⇒ «inesperada», nunca «sin check-runs»"

# 7) MUTACIÓN LITERAL DEL FALLO ORIGINAL: `node` no puede ejecutar el parser
NODESTUB="$BASE/nodestub"; mkdir -p "$NODESTUB"
printf '%s\n' '#!/usr/bin/env bash' 'echo "node: Argument list too long" >&2; exit 2' > "$NODESTUB/node"; chmod +x "$NODESTUB/node"
limpiar; fabricar "$RESP/page1" 49 49 completed success
caso 2 "no pude ejecutar el parser" "NINGÚN" "el parser revienta (rc=2) ⇒ «no pude ejecutar», nunca «sin check-runs»" "$NODESTUB"

# 8) uno en rojo
limpiar; fabricar "$RESP/page1" 3 3 completed failure
caso 1 "NO está verde" "-" "check-runs en failure ⇒ rc=1"

# 9) uno sin terminar
limpiar; fabricar "$RESP/page1" 3 3 in_progress "-"
caso 2 "sin terminar" "-" "check-runs in_progress ⇒ rc=2"

# renombrar <fichero> <indice> <nombre> : cambia el nombre de un check-run fabricado
renombrar() { python3 -c '
import json, sys
f, i, n = sys.argv[1], int(sys.argv[2]), sys.argv[3]
a = json.load(open(f)); a["check_runs"][i]["name"] = n; json.dump(a, open(f, "w"))' "$1" "$2" "$3"; }

# 10) F1-2: un `skipped` sin motivo escrito NO suma al verde ⇒ rc=3 y lo dice
limpiar; fabricar "$RESP/page1" 3 3 completed skipped
caso 3 "SIN motivo escrito" "están en verde" "check-runs skipped fuera de la lista ⇒ rc=3, «no medido, no verde»"

# 11) F1-2: un `skipped` de la lista cerrada pasa, con su motivo impreso
limpiar; fabricar "$RESP/page1" 3 3 completed skipped
renombrar "$RESP/page1" 0 promote-production-backend; renombrar "$RESP/page1" 1 promote-production-frontend; renombrar "$RESP/page1" 2 deploy-ci-gate
caso 0 "esperado:" "SIN motivo" "skipped de SKIPPED_ESPERADOS (promote-*, deploy-ci-gate) ⇒ rc=0 con motivo"

# 12) F1-2: mezcla — un skipped esperado Y uno sin motivo ⇒ rc=3 (el sin motivo manda)
limpiar; fabricar "$RESP/page1" 2 2 completed skipped
renombrar "$RESP/page1" 0 promote-production-frontend
caso 3 "SIN motivo escrito" "-" "un skipped esperado + uno sin motivo ⇒ rc=3"

# 13) N4: una clave de SKIPPED_ESPERADOS que no es job de deploy.yml ⇒ rc=2 «lista desfasada»
limpiar; fabricar "$RESP/page1" 3 3 completed success
cp "$REPO/scripts/check-candidate-checks.sh" "$BASE/orig.sh"
sed -i 's/^  \[deploy-ci-gate\]=/  [job-que-ya-no-existe]="x"\n  [deploy-ci-gate]=/' "$REPO/scripts/check-candidate-checks.sh"
grep -q 'job-que-ya-no-existe' "$REPO/scripts/check-candidate-checks.sh" || bad "la mutación N4 no se aplicó"
caso 2 "lista desfasada" "están en verde" "clave de SKIPPED_ESPERADOS sin job en deploy.yml ⇒ rc=2, nunca verde"
cp "$BASE/orig.sh" "$REPO/scripts/check-candidate-checks.sh"

# 14) N4: sin deploy.yml ⇒ rc=2
mv "$REPO/.github/workflows/deploy.yml" "$BASE/deploy.bak"
caso 2 "no puedo validar" "están en verde" "sin deploy.yml ⇒ rc=2"
mv "$BASE/deploy.bak" "$REPO/.github/workflows/deploy.yml"

TOTAL=$((PASADAS+FALLOS))
printf '\n'
if [ "$FALLOS" -gt 0 ]; then
  printf '\033[1;31m✗ Canario C5: %s/%s. El instrumento puede volver a confundir un fallo propio con «no hay nada».\033[0m\n\n' "$PASADAS" "$TOTAL"
  exit 1
fi
printf '\033[1;32m✓ Canario C5: %s/%s — «no pude leer» y «no hay nada» son ramas distintas, con rc y mensaje propios.\033[0m\n\n' "$PASADAS" "$TOTAL"
exit 0

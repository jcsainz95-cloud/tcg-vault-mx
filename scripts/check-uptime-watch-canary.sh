#!/usr/bin/env bash
#
# check-uptime-watch-canary.sh — «¿el vigía de LIVE-9 sabe ponerse rojo?» · devops
# =============================================================================
# Un vigía que no puede fallar es peor que ninguno (P-77). Este canario levanta
# una tienda + backend de MENTIRA en 127.0.0.1 (python, sin red externa) y
# ejercita `scripts/uptime-watch.sh` REAL contra cada forma de caída que debe
# avisar, y contra las que NO deben avisar (redirección de idioma, un parpadeo
# que el reintento absorbe). Después MUTA el vigía (quitar la comparación de
# `stripeMode`; quitar el seguimiento de redirecciones) y exige que el caso que
# cada mutación rompe salga distinto: si no, el canario no muerde.
#
# Corre en `uptime-watch.yml` (job `autoprueba`, antes de cada vigilancia) y en
# cada PR/push que toque el vigía.
#
# Uso:  ./scripts/check-uptime-watch-canary.sh
# rc 0 todos los casos como deben · 1 alguno no · 2 no pudo medir.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WATCH="$ROOT_DIR/scripts/uptime-watch.sh"
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
mal() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }
for b in python3 curl node; do command -v "$b" >/dev/null 2>&1 || { echo "::error::sin $b. NO concluyente."; exit 2; }; done
[ -f "$WATCH" ] || { echo "::error::falta $WATCH"; exit 1; }

TMP="$(mktemp -d -t uptime-canario-XXXXXX)"; SRV=""
trap '[ -n "$SRV" ] && kill "$SRV" 2>/dev/null; rm -rf "$TMP"' EXIT

# Escenario = JSON en $TMP/esc.json, releído en cada petición:
#   {"/": [status, body, location?], "/es": …, "/api/v1/health": …, "flaky": {"/": n}}
cat > "$TMP/fake.py" <<'PY'
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
ESC = sys.argv[2]; hits = {}
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        e = json.load(open(ESC)); p = self.path.split('?')[0]
        hits[p] = hits.get(p, 0) + 1
        if hits[p] <= e.get('flaky', {}).get(p, 0):
            return self.out(502, 'bad gateway', None)
        st, body, loc = (e.get(p) or [404, 'nope', None]) + [None] * (3 - len(e.get(p) or [404, 'nope', None]))
        self.out(st, body, loc)
    def out(self, st, body, loc):
        b = body.encode() if isinstance(body, str) else json.dumps(body).encode()
        self.send_response(st)
        if loc: self.send_header('location', loc)
        self.send_header('content-length', str(len(b))); self.end_headers(); self.wfile.write(b)
HTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
PY

arrancar() {
  [ -n "$SRV" ] && { kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null; SRV=""; }
  PORT=$(( 9600 + RANDOM % 150 ))
  python3 "$TMP/fake.py" "$PORT" "$TMP/esc.json" >/dev/null 2>&1 & SRV=$!
  for _ in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$PORT/__vivo" 2>/dev/null && return 0; sleep 0.1; done
  return 1
}
SANO='{"status":"ok","uptime":1,"timestamp":"t","db":"up","redis":"up","stripeMode":"test"}'
escenario() { printf '%s' "$1" > "$TMP/esc.json"; arrancar || { echo "::error::el servidor de mentira no arrancó. NO concluyente."; exit 2; }; }
vigia() { # <script> [args extra…] → rc; salida en $TMP/out
  local s="$1"; shift
  bash "$s" --allow-local --site "http://127.0.0.1:$PORT/" --health "http://127.0.0.1:$PORT/api/v1/health" \
    --attempts 2 --pause 0 --timeout 5 "$@" >"$TMP/out" 2>&1
}
caso() { # <rc esperado> <texto esperado> <nombre> <script> [args…]
  local rce="$1" txt="$2" nom="$3"; shift 3
  vigia "$@"; local rc=$?
  if [ "$rc" -eq "$rce" ] && grep -q -- "$txt" "$TMP/out"; then ok "$nom ⇒ rc $rc"; else mal "$nom ⇒ rc $rc (esperaba $rce y «$txt»)"; sed 's/^/      /' "$TMP/out" | tail -5; fi
}

printf '\n\033[1m== LIVE-9 · ¿el vigía de disponibilidad sabe ponerse rojo? ==\033[0m\n\n'

escenario '{"/":[200,"<html>tienda</html>"],"/api/v1/health":[200,'"$SANO"']}'
caso 0 "VERDICT=OK" "todo sano, stripeMode test = esperado test" "$WATCH" --expected-stripe-mode test
caso 0 "NO comparado" "sin EXPECTED_STRIPE_MODE ⇒ OK pero lo DICE («NO comparado»)" "$WATCH"
caso 1 "stripeMode" "salud dice test y se espera live ⇒ ROJO" "$WATCH" --expected-stripe-mode live

escenario '{"/":[307,"",'"\"/es\""'],"/es":[200,"<html>es</html>"],"/api/v1/health":[200,'"$SANO"']}'
caso 0 "VERDICT=OK" "home redirige a /es (idioma) ⇒ OK" "$WATCH" --expected-stripe-mode test

escenario '{"/":[500,"boom"],"/api/v1/health":[200,'"$SANO"']}'
caso 1 "ROJO_home" "home 500 ⇒ ROJO" "$WATCH" --expected-stripe-mode test

escenario '{"/":[200,"x"],"/api/v1/health":[503,{"status":"degraded","db":"down","redis":"up","stripeMode":"test"}]}'
caso 1 "ROJO_salud" "salud 503 degraded ⇒ ROJO" "$WATCH" --expected-stripe-mode test

escenario '{"/":[200,"x"],"/api/v1/health":[200,{"status":"ok","db":"up","redis":"up"}]}'
caso 1 "(ausente)" "salud SIN stripeMode y se espera test ⇒ ROJO (no se puede afirmar el modo)" "$WATCH" --expected-stripe-mode test

escenario '{"/":[200,"x"],"/api/v1/health":[200,"<html>no soy json</html>"]}'
caso 1 "no es JSON" "salud 200 que no es JSON ⇒ ROJO" "$WATCH"

escenario '{"/":[200,"x"],"/api/v1/health":[200,'"$SANO"'],"flaky":{"/":1}}'
caso 0 "intento 2/2" "un parpadeo (502 una vez) lo absorbe el reintento ⇒ OK" "$WATCH" --expected-stripe-mode test

# sin nadie escuchando
kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null; SRV=""
caso 1 "HTTP 000" "servidor caído (conexión rechazada) ⇒ ROJO" "$WATCH"

bash "$WATCH" --site http://ejemplo.invalid/ --health https://x.invalid/ >"$TMP/out" 2>&1
[ $? -eq 2 ] && grep -q "no es https" "$TMP/out" && ok "URL http no local ⇒ rc 2 (no concluyente)" || mal "URL http no local no dio rc 2"

# --- mutaciones -------------------------------------------------------------
python3 - "$WATCH" "$TMP/m1.sh" "$TMP/m2.sh" <<'PY'
import sys
s = open(sys.argv[1]).read()
a = 'if [ "$SM" = "$EXPECTED" ]; then'
assert a in s, 'anclaje stripeMode'
open(sys.argv[2], 'w').write(s.replace(a, 'if true; then'))
b = 'curl -sS -L --max-redirs 5 -o "$TMPD/home"'
assert b in s, 'anclaje -L'
open(sys.argv[3], 'w').write(s.replace(b, 'curl -sS -o "$TMPD/home"'))
PY
[ $? -eq 0 ] || { echo "::error::no pude aplicar las mutaciones (anclaje desfasado). NO concluyente."; exit 2; }
escenario '{"/":[200,"x"],"/api/v1/health":[200,'"$SANO"']}'
vigia "$TMP/m1.sh" --expected-stripe-mode live; rc=$?
[ "$rc" -eq 0 ] && ok "mutación m-sin-stripeMode ⇒ el caso «test≠live» pasa a VERDE (rc 0): el canario la caza" || mal "mutación m-sin-stripeMode no cambió el veredicto (rc $rc)"
escenario '{"/":[307,"",'"\"/es\""'],"/es":[200,"x"],"/api/v1/health":[200,'"$SANO"']}'
vigia "$TMP/m2.sh"; rc=$?
[ "$rc" -eq 1 ] && ok "mutación m-sin-redirecciones ⇒ el caso «/ → /es» pasa a ROJO (rc 1): el canario la caza" || mal "mutación m-sin-redirecciones no cambió el veredicto (rc $rc)"

# --- issue propio (TD-LIVE-8) ------------------------------------------------
# El vigía busca SU issue con el filtro `ISSUE_JQ` del workflow (se extrae del yml, no
# se copia) y el mismo `jq` del paso. Un issue con el mismo título abierto por un
# desconocido —con o sin etiqueta— NO puede contar como «ya abierto»: si contara, la
# alerta de caída quedaría suprimida por cualquiera.
WF="$ROOT_DIR/.github/workflows/uptime-watch.yml"
if ! command -v jq >/dev/null 2>&1; then
  mal "sin jq no puedo probar el filtro del issue (el workflow lo usa)"
else
  python3 - "$WF" "$TMP/jq" "$TMP/title" <<'PY'
import sys, yaml
env = yaml.safe_load(open(sys.argv[1]))['jobs']['vigilancia']['env']
open(sys.argv[2], 'w').write(env.get('ISSUE_JQ', ''))
open(sys.argv[3], 'w').write(env.get('TITLE', ''))
PY
  JQF="$(cat "$TMP/jq" 2>/dev/null)"; T="$(cat "$TMP/title" 2>/dev/null)"
  if [ -z "$JQF" ] || [ -z "$T" ]; then mal "uptime-watch.yml sin ISSUE_JQ/TITLE en jobs.vigilancia.env"
  else
    [ "$(grep -c 'jq -r --arg T "${TITLE}" "${ISSUE_JQ}"' "$WF")" = 2 ] \
      && ok "abrir y cerrar usan los dos el filtro ISSUE_JQ" || mal "abrir/cerrar no usan ISSUE_JQ (las 2 búsquedas deben)"
    issue() { # <número> <login> <is_bot> <etiqueta|-> — título = el del vigía
      jq -n --argjson n "$1" --arg l "$2" --argjson b "$3" --arg lab "$4" --arg t "$T" \
        '{number:$n,title:$t,author:{login:$l,is_bot:$b},labels:(if $lab=="-" then [] else [{name:$lab}] end)}'
    }
    filtro() { jq -s "." | jq -r --arg T "$T" "$1"; }
    probar() { # <filtro> <esperado> <nombre> <issues…>
      local f="$1" esp="$2" nom="$3"; shift 3
      local got; got="$(printf '%s\n' "$@" | filtro "$f")"
      [ "$got" = "$esp" ] && ok "$nom ⇒ «${got:-ninguno}»" || mal "$nom ⇒ «${got:-ninguno}» (esperado «${esp:-ninguno}»)"
    }
    INTRUSO="$(issue 7 mallory false -)"; INTRUSO_L="$(issue 8 mallory false caida)"
    FALSO_BOT="$(issue 9 mallory true caida)"; BOT="$(issue 12 app/github-actions true caida)"
    BOT_SIN="$(issue 10 app/github-actions true -)"
    probar "$JQF" ""   "issue de un desconocido con el mismo título (sin etiqueta) no cuenta" "$INTRUSO"
    probar "$JQF" ""   "…ni con la etiqueta caida" "$INTRUSO_L"
    probar "$JQF" ""   "…ni de otro bot" "$FALSO_BOT"
    probar "$JQF" ""   "issue del bot SIN etiqueta caida no cuenta" "$BOT_SIN"
    probar "$JQF" "12" "issue del bot con caida, entre intrusos ⇒ el del bot" "$INTRUSO" "$INTRUSO_L" "$FALSO_BOT" "$BOT"
    # Mutación: el filtro viejo (solo título) ⇒ el intruso suprime la alerta.
    probar 'map(select(.title == $T)) | .[0].number // empty' "7" \
      "mutación m-solo-título ⇒ el intruso SÍ cuenta (el canario distingue el filtro viejo)" "$INTRUSO" "$BOT"
    MUT="$(printf '%s' "$JQF" | sed 's/ and \.author\.is_bot == true and (.author.login == "app\/github-actions" or .author.login == "github-actions\[bot\]")//')"
    if [ "$MUT" = "$JQF" ]; then mal "mutación m-sin-autor no aplicó (anclaje desfasado)"
    else
      got="$(printf '%s\n' "$INTRUSO_L" "$BOT" | filtro "$MUT")"
      [ "$got" = "8" ] && ok "mutación m-sin-autor ⇒ el intruso etiquetado SÍ cuenta: el autor es lo que muerde" \
                       || mal "mutación m-sin-autor no cambió el resultado («$got»)"
    fi
  fi
fi

echo
if [ "$FALLOS" -eq 0 ]; then printf '\033[1;32m✓ LIVE-9 vigía: %s/%s.\033[0m\n' "$PASADAS" "$PASADAS"; exit 0; fi
printf '\033[1;31m✗ LIVE-9 vigía: %s fallo(s) de %s.\033[0m\n' "$FALLOS" "$((PASADAS+FALLOS))"; exit 1

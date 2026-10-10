#!/usr/bin/env bash
#
# check-edge-xff-probe-canary.sh — «¿edge-xff-probe.sh distingue el tope por IP
#                                    del candado por cuenta?»   · devops · LIVE-11
# =============================================================================
# DE DÓNDE VIENE (2026-10-05, DEVOPS_NOTES §85.4)
# ---------------------------------------------------------------------------
# La sonda de C6 mandaba 6 logins con el MISMO correo. Desde C7 (v1.80) el 6.º
# intento contra una misma cuenta es `429 TOO_MANY_PASSWORD_ATTEMPTS`
# (PASSWORD_FREE_ATTEMPTS = 5) venga de la IP que venga ⇒ la sonda leía «429 en
# el 6.º» y concluía «bypass ausente, C6 cierra» AUNQUE el borde dejara elegir
# la IP. Un falso cierre de una condición de seguridad antes de `sk_live_`.
#
# QUÉ EJERCE (sin producción, sin red externa): un backend de MENTIRA en
# 127.0.0.1 que imita las dos piezas reales —throttler 5/min por «IP» y candado
# de cuenta al 6.º intento— con tres bordes:
#   · `edge`   : la IP es la del socket (el borde la fija) ⇒ rc 0 «CIERRA» con 6
#                peticiones (el presupuesto autorizado por el dueño, HECHOS 2026-10-05)
#   · `bypass` : la IP es la última entrada de X-Forwarded-For ⇒ sin control rc 2
#                (pide autorización), con `--with-control` rc 1 «FALLA»
#   · `off`    : no hay tope por IP ⇒ rc 2 (el control no dispara)
# y dos MUTACIONES de la sonda, cada una debe poner ROJO el caso `bypass`:
#   · m-correo-unico : volver a un solo correo para todas las peticiones;
#   · m-429-cualquiera + correo único: la forma exacta de antes (cualquier 429 vale).
#
# Uso:  ./scripts/check-edge-xff-probe-canary.sh [N]   (N tiradas por caso, def. 3)
# rc 0 todo como debe · 1 algún caso falló · 2 no pudo medir.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
N="${1:-3}"
PROBE="$ROOT_DIR/scripts/edge-xff-probe.sh"
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
mal() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }
command -v python3 >/dev/null 2>&1 || { echo "::error::sin python3 no hay backend de mentira. NO concluyente."; exit 2; }
command -v curl >/dev/null 2>&1 || { echo "::error::sin curl. NO concluyente."; exit 2; }

TMP="$(mktemp -d -t c6-canario-XXXXXX)"; SRV=""
trap '[ -n "$SRV" ] && kill "$SRV" 2>/dev/null; rm -rf "$TMP"' EXIT

cat > "$TMP/fake.py" <<'PY'
import json, sys, time
from http.server import BaseHTTPRequestHandler, HTTPServer
MODE = sys.argv[2]
ip_hits, acct = {}, {}
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        n = int(self.headers.get('content-length', 0)); body = json.loads(self.rfile.read(n) or b'{}')
        xff = self.headers.get('x-forwarded-for')
        if MODE == 'bypass' and xff: tracker = xff.split(',')[-1].strip()
        else: tracker = self.client_address[0]
        now = time.time()
        if MODE != 'off':
            hits = [t for t in ip_hits.get(tracker, []) if now - t < 60] + [now]
            ip_hits[tracker] = hits
            if len(hits) > 5: return self.out(429, 'RATE_LIMITED')
        email = body.get('email', '')
        f = acct.get(email, 0)
        if f >= 5: return self.out(429, 'TOO_MANY_PASSWORD_ATTEMPTS')
        acct[email] = f + 1
        return self.out(401, 'INVALID_CREDENTIALS')
    def out(self, st, code):
        b = json.dumps({'error': {'code': code}}).encode()
        self.send_response(st); self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(b))); self.end_headers(); self.wfile.write(b)
HTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
PY

arrancar() { # <modo>
  [ -n "$SRV" ] && { kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null; SRV=""; }
  PORT=$(( 9800 + RANDOM % 150 ))
  python3 "$TMP/fake.py" "$PORT" "$1" >/dev/null 2>&1 & SRV=$!
  for _ in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null && return 0; sleep 0.1; done
  kill -0 "$SRV" 2>/dev/null
}
sonda() { # <script> [args…] → rc
  local sc="$1"; shift
  TARGET_BASE_URL="http://127.0.0.1:$PORT" bash "$sc" --canary-local --round-pause 0 "$@" >"$TMP/out" 2>&1
}

printf '\n\033[1m== LIVE-11 · ¿la sonda de C6 distingue el tope por IP del candado de cuenta? ==\033[0m\n\n'

caso() { # <script> <modo> <rc esperado> <texto esperado> <nombre> [args de la sonda…]
  local hit=0 rc sc="$1" modo="$2" rce="$3" txt="$4" nom="$5"; shift 5
  set -- "$sc" "$modo" "$rce" "$txt" "$nom" "$@"
  local extra=("${@:6}")
  for _ in $(seq 1 "$N"); do
    arrancar "$2" || { echo "::error::el backend de mentira no arrancó. NO concluyente."; exit 2; }
    sonda "$1" "${extra[@]}"; rc=$?
    [ "$rc" -eq "$3" ] && grep -q -- "$4" "$TMP/out" && hit=$((hit+1))
  done
  [ "$hit" -eq "$N" ] && ok "$5 · $hit/$N" || { mal "$5 · solo $hit/$N"; sed 's/^/      /' "$TMP/out" | tail -6; }
}

caso "$PROBE" edge   0 "peticiones: 6" "borde que fija la IP ⇒ rc 0 «C6 CIERRA» con 6 peticiones (lo autorizado), sin control"
caso "$PROBE" bypass 2 "Hace falta autorización" "borde que deja elegir la IP, SIN control autorizado ⇒ rc 2 (pide 6 más; no concluye)"
caso "$PROBE" bypass 1 "C6 FALLA"  "borde que deja elegir la IP + --with-control ⇒ rc 1 «C6 FALLA» (con el candado de cuenta vivo)" --with-control
caso "$PROBE" off    2 "NO concluyente" "sin tope por IP + --with-control ⇒ rc 2 (el control no dispara)" --with-control
caso "$PROBE" edge   0 "C6 CIERRA" "borde que fija la IP, 3 rondas ⇒ rc 0 (3/3 dentro de la corrida)" --rounds 3
# --control-only: la ronda base NO se reenvía ⇒ SOLO 6 peticiones (lo autorizado), no 12.
caso "$PROBE" bypass 1 "peticiones: 6" "borde que deja elegir la IP + --control-only ⇒ rc 1 «C6 FALLA» con SOLO 6 peticiones (base no reenviada)" --control-only
caso "$PROBE" off    2 "NO concluyente" "sin tope por IP + --control-only ⇒ rc 2 (el control no dispara)" --control-only

# --- guarda: la sonda se niega a correr contra local sin --canary-local -------
TARGET_BASE_URL="http://127.0.0.1:1" bash "$PROBE" --i-have-a-window >"$TMP/out" 2>&1
[ $? -eq 2 ] && grep -q "apunta a local" "$TMP/out" && ok "con --i-have-a-window contra local ⇒ rc 2 «apunta a local»" || mal "la guarda de host local no saltó"

# --- mutaciones -------------------------------------------------------------
mutar() { # <salida> <python-replace…>
  python3 - "$PROBE" "$1" "$2" <<'PY'
import sys
src, dst, which = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(src).read()
a = 'local correo="${TAG}-${n}@example.invalid"'
assert a in s, 'anclaje del correo no encontrado'
s = s.replace(a, 'local correo="${TAG}@example.invalid"')
if which == 'cualquiera':
    b = '429:RATE_LIMITED) echo IP ;;'
    assert b in s, 'anclaje de la clasificación no encontrado'
    s = s.replace(b, '429:*) echo IP ;;')
    c = '429:TOO_MANY_PASSWORD_ATTEMPTS) echo CUENTA; return ;;'
    assert c in s
    s = s.replace(c, 'NADA) ;;')
open(dst, 'w').write(s)
PY
}
for m in unico cualquiera; do
  mutar "$TMP/mut-$m.sh" "$m" || { echo "::error::no pude aplicar la mutación $m (anclaje desfasado). NO concluyente."; exit 2; }
  rojo=0
  for _ in $(seq 1 "$N"); do
    arrancar bypass; sonda "$TMP/mut-$m.sh" --with-control; rc=$?
    [ "$rc" -ne 1 ] && rojo=$((rojo+1))
  done
  [ "$rojo" -eq "$N" ] && ok "mutación m-$m ⇒ el caso «bypass» deja de dar «C6 FALLA» · $rojo/$N — el canario muerde (última salida: rc=$rc)" \
    || mal "mutación m-$m: solo $rojo/$N rojas"
done

echo
if [ "$FALLOS" -eq 0 ]; then printf '\033[1;32m✓ LIVE-11 sonda C6: %s/%s.\033[0m\n' "$PASADAS" "$PASADAS"; exit 0; fi
printf '\033[1;31m✗ LIVE-11 sonda C6: %s fallo(s) de %s.\033[0m\n' "$FALLOS" "$((PASADAS+FALLOS))"; exit 1

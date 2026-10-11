#!/usr/bin/env bash
#
# check-ttfb-probe-canary.sh — «¿la sonda de TTFB (E-8) sabe distinguir y
# sabe ponerse roja?» · devops
# =============================================================================
# Levanta una tienda de MENTIRA en 127.0.0.1 (python, sin red externa) y corre
# `scripts/ttfb-probe.sh` REAL contra: sin CSP, CSP estática sin nonce (lo que
# hoy sirve producción), Report-Only con nonce + estática (las dos salen),
# Report-Only con nonce SUSTITUYENDO a la estática (E-6 roto), enforce, cabecera
# en mayúsculas, lenta (umbral 800 y subida 300), calentamiento lento descartado,
# 500, 500 a mitad, redirección, etiqueta mezclada, servidor caído y URL no https.
# Cuenta en el servidor que la sonda hace EXACTAMENTE 11 peticiones y todas GET.
# Después MUTA la sonda (sin detección de nonce; aceptar cualquier código;
# no descartar el calentamiento) y exige que el caso que cada mutación rompe
# salga distinto: si no, el canario no muerde.
#
# Corre en `ttfb-probe.yml` (job `autoprueba`, antes de cada medición) y en
# `ci.yml` job `live-candados`.
#
# Uso:  ./scripts/check-ttfb-probe-canary.sh
# rc 0 todos los casos como deben · 1 alguno no · 2 no pudo medir.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROBE="$ROOT_DIR/scripts/ttfb-probe.sh"
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
mal() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }
for b in python3 curl awk; do command -v "$b" >/dev/null 2>&1 || { echo "::error::sin $b. NO concluyente."; exit 2; }; done
[ -f "$PROBE" ] || { echo "::error::falta $PROBE"; exit 1; }

TMP="$(mktemp -d -t ttfb-canario-XXXXXX)"; SRV=""
trap '[ -n "$SRV" ] && kill "$SRV" 2>/dev/null; rm -rf "$TMP"' EXIT

# Escenario = JSON en $TMP/esc.json:
#   {"st":200, "h":[[k,v],…], "d":segundos, "loc":"/x",
#    "i":{"<n.º de petición desde 0>": {mismas claves, sustituyen}}}
# El servidor anota «MÉTODO RUTA» de cada petición en $TMP/hits.
cat > "$TMP/fake.py" <<'PY'
import json, sys, time
from http.server import BaseHTTPRequestHandler, HTTPServer
ESC, HITS = sys.argv[2], sys.argv[3]; n = [0]
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def handle_one_request(self):
        try: return super().handle_one_request()
        except Exception: pass
    def any(self):
        if self.path == '/__vivo':
            self.send_response(204); self.end_headers(); return
        open(HITS, 'a').write(f'{self.command} {self.path}\n')
        e = json.load(open(ESC)); k = str(n[0]); n[0] += 1
        c = dict(e); c.update(e.get('i', {}).get(k, {}))
        time.sleep(c.get('d', 0))
        b = b'<html>tienda</html>'
        self.send_response(c.get('st', 200))
        for hk, hv in c.get('h', []): self.send_header(hk, hv)
        if c.get('loc'): self.send_header('location', c['loc'])
        self.send_header('content-length', str(len(b))); self.end_headers(); self.wfile.write(b)
    do_GET = do_HEAD = do_POST = any
HTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
PY

arrancar() {
  [ -n "$SRV" ] && { kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null; SRV=""; }
  : > "$TMP/hits"
  PORT=$(( 9750 + RANDOM % 200 ))
  python3 "$TMP/fake.py" "$PORT" "$TMP/esc.json" "$TMP/hits" >/dev/null 2>&1 & SRV=$!
  for _ in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$PORT/__vivo" 2>/dev/null && return 0; sleep 0.1; done
  return 1
}
escenario() { printf '%s' "$1" > "$TMP/esc.json"; arrancar || { echo "::error::el servidor de mentira no arrancó. NO concluyente."; exit 2; }; }
sonda() { # <script> [args…] → rc; salida en $TMP/out
  local s="$1"; shift
  bash "$s" --allow-local --url "http://127.0.0.1:$PORT/es" --timeout 5 "$@" >"$TMP/out" 2>&1
}
caso() { # <rc esperado> <nombre> <script> [args…] -- <texto>…  (cada texto debe aparecer)
  local rce="$1" nom="$2" s="$3"; shift 3
  local args=() txts=(); while [ $# -gt 0 ] && [ "$1" != "--" ]; do args+=("$1"); shift; done
  [ "${1:-}" = "--" ] && shift; txts=("$@")
  sonda "$s" "${args[@]}"; local rc=$? falta=""
  for t in "${txts[@]}"; do grep -qF -- "$t" "$TMP/out" || falta="$falta «$t»"; done
  if [ "$rc" -eq "$rce" ] && [ -z "$falta" ]; then ok "$nom ⇒ rc $rc"; else mal "$nom ⇒ rc $rc (esperaba $rce; falta:${falta:- nada})"; sed 's/^/      /' "$TMP/out" | tail -6; fi
}
p() { sed -n "s/^$1=\([0-9]*\).*/\1/p" "$TMP/out" | head -1; }

ESTATICA='["Content-Security-Policy","frame-ancestors '"'"'none'"'"'"]'
RO_NONCE='["Content-Security-Policy-Report-Only","default-src '"'"'self'"'"'; script-src '"'"'nonce-abc123'"'"' '"'"'strict-dynamic'"'"'"]'
ENF_NONCE='["Content-Security-Policy","default-src '"'"'self'"'"'; script-src '"'"'nonce-abc123'"'"'; frame-ancestors '"'"'none'"'"'"]'

printf '\n\033[1m== E-8 · ¿la sonda de TTFB distingue antes/después y sabe ponerse roja? ==\033[0m\n\n'

escenario '{"st":200,"h":[]}'
caso 3 "sin ninguna CSP ⇒ antes, 0 cabeceras, E-6 roto ⇒ ALARMA" "$PROBE" -- "ETIQUETA=antes" "CSP_CABECERAS=0" "E6_FRAME_ANCESTORS=no" "P90_MS="
H="$(sort -u "$TMP/hits")"; C="$(wc -l < "$TMP/hits")"
[ "$C" -eq 11 ] && [ "$H" = "GET /es" ] && ok "la sonda hace EXACTAMENTE 11 peticiones, todas «GET /es»" || mal "la sonda hizo $C peticiones: $(echo $H)"

escenario '{"st":200,"h":['"$ESTATICA"']}'
caso 0 "solo la estática sin nonce (producción hoy) ⇒ antes, 1 cabecera, E-6 sí" "$PROBE" -- "ETIQUETA=antes" "CSP_CABECERAS=1 (aplicadas=1 report_only=0)" "E6_FRAME_ANCESTORS=si" "UMBRAL=no aplica"

escenario '{"st":200,"h":['"$ESTATICA"','"$RO_NONCE"']}'
caso 0 "Report-Only con nonce + estática (no sustituye) ⇒ después, 2 cabeceras" "$PROBE" -- "ETIQUETA=despues" "CSP_CABECERAS=2 (aplicadas=1 report_only=1)" "E6_FRAME_ANCESTORS=si" "subida NO comparada"

escenario '{"st":200,"h":['"$RO_NONCE"']}'
caso 3 "Report-Only con nonce SUSTITUYE a la estática ⇒ después, 1 cabecera, E-6 roto ⇒ ALARMA" "$PROBE" -- "ETIQUETA=despues" "CSP_CABECERAS=1 (aplicadas=0 report_only=1)" "E6_FRAME_ANCESTORS=no"

escenario '{"st":200,"h":['"$ENF_NONCE"']}'
caso 0 "enforce con nonce y frame-ancestors ⇒ después, umbral VERDE con antes p90" "$PROBE" --antes-p90 5 -- "ETIQUETA=despues" "UMBRAL=VERDE" "E6_FRAME_ANCESTORS=si"

escenario '{"st":200,"h":[["CONTENT-SECURITY-POLICY","frame-ancestors '"'"'NONE'"'"'; script-src '"'"'nonce-Q'"'"'"]]}'
caso 0 "cabecera en MAYÚSCULAS ⇒ se cuenta igual (HTTP/1.1 no normaliza)" "$PROBE" -- "ETIQUETA=despues" "CSP_CABECERAS=1" "E6_FRAME_ANCESTORS=si"

escenario '{"st":200,"d":0.4,"h":['"$ENF_NONCE"']}'
caso 3 "lenta (400 ms) con umbral-p90 300 ⇒ UMBRAL ROJO" "$PROBE" --n 3 --umbral-p90 300 -- "UMBRAL=ROJO" "p90"
P90="$(p P90_MS)"; [ -n "$P90" ] && [ "$P90" -ge 380 ] && ok "y el p90 medido es real: $P90 ms ≥ 380" || mal "p90 de la lenta = '${P90}' (esperaba ≥ 380)"
caso 3 "lenta (400 ms) con antes p90 = 50 ⇒ subida > 300 ⇒ UMBRAL ROJO aunque p90 ≤ 800" "$PROBE" --n 3 --antes-p90 50 -- "UMBRAL=ROJO" "subida"
caso 0 "lenta (400 ms) con antes p90 = 200 ⇒ subida ≤ 300 y p90 ≤ 800 ⇒ VERDE" "$PROBE" --n 3 --antes-p90 200 -- "UMBRAL=VERDE"

escenario '{"st":200,"h":['"$ESTATICA"'],"i":{"0":{"d":0.6}}}'
caso 0 "calentamiento lento (petición 0, 600 ms) ⇒ se informa y se descarta" "$PROBE" -- "(descartado)"
max_muestras() { sed -n 's/^MUESTRAS_MS=//p' "$TMP/out" | tr ' ' '\n' | sort -n | tail -1; }
n_muestras() { sed -n 's/^MUESTRAS_MS=//p' "$TMP/out" | wc -w; }
M="$(max_muestras)"; NM="$(n_muestras)"
[ "$NM" -eq 10 ] && [ -n "$M" ] && [ "$M" -lt 300 ] && ok "10 muestras y la mayor = $M ms < 300 (el calentamiento no entró)" || mal "muestras=$NM, mayor='$M' (el calentamiento entró en la estadística)"

escenario '{"st":500,"h":[]}'
caso 1 "500 ⇒ muestra INVÁLIDA, sin p50/p90" "$PROBE" -- "HTTP 500" "VERDICT=MUESTRA_INVALIDA"
grep -q '^P50_MS=' "$TMP/out" && mal "con 500 imprimió P50_MS (cifra de algo que no fue la página)" || ok "con 500 NO imprime P50_MS"

escenario '{"st":200,"h":['"$ESTATICA"'],"i":{"6":{"st":500}}}'
caso 1 "un 500 a mitad (petición 6) contamina la corrida entera" "$PROBE" -- "petición 6: HTTP 500"

escenario '{"st":307,"loc":"https://www.tcghunt.mx/es","h":[]}'
caso 1 "redirección ⇒ INVÁLIDA y dice adónde" "$PROBE" -- "HTTP 307" "www.tcghunt.mx" "TTFB_URL"

escenario '{"st":200,"h":['"$ESTATICA"'],"i":{"7":{"h":['"$ESTATICA"','"$RO_NONCE"']},"8":{"h":['"$ESTATICA"','"$RO_NONCE"']},"9":{"h":['"$ESTATICA"','"$RO_NONCE"']},"10":{"h":['"$ESTATICA"','"$RO_NONCE"']}}}'
caso 1 "despliegue a mitad (antes→después en la 7) ⇒ etiqueta mezclada" "$PROBE" -- "etiqueta mezclada"

kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null; SRV=""
caso 1 "servidor caído (conexión rechazada) ⇒ INVÁLIDA" "$PROBE" -- "curl rc 7"

bash "$PROBE" --url http://ejemplo.invalid/es >"$TMP/out" 2>&1
[ $? -eq 2 ] && grep -q "no es https" "$TMP/out" && ok "URL http no local ⇒ rc 2 (no concluyente)" || mal "URL http no local no dio rc 2"
bash "$PROBE" --url https://x.invalid/es --n diez >"$TMP/out" 2>&1
[ $? -eq 2 ] && ok "--n no entero ⇒ rc 2" || mal "--n no entero no dio rc 2"

# --- mutaciones -------------------------------------------------------------
python3 - "$PROBE" "$TMP/m1.sh" "$TMP/m2.sh" "$TMP/m3.sh" <<'PY'
import sys
s = open(sys.argv[1]).read()
a = '''grep -q "'nonce-"; then echo despues'''
assert a in s, 'anclaje nonce'
open(sys.argv[2], 'w').write(s.replace(a, '''grep -q "NUNCA-ESTO"; then echo despues'''))
b = '    200) ;;\n'
assert b in s, 'anclaje 200'
open(sys.argv[3], 'w').write(s.replace(b, '    *) ;;\n'))
c = 'if [ "$i" -eq 0 ]; then'
assert c in s, 'anclaje calentamiento'
open(sys.argv[4], 'w').write(s.replace(c, 'if false; then'))
PY
[ $? -eq 0 ] || { echo "::error::no pude aplicar las mutaciones (anclaje desfasado). NO concluyente."; exit 2; }

escenario '{"st":200,"h":['"$ESTATICA"','"$RO_NONCE"']}'
sonda "$TMP/m1.sh"; grep -q '^ETIQUETA=antes' "$TMP/out" \
  && ok "mutación m-sin-nonce ⇒ Report-Only con nonce sale «antes»: el canario la caza" \
  || mal "mutación m-sin-nonce no cambió la etiqueta"
escenario '{"st":500,"h":[]}'
sonda "$TMP/m2.sh"; rc=$?
[ "$rc" -ne 1 ] && grep -q '^P50_MS=' "$TMP/out" \
  && ok "mutación m-acepta-cualquier-código ⇒ el 500 da cifra (rc $rc): el canario la caza" \
  || mal "mutación m-acepta-cualquier-código no cambió el veredicto (rc $rc)"
escenario '{"st":200,"h":['"$ESTATICA"'],"i":{"0":{"d":0.6}}}'
sonda "$TMP/m3.sh"; M="$(max_muestras)"; NM="$(n_muestras)"
[ -n "$M" ] && [ "$M" -ge 300 ] \
  && ok "mutación m-sin-descartar-calentamiento ⇒ $NM muestras, la mayor $M ms: el canario la caza" \
  || mal "mutación m-sin-descartar-calentamiento no cambió las muestras (n=$NM, mayor='$M')"

echo
if [ "$FALLOS" -eq 0 ]; then printf '\033[1;32m✓ E-8 sonda TTFB: %s/%s.\033[0m\n' "$PASADAS" "$PASADAS"; exit 0; fi
printf '\033[1;31m✗ E-8 sonda TTFB: %s fallo(s) de %s.\033[0m\n' "$FALLOS" "$((PASADAS+FALLOS))"; exit 1

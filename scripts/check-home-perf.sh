#!/usr/bin/env bash
# =============================================================================
# check-home-perf.sh — candado ESTÁTICO + de conducta del arnés de Lighthouse de la portada
# (API_CONTRACT §DYN.7 DYN-D1/DYN-D2/DYN-D3, PROJECT criterios 936-938) · devops · 2026-10-29, v1.114.2 2026-10-30
# -----------------------------------------------------------------------------
# Lo que NO necesita stack ni navegador (corre en `ci.yml` en cada push). La medición de verdad
# (Lighthouse contra el stack sembrado, con su canario de retraso) es `.github/workflows/home-perf.yml`.
#   1. Lighthouse CI FIJADO: `@lhci/cli` con versión exacta en scripts/home-perf/package.json y la
#      misma en su package-lock.json (toda dependencia externa va fijada, CLAUDE.md).
#   2. Umbrales (DYN-D1 v1.114.2): `lhci-config.mjs` da, sobre la MEDIANA, escritorio FCP 1000/LCP 1500,
#      CLS 0.1 en los dos perfiles, y en celular el TRINQUETE de `mobile-ratchet.json` (FCP/LCP =
#      ⌈mediana × 1.10⌉₁₀, con N ≥ 5, sha y fecha) o, sin fijar, la meta de 936 (1000/2500); d2 igual
#      sin LCP. `run.sh` corre 5 por perfil y escribe la meta de 936 en celular en el resumen.
#      `--against-ref <ref>`: el trinquete no SUBE respecto a <ref> sin pase del arquitecto
#      (`paseArquitecto` nuevo y presente en docs/API_CONTRACT.md).
#   3. El proxy de prueba (`delay-proxy.mjs`) hace lo que dice, MEDIDO N=10 veces (depende de
#      un temporizador ⇒ O-3): ruta sin regla < 400 ms; con `delay:1200` ≥ 1150 ms; `503` ⇒ 503;
#      `pad:300` ⇒ ≥ 300 KB más con el doctype primero; y se NIEGA a un upstream no local (rc 2).
#      run.sh: el canario engorda la portada y exige ΔFCP ≥ 500 ms frente a d1.
#   4. La variable del canario (HOME_PERF_CANARY_PAD_KB) no existe en frontend/ ni backend/.
#   5. El workflow `home-perf.yml` corre los cuatro modos (d1, d1-canary, d2-delay, d2-503), con
#      N=5, sin `continue-on-error`, y sube los lhr-*.json (`include-hidden-files: true`, D-DYN-9).
#   6. DYN-D3: la foto líder del origen es la de peso REAL (PNG ≥ 800 KB, huella fijada aquí y en
#      `seed-image-host.py`); `run.sh` la exige en el origen, reescribe el host del seed a uno de
#      `remotePatterns`, carga `next-image-origin.cjs` en `next start`, comprueba `/_next/image` de la
#      líder (200 webp) y pasa `lcp-optimized.mjs` por cada corrida d1; `lcp-optimized.mjs` es rojo con
#      respaldo, con 500 o sin `/_next/image` (lhr de juguete); el proxy reescribe JSON (`--replace`);
#      el desvío del optimizador se niega a un origen no local y no existe en frontend/ ni backend/.
#
# Uso:  ./scripts/check-home-perf.sh                      # candado
#       ./scripts/check-home-perf.sh --canary             # mutaciones ⇒ todas ROJAS
#       ./scripts/check-home-perf.sh --against-ref <ref>  # el trinquete de celular no subió (CI)
#       ./scripts/check-home-perf.sh --against-ref-canary # 5 casos del anterior ⇒ como se esperan
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d -t home-perf-XXXXXX)"
UP_PORT=39991; PX_PORT=39992; RW_PORT=39993; KILL=()
HUELLA_LIDER='bec432ea5397736f16d21287c48ea0e2aa76c4be02825eb3e1dde31eb8cdcb7a'; PESO_MIN_LIDER=819200
LLAVE=POKEMONPRICETRACKER""_API_KEY
limpiar() { for p in "${KILL[@]}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$TMP"; }
trap limpiar EXIT
# El trinquete de celular no SUBE sin pase del arquitecto (DYN-D1: «subir el trinquete sin pase del arquitecto» ⇒ rojo).
# $1 = json base · $2 = json nuevo · $3 = API_CONTRACT.md. rc 0 bien · 1 subió sin pase.
trinquete_no_sube() {
  node -e '
    const fs=require("fs");const [b,n,c]=process.argv.slice(1);
    const B=JSON.parse(fs.readFileSync(b,"utf8")),N=JSON.parse(fs.readFileSync(n,"utf8")),C=fs.readFileSync(c,"utf8");
    const sube=["fcpMs","lcpMs"].filter(k=>Number.isInteger(B[k])&&(!Number.isInteger(N[k])?false:N[k]>B[k]));
    if(!sube.length){console.log("  ✔ el trinquete de celular no sube respecto a la base");process.exit(0)}
    const pase=N.paseArquitecto, nuevo=pase&&pase!==B.paseArquitecto&&C.includes(pase);
    if(nuevo){console.log(`  ✔ el trinquete sube (${sube}) con pase del arquitecto ${pase}`);process.exit(0)}
    console.log(`  ✗ el trinquete de celular SUBE (${sube.map(k=>`${k} ${B[k]}→${N[k]}`)}) sin pase del arquitecto nuevo y presente en API_CONTRACT (paseArquitecto «${pase}»)`);process.exit(1)' "$1" "$2" "$3"
}
if [ "${1:-}" = "--against-ref" ]; then
  REF="${2:-}"; [ -n "$REF" ] || { echo "::error::--against-ref <ref>"; exit 2; }
  echo "== Trinquete de celular (DYN-D1) contra $REF =="
  git -C "$ROOT_DIR" show "$REF:scripts/home-perf/mobile-ratchet.json" > "$TMP/base.json" 2>/dev/null \
    || { echo "  ✔ $REF no tiene mobile-ratchet.json: nada con qué comparar"; exit 0; }
  trinquete_no_sube "$TMP/base.json" "$ROOT_DIR/scripts/home-perf/mobile-ratchet.json" "$ROOT_DIR/docs/API_CONTRACT.md"; exit $?
fi
if [ "${1:-}" = "--against-ref-canary" ]; then
  echo "== Canario de --against-ref (trinquete de celular) =="
  printf 'v1.114.2 … v1.115 pase del arquitecto\n' > "$TMP/contrato.md"
  j() { printf '{"fcpMs":%s,"lcpMs":%s,"paseArquitecto":"%s"}' "$1" "$2" "$3" > "$TMP/$4.json"; }
  okc=0; totc=0
  caso() { totc=$((totc+1)); trinquete_no_sube "$TMP/b.json" "$TMP/n.json" "$TMP/contrato.md" >/dev/null; local rc=$?
           if [ "$rc" = "$2" ]; then echo "  ✔ $1 ⇒ rc $rc"; okc=$((okc+1)); else echo "  ✗ $1 ⇒ rc $rc (esperado $2)"; fi; }
  j null null v1.114.2 b; j 1370 6100 v1.114.2 n; caso "se fija por primera vez (null → valor)" 0
  j 1370 6100 v1.114.2 b; j 1300 6000 v1.114.2 n; caso "baja" 0
  j 1370 6100 v1.114.2 b; j 1500 6100 v1.114.2 n; caso "sube sin pase" 1
  j 1370 6100 v1.114.2 b; j 1370 6500 v1.116 n;   caso "sube con un pase que no está en el contrato" 1
  j 1370 6100 v1.114.2 b; j 1500 6500 v1.115 n;   caso "sube con pase nuevo presente en el contrato" 0
  echo "Canario: $okc/$totc casos como se esperan."; [ "$okc" = "$totc" ]; exit $?
fi
for p in $UP_PORT $PX_PORT $RW_PORT; do curl -s -m 2 -o /dev/null "http://127.0.0.1:$p/" 2>/dev/null && { echo "::error:::$p ocupado (NO concluyente)"; exit 2; }; done
python3 -I "$ROOT_DIR/scripts/stack-test/fake-health-server.py" "$UP_PORT" >/dev/null 2>&1 & KILL+=($!)
# Readiness con margen: bajo carga (un Lighthouse al lado) un `node` tarda segundos en abrir el puerto.
esperar_http() { local i; for i in $(seq 1 150); do curl -s -m 1 -o /dev/null "$1" 2>/dev/null && return 0; sleep 0.2; done; return 1; }
esperar_http "http://127.0.0.1:$UP_PORT/" || { echo "::error::el upstream de maqueta no arrancó (NO concluyente)"; exit 2; }

ms() { curl -s -o /dev/null -m 10 -w '%{http_code} %{time_total}' "$1" | awk '{printf "%s %d", $1, $2*1000}'; }

comprobar() {  # $1 = raíz con scripts/home-perf, scripts/check-home-perf.sh, .github, frontend, backend
  local r="$1" hp="$1/scripts/home-perf" fallos=0 v lv out code t
  ok() { echo "  ✔ $*"; }
  ko() { echo "  ✗ $*"; fallos=$((fallos+1)); }

  # 1. versión fijada
  v="$(node -e 'const p=require(process.argv[1]);process.stdout.write((p.devDependencies||{})["@lhci/cli"]||"")' "$hp/package.json" 2>/dev/null)"
  lv="$(node -e 'const p=require(process.argv[1]);process.stdout.write(((p.packages||{})["node_modules/@lhci/cli"]||{}).version||"")' "$hp/package-lock.json" 2>/dev/null)"
  if printf '%s' "$v" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' && [ "$v" = "$lv" ]; then ok "@lhci/cli fijado: $v (package.json = package-lock)"
  else ko "@lhci/cli sin fijar: package.json «$v», package-lock «$lv»"; fi

  # 2. umbrales (celular: trinquete fijado de forma coherente, o la meta de 936 si está en null)
  local exp_m
  exp_m="$(node -e '
    const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=(ms)=>Math.ceil(ms*1.1/10)*10;
    if(r.fcpMs===null&&r.lcpMs===null){console.log("1000 2500");process.exit(0)}
    const ok=Number.isInteger(r.fcpMs)&&Number.isInteger(r.lcpMs)&&r.fcpMs===t(r.medianaFcpMs)&&r.lcpMs===t(r.medianaLcpMs)
      &&r.runs>=5&&/^[0-9a-f]{7,40}$/.test(r.sha||"")&&/^\d{4}-\d{2}-\d{2}$/.test(r.fecha||"");
    if(!ok){console.log("INCOHERENTE");process.exit(0)}
    console.log(`${r.fcpMs} ${r.lcpMs}`)' "$hp/mobile-ratchet.json" 2>&1)"
  case "$exp_m" in
    "1000 2500") ok "celular: trinquete sin fijar ⇒ bloquea la meta de 936 (1000/2500)" ;;
    INCOHERENTE|"") ko "mobile-ratchet.json incoherente: fcpMs/lcpMs ≠ ⌈mediana × 1.10⌉₁₀, o N < 5, o sin sha/fecha"; exp_m="? ?" ;;
    *) ok "celular: trinquete fijado FCP/LCP $exp_m ms = ⌈mediana × 1.10⌉₁₀ (N ≥ 5, sha y fecha)" ;;
  esac
  local mf ml; read -r mf ml <<<"$exp_m"
  out="$(for p in mobile desktop; do for t in d1 d2; do printf '%s %s ' "$p" "$t"; node "$hp/lhci-config.mjs" "$p" "$t" /chrome 1 \
          | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s).ci.assert.assertions;const g=k=>a[k]?`${a[k][1].maxNumericValue}/${a[k][1].aggregationMethod}`:"-";console.log(`fcp=${g("first-contentful-paint")} lcp=${g("largest-contentful-paint")} cls=${g("cumulative-layout-shift")} preset=${JSON.parse(s).ci.collect.settings.preset||"mobile"}`)})'; done; done 2>&1)"
  esperado="mobile d1 fcp=$mf/median lcp=$ml/median cls=0.1/median preset=mobile
mobile d2 fcp=$mf/median lcp=- cls=0.1/median preset=mobile
desktop d1 fcp=1000/median lcp=1500/median cls=0.1/median preset=desktop
desktop d2 fcp=1000/median lcp=- cls=0.1/median preset=desktop"
  [ "$out" = "$esperado" ] && ok "umbrales de DYN-D1/D2 sobre la mediana, por perfil" || ko "umbrales distintos: $(printf '%s' "$out" | tr '\n' ';')"
  grep -q 'NO CUMPLIDA, decisión del dueño 2026-10-30' "$hp/run.sh" && grep -q 'META_CEL' "$hp/run.sh" \
    && ok "run.sh: la meta de 936 en celular sale en el resumen (solo reporte)" || ko "run.sh no reporta la meta de 936 en celular"
  grep -qE '(^|; )RUNS="\$\{HOME_PERF_RUNS:-5\}"' "$hp/run.sh" && ok "run.sh: 5 corridas por perfil por defecto" || ko "run.sh no corre 5 por perfil"

  # 3. el proxy, medido N=10
  node "$hp/delay-proxy.mjs" --listen "$PX_PORT" --upstream "http://127.0.0.1:$UP_PORT" \
       --rule '^/lento=delay:1200' --rule '^/caido=503' --rule '^/gordo=pad:300' >/dev/null 2>&1 & local px=$!
  esperar_http "http://127.0.0.1:$PX_PORT/" || { kill "$px" 2>/dev/null; ko "el proxy no abrió :$PX_PORT en 30 s"; }
  local okr=0 okl=0 ok5=0 okp=0 i base gordo
  base="$(curl -s -m 10 "http://127.0.0.1:$PX_PORT/es" | wc -c | tr -d ' ')"
  for i in $(seq 1 10); do
    read -r code t <<<"$(ms "http://127.0.0.1:$PX_PORT/es")";      [ "$code" = 200 ] && [ "$t" -lt 400 ] && okr=$((okr+1))
    read -r code t <<<"$(ms "http://127.0.0.1:$PX_PORT/lento?x=1")"; [ "$code" = 200 ] && [ "$t" -ge 1150 ] && okl=$((okl+1))
    read -r code t <<<"$(ms "http://127.0.0.1:$PX_PORT/caido")";   [ "$code" = 503 ] && ok5=$((ok5+1))
    # pad:300 ⇒ ≥ 300 KB más, y sigue empezando por <!doctype (el relleno va DENTRO de <head>).
    gordo="$(curl -s -m 10 "http://127.0.0.1:$PX_PORT/gordo" -o "$TMP/gordo.html" -w '%{size_download}')"
    [ "$gordo" -ge $(( base + 300 * 1024 )) ] && head -c 15 "$TMP/gordo.html" | grep -qi '^<!doctype' && okp=$((okp+1))
  done
  kill "$px" 2>/dev/null; wait "$px" 2>/dev/null
  [ "$okr" = 10 ] && ok "proxy sin regla: 10/10 rápidas (< 400 ms)" || ko "proxy sin regla: $okr/10 rápidas"
  [ "$okl" = 10 ] && ok "proxy delay:1200: 10/10 retrasadas (≥ 1150 ms)" || ko "proxy delay:1200: $okl/10 retrasadas"
  [ "$ok5" = 10 ] && ok "proxy 503: 10/10" || ko "proxy 503: $ok5/10"
  [ "$okp" = 10 ] && ok "proxy pad:300 (canario de D1): 10/10 con ≥ 300 KB más y el doctype primero" || ko "proxy pad:300: $okp/10"
  grep -qE 'd1-canary\) front_rules=\(--rule "\$HOME_RE=pad:\$CANARY_KB"\)' "$hp/run.sh" \
    && grep -qE '"\$delta" -lt "\$CANARY_MIN_DELTA_MS"' "$hp/run.sh" \
    && ok "run.sh: el canario engorda la portada y exige ΔFCP ≥ CANARY_MIN_DELTA_MS frente a d1" \
    || ko "run.sh: el canario no engorda la portada o no exige ver el retraso"
  timeout 5 node "$hp/delay-proxy.mjs" --listen "$PX_PORT" --upstream "http://api.tcghunt.mx" >/dev/null 2>&1; code=$?
  [ "$code" = 2 ] && ok "proxy se niega a un upstream remoto (rc 2)" || ko "proxy aceptó un upstream remoto (rc $code)"

  # 4. el canario no vive en el producto
  if grep -rqs 'HOME_PERF_CANARY_PAD_KB' "$r/frontend/src" "$r/frontend/next.config.mjs" "$r/backend/src"; then ko "HOME_PERF_CANARY_PAD_KB aparece en frontend/ o backend/"
  else ok "la variable del canario no existe en frontend/ ni backend/"; fi

  # 5. el workflow
  local wf="$r/.github/workflows/home-perf.yml"
  if [ -f "$wf" ] && grep -qE 'scripts/home-perf/run\.sh d1 d1-canary d2-delay d2-503' "$wf" \
     && grep -qE 'HOME_PERF_RUNS: *"?5"?' "$wf" && ! grep -qE '^ *continue-on-error:' "$wf" \
     && grep -q 'npm ci --ignore-scripts' "$wf"; then ok "home-perf.yml corre d1 + canario + d2 (N=5, bloqueante, lockfile)"
  else ko "home-perf.yml no cablea los cuatro modos con N=5 y sin continue-on-error"; fi
  if awk '/uses: actions\/upload-artifact/{f=1} f&&/include-hidden-files: *true/{print "si"; exit}' "$wf" 2>/dev/null | grep -q si; then
    ok "home-perf.yml sube los lhr-*.json (.lighthouseci oculta: include-hidden-files: true)"
  else ko "home-perf.yml no sube las carpetas ocultas: el artefacto sale sin lhr-*.json (D-DYN-9)"; fi

  # 6. DYN-D3: bytes reales y optimizador de verdad
  local hl
  hl="$(python3 -I "$hp/seed-image-host.py" --huella 2>/dev/null)"
  if [ "${hl#* }" = "$HUELLA_LIDER" ] && [ "${hl%% *}" -ge "$PESO_MIN_LIDER" ] 2>/dev/null; then ok "foto líder del origen: ${hl%% *} B (≥ $PESO_MIN_LIDER) con la huella fijada"
  else ko "foto líder del origen distinta de la fijada o < $PESO_MIN_LIDER B («$hl»): ¿la sustituta?"; fi
  grep -qE '^PESO_MIN_LIDER=\$\(\(800 \* 1024\)\)' "$hp/run.sh" && grep -q '"${PESO_ORIGEN:-0}" -ge "$PESO_MIN_LIDER"' "$hp/run.sh" \
    && ok "run.sh exige ≥ 800 KB en el origen antes de medir" || ko "run.sh no exige el peso de la foto líder en el origen"
  grep -q -- '--replace "$IMG_FIXTURE" --with "$IMG_REMOTO"' "$hp/run.sh" && grep -q "IMG_REMOTO='https://images.scrydex.com/e2e/'" "$hp/run.sh" \
    && ok "run.sh: el proxy del API sirve el arte con un host de remotePatterns" || ko "run.sh no reescribe el host del seed (el optimizador lo rechazaría)"
  grep -q 'NODE_OPTIONS="--require $HERE/next-image-origin.cjs"' "$hp/run.sh" \
    && ok "run.sh: next start con el desvío del optimizador al origen local" || ko "run.sh no carga next-image-origin.cjs en next start"
  grep -q '^proxies d1; optimizador$' "$hp/run.sh" && grep -q 'OPTIMIZADOR="NO: /_next/image de la líder' "$hp/run.sh" \
    && grep -q '^rm -rf "$FE/.next/cache/images"$' "$hp/run.sh" \
    && grep -q '"$HERE/lcp-optimized.mjs" "$dir/.lighthouseci"' "$hp/run.sh" \
    && ok "run.sh: /_next/image de la líder antes de medir y lcp-optimized.mjs por corrida d1" || ko "run.sh no comprueba el optimizador (DYN-D3)"
  local L="$TMP/lhr$RANDOM"; mkdir -p "$L/bueno" "$L/respaldo" "$L/e500" "$L/crudo" "$L/doble"
  lhr() {  # $1 dir  $2 peticiones (JSON)  $3 snippet LCP
    node -e 'const [d,r,s]=process.argv.slice(1);require("fs").writeFileSync(d+"/lhr-1.json",JSON.stringify({audits:{"network-requests":{details:{items:JSON.parse(r)}},"largest-contentful-paint-element":{details:{items:[{items:[{node:{snippet:s}}]}]}}}}))' "$1" "$2" "$3"
  }
  local O='https://images.scrydex.com/e2e/x_hires.png' N='http://localhost:3190/_next/image?url=https%3A%2F%2Fimages.scrydex.com%2Fe2e%2Fx_hires.png&w=640&q=75'
  lhr "$L/bueno"    "[{\"url\":\"$N\",\"statusCode\":200,\"mimeType\":\"image/webp\"}]" '<img src="http://localhost:3190/_next/image?url=https%3A%2F%2Fimages.scrydex.com%2Fe2e%2Fx_hires.png&amp;w=640&amp;q=75">'
  lhr "$L/respaldo" "[{\"url\":\"$N\",\"statusCode\":500,\"mimeType\":\"text/plain\"},{\"url\":\"$O\",\"statusCode\":200,\"mimeType\":\"image/png\"}]" "<img src=\"$O\">"
  lhr "$L/e500"     "[{\"url\":\"$N\",\"statusCode\":500,\"mimeType\":\"text/plain\"}]" '<h1 class="x">'
  lhr "$L/crudo"    "[{\"url\":\"$O\",\"statusCode\":200,\"mimeType\":\"image/png\"}]" "<img src=\"$O\">"
  # doble: la WebP llegó bien, pero el navegador ADEMÁS bajó la original (respaldo, o precarga de la original).
  lhr "$L/doble"    "[{\"url\":\"$N\",\"statusCode\":200,\"mimeType\":\"image/webp\"},{\"url\":\"$O\",\"statusCode\":200,\"mimeType\":\"image/png\"}]" '<img src="http://localhost:3190/_next/image?url=https%3A%2F%2Fimages.scrydex.com%2Fe2e%2Fx_hires.png&amp;w=640&amp;q=75">'
  local lb lr l5 lc ld
  node "$hp/lcp-optimized.mjs" "$L/bueno" >/dev/null 2>&1; lb=$?
  node "$hp/lcp-optimized.mjs" "$L/respaldo" >/dev/null 2>&1; lr=$?
  node "$hp/lcp-optimized.mjs" "$L/e500" >/dev/null 2>&1; l5=$?
  node "$hp/lcp-optimized.mjs" "$L/crudo" >/dev/null 2>&1; lc=$?
  node "$hp/lcp-optimized.mjs" "$L/doble" >/dev/null 2>&1; ld=$?
  [ "$lb$lr$l5$lc$ld" = 01111 ] && ok "lcp-optimized.mjs: 200 webp verde; respaldo, 500, <img> cruda y doble descarga ROJOS" \
    || ko "lcp-optimized.mjs no distingue (bueno $lb · respaldo $lr · 500 $l5 · cruda $lc · doble $ld; se espera 0 1 1 1 1)"
  node "$hp/delay-proxy.mjs" --listen "$RW_PORT" --upstream "http://127.0.0.1:$UP_PORT" --replace '"ok"' --with '"REESCRITO"' >/dev/null 2>&1 & local rw=$!
  if esperar_http "http://127.0.0.1:$RW_PORT/"; then
    local j h; j="$(curl -s -m 5 "http://127.0.0.1:$RW_PORT/api/v1/health")"; h="$(curl -s -m 5 "http://127.0.0.1:$RW_PORT/es")"
    case "$j|$h" in *'"REESCRITO"'*'|<!doctype html>'*) ok "proxy --replace reescribe el JSON y deja el HTML" ;; *) ko "proxy --replace no reescribe el JSON («$j»)" ;; esac
  else ko "el proxy con --replace no abrió :$RW_PORT"; fi
  kill "$rw" 2>/dev/null; wait "$rw" 2>/dev/null
  HOME_PERF_IMG_ORIGIN=http://images.scrydex.com:80 node -r "$hp/next-image-origin.cjs" -e '' >/dev/null 2>&1 \
    && ko "next-image-origin.cjs acepta un origen no local" || ok "next-image-origin.cjs se niega a un origen no local"
  if grep -rqs 'next-image-origin\|HOME_PERF_IMG_ORIGIN' "$r/frontend/src" "$r/frontend/next.config.mjs" "$r/frontend/package.json" "$r/backend/src"; then
    ko "el desvío del optimizador del arnés aparece en frontend/ o backend/"
  else ok "el desvío del optimizador no existe en frontend/ ni backend/"; fi
  # sharp en el build `standalone` (§4.DYN (f) 7, §5.3.6 (c)): sin él, /_next/image devuelve la PNG original con 200
  # (medido, Next 15.5.28) y la imagen se publicaría así. La etapa runtime transforma a WebP o no se construye.
  if awk '/^FROM base AS runtime/{f=1} f' "$r/Dockerfile.frontend" 2>/dev/null | grep -v '^#' \
       | grep -q "^RUN node -e \"const s=require('sharp');.*webp({quality:75}).*SHARP_STANDALONE_OK.*process.exit(1)"; then
    ok "Dockerfile.frontend: la etapa runtime exige sharp funcionando en el standalone (WebP)"
  else ko "Dockerfile.frontend: sin la guarda de sharp en la etapa runtime (el standalone publicaría la líder sin optimizar)"; fi
  # Encender el dial del gancho (para que exista la vitrina) solo es seguro sin llave del proveedor.
  # (El nombre de la variable va en $LLAVE: escrito junto a un valor, el manifiesto de secretos
  #  publicados lo contaría como literal — check-secret-defaults.sh, S-88-1.)
  if grep -qE 'HP_GRADING_HOOK_ON: *"?1"?' "$wf" 2>/dev/null && ! grep -qE "^ +${LLAVE}: *''$" "$wf"; then
    ko "home-perf.yml enciende el dial del gancho SIN declarar vacía la llave del proveedor de paga"
  else ok "home-perf.yml: dial del gancho encendido solo con la llave del proveedor vacía"; fi
  [ "$fallos" = 0 ]
}

copia() {  # árbol mínimo para mutar
  local d="$TMP/c$RANDOM"; mkdir -p "$d/scripts" "$d/.github/workflows" "$d/frontend" "$d/backend"
  cp -r "$ROOT_DIR/scripts/home-perf" "$d/scripts/"; rm -rf "$d/scripts/home-perf/node_modules"
  cp "$ROOT_DIR/.github/workflows/home-perf.yml" "$d/.github/workflows/" 2>/dev/null
  cp "$ROOT_DIR/Dockerfile.frontend" "$d/" 2>/dev/null
  cp -r "$ROOT_DIR/frontend/src" "$d/frontend/src"; cp -r "$ROOT_DIR/backend/src" "$d/backend/src"
  printf '%s' "$d"
}

if [ "${1:-}" != "--canary" ]; then
  echo "== Arnés de Lighthouse de la portada (DYN-D1/DYN-D2): fijado, umbrales, proxy y workflow =="
  comprobar "$ROOT_DIR" && { echo "✓ OK"; exit 0; }
  echo "✗ ROJO"; exit 1
fi
echo "== Canario de check-home-perf =="
comprobar "$ROOT_DIR" >/dev/null 2>&1 || { echo "✗ el original ya está rojo: el canario no concluye"; exit 2; }
muerde=0; total=0
mutar() {  # $1 nombre  $2 fichero relativo  $3 sed | o comando con «cmd:»
  total=$((total+1)); local d; d="$(copia)"
  if [ "${3#cmd:}" != "$3" ]; then ( cd "$d" && eval "${3#cmd:}" )
  else sed -i "$3" "$d/$2"; cmp -s "$d/$2" "$ROOT_DIR/$2" && { echo "  ✗ mutación '$1' no cambió nada (canario ciego)"; return; }; fi
  if comprobar "$d" >/dev/null 2>&1; then echo "  ✗ '$1' ⇒ VERDE (el candado NO muerde)"
  else echo "  ✔ '$1' ⇒ ROJO"; muerde=$((muerde+1)); fi
}
mutar "lhci con ^"                     scripts/home-perf/package.json   's|"@lhci/cli": "0|"@lhci/cli": "^0|'
mutar "LCP de escritorio a 2500"       scripts/home-perf/lhci-config.mjs 's|desktop: { fcp: 1000, lcp: 1500 }|desktop: { fcp: 1000, lcp: 2500 }|'
mutar "agregación optimista"           scripts/home-perf/lhci-config.mjs "s|aggregationMethod: 'median'|aggregationMethod: 'optimistic'|"
mutar "3 corridas"                     scripts/home-perf/run.sh          's|HOME_PERF_RUNS:-5|HOME_PERF_RUNS:-3|'
mutar "el proxy ignora el retraso"     scripts/home-perf/delay-proxy.mjs 's|setTimeout(forward, rule.fault.ms);|forward();|'
mutar "el proxy no engorda"            scripts/home-perf/delay-proxy.mjs 's|body = /<head\[^>\]\*>/i.test(body)|body = false|'
mutar "canario sin exigir ΔFCP"        scripts/home-perf/run.sh          's|"\$delta" -lt "\$CANARY_MIN_DELTA_MS"|"$delta" -lt 0|'
mutar "el proxy acepta cualquier host" scripts/home-perf/delay-proxy.mjs "s|if (!\['localhost'|if (false \&\& !['localhost'|"
mutar "canario dentro del producto"    frontend/src/x.ts                 'cmd:echo "export const d = process.env.HOME_PERF_CANARY_PAD_KB;" > frontend/src/x.ts'
mutar "dial encendido con llave"       .github/workflows/home-perf.yml   "s|^      ${LLAVE}: ''\$|      ${LLAVE}: \${{ secrets.PPT }}|"
mutar "workflow sin el canario"        .github/workflows/home-perf.yml   's|run.sh d1 d1-canary d2-delay d2-503|run.sh d1 d2-delay d2-503|'
mutar "CLS de celular a 0.25"          scripts/home-perf/lhci-config.mjs 's|cls: 0.1 }|cls: 0.25 }|'
mutar "trinquete que no es mediana+10%" scripts/home-perf/mobile-ratchet.json 's|"fcpMs": null|"fcpMs": 1600|; s|"lcpMs": null|"lcpMs": 6100|; s|"medianaFcpMs": null|"medianaFcpMs": 1240|; s|"medianaLcpMs": null|"medianaLcpMs": 5470|; s|"runs": null|"runs": 5|; s|"sha": null|"sha": "0d40d0b7"|; s|"fecha": null|"fecha": "2026-10-30"|'
mutar "meta de 936 fuera del resumen"   scripts/home-perf/run.sh          's|NO CUMPLIDA, decisión del dueño 2026-10-30|no cumplida|'
mutar "artefacto sin lhr (ocultas)"     .github/workflows/home-perf.yml   '/include-hidden-files: true/d'
mutar "foto líder sustituta (ligera)"   scripts/home-perf/seed-image-host.py 's|bloque, amp_bloque, amp_fino = 10, 84, 2|bloque, amp_bloque, amp_fino = 10, 84, 1|'
mutar "run.sh no exige el peso"         scripts/home-perf/run.sh          's|^PESO_MIN_LIDER=$((800 \* 1024))|PESO_MIN_LIDER=$((100 * 1024))|'
mutar "sin reescritura del host"        scripts/home-perf/run.sh          's|--replace "$IMG_FIXTURE" --with "$IMG_REMOTO" ||'
mutar "next start sin el desvío"        scripts/home-perf/run.sh          's|NODE_OPTIONS="--require $HERE/next-image-origin.cjs" ||'
mutar "run.sh sin lcp-optimized"        scripts/home-perf/run.sh          's|"$HERE/lcp-optimized.mjs" "$dir/.lighthouseci"|true|'
mutar "lcp-optimized acepta el respaldo" scripts/home-perf/lcp-optimized.mjs 's|if (origenes.has(r.url)) motivos.push|if (false) motivos.push|'
mutar "lcp-optimized acepta 500"        scripts/home-perf/lcp-optimized.mjs 's|if (r.statusCode !== 200 |if (false) if (r.statusCode !== 200 |'
mutar "proxy sin --replace"             scripts/home-perf/delay-proxy.mjs 's|.split(opt.replace).join(opt.with)||'
mutar "desvío con cualquier origen"     scripts/home-perf/next-image-origin.cjs 's|.test(origen)) {|.test(origen) \&\& false) {|'
mutar "desvío dentro del producto"      frontend/src/y.ts                 'cmd:echo "import \"../../scripts/home-perf/next-image-origin.cjs\";" > frontend/src/y.ts'
mutar "caché del optimizador heredada"  scripts/home-perf/run.sh          '/^rm -rf "$FE\/.next\/cache\/images"$/d'
mutar "imagen sin la guarda de sharp"   Dockerfile.frontend               '/SHARP_STANDALONE_OK/d'
mutar "guarda de sharp que no falla"    Dockerfile.frontend               's|process.exit(1)})"$|process.exit(0)})"|'
echo "Canario: $muerde/$total mutaciones salen ROJAS."
[ "$muerde" = "$total" ]

#!/usr/bin/env bash
# =============================================================================
# check-home-perf.sh — candado ESTÁTICO + de conducta del arnés de Lighthouse de la portada
# (API_CONTRACT §DYN.7 DYN-D1/DYN-D2, PROJECT criterios 936-938) · devops · 2026-10-29
# -----------------------------------------------------------------------------
# Lo que NO necesita stack ni navegador (corre en `ci.yml` en cada push). La medición de verdad
# (Lighthouse contra el stack sembrado, con su canario de retraso) es `.github/workflows/home-perf.yml`.
#   1. Lighthouse CI FIJADO: `@lhci/cli` con versión exacta en scripts/home-perf/package.json y la
#      misma en su package-lock.json (toda dependencia externa va fijada, CLAUDE.md).
#   2. Umbrales: `lhci-config.mjs` da, sobre la MEDIANA, móvil FCP 1000/LCP 2500, escritorio
#      FCP 1000/LCP 1500, CLS 0.1 (d1) y FCP+CLS sin LCP (d2); `run.sh` corre 5 por perfil.
#   3. El proxy de prueba (`delay-proxy.mjs`) hace lo que dice, MEDIDO N=10 veces (depende de
#      un temporizador ⇒ O-3): ruta sin regla < 400 ms; con `delay:1200` ≥ 1150 ms; `503` ⇒ 503;
#      `pad:300` ⇒ ≥ 300 KB más con el doctype primero; y se NIEGA a un upstream no local (rc 2).
#      run.sh: el canario engorda la portada y exige ΔFCP ≥ 500 ms frente a d1.
#   4. La variable del canario (HOME_PERF_CANARY_PAD_KB) no existe en frontend/ ni backend/.
#   5. El workflow `home-perf.yml` corre los cuatro modos (d1, d1-canary, d2-delay, d2-503), con
#      N=5, sin `continue-on-error`, y fija la versión de las acciones como el resto del repo.
#
# Uso:  ./scripts/check-home-perf.sh            # candado
#       ./scripts/check-home-perf.sh --canary   # mutaciones ⇒ todas ROJAS
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d -t home-perf-XXXXXX)"
UP_PORT=39991; PX_PORT=39992; KILL=()
limpiar() { for p in "${KILL[@]}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$TMP"; }
trap limpiar EXIT
for p in $UP_PORT $PX_PORT; do curl -s -m 2 -o /dev/null "http://127.0.0.1:$p/" 2>/dev/null && { echo "::error:::$p ocupado (NO concluyente)"; exit 2; }; done
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

  # 2. umbrales
  out="$(for p in mobile desktop; do for t in d1 d2; do printf '%s %s ' "$p" "$t"; node "$hp/lhci-config.mjs" "$p" "$t" /chrome 1 \
          | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s).ci.assert.assertions;const g=k=>a[k]?`${a[k][1].maxNumericValue}/${a[k][1].aggregationMethod}`:"-";console.log(`fcp=${g("first-contentful-paint")} lcp=${g("largest-contentful-paint")} cls=${g("cumulative-layout-shift")} preset=${JSON.parse(s).ci.collect.settings.preset||"mobile"}`)})'; done; done 2>&1)"
  esperado="mobile d1 fcp=1000/median lcp=2500/median cls=0.1/median preset=mobile
mobile d2 fcp=1000/median lcp=- cls=0.1/median preset=mobile
desktop d1 fcp=1000/median lcp=1500/median cls=0.1/median preset=desktop
desktop d2 fcp=1000/median lcp=- cls=0.1/median preset=desktop"
  [ "$out" = "$esperado" ] && ok "umbrales de 936/937 sobre la mediana, por perfil" || ko "umbrales distintos: $(printf '%s' "$out" | tr '\n' ';')"
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
  # Encender el dial del gancho (para que exista la vitrina) solo es seguro sin llave del proveedor.
  if grep -qE 'HP_GRADING_HOOK_ON: *"?1"?' "$wf" 2>/dev/null && ! grep -qE "^ +POKEMONPRICETRACKER_API_KEY: *''$" "$wf"; then
    ko "home-perf.yml enciende el dial del gancho SIN declarar vacía la llave del proveedor de paga"
  else ok "home-perf.yml: dial del gancho encendido solo con POKEMONPRICETRACKER_API_KEY=''"; fi
  [ "$fallos" = 0 ]
}

copia() {  # árbol mínimo para mutar
  local d="$TMP/c$RANDOM"; mkdir -p "$d/scripts" "$d/.github/workflows" "$d/frontend" "$d/backend"
  cp -r "$ROOT_DIR/scripts/home-perf" "$d/scripts/"; rm -rf "$d/scripts/home-perf/node_modules"
  cp "$ROOT_DIR/.github/workflows/home-perf.yml" "$d/.github/workflows/" 2>/dev/null
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
mutar "dial encendido con llave"       .github/workflows/home-perf.yml   "s|^      POKEMONPRICETRACKER_API_KEY: ''\$|      POKEMONPRICETRACKER_API_KEY: \${{ secrets.PPT }}|"
mutar "workflow sin el canario"        .github/workflows/home-perf.yml   's|run.sh d1 d1-canary d2-delay d2-503|run.sh d1 d2-delay d2-503|'
echo "Canario: $muerde/$total mutaciones salen ROJAS."
[ "$muerde" = "$total" ]

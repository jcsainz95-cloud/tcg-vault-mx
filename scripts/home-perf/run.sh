#!/usr/bin/env bash
# =============================================================================
# scripts/home-perf/run.sh — Lighthouse CI de la portada contra el stack SEMBRADO · devops
# API_CONTRACT §DYN.7: DYN-D1 (938: escritorio y CLS bloquean, celular con trinquete y la meta de 936 en
# solo reporte), DYN-D2 (937) y DYN-D3 (bytes reales y optimizador de verdad), v1.114.2.
# =============================================================================
# QUÉ HACE
#   Con un backend YA arriba y sembrado (`API_UPSTREAM`), hornea el frontend con `npm run build`
#   (prebuild + postbuild, como el que se publica) apuntando al API a través de un PROXY DE PRUEBA,
#   lo sirve con `next start` detrás de OTRO proxy (el de la tienda) y corre Lighthouse CI:
#     d1         5 corridas por perfil (móvil y escritorio estándar de Lighthouse), umbrales sobre la
#                MEDIANA (`lhci-config.mjs`): escritorio FCP ≤ 1.0 s, LCP ≤ 1.5 s; CLS ≤ 0.1; celular el
#                trinquete de `mobile-ratchet.json` (o la meta de 936 si no está fijado). La meta de 936 en
#                celular sale en el resumen (solo reporte). Y DYN-D3: en las 5×2 corridas la foto líder la
#                sirve `/_next/image` con 200 `image/webp` y sin respaldo a la original (`lcp-optimized.mjs`).
#     d1-canary  lo mismo con el HTML de la portada ENGORDADO HOME_PERF_CANARY_PAD_KB (1500 KB de
#                comentario) en el proxy de la tienda: TIENE que salir rojo y con el FCP ≥ 500 ms por
#                encima del de d1. Si no, el candado no muerde ⇒ rc 1. (Engordar y no retrasar: la
#                simulación estándar de Lighthouse no ve el TTFB del documento; medido, ver delay-proxy.mjs.)
#     d2-delay   el API retrasa 5 s `/catalog/featured` y la vitrina (`sort=grading_showcase`):
#                FCP (escritorio ≤ 1.0 s; celular ≤ el FCP del trinquete, DYN-D2 v1.114.5) y CLS ≤ 0.1 en la mediana.
#     d2-503     lo mismo respondiendo 503.
#   En d2-* cada corrida arranca con la caché de datos de Next VACÍA y el servidor reiniciado: la
#   petición tardía de la corrida anterior llena la caché y la siguiente mediría el caso cacheado.
#
# POR QUÉ LOS DOS PROXIES SON DE PRUEBA Y NO DEL PRODUCTO
#   `delay-proxy.mjs` solo escucha en 127.0.0.1 y se niega a un upstream no local. La «variable
#   solo fuera de producción» del canario (§DYN.7) es HOME_PERF_CANARY_PAD_KB, que solo lee este
#   script: no hay ni una línea en frontend/ ni backend/ (lo vigila scripts/check-home-perf.sh).
#
# LAS IMÁGENES DEL SEED (DYN-D3)
#   El seed apunta el arte a `https://img.e2e.local/…` (no resuelve y no está en `remotePatterns`). El proxy
#   del API lo reescribe a `https://images.scrydex.com/e2e/…`; `seed-image-host.py` sirve la foto líder con
#   peso REAL (PNG 733×1024 ≥ 800 KB, huella fijada) por HTTPS local para el Chrome de Lighthouse (MAP de los
#   hosts de imagen) y por HTTP local para el optimizador de `next start` (`next-image-origin.cjs`, cargado
#   con NODE_OPTIONS solo aquí). Antes de medir se comprueba: peso en el origen ≥ 800 KB y
#   `/_next/image?url=<líder>&w=640&q=75` ⇒ 200 `image/webp` (si no, ROJO: p. ej. sin `sharp`).
#
# REQUISITOS (variables)
#   API_UPSTREAM        backend sembrado, p. ej. http://127.0.0.1:3099 (su APP_BASE_URL tiene que
#                       incluir http://localhost:$HP_FRONT_PORT, si no CORS lo tumba: se comprueba)
#   CHROME_PATH         Chrome/Chromium (en CI el de Playwright)
#   HP_FRONT_PORT 3190 · HP_NEXT_PORT 3192 · HP_API_PROXY_PORT 3193 · HP_IMG_PORT 3194 · HP_IMG_HTTP_PORT 3196
#   HOME_PERF_OUT       directorio de salida (por defecto <repo>/.home-perf)
#   HOME_PERF_RUNS      corridas por perfil (5; el contrato pide 5 — no lo bajes en CI)
#   HP_SKIP_BUILD=1     reutiliza frontend/.next si su sello coincide (solo para iterar en local)
# Uso:  scripts/home-perf/run.sh d1 [d1-canary d2-delay d2-503]
# rc:   0 todo como se esperaba · 1 rojo (el informe dice qué) · 2 no concluyente (no se pudo medir)
# =============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
FE="$ROOT/frontend"
API_UPSTREAM="${API_UPSTREAM:-http://127.0.0.1:3099}"; API_UPSTREAM="${API_UPSTREAM%/}"
HP_FRONT_PORT="${HP_FRONT_PORT:-3190}"; HP_NEXT_PORT="${HP_NEXT_PORT:-3192}"
HP_API_PROXY_PORT="${HP_API_PROXY_PORT:-3193}"; HP_IMG_PORT="${HP_IMG_PORT:-3194}"; HP_IMG_HTTP_PORT="${HP_IMG_HTTP_PORT:-3196}"
OUT="${HOME_PERF_OUT:-$ROOT/.home-perf}"; RUNS="${HOME_PERF_RUNS:-5}"
CANARY_KB="${HOME_PERF_CANARY_PAD_KB:-1500}"; CANARY_MIN_DELTA_MS=500
LHCI="${LHCI_BIN:-$HERE/node_modules/.bin/lhci}"
MODES=("$@"); [ "${#MODES[@]}" -gt 0 ] || MODES=(d1)
FEATURED_RE='^/api/v1/catalog/featured([?].*)?$'
SHOWCASE_RE='^/api/v1/catalog/cards[?].*sort=grading_showcase'
HOME_RE='^/es/?([?].*)?$'
# DYN-D3: el host del seed se sirve como uno de `remotePatterns` (ver «LAS IMÁGENES DEL SEED»).
IMG_FIXTURE='https://img.e2e.local/'; IMG_REMOTO='https://images.scrydex.com/e2e/'
PESO_MIN_LIDER=$((800 * 1024))

say()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
nc()   { printf '\n\033[1;33m∅ NO CONCLUYENTE: %s\033[0m\n' "$*" >&2; exit 2; }
PIDS=(); API_PROXY_PID=""; FRONT_PROXY_PID=""; NEXT_PID=""
# Apagado por PID, nunca por patrón (O-19): solo lo que este script arrancó.
limpiar() { local p; for p in "${PIDS[@]}" $API_PROXY_PID $FRONT_PROXY_PID $NEXT_PID; do kill "$p" 2>/dev/null || true; done; }
trap limpiar EXIT

for m in "${MODES[@]}"; do case "$m" in d1|d1-canary|d2-delay|d2-503|prep) ;; *) nc "modo desconocido «$m»" ;; esac; done
[ -x "$LHCI" ] || nc "falta $LHCI (cd scripts/home-perf && npm ci --ignore-scripts)"
[ -n "${CHROME_PATH:-}" ] && [ -x "$CHROME_PATH" ] || nc "CHROME_PATH no apunta a un Chrome ejecutable"
[ -d "$FE/node_modules" ] || nc "falta frontend/node_modules (cd frontend && npm ci)"
command -v openssl >/dev/null && command -v python3 >/dev/null || nc "faltan openssl o python3"
for p in "$HP_FRONT_PORT" "$HP_NEXT_PORT" "$HP_API_PROXY_PORT" "$HP_IMG_PORT" "$HP_IMG_HTTP_PORT"; do
  curl -s -m 2 -o /dev/null "http://127.0.0.1:$p/" 2>/dev/null && nc "el puerto $p ya responde: no es mío, no mido encima"
done
mkdir -p "$OUT"
SHA="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || printf '%s' "${HOME_PERF_SHA:-?}")"

# --- 0. El backend: vivo, sembrado, con CORS para la tienda y con Destacadas del día ----------
say "backend $API_UPSTREAM"
curl -sf -m 10 "$API_UPSTREAM/api/v1/health" >/dev/null || nc "el backend no responde en $API_UPSTREAM/api/v1/health"
ACAO="$(curl -s -m 10 -o /dev/null -D - -X OPTIONS "$API_UPSTREAM/api/v1/catalog/featured" \
         -H "Origin: http://localhost:$HP_FRONT_PORT" -H 'Access-Control-Request-Method: GET' | tr -d '\r' \
         | awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}')"
[ "$ACAO" = "http://localhost:$HP_FRONT_PORT" ] \
  || nc "el backend no admite el origen http://localhost:$HP_FRONT_PORT (CORS: «${ACAO:-nada}»). Arráncalo con APP_BASE_URL que lo incluya."
jcount() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.total ?? (j.data||[]).length)}catch{console.log(-1)}})'; }
featured_n() { curl -sf -m 10 "$API_UPSTREAM/api/v1/catalog/featured" | jcount; }
vitrina_n()  { curl -sf -m 10 "$API_UPSTREAM/api/v1/catalog/cards?sort=grading_showcase&gradingHighlight=true&pageSize=8" | jcount; }
# El súper-admin del FIXTURE (no es un secreto: es el usuario de un stack sintético; se lee de su
# única fuente, como price-provider-parity.sh). Solo se usa contra el backend LOCAL de este arnés.
ADM_SESION=""
admin_token() {
  [ -z "$ADM_SESION" ] || return 0
  local fix="$ROOT/backend/prisma/e2e-fixtures.ts" mail pass
  mail="$(sed -n "s/.*admin: *{ *email: *'\([^']*\)'.*/\1/p" "$fix" | head -1)"
  pass="$(sed -n "s/.*admin: *{ *email: *'[^']*' *, *password: *'\([^']*\)'.*/\1/p" "$fix" | head -1)"
  [ -n "$mail" ] && [ -n "$pass" ] || nc "no pude leer el súper-admin de $fix"
  ADM_SESION="$(curl -s -m 20 -X POST "$API_UPSTREAM/api/v1/auth/login" -H 'Content-Type: application/json' \
            -d "{\"email\":\"$mail\",\"password\":\"$pass\"}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).accessToken||"")}catch{}})')"
  [ -n "$ADM_SESION" ] || nc "el login del súper-admin del fixture no dio token (¿se sembró?)"
}
case "$API_UPSTREAM" in http://127.0.0.1:*|http://localhost:*) ;; *) nc "API_UPSTREAM tiene que ser el backend LOCAL del arnés" ;; esac
N_FEAT="$(featured_n)"
if [ "${N_FEAT:-0}" -le 0 ] || [ "${HP_FORCE_ROTATION:-0}" = 1 ]; then
  # El seed no escribe la selección del día (el tic de 15 min aún no corrió): se fuerza por la ruta
  # documentada (§DYN.2.4, super_admin, auditada).
  say "Destacadas del día: $N_FEAT ⇒ se fuerza la rotación como súper-admin del fixture"
  admin_token
  curl -sf -m 60 -X POST "$API_UPSTREAM/api/v1/admin/jobs/featured-rotation" -H "Authorization: Bearer $ADM_SESION" \
       -H 'Content-Type: application/json' -d '{"force":true}' >/dev/null || nc "POST /admin/jobs/featured-rotation {force:true} falló"
  N_FEAT="$(featured_n)"
  [ "${N_FEAT:-0}" -gt 0 ] || nc "BLOQUEANTE de semilla: tras forzar la rotación /catalog/featured sigue vacío. Sin Destacadas no se mide la portada real (rol backend: el seed sintético no deja elegibles)."
fi
say "Destacadas del día: $N_FEAT tejas"
# La vitrina «Joyas para gradear» solo existe con el dial del gancho `on` (seed `off`) y elegibles.
# Sin ella, DYN-D2 no mediría lo que pregunta (¿su llegada tardía suma CLS?). HP_GRADING_HOOK_ON=1 la
# enciende con `PUT /admin/settings` — SOLO donde el backend NO tiene llave del proveedor de paga
# (home-perf.yml declara vacía la llave del proveedor; §4.38(r.6.1)): con el dial `on` y llave, gasta.
if [ "${HP_GRADING_HOOK_ON:-0}" = 1 ]; then
  admin_token
  curl -sf -m 20 -X PUT "$API_UPSTREAM/api/v1/admin/settings" -H "Authorization: Bearer $ADM_SESION" \
       -H 'Content-Type: application/json' -d '{"gradingHookEnabled":"on"}' >/dev/null || nc "no pude encender el dial del gancho"
fi
N_VIT="$(vitrina_n)"
say "vitrina «Joyas para gradear»: $N_VIT elegible(s)"
case " ${MODES[*]} " in *" d2-"*)
  [ "${N_VIT:-0}" -gt 0 ] || nc "la vitrina no tiene elegibles (¿HP_GRADING_HOOK_ON=1?): DYN-D2 no mediría su llegada tardía." ;;
esac
# `prep`: solo el paso 0 (backend, CORS, Destacadas). Con HP_FORCE_ROTATION=1 prueba la ruta de forzado.
[ "${MODES[*]}" != prep ] || exit 0

# --- 1. Imágenes del seed (HTTPS local) ---------------------------------------------------------
# Certificado efímero FUERA de $OUT (que se sube como artefacto) y borrado al salir.
CERT_DIR="$(mktemp -d -t hp-cert-XXXXXX)"; trap 'limpiar; rm -rf "$CERT_DIR"' EXIT
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj '/CN=img.e2e.local' \
  -keyout "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem" >/dev/null 2>&1 || nc "openssl no generó el certificado"
python3 -I "$HERE/seed-image-host.py" "$HP_IMG_PORT" "$CERT_DIR/cert.pem" "$CERT_DIR/key.pem" "$HP_IMG_HTTP_PORT" >"$OUT/img.log" 2>&1 & PIDS+=($!)
for _ in $(seq 1 100); do curl -s -m 1 -o /dev/null "http://127.0.0.1:$HP_IMG_HTTP_PORT/x.png" 2>/dev/null && break; sleep 0.1; done
PESO_ORIGEN="$(curl -s -m 10 -o /dev/null -w '%{size_download}' "http://127.0.0.1:$HP_IMG_HTTP_PORT/e2e/peso_hires.png" 2>/dev/null)"
[ "${PESO_ORIGEN:-0}" -ge "$PESO_MIN_LIDER" ] \
  || nc "la foto líder del origen pesa ${PESO_ORIGEN:-0} B (< $PESO_MIN_LIDER): no es la de peso real (log $OUT/img.log)"

# --- 2. Proxies y servidor -----------------------------------------------------------------------
esperar_puerto() {  # $1 puerto  $2 up|down
  local _
  for _ in $(seq 1 100); do
    if curl -s -m 1 -o /dev/null "http://127.0.0.1:$1/" 2>/dev/null; then [ "$2" = up ] && return 0
    else [ "$2" = down ] && return 0; fi
    sleep 0.1
  done
  return 1
}
parar() {  # $1 pid  $2 puerto
  [ -n "${1:-}" ] || return 0
  kill "$1" 2>/dev/null; wait "$1" 2>/dev/null
  esperar_puerto "$2" down || nc "el pid $1 no soltó :$2"
}
proxies() {  # $1 modo — fija API_PROXY_PID y FRONT_PROXY_PID (procesos hijos de ESTE shell)
  parar "$API_PROXY_PID" "$HP_API_PROXY_PORT"; parar "$FRONT_PROXY_PID" "$HP_FRONT_PORT"
  local api_rules=() front_rules=()
  case "$1" in
    d1-canary) front_rules=(--rule "$HOME_RE=pad:$CANARY_KB") ;;
    d2-delay)  api_rules=(--rule "$FEATURED_RE=delay:5000" --rule "$SHOWCASE_RE=delay:5000") ;;
    d2-503)    api_rules=(--rule "$FEATURED_RE=503" --rule "$SHOWCASE_RE=503") ;;
  esac
  node "$HERE/delay-proxy.mjs" --listen "$HP_API_PROXY_PORT" --upstream "$API_UPSTREAM" \
       --replace "$IMG_FIXTURE" --with "$IMG_REMOTO" \
       --log "$OUT/proxy-api-$1.log" "${api_rules[@]}" >/dev/null 2>&1 &
  API_PROXY_PID=$!
  node "$HERE/delay-proxy.mjs" --listen "$HP_FRONT_PORT" --upstream "http://127.0.0.1:$HP_NEXT_PORT" \
       --log "$OUT/proxy-tienda-$1.log" "${front_rules[@]}" >/dev/null 2>&1 &
  FRONT_PROXY_PID=$!
  esperar_puerto "$HP_API_PROXY_PORT" up && esperar_puerto "$HP_FRONT_PORT" up || nc "los proxies no arrancaron"
}
next_up() {
  parar "$NEXT_PID" "$HP_NEXT_PORT"
  # `exec node …/next start`: el pid es el del servidor (que se renombra a next-server); con
  # `npx` delante el pid sería el del npx y matarlo dejaba el servidor vivo (§32.10).
  # NODE_OPTIONS solo aquí: el optimizador baja la líder del origen LOCAL (next-image-origin.cjs, DYN-D3).
  ( cd "$FE" && exec env NODE_ENV=production NODE_OPTIONS="--require $HERE/next-image-origin.cjs" \
      HOME_PERF_IMG_ORIGIN="http://127.0.0.1:$HP_IMG_HTTP_PORT" HOME_PERF_IMG_LOG="$OUT/optimizador-origen.log" \
      node node_modules/next/dist/bin/next start -p "$HP_NEXT_PORT" ) >>"$OUT/next.log" 2>&1 &
  NEXT_PID=$!
  local _
  for _ in $(seq 1 120); do curl -sf -m 5 -o /dev/null "http://127.0.0.1:$HP_NEXT_PORT/es" 2>/dev/null && return 0; sleep 0.5; done
  nc "next start no respondió en :$HP_NEXT_PORT (log $OUT/next.log)"
}

BUILD_STAMP="$FE/.next/HOME_PERF_BUILD"
WANT_STAMP="api=http://localhost:$HP_API_PROXY_PORT/api/v1 sha=$SHA"
if [ "${HP_SKIP_BUILD:-0}" = 1 ] && [ "$(cat "$BUILD_STAMP" 2>/dev/null)" = "$WANT_STAMP" ]; then
  say "build reutilizado ($WANT_STAMP)"
else
  say "npm run build (API vía proxy :$HP_API_PROXY_PORT, mocks=false, medición off)"
  ( cd "$FE" && env NODE_ENV=production NEXT_PUBLIC_USE_MOCKS=false \
      NEXT_PUBLIC_API_BASE_URL="http://localhost:$HP_API_PROXY_PORT/api/v1" \
      NEXT_PUBLIC_MEASUREMENT_MODE=off NEXT_PUBLIC_GA4_MEASUREMENT_ID= NEXT_PUBLIC_META_PIXEL_ID= \
      npm run build ) >"$OUT/build.log" 2>&1 || { tail -n 40 "$OUT/build.log"; nc "npm run build falló (log $OUT/build.log; si es código, rol frontend)"; }
  grep -q 'HOME_BUNDLE_OK' "$OUT/build.log" || nc "el build no pasó por el postbuild (HOME_BUNDLE_OK ausente)"
  printf '%s' "$WANT_STAMP" > "$BUILD_STAMP"
fi

# --- 3. Lighthouse -------------------------------------------------------------------------------
config() {  # $1 perfil (mobile|desktop)  $2 tipo (d1|d2)  $3 fichero — umbrales: lhci-config.mjs
  node "$HERE/lhci-config.mjs" "$1" "$2" "$CHROME_PATH" "$HP_IMG_PORT" > "$3" || nc "lhci-config.mjs falló"
}
URL="http://localhost:$HP_FRONT_PORT/es"
RESUMEN="$OUT/RESUMEN.md"
MODO_CEL="$(node "$HERE/lhci-config.mjs" --modo-celular)" || nc "lhci-config.mjs --modo-celular falló"
# DYN-D3, antes de Lighthouse: la líder (la de /catalog/featured tal como la ve la tienda) por el optimizador.
OPTIMIZADOR=""
optimizador() {
  local lider enc hdr code ctype
  lider="$(curl -sf -m 10 "http://127.0.0.1:$HP_API_PROXY_PORT/api/v1/catalog/featured" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const c=(JSON.parse(s).data||[])[0].card;process.stdout.write(c.imageLargeUrl||c.imageSmallUrl||"")}catch{}})')"
  case "$lider" in "$IMG_REMOTO"*) ;; *) nc "la líder del API no sale reescrita a $IMG_REMOTO («${lider:-nada}»): el arnés no mide el optimizador" ;; esac
  enc="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$lider")"
  hdr="$(curl -s -m 30 -o "$OUT/optimizador-lider.bin" -D - -H 'Accept: image/avif,image/webp,*/*' \
         "http://localhost:$HP_FRONT_PORT/_next/image?url=$enc&w=640&q=75" | tr -d '\r')"
  code="$(printf '%s\n' "$hdr" | awk 'NR==1{print $2}')"
  ctype="$(printf '%s\n' "$hdr" | awk -F': ' 'tolower($1)=="content-type"{print $2}')"
  if [ "$code" = 200 ] && [ "$ctype" = image/webp ]; then
    OPTIMIZADOR="sí: líder $(wc -c <"$OUT/optimizador-lider.bin" | tr -d ' ') B en WebP 640 desde ${PESO_ORIGEN} B en el origen"
  else
    OPTIMIZADOR="NO: /_next/image de la líder ⇒ ${code:-sin respuesta} ${ctype:-}"; RC=1
  fi
  say "optimizador: $OPTIMIZADOR"
}
{ echo "# Portada — Lighthouse CI (§DYN.7)"; echo; echo "sha \`$SHA\` · $(date -u '+%Y-%m-%d %H:%M UTC') · carga $(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null) · $(nproc 2>/dev/null) CPU · N=$RUNS por perfil · URL $URL · Destacadas $N_FEAT tejas · vitrina $N_VIT elegible(s)"; echo
  echo "Celular bloquea con: \`$MODO_CEL\` (\`mobile-ratchet.json\`; \`meta\` = trinquete sin fijar). Foto líder en el origen: $PESO_ORIGEN B."; echo
  echo "| modo | perfil | FCP mediana / peor | LCP mediana / peor | CLS mediana / peor | N | assert |"; echo "|---|---|---|---|---|---|---|"; } > "$RESUMEN"
RC=0
# Caché del optimizador VACÍA: si no, una WebP de una tanda anterior (minimumCacheTTL de 30 días) ocultaría un
# optimizador roto en esta (medido 2026-10-30: sin `sharp` y con la caché llena, la comprobación salía «sí»).
rm -rf "$FE/.next/cache/images"
next_up
proxies d1; optimizador
for modo in "${MODES[@]}"; do
  proxies "$modo"
  tipo=d1; case "$modo" in d2-*) tipo=d2 ;; esac
  for perfil in mobile desktop; do
    dir="$OUT/$modo-$perfil"; rm -rf "$dir"; mkdir -p "$dir"; config "$perfil" "$tipo" "$dir/lighthouserc.json"
    say "$modo · $perfil · $RUNS corridas"
    for i in $(seq 1 "$RUNS"); do
      if [ "$tipo" = d2 ]; then rm -rf "$FE/.next/cache/fetch-cache"; next_up; fi
      add=(); [ "$i" = 1 ] || add=(--additive)
      ( cd "$dir" && "$LHCI" collect --config=./lighthouserc.json --url="$URL" --numberOfRuns=1 "${add[@]}" ) >>"$dir/collect.log" 2>&1 \
        || { tail -n 20 "$dir/collect.log"; nc "lhci collect falló ($modo/$perfil, corrida $i)"; }
    done
    ( cd "$dir" && "$LHCI" assert --config=./lighthouserc.json ) >"$dir/assert.log" 2>&1; arc=$?
    fila="$(node "$HERE/summarize.mjs" "$dir/.lighthouseci")" || nc "no pude leer los informes de $dir"
    case "$modo" in
      d1-canary)
        # Rojo del assert NO basta si la línea base ya era roja (un rojo de d1 haría «morder» a
        # cualquier canario). Se exige además que el instrumento VEA el retraso: la mediana de FCP
        # del canario supera a la de d1 (misma corrida, mismo perfil) en ≥ CANARY_MIN_DELTA_MS.
        delta=""
        if [ -f "$OUT/d1-$perfil/medianas.json" ]; then
          delta="$(node -e 'const a=require(process.argv[1]),b=require(process.argv[2]);process.stdout.write(String(Math.round(b.fcp-a.fcp)))' \
                    "$OUT/d1-$perfil/medianas.json" "$dir/medianas.json")"
        fi
        if [ "$arc" = 0 ]; then v="VERDE — el canario NO muerde"; RC=1
        elif [ -n "$delta" ] && [ "$delta" -lt "$CANARY_MIN_DELTA_MS" ]; then v="ROJO pero sin ver el retraso (ΔFCP ${delta} ms < $CANARY_MIN_DELTA_MS) — canario ciego"; RC=1
        else v="ROJO (esperado: el canario muerde${delta:+; ΔFCP +${delta} ms})"; fi ;;
      *)         [ "$arc" = 0 ] && v="verde" || { v="ROJO"; RC=1; } ;;
    esac
    if [ "$modo" = d1 ]; then
      # DYN-D3: la líder por el optimizador en TODAS las corridas (k/N). Caer al respaldo es rojo.
      lo="$(node "$HERE/lcp-optimized.mjs" "$dir/.lighthouseci")"; lrc=$?
      printf '%s\n' "$lo" > "$dir/optimizador.txt"
      if [ "$lrc" = 0 ]; then v="$v · líder por /_next/image $(head -n1 <<<"$lo")"
      else v="$v · **líder SIN optimizador $(head -n1 <<<"$lo")** (DYN-D3)"; RC=1; fi
    fi
    if [ "$modo" = d1 ] && [ "$perfil" = mobile ]; then
      # Meta de 936 en celular: SOLO REPORTE mientras haya trinquete (DYN-D1, decisión del dueño 2026-10-30).
      META_CEL="$(node -e 'const m=require(process.argv[1]);const ok=m.fcp<=1000&&m.lcp<=2500;process.stdout.write(`${ok?"CUMPLIDA":"NO CUMPLIDA, decisión del dueño 2026-10-30"} — FCP ${(m.fcp/1000).toFixed(2)} s (meta 1.0) · LCP ${(m.lcp/1000).toFixed(2)} s (meta 2.5), mediana N=${m.n}`)' "$dir/medianas.json")"
    fi
    # Qué métricas fallaron (para d2: ¿es el FCP o es el CLS de la vitrina?).
    falla="$(node -e 'try{const r=require(process.argv[1]);const f=[...new Set(r.filter(x=>!x.passed).map(x=>x.auditId))];process.stdout.write(f.join(","))}catch{}' \
              "$dir/.lighthouseci/assertion-results.json" 2>/dev/null)"
    [ -z "$falla" ] || v="$v · falla: $falla"
    echo "| $modo | $perfil | $fila | $v |" >> "$RESUMEN"
    [ "$arc" = 0 ] || sed -n '1,40p' "$dir/assert.log" | grep -E 'failure|expected|found|✘|×' | head -n 6 | sed "s/^/    [$modo\/$perfil] /"
  done
done
{ echo
  echo "**Optimizador (DYN-D3):** ${OPTIMIZADOR:-no se comprobó}."
  case "$MODO_CEL" in
    trinquete*) echo "**Meta de 936 en celular (solo reporte, caduca 2026-12-31, candado \`home-perf-mobile-goal-expiry\`):** ${META_CEL:-sin d1 en esta tanda}." ;;
    *)          echo "**Celular:** trinquete SIN FIJAR ⇒ bloquea la meta de 936 (${META_CEL:-sin d1 en esta tanda}). Se fija con \`fix-ratchet.mjs\` tras medir A + c1." ;;
  esac
  echo; echo "Proxies: \`$OUT/proxy-*.log\` (qué se retrasó o tumbó). Optimizador → origen: \`$OUT/optimizador-origen.log\`. Informes Lighthouse: \`$OUT/<modo>-<perfil>/.lighthouseci/lhr-*.json\` (el artefacto los incluye: \`include-hidden-files\`)."; } >> "$RESUMEN"
cat "$RESUMEN"
exit "$RC"

#!/usr/bin/env bash
#
# sast-gitleaks-measurement-canary.sh — C-D2 (API_CONTRACT §MKT.H.11): ¿el escáner de secretos
# MUERDE con un token de Meta CAPI y con un `api_secret` de GA4 MP, y deja pasar las referencias? · devops
# =============================================================================
# Con el MISMO binario y la MISMA config que el job `gitleaks` de security-sast.yml (las reglas
# `meta-graph-access-token`, `meta-capi-token-assignment` y `ga4-mp-api-secret` de
# security/gitleaks.toml). Todo valor es FICCIÓN con la forma real, construido por concatenación
# para que este fichero no lo lleve escrito de una pieza (el escáner también lo lee).
#
#   ROJO   · token `EAA…` de 180 caracteres en backend/src (forma de usuario de sistema, prefijo que
#            la regla por defecto NO mira: `EAAG`);
#          · el mismo token como `META_CAPI_TOKEN=…` en un .sh de scripts/;
#          · `META_CAPI_TOKEN: "…"` sin prefijo EAA (cualquier valor de 20+ con entropía);
#          · `GA4_MP_API_SECRET=…` (22 aleatorios);
#          · la URL de Measurement Protocol con `&api_secret=…` en un log de docs/;
#          · `api_secret: '…'` en un .ts;
#          · modo `git` (el de CI): un commit con el token ⇒ rojo.
#   VERDE  · `META_CAPI_TOKEN=` y `GA4_MP_API_SECRET=` vacíos; `${META_CAPI_TOKEN:-}`;
#            `process.env.META_CAPI_TOKEN`; `{ api_secret: apiSecret }`; `api_secret=${GA4_MP_API_SECRET}`;
#            `searchParams.set('api_secret', secret)`; base64 de ceros que empieza por `EAAAAAAA…`;
#            placeholders auto-delatores (`CHANGE_ME…`).
# Uso:  ./security/scripts/sast-gitleaks-measurement-canary.sh [N]
#       GITLEAKS_BIN=/ruta/gitleaks …
# Sale 0 si todos los casos salen como deben (N rondas); 1 con el caso exacto; 127 sin binario
# (NO es verde: el canario no pudo medir).
# =============================================================================
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEC_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG="${GITLEAKS_CONFIG:-$SEC_DIR/gitleaks.toml}"
GL="${GITLEAKS_BIN:-gitleaks}"
N="${1:-1}"
command -v "$GL" >/dev/null 2>&1 || { echo "✗ gitleaks no está en PATH (GITLEAKS_BIN=…). El canario NO puede medir: eso no es verde."; exit 127; }
[ -f "$CONFIG" ] || { echo "✗ falta $CONFIG"; exit 1; }
for r in meta-graph-access-token meta-capi-token-assignment ga4-mp-api-secret; do
  grep -q "id = \"$r\"" "$CONFIG" || { echo "✗ la config no tiene la regla $r (C-D2): no hay nada que probar."; exit 1; }
done

FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }
BASE="$(mktemp -d -t gl-mkt-canario-XXXXXX)"; trap '[ -n "${KEEP_CANARIO:-}" ] || rm -rf "$BASE"' EXIT

# Ficción con forma real: 3 + 177 base62 mezclados (los tokens de usuario de sistema rondan 180-250).
CUERPO="$(printf 'GZBx7Qk2Lm9Np4Rt8Vw3Hy6Jd1Fc5Ss0Ae')"
FAKE_META="EAA${CUERPO}${CUERPO}${CUERPO}${CUERPO}${CUERPO}ZQ7kP"
FAKE_META_SIN_PREFIJO="$(printf 'mQ4vT9xK2pL7wR3nB8cJ5hF1')"
FAKE_GA4="$(printf 'Xr4_Kp9-Lm2Qv7Tz3Wn8Bc')"
CEROS_B64="EAA$(printf 'A%.0s' $(seq 1 120))"

arbol() { local d; d="$(mktemp -d "$BASE/t-XXXXXX")"; mkdir -p "$d/backend/src" "$d/scripts" "$d/docs"; echo 'export const ok = 1;' > "$d/backend/src/ok.ts"; echo "$d"; }
escanear() { # <dir> <dir|git>
  ( cd "$1" && "$GL" "$2" . --config "$CONFIG" --no-banner --exit-code 1 --report-format json --report-path "$1/.report.json" >"$1/.log" 2>&1 )
}
caso() { # ROJO|VERDE dir|git <nombre> <dir> [regla esperada]
  local esperado="$1" modo="$2" nombre="$3" d="$4" regla="${5:-}" rc reglas
  escanear "$d" "$modo"; rc=$?
  reglas="$(jq -r '[.[].RuleID] | unique | join(",")' "$d/.report.json" 2>/dev/null)"
  if [ "$esperado" = ROJO ]; then
    [ "$rc" -eq 1 ] || { bad "$nombre — rc=$rc (esperaba hallazgo, rc=1). $(tail -1 "$d/.log")"; return; }
    if [ -n "$regla" ] && [[ ",$reglas," != *",$regla,"* ]]; then bad "$nombre — rojo, pero no por $regla (reglas: $reglas)"; return; fi
    ok "$nombre — ROJO ($reglas)"
  else
    [ "$rc" -eq 0 ] || { bad "$nombre — rc=$rc sobre algo legítimo (reglas: $reglas)"; return; }
    ok "$nombre — VERDE"
  fi
}

for ((r=1;r<=N;r++)); do
  printf '\n\033[1m== C-D2 · gitleaks y los secretos de medición — ronda %s/%s ==\033[0m\n' "$r" "$N"
  d="$(arbol)"; caso VERDE dir "árbol limpio" "$d"
  d="$(arbol)"; printf '%s\n' "const token = '$FAKE_META';" > "$d/backend/src/capi.ts"
  caso ROJO dir "token EAAG… de 180 en backend/src" "$d" meta-graph-access-token
  d="$(arbol)"; printf '%s\n' "META_CAPI_TOKEN=$FAKE_META" > "$d/scripts/arranque.sh"
  caso ROJO dir "META_CAPI_TOKEN=<token> en scripts/" "$d"
  d="$(arbol)"; printf '%s\n' "META_CAPI_TOKEN: \"$FAKE_META_SIN_PREFIJO\"" > "$d/scripts/compose-extra.yml"
  caso ROJO dir "META_CAPI_TOKEN: \"…\" sin prefijo EAA" "$d" meta-capi-token-assignment
  d="$(arbol)"; printf '%s\n' "GA4_MP_API_SECRET=$FAKE_GA4" > "$d/scripts/arranque.sh"
  caso ROJO dir "GA4_MP_API_SECRET=<22 aleatorios>" "$d" ga4-mp-api-secret
  d="$(arbol)"; printf '%s\n' "POST https://www.google-analytics.com/mp/collect?measurement_id=G-ABCD1234&api_secret=$FAKE_GA4 -> 204" > "$d/docs/log-envio.md"
  caso ROJO dir "URL de MP con &api_secret= en un .md de docs/" "$d" ga4-mp-api-secret
  d="$(arbol)"; printf '%s\n' "const body = { api_secret: '$FAKE_GA4' };" > "$d/backend/src/mp.ts"
  caso ROJO dir "api_secret: '…' en un .ts" "$d" ga4-mp-api-secret
  d="$(arbol)"
  # Los vacíos van en ficheros separados a propósito: dos `VAR=` vacíos en líneas seguidas los junta la
  # regla POR DEFECTO `generic-api-key` (no una de C-D2: medido, toma `GA4_MP_API_SECRET=` como valor del
  # `META_CAPI_TOKEN=` de arriba). En el repo esa forma solo existe en `.env.example`, exento por ruta.
  echo 'META_CAPI_TOKEN=' > "$d/scripts/vacio-meta.sh"
  echo 'GA4_MP_API_SECRET=' > "$d/scripts/vacio-ga4.sh"
  {
    echo 'META_CAPI_TOKEN: ${META_CAPI_TOKEN:-}'
    echo 'GA4_MP_API_SECRET: "${GA4_MP_API_SECRET:-}"'
    echo 'META_CAPI_TOKEN=CHANGE_ME_meta_capi_token_placeholder'
  } > "$d/scripts/referencias.sh"
  {
    echo 'const t = process.env.META_CAPI_TOKEN;'
    echo 'const q = { api_secret: apiSecret };'
    echo 'const u = `https://www.google-analytics.com/mp/collect?api_secret=${GA4_MP_API_SECRET}`;'
    echo "url.searchParams.set('api_secret', secret);"
    echo "const png = '$CEROS_B64';"
  } > "$d/backend/src/referencias.ts"
  caso VERDE dir "referencias, vacíos, placeholders y base64 de ceros" "$d"
  # Modo git (el de CI escanea el rango del push).
  d="$(arbol)"; printf '%s\n' "const token = '$FAKE_META';" > "$d/backend/src/capi.ts"
  ( cd "$d" && git init -q . && git -c user.email=c@c -c user.name=c add -A && git -c user.email=c@c -c user.name=c commit -qm token ) >/dev/null 2>&1
  caso ROJO git "modo git: commit con el token de Meta" "$d" meta-graph-access-token
done

printf '\n'
if [ "$FALLOS" -gt 0 ]; then printf '\033[1;31mROJO: %s/%s casos fallaron.\033[0m\n' "$FALLOS" "$((FALLOS+PASADAS))"; exit 1; fi
printf '\033[1;32mVERDE: %s/%s casos (N=%s rondas): C-D2 muerde con Meta CAPI y GA4 MP y no ladra a las referencias.\033[0m\n' "$PASADAS" "$PASADAS" "$N"

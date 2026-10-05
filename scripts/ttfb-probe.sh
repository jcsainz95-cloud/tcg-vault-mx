#!/usr/bin/env bash
#
# ttfb-probe.sh — TTFB de la tienda publicada, antes/después del nonce de la CSP
#                                                                        · devops
# =============================================================================
# NORMA: API_CONTRACT §14.14 E-8 (v1.84.1) y §14.3 «Coste a medir antes de
# `enforce`»; porqué en ARCHITECTURE §4.63.11. DEVOPS_NOTES §85.10.
#
# QUÉ HACE (solo GET, solo https, una ruta pública; 11 peticiones por corrida)
#   1. 1 GET de CALENTAMIENTO a --url, descartado (no entra en la estadística).
#   2. N = 10 GET SECUENCIALES (`--n`), cada uno con `curl -w %{time_starttransfer}`
#      y SIN seguir redirecciones (el TTFB de un 30x no es el de la página).
#   3. p50 y p90 en ms por RANGO MÁS CERCANO sobre las N muestras ordenadas:
#      p = muestra[ceil(q·N)] (N=10 ⇒ p50 = 5.ª, p90 = 9.ª). Sin interpolar.
#   4. ETIQUETA por las cabeceras servidas: `despues` si alguna
#      `content-security-policy*` lleva `'nonce-`; `antes` si ninguna. Las 11
#      respuestas tienen que dar la MISMA etiqueta (si no, hubo un despliegue a
#      mitad de la corrida ⇒ muestra mezclada, rc 1).
#   5. CSP_CABECERAS = cuántas `content-security-policy` + `-report-only` salen
#      en la respuesta (cierra E-6 en Vercel: ¿la del middleware SUSTITUYE a la
#      estática de next.config.mjs o salen las dos?). E6_FRAME_ANCESTORS = si
#      alguna APLICADA (no -Report-Only) trae `frame-ancestors 'none'`.
#   6. UMBRAL (§14.3), solo con ETIQUETA=despues: p90 > --umbral-p90 (800 ms) o
#      p90 − --antes-p90 > --umbral-subida (300 ms) ⇒ ROJO. Sin --antes-p90 la
#      subida NO se compara y se DICE.
#
# VEREDICTO
#   rc 0 · medición válida, sin alarma
#   rc 3 · medición válida CON alarma: UMBRAL=ROJO o E6_FRAME_ANCESTORS=no
#   rc 1 · muestra INVÁLIDA (no-200, redirección, conexión fallida, timeout,
#          etiqueta mezclada): NO se imprime p50/p90 — nunca una cifra de algo
#          que no fue la página
#   rc 2 · no concluyente: argumentos mal, sin curl, URL no https
#
# Uso:
#   ./scripts/ttfb-probe.sh [--url https://tcghunt.mx/es] [--n 10] [--timeout 20]
#       [--antes-p90 MS] [--umbral-p90 800] [--umbral-subida 300]
#   --allow-local  (SOLO el canario: admite http://127.0.0.1:<p>)
# =============================================================================
set -uo pipefail

URL="https://tcghunt.mx/es"; N=10; TIMEOUT=20; ANTES_P90=""; U_P90=800; U_SUB=300; ALLOW_LOCAL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="${2:-}"; shift 2 ;;
    --n) N="${2:-}"; shift 2 ;;
    --timeout) TIMEOUT="${2:-}"; shift 2 ;;
    --antes-p90) ANTES_P90="${2:-}"; shift 2 ;;
    --umbral-p90) U_P90="${2:-}"; shift 2 ;;
    --umbral-subida) U_SUB="${2:-}"; shift 2 ;;
    --allow-local) ALLOW_LOCAL=1; shift ;;
    -h|--help) sed -n '1,45p' "$0"; exit 0 ;;
    *) echo "::error::opción desconocida '$1'"; echo "VERDICT=NO_CONCLUYENTE"; exit 2 ;;
  esac
done

nc() { echo "::error::$*"; echo "VERDICT=NO_CONCLUYENTE"; exit 2; }
command -v curl >/dev/null 2>&1 || nc "sin curl no puedo medir."
for n in "$N" "$TIMEOUT" "$U_P90" "$U_SUB" ${ANTES_P90:+"$ANTES_P90"}; do
  case "$n" in ''|*[!0-9]*) nc "--n/--timeout/--antes-p90/--umbral-* deben ser enteros (llegó '$n')." ;; esac
done
[ "$N" -ge 1 ] || nc "--n ≥ 1."
case "$URL" in
  https://*) ;;
  http://127.0.0.1:*) [ "$ALLOW_LOCAL" -eq 1 ] || nc "'$URL' no es https (solo el canario usa --allow-local)." ;;
  *) nc "'$URL' no es https." ;;
esac

TMPD="$(mktemp -d -t ttfb-XXXXXX)"; trap 'rm -rf "$TMPD"' EXIT
invalida() { echo "  ✗ $*"; echo "VERDICT=MUESTRA_INVALIDA"; exit 1; }

# una_peticion <i> — deja cabeceras en $TMPD/h<i>, imprime «código ttfb_s»
una_peticion() {
  curl -sS -o /dev/null -D "$TMPD/h$1" --max-time "$TIMEOUT" --proto '=https,http' \
    -H 'accept: text/html' -A 'tcghunt-ttfb-probe/1 (+DEVOPS_NOTES §85.10)' \
    -w '%{http_code} %{time_starttransfer}' "$URL" 2>"$TMPD/e$1"
}

# etiqueta_de <fichero de cabeceras> — imprime antes|despues
etiqueta_de() {
  if grep -iE '^content-security-policy(-report-only)?:' "$1" | grep -q "'nonce-"; then echo despues; else echo antes; fi
}

echo "URL=$URL"
echo "N=$N (+1 de calentamiento descartado)"
MUESTRAS=""; ETQ=""
for i in $(seq 0 "$N"); do
  R="$(una_peticion "$i")"; RC=$?
  COD="${R%% *}"; T="${R#* }"
  [ "$RC" -eq 0 ] || invalida "petición $i: curl rc $RC ($(tr '\n' ' ' < "$TMPD/e$i" | cut -c1-160))"
  case "$COD" in
    200) ;;
    30[0-9]) invalida "petición $i: HTTP $COD hacia '$(grep -i '^location:' "$TMPD/h$i" | head -1 | cut -d' ' -f2- | tr -d '\r')' — el TTFB de una redirección no es el de la página; ajusta TTFB_URL" ;;
    *) invalida "petición $i: HTTP $COD" ;;
  esac
  E="$(etiqueta_de "$TMPD/h$i")"
  if [ -z "$ETQ" ]; then ETQ="$E"; elif [ "$E" != "$ETQ" ]; then
    invalida "etiqueta mezclada: la petición 0 dio '$ETQ' y la $i dio '$E' (¿despliegue a mitad de la corrida?) — repetir"
  fi
  MS="$(awk -v t="$T" 'BEGIN{printf "%d", t*1000 + 0.5}')"
  if [ "$i" -eq 0 ]; then echo "  · calentamiento: ${MS} ms (descartado)"; else MUESTRAS="$MUESTRAS $MS"; fi
done

ORD="$(printf '%s\n' $MUESTRAS | sort -n | tr '\n' ' ')"
pct() { printf '%s\n' $ORD | awk -v q="$1" -v n="$N" 'BEGIN{k=q*n; r=int(k); if (r<k) r++; if (r<1) r=1} NR==r{print; exit}'; }
P50="$(pct 0.5)"; P90="$(pct 0.9)"

# Cabeceras CSP de la última respuesta (todas dieron la misma etiqueta).
H="$TMPD/h$N"
CSP_A="$(grep -icE '^content-security-policy:' "$H")"
CSP_RO="$(grep -icE '^content-security-policy-report-only:' "$H")"
if grep -iE '^content-security-policy:' "$H" | grep -qi "frame-ancestors 'none'"; then FA=si; else FA=no; fi
CACHE="$(grep -iE '^x-vercel-cache:' "$H" | head -1 | cut -d: -f2- | tr -d ' \r')"

echo "MUESTRAS_MS=$(echo $MUESTRAS)"
echo "P50_MS=$P50"
echo "P90_MS=$P90"
echo "ETIQUETA=$ETQ"
echo "CSP_CABECERAS=$((CSP_A + CSP_RO)) (aplicadas=$CSP_A report_only=$CSP_RO)"
echo "E6_FRAME_ANCESTORS=$FA"
echo "X_VERCEL_CACHE=${CACHE:-(ausente)}"

ALARMA=0
[ "$FA" = si ] || { echo "  ✗ ninguna CSP APLICADA trae frame-ancestors 'none' (invariante E-6, API_CONTRACT §14.3)"; ALARMA=1; }
if [ "$ETQ" = antes ]; then
  echo "UMBRAL=no aplica (muestra antes)"
else
  U="VERDE"; WHY="p90 $P90 ≤ $U_P90"
  [ "$P90" -gt "$U_P90" ] && { U="ROJO"; WHY="p90 $P90 > $U_P90 ms"; }
  if [ -z "$ANTES_P90" ]; then
    WHY="$WHY; subida NO comparada (sin p90 de antes)"
  else
    SUB=$((P90 - ANTES_P90))
    if [ "$SUB" -gt "$U_SUB" ]; then U="ROJO"; WHY="$WHY; subida $SUB > $U_SUB ms (antes p90 $ANTES_P90)"
    else WHY="$WHY; subida $SUB ≤ $U_SUB ms (antes p90 $ANTES_P90)"; fi
  fi
  echo "UMBRAL=$U ($WHY)"
  [ "$U" = ROJO ] && ALARMA=1
fi
if [ "$ALARMA" -eq 1 ]; then echo "VERDICT=ALARMA"; exit 3; fi
echo "VERDICT=OK"; exit 0

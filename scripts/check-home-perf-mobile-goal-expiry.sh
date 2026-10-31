#!/usr/bin/env bash
# =============================================================================
# check-home-perf-mobile-goal-expiry.sh — ⏳ «la meta de 936 en celular en SOLO REPORTE tiene fecha» · devops
# API_CONTRACT §DYN.7 DYN-D1 (v1.114.2), candado `home-perf-mobile-goal-expiry` (job de ci.yml).
# -----------------------------------------------------------------------------
# DE DÓNDE VIENE: el dueño eligió la opción A para la portada en celular (HECHOS 2026-10-30) sabiendo que no
# alcanza 936 (LCP ≤ 2.5 s). DYN-D1 deja la meta de celular en solo reporte y bloquea con un trinquete de no
# regresión. Es una condición con dueño (orquestador: devolver al dueño la opción B con el número), caducidad
# 2026-12-31 y este candado: desde 2027-01-01, si celular sigue en trinquete, ROJO.
#
# QUÉ MIRA (estático, sin red): `node scripts/home-perf/lhci-config.mjs --modo-celular`, la misma fuente que
# usa el arnés. `trinquete …` = la meta en solo reporte ⇒ cuenta la fecha. `meta …` = celular bloquea con 936
# (trinquete sin fijar o retirado) ⇒ nada que caducar, verde.
#
# Uso:  ./scripts/check-home-perf-mobile-goal-expiry.sh [--today YYYY-MM-DD] [--root DIR]
#       ./scripts/check-home-perf-mobile-goal-expiry.sh --canary   # 4 casos ⇒ todos como se esperan
# rc: 0 vigente o sin solo-reporte · 9 CADUCÓ · 2 no concluyente
# FECHA_LIMITE no se mueve sin decisión del dueño escrita en HECHOS.md y pase del arquitecto en el contrato.
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FECHA_LIMITE="2027-01-01"   # rojo DESDE este día (la caducidad de la condición es 2026-12-31)

if [ "${1:-}" = "--canary" ]; then
  echo "== Canario de home-perf-mobile-goal-expiry =="
  TMP="$(mktemp -d -t hp-expiry-XXXXXX)"; trap 'rm -rf "$TMP"' EXIT
  copia() {  # $1 = fcpMs/lcpMs (número o null)
    local d="$TMP/c$RANDOM"; mkdir -p "$d/scripts/home-perf"
    cp "$ROOT_DIR/scripts/home-perf/lhci-config.mjs" "$d/scripts/home-perf/"
    node -e 'const fs=require("fs");const [f,v]=process.argv.slice(1);const r=JSON.parse(fs.readFileSync(f));r.fcpMs=v==="null"?null:Number(v);r.lcpMs=v==="null"?null:Number(v)*4;fs.writeFileSync(process.argv[3],JSON.stringify(r))' \
      "$ROOT_DIR/scripts/home-perf/mobile-ratchet.json" "$1" "$d/scripts/home-perf/mobile-ratchet.json"
    printf '%s' "$d"
  }
  ok=0; total=0
  caso() {  # $1 nombre  $2 valor del trinquete  $3 hoy  $4 rc esperado
    total=$((total+1)); local d rc; d="$(copia "$2")"
    "$ROOT_DIR/scripts/check-home-perf-mobile-goal-expiry.sh" --root "$d" --today "$3" >/dev/null 2>&1; rc=$?
    if [ "$rc" = "$4" ]; then echo "  ✔ $1 ⇒ rc $rc"; ok=$((ok+1)); else echo "  ✗ $1 ⇒ rc $rc (esperado $4)"; fi
  }
  caso "trinquete, 2026-12-31 (último día de la condición)" 1370 2026-12-31 0
  caso "trinquete, 2027-01-01 (caducó)"                     1370 2027-01-01 9
  caso "trinquete, 2027-03-15"                              1370 2027-03-15 9
  caso "sin trinquete (celular bloquea con 936), 2027-06-01" null 2027-06-01 0
  echo "Canario: $ok/$total casos como se esperan."
  [ "$ok" = "$total" ]; exit $?
fi

HOY="$(date -u +%F)"
while [ $# -gt 0 ]; do
  case "$1" in
    --today) HOY="$2"; shift 2 ;;
    --root)  ROOT_DIR="$(cd "$2" && pwd)"; shift 2 ;;
    *) echo "::error::argumento desconocido: $1"; exit 2 ;;
  esac
done
[[ "$HOY" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "::error::--today debe ser YYYY-MM-DD (recibí '$HOY')"; exit 2; }
MODO="$(node "$ROOT_DIR/scripts/home-perf/lhci-config.mjs" --modo-celular 2>&1)" \
  || { echo "::error::lhci-config.mjs --modo-celular falló: $MODO (NO concluyente)"; exit 2; }
case "$MODO" in
  meta\ *)
    echo "✔ Celular bloquea con la meta de 936 ($MODO): no hay solo-reporte que caducar."; exit 0 ;;
  trinquete\ *) ;;
  *) echo "::error::modo de celular ilegible: «$MODO» (NO concluyente)"; exit 2 ;;
esac
if [[ "$HOY" < "$FECHA_LIMITE" ]]; then
  echo "✔ Celular en trinquete ($MODO) y la meta de 936 en solo reporte: vigente hasta 2026-12-31 (hoy $HOY)."
  exit 0
fi
echo "::error title=home-perf-mobile-goal-expiry: CADUCÓ::La meta de 936 en celular sigue en SOLO REPORTE ($MODO) desde $FECHA_LIMITE. Dueño: orquestador — devolver al dueño la opción B con el número (API_CONTRACT §DYN.7 DYN-D1). Se apaga sola cuando celular vuelve a bloquear con la meta (fcpMs/lcpMs a null en scripts/home-perf/mobile-ratchet.json) o con una decisión nueva del dueño y pase del arquitecto."
exit 9

#!/usr/bin/env bash
#
# integration-heap.sh — presupuesto de heap de la suite de INTEGRACIÓN del backend (jest --runInBand)  · devops
# =============================================================================
# DE DÓNDE VIENE (2026-10-26, DEVOPS_NOTES §102): run 40283150245, job `backend-e2e` 121440990278, sha
# `9f1a2124`. «Test de integración» murió a los ~17 min con exit 134 y
#   FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
# (Scavenge 4031→4023 MB de 4095). 236 líneas PASS y ningún FAIL: no era un rojo de aserción, era el heap
# por defecto de Node en el runner (~4 GB) contra una suite que crece. Y el job lo llamó «LA SUITE CORRIÓ y
# falló · dueño backend».
#
# POR QUÉ NO WORKERS NI `workerIdleMemoryLimit`: la suite corre `--runInBand` (package.json, dueño backend) y
# el candado `test/integration/open-handles.teardown.ts` cuenta los handles DEL PROCESO PRINCIPAL; con
# workers los specs viven en otro proceso y ese candado se queda ciego (vuelve el cuelgue de 6 h). En banda
# no hay worker que reciclar: la palanca es el heap del proceso.
#
# UN HECHO, UN SITIO: el número vive AQUÍ y lo usan `e2e.yml` (backend-e2e) y `stack-native.sh
# test:integration`. Cambiarlo es cambiar esta línea:
DEFAULT_HEAP_MB=6144
# Medición que lo sostiene (DEVOPS_NOTES §102, 2 corridas locales de los 149 specs sobre `9f1a2124`): heap tras
# cada spec (`--logHeapUsage`) 1,2-1,7 GB tras el primero y crece LINEAL ~16 MB/spec ⇒ 3,6-4,1 GB al final: ya
# no cabe en los 4095 MB por defecto. Con 6144: sin OOM, pico 3758 MB, RSS máx. de jest 4836 MB ⇒ ~2 GB de
# margen (~120-160 specs más al ritmo medido) y cabe en los 16 GB de `ubuntu-latest` con Postgres/Redis/s3-local.
#
# Uso:
#   integration-heap.sh node-options        # imprime NODE_OPTIONS con --max-old-space-size=<MB> (E2E_HEAP_MB o el default)
#   integration-heap.sh limit-mb            # imprime el límite en MB que se aplica
#   integration-heap.sh report <log>        # pico y crecimiento por spec del log de jest --logHeapUsage;
#                                           #   ::warning si el pico pasa del E2E_HEAP_WARN_PCT % (80) del límite
#   integration-heap.sh oom <log>           # rc 0 si el log trae la firma de V8 de heap agotado
# Canario: scripts/check-e2e-suite-hang-canary.sh (casos OOM).
# =============================================================================
set -uo pipefail

limit_mb() {
  local mb="${E2E_HEAP_MB:-$DEFAULT_HEAP_MB}"
  case "$mb" in ''|*[!0-9]*) echo "::error::E2E_HEAP_MB='$mb' no es un entero de MB." >&2; return 2 ;; esac
  [ "$mb" -ge 512 ] || { echo "::error::E2E_HEAP_MB=$mb es menor que 512 MB." >&2; return 2; }
  printf '%s\n' "$mb"
}

OOM_RE='JavaScript heap out of memory|Reached heap limit|Ineffective mark-compacts near heap limit'

case "${1:-}" in
  limit-mb) limit_mb ;;
  node-options)
    mb="$(limit_mb)" || exit 2
    # Quita un --max-old-space-size previo (el último gana en V8, pero dos valores en el log confunden).
    rest="$(printf '%s' "${NODE_OPTIONS:-}" | sed -E 's/(^|[[:space:]])--max-old-space-size=[^[:space:]]*//g; s/^[[:space:]]+//')"
    printf '%s\n' "${rest:+$rest }--max-old-space-size=$mb" ;;
  oom)
    [ -s "${2:-}" ] || exit 1
    grep -qE "$OOM_RE" "$2" ;;
  report)
    LOG="${2:-}"; [ -s "$LOG" ] || { echo "integration-heap: log vacío o ausente; sin datos de heap."; exit 0; }
    mb="$(limit_mb)" || exit 2
    pct="${E2E_HEAP_WARN_PCT:-80}"
    # jest --logHeapUsage: «PASS test/integration/x.e2e-spec.ts (12.3 s, 1734 MB heap size)».
    sed 's/\x1b\[[0-9;]*m//g' "$LOG" | awk -v lim="$mb" -v pct="$pct" '
      # jest repite cada FAIL en el resumen final con el heap de ESE momento: solo cuenta la primera aparición.
      /^(PASS|FAIL) / && !visto[$2]++ && match($0, /[0-9]+ MB heap size/) {
        v = substr($0, RSTART, RLENGTH) + 0; n++
        if (n == 1) first = v
        last = v; if (v > max) { max = v; maxspec = $2 }
      }
      END {
        if (n == 0) { print "integration-heap: el log no trae «MB heap size» (¿falta --logHeapUsage?)."; exit 0 }
        slope = (n > 1) ? (last - first) / (n - 1) : 0
        printf "heap de la suite: %d specs · primero %d MB · último %d MB · pico %d MB (%s) · límite %d MB · crecimiento medio %.1f MB/spec\n", n, first, last, max, maxspec, lim, slope
        if (slope > 0 && last < lim) printf "  a este ritmo el límite se alcanza en ~%d specs más\n", (lim - last) / slope
        if (max * 100 > lim * pct)
          printf "::warning title=backend-e2e · heap al %d%% del límite::pico %d MB de %d MB (%s); crecimiento %.1f MB/spec. Antes de que muera: sube DEFAULT_HEAP_MB en scripts/integration-heap.sh (devops) o cierra lo que retiene cada spec (backend). DEVOPS_NOTES §102.\n", max * 100 / lim, max, lim, maxspec, slope
      }' ;;
  *) sed -n '2,32p' "$0"; exit 2 ;;
esac

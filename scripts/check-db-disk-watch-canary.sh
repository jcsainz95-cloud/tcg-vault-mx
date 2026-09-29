#!/usr/bin/env bash
#
# check-db-disk-watch-canary.sh — el canario de db-disk-watch.sh          · devops
# =============================================================================
# POR QUÉ (doctrina del proyecto: «cada candado viene con su canario que
# demuestra que muerde», CLAUDE.md). db-disk-watch.sh no alcanza la prod desde
# CI (egress bloqueado), así que su LÓGICA DE VEREDICTO —la parte que decide si
# suena la alarma— se prueba aquí, sobre cifras sintéticas, SIN base de datos,
# vía el modo `--selftest-eval`. Si un cambio afloja un umbral o rompe la
# proyección, este canario se pone ROJO en CI antes de que un tope real pase
# inadvertido. Corre en su propio workflow db-disk-watch.yml: en el cron semanal
# y en cada PR/push que toque esta herramienta o su canario (job `autoprueba`).
#
# rc: 0 todos los casos pasan · 1 algún caso no dio el veredicto esperado.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR" || exit 1
WATCH="./scripts/db-disk-watch.sh"
[ -x "$WATCH" ] || { echo "::error::no encuentro/ejecutable $WATCH"; exit 1; }

GiB=1073741824
fallos=0

# caso: descripción · USED · VOL · PERDAY · SLOTS · MAXWAL_MB · nivel esperado · rc esperado
probar() {
  local desc="$1" used="$2" vol="$3" perday="$4" slots="$5" maxwal="$6" nivel_esp="$7" rc_esp="$8"
  local out rc nivel
  out="$("$WATCH" --selftest-eval "$used" "$vol" "$perday" "$slots" "$maxwal" 2>&1)"; rc=$?
  nivel="$(printf '%s\n' "$out" | sed -n 's/^VERDICT=//p')"
  if [ "$nivel" = "$nivel_esp" ] && [ "$rc" -eq "$rc_esp" ]; then
    printf '  \033[1;32m✔\033[0m %-46s → %s (rc %s)\n' "$desc" "$nivel" "$rc"
  else
    printf '  \033[1;31m✗\033[0m %-46s → esperaba %s/rc%s, obtuve %s/rc%s\n' \
      "$desc" "$nivel_esp" "$rc_esp" "${nivel:-?}" "$rc"
    printf '%s\n' "$out" | sed 's/^/        /'
    fallos=$((fallos+1))
  fi
}

echo
echo "== canario de db-disk-watch.sh: ¿el veredicto muerde? =="

# 1) Holgado: 39% de uso, crecimiento mínimo, sin slots.
probar "OK: 39% uso, crecimiento mínimo"        $((419430400))  $GiB $((1048576))  0 "?"    OK    0
# 2) Aviso: 83% de uso, pero aún cientos de días de margen.
probar "AVISO: 83% uso, todavía con margen"     $((891289600))  $GiB $((1048576))  0 "?"    AVISO 0
# 3) Rojo por uso crítico (≥90%).
probar "ROJO: 95% uso"                           $((1020054733)) $GiB $((1048576))  0 "?"    ROJO  1
# 4) Rojo SOLO por proyección: 50% uso pero ~13 días al tope.
probar "ROJO: 50% uso pero ~13 días al tope"    $((536870912))  $GiB $((41943040)) 0 "?"    ROJO  1
# 5) Rojo por FUGA de WAL: replication slot > 0 aunque el disco esté holgado.
probar "ROJO: 1 replication slot (fuga WAL)"    $((419430400))  $GiB $((1048576))  1 "?"    ROJO  1

# 6) Aviso de config sin efecto en el rc: max_wal_size de FÁBRICA debe avisarse.
echo
echo "== el aviso «WAL aún de FÁBRICA» aparece cuando max_wal_size ≥ 512 MB =="
out="$("$WATCH" --selftest-eval $((419430400)) $GiB $((1048576)) 0 1024 2>&1)"
if printf '%s\n' "$out" | grep -q 'FÁBRICA'; then
  printf '  \033[1;32m✔\033[0m max_wal_size=1024MB → avisa que sigue de fábrica\n'
else
  printf '  \033[1;31m✗\033[0m max_wal_size=1024MB → NO avisó que sigue de fábrica\n'
  printf '%s\n' "$out" | sed 's/^/        /'; fallos=$((fallos+1))
fi
out="$("$WATCH" --selftest-eval $((419430400)) $GiB $((1048576)) 0 128 2>&1)"
if printf '%s\n' "$out" | grep -q 'acotado'; then
  printf '  \033[1;32m✔\033[0m max_wal_size=128MB → lo marca acotado\n'
else
  printf '  \033[1;31m✗\033[0m max_wal_size=128MB → no lo marcó acotado\n'
  printf '%s\n' "$out" | sed 's/^/        /'; fallos=$((fallos+1))
fi

echo
if [ "$fallos" -eq 0 ]; then
  echo "== canario VERDE: el veredicto de db-disk-watch muerde en los 7 casos =="
  exit 0
fi
echo "::error::canario ROJO: $fallos caso(s) de db-disk-watch no dieron el veredicto esperado."
exit 1

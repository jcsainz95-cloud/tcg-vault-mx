#!/usr/bin/env bash
# =============================================================================
# e2e-mock-verdict.sh — veredicto del job `frontend-e2e` (MOCK) de e2e.yml · devops
# =============================================================================
# Uso: e2e-mock-verdict.sh <rc de playwright> <log de playwright (stdout+stderr)>
#
# Por qué existe (2026-11-03, sha 48077124): el paso de la suite tenía
# `continue-on-error: true` (e2e.yml) y el job salía VERDE con IDS-F7 y DSC rojas
# en sus 3 intentos (run 41702516917, job 126150617900: «2 failed», «Process
# completed with exit code 1», job success). Un job verde con una prueba roja en
# todos sus intentos no es un gate.
#
# Regla (medida con @playwright/test 1.56.0, retries=2):
#   - Prueba roja en TODOS sus intentos  ⇒ Playwright sale 1  ⇒ job ROJO.
#   - Prueba roja y luego verde en un reintento («flaky») ⇒ Playwright sale 0 ⇒
#     job VERDE, pero cada flaky queda REGISTRADA: ::warning:: con su nombre y
#     tabla en el resumen del job. Flaky no es rojo, y tampoco es silencio.
#   - Playwright sale 0 pero el resumen dice «N failed»/«interrupted» ⇒ ROJO
#     (un reporter o un wrapper se tragó el código).
#   - Ninguna prueba pasó («No tests found», resumen ausente) ⇒ ROJO: una suite
#     que no midió nada no es verde.
# El rc de Playwright manda; este script solo puede endurecerlo, nunca ablandarlo.
# Canario: scripts/e2e-mock-verdict-canary.sh (cableado en ci.yml › e2e-harness-gaps).
# Política: docs/DEVOPS_NOTES-24-railway-deploy-gate.md §24.0.
# =============================================================================
set -uo pipefail

RC="${1:-}"
LOG="${2:-}"
if [ -z "$RC" ] || [ -z "$LOG" ]; then
  echo "::error::uso: e2e-mock-verdict.sh <rc> <log>"; exit 2
fi
if [ ! -r "$LOG" ]; then
  echo "::error title=E2E MOCK sin log::No puedo leer $LOG — sin log no hay veredicto. Dueño: devops."; exit 1
fi

SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

# Resumen del reporter `list`: «  N failed|flaky|passed|skipped|interrupted|did not run»
# y debajo, con 4 espacios, los nombres. Se quita ANSI y la línea de adorno «────».
LIMPIO="$(sed -e 's/\x1b\[[0-9;]*m//g' -e 's/\r$//' -- "$LOG")"

cuenta() { # $1 = categoría; la ÚLTIMA aparición (el resumen final)
  grep -E "^  [0-9]+ $1( \(.*\))?\$" <<<"$LIMPIO" | tail -1 | awk '{print $1}'
}
nombres() { # $1 = categoría; los nombres listados bajo su cabecera
  awk -v cat="$1" '
    $0 ~ "^  [0-9]+ " cat "( \\(.*\\))?$" { on=1; buf=""; next }
    on && /^    [^ ]/ { s=$0; sub(/^    /,"",s); sub(/ (─)+$/,"",s); sub(/ +$/,"",s); buf=buf s "\n"; next }
    on { on=0; last=buf }
    END { if (on) last=buf; printf "%s", last }
  ' <<<"$LIMPIO"
}

FAILED="$(cuenta failed)";       FAILED="${FAILED:-0}"
FLAKY="$(cuenta flaky)";         FLAKY="${FLAKY:-0}"
PASSED="$(cuenta passed)";       PASSED="${PASSED:-0}"
SKIPPED="$(cuenta skipped)";     SKIPPED="${SKIPPED:-0}"
INTERR="$(cuenta interrupted)";  INTERR="${INTERR:-0}"
NORUN="$(cuenta 'did not run')"; NORUN="${NORUN:-0}"

{
  echo "### E2E MOCK — veredicto"
  echo ""
  echo "| rc | passed | failed | flaky | skipped | interrupted | did not run |"
  echo "|---|---|---|---|---|---|---|"
  echo "| $RC | $PASSED | $FAILED | $FLAKY | $SKIPPED | $INTERR | $NORUN |"
} >>"$SUMMARY"

if [ "$FLAKY" -gt 0 ]; then
  { echo ""; echo "**Flaky (rojas y luego verdes en un reintento; NO bloquean, quedan registradas):**"; } >>"$SUMMARY"
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    echo "::warning title=E2E MOCK flaky (registrada, no bloquea)::$t — falló y pasó en un reintento. Dueño: frontend (spec en frontend/e2e/)."
    echo "- $t" >>"$SUMMARY"
  done < <(nombres flaky)
fi

ROJO=0
if [ "$FAILED" -gt 0 ]; then
  { echo ""; echo "**Rojas en todos sus intentos (bloquean):**"; } >>"$SUMMARY"
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    echo "::error title=E2E MOCK rojo en todos sus intentos::$t — Dueño: frontend (spec en frontend/e2e/). Reporte: artifact playwright-report-mock."
    echo "- $t" >>"$SUMMARY"
  done < <(nombres failed)
  ROJO=1
fi
if [ "$INTERR" -gt 0 ]; then
  echo "::error title=E2E MOCK interrumpida::$INTERR prueba(s) interrumpidas (tiempo global o corte). No es verde."
  ROJO=1
fi
if [ "$RC" != "0" ]; then
  if [ "$FAILED" -eq 0 ] && [ "$INTERR" -eq 0 ]; then
    echo "::error title=E2E MOCK rc=$RC sin pruebas rojas en el resumen::Playwright salió $RC y el resumen no nombra rojas: murió antes de terminar (webServer, config, «No tests found»). Ver el log del paso. Dueño: devops si es arranque; frontend si es config/spec."
  fi
  ROJO=1
fi
if [ "$RC" = "0" ] && [ "$PASSED" -eq 0 ]; then
  echo "::error title=E2E MOCK no midió nada::rc=0 y 0 pruebas pasadas (o sin resumen). Una suite que no corrió no es verde. Dueño: devops."
  ROJO=1
fi

if [ "$ROJO" -eq 1 ]; then
  echo "E2E MOCK ROJO: rc=$RC passed=$PASSED failed=$FAILED flaky=$FLAKY interrupted=$INTERR"
  exit 1
fi
echo "E2E MOCK VERDE: passed=$PASSED flaky=$FLAKY (registradas arriba) skipped=$SKIPPED"
exit 0

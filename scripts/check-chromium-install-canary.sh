#!/usr/bin/env bash
#
# check-chromium-install-canary.sh — «¿el candado CI-APT-LOCK muerde?» · devops
# =============================================================================
# Ejercita check-chromium-install.sh sobre COPIAS de .github/workflows/ y
# scripts/ci-install-chromium.sh con mutaciones. Rojos Y verdes:
#   1. copia intacta                                         -> VERDE
#   2. un paso vuelve a `npx playwright install` inline      -> ROJO
#   3. el script pierde DPkg::Lock::Timeout                  -> ROJO
#   4. DPkg::Lock::Timeout baja a 10 s                       -> ROJO
#   5. backoff vuelve a 10 s                                 -> ROJO
#   6. un paso baja timeout-minutes por debajo del budget    -> ROJO
#   7. ninguna llamada al script                             -> rc=2, NUNCA 0
# Uso: ./scripts/check-chromium-install-canary.sh   (sin red, ~2 s)
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE="$ROOT_DIR/scripts/check-chromium-install.sh"
FALLOS=0
BASE="$(mktemp -d -t chromium-install-canary-XXXXXX)"; trap 'rm -rf "$BASE"' EXIT
copia() { rm -rf "$1"; mkdir -p "$1/.github/workflows" "$1/scripts"
  cp "$ROOT_DIR"/.github/workflows/*.yml "$1/.github/workflows/"; cp "$ROOT_DIR/scripts/ci-install-chromium.sh" "$1/scripts/"; }
caso() { local esperado="$1" nombre="$2" d="$3" rc
  bash "$GATE" "$d" >"$d.log" 2>&1; rc=$?
  if [ "$rc" = "$esperado" ]; then echo "  ✔ $nombre (rc=$rc)"; else echo "  ✗ $nombre: rc=$rc, esperaba $esperado"; sed 's/^/      /' "$d.log"; FALLOS=$((FALLOS+1)); fi; }
W=.github/workflows; S=scripts/ci-install-chromium.sh

d="$BASE/1"; copia "$d"; caso 0 "copia intacta" "$d"
d="$BASE/2"; copia "$d"
sed -i 's#CHROMIUM_INSTALL_BUDGET_S=840 bash "${{ github.workspace }}/scripts/ci-install-chromium.sh" || exit 1#timeout 420 npx playwright install --with-deps chromium#' "$d/$W/csp-stripe-probe.yml"
caso 1 "playwright install inline en csp-stripe-probe.yml" "$d"
d="$BASE/3"; copia "$d"; sed -i '/DPkg::Lock::Timeout/d' "$d/$S"; caso 1 "sin DPkg::Lock::Timeout" "$d"
d="$BASE/4"; copia "$d"; sed -i 's/^APT_LOCK_TIMEOUT_S=[0-9]*/APT_LOCK_TIMEOUT_S=10/' "$d/$S"; caso 1 "DPkg::Lock::Timeout=10" "$d"
d="$BASE/5"; copia "$d"; sed -i 's/espera=$(( 30 \* intento ))/espera=10/' "$d/$S"; caso 1 "backoff fijo de 10 s" "$d"
d="$BASE/6"; copia "$d"; sed -i 's/timeout-minutes: 15/timeout-minutes: 5/' "$d/$W/csp-stripe-probe.yml"; caso 1 "timeout-minutes < presupuesto" "$d"
d="$BASE/7"; copia "$d"; sed -i '/ci-install-chromium.sh/d' "$d"/$W/*.yml; caso 2 "sin llamadas" "$d"

[ "$FALLOS" = 0 ] && { echo "OK: el candado CI-APT-LOCK muerde (7/7)."; exit 0; }
echo "::error title=check-chromium-install-canary::$FALLOS caso(s) no se comportaron como se esperaba."; exit 1

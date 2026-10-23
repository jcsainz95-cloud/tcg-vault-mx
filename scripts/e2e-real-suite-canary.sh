#!/usr/bin/env bash
#
# e2e-real-suite-canary.sh — ¿el arnés de la suite @real completa da a cada spec de invitado su
# propio presupuesto, sin tocar el límite del producto?   · devops (QA-REL-3, DEVOPS_NOTES §103.3)
# =============================================================================
# Sin Playwright y sin stack: alimenta `e2e-real-suite.sh --dry-run` con una lista de `--list`
# fabricada y una carpeta de specs de juguete, y exige:
#   1. plan exacto: RESTART · tanda común · y por CADA spec de invitado un RESTART justo antes
#   2. un spec de la lista que no existe                    ⇒ rc 2
#   3. lista sin specs                                      ⇒ rc 2
#   4. solo specs de invitado                               ⇒ sin tanda común, un RESTART por spec
#   5. un spec sin @real (no está en la lista) no entra en ninguna tanda
#   6. el límite del PRODUCTO sigue intacto: `checkout/guest/session` con `limit: 5` por hora, y el
#      throttler solo se omite bajo NODE_ENV=test (`isTestEnv() &&` en config/test-env.ts)
#   7. `stack-native.sh restart:backend` existe, exige pidfile propio y re-verifica procedencia
# Uso: ./scripts/e2e-real-suite-canary.sh [N]
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER="$ROOT_DIR/scripts/e2e-real-suite.sh"; N="${1:-1}"
BASE="$(mktemp -d -t e2e-real-suite-canario-XXXXXX)"; trap 'rm -rf "$BASE"' EXIT
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }

E="$BASE/e2e"; mkdir -p "$E"
printf "test('compra como invitado @real', async () => {});\n" > "$E/g1.spec.ts"
printf "const isGuestSession = 1; test('x @real', async () => {});\n" > "$E/g2.spec.ts"
printf "test('catálogo @real', async () => {});\n" > "$E/n1.spec.ts"
printf "test('bóveda @real', async () => {});\n" > "$E/n2.spec.ts"
printf "test('solo mock, invitado', async () => {});\n" > "$E/mock.spec.ts"
cat > "$BASE/lista.txt" <<'EOF'
Listing tests:
  [chromium] › g1.spec.ts:1:1 › compra como invitado @real
  [chromium] › n2.spec.ts:1:1 › bóveda @real
  [chromium] › g2.spec.ts:1:1 › x @real
  [chromium] › n1.spec.ts:1:1 › catálogo @real
  [chromium] › n1.spec.ts:2:1 › catálogo 2 @real
Total: 5 tests in 4 files
EOF
ESPERADO="RESTART
RUN comun n1.spec.ts n2.spec.ts
RESTART
RUN invitado g1.spec.ts
RESTART
RUN invitado g2.spec.ts"
plan() { "$RUNNER" --dry-run --e2e-dir "$E" --list-file "$1" 2>&1 | grep -E '^(RESTART|RUN )'; }

for ((r=1;r<=N;r++)); do
  printf '\n\033[1m== e2e-real-suite canario, ronda %s/%s ==\033[0m\n' "$r" "$N"
  P="$(plan "$BASE/lista.txt")"
  [ "$P" = "$ESPERADO" ] && ok "plan exacto: cada spec de invitado tras su RESTART" || { bad "plan distinto:"; printf '%s\n' "$P" | sed 's/^/      /'; }
  grep -q "mock.spec.ts" <<<"$P" && bad "un spec sin @real entró en una tanda" || ok "spec sin @real fuera de toda tanda"

  printf '  [chromium] › fantasma.spec.ts:1:1 › x @real\n' > "$BASE/l2.txt"
  "$RUNNER" --dry-run --e2e-dir "$E" --list-file "$BASE/l2.txt" >/dev/null 2>&1; rc=$?
  [ "$rc" -eq 2 ] && ok "spec inexistente ⇒ rc=2" || bad "spec inexistente ⇒ rc=$rc, esperaba 2"

  printf 'Listing tests:\nTotal: 0 tests in 0 files\n' > "$BASE/l3.txt"
  "$RUNNER" --dry-run --e2e-dir "$E" --list-file "$BASE/l3.txt" >/dev/null 2>&1; rc=$?
  [ "$rc" -eq 2 ] && ok "lista vacía ⇒ rc=2" || bad "lista vacía ⇒ rc=$rc, esperaba 2"

  printf '  [chromium] › g2.spec.ts:1:1 › x @real\n  [chromium] › g1.spec.ts:1:1 › y @real\n' > "$BASE/l4.txt"
  P4="$(plan "$BASE/l4.txt")"
  [ "$P4" = "$(printf 'RESTART\nRUN invitado g1.spec.ts\nRESTART\nRUN invitado g2.spec.ts')" ] \
    && ok "solo invitado ⇒ sin tanda común, un RESTART por spec" || bad "solo invitado ⇒ plan: $(tr '\n' '|' <<<"$P4")"
done

# --- Invariantes del producto (estáticas): el arnés NO debilita el límite -------
CTRL="$ROOT_DIR/backend/src/modules/orders/guest-orders.controller.ts"
TENV="$ROOT_DIR/backend/src/config/test-env.ts"
if [ -f "$CTRL" ] && grep -B1 -E "@Post\('checkout/guest/session'\)" "$CTRL" | grep -qE "@Throttle\(\{ default: \{ ttl: HOUR_MS, limit: 5 \} \}\)"; then
  ok "producto: checkout/guest/session sigue en 5/h por IP"
else bad "producto: el límite de checkout/guest/session ya no es el @Throttle 5/h literal ($CTRL) — revisar con backend/seguridad"; fi
if [ -f "$TENV" ] && grep -qE "return isTestEnv\(\) && process\.env\.E2E_ENABLE_THROTTLER !== 'true';" "$TENV"; then
  ok "producto: el throttler solo se omite bajo NODE_ENV=test"
else bad "producto: isThrottlerDisabled ya no exige NODE_ENV=test ($TENV)"; fi
BLOQUE="$(awk '/^  restart:backend\)/{f=1} f&&/^    ;;/{print; exit} f' "$ROOT_DIR/scripts/stack-native.sh")"
if grep -q 'backend.pid" \] || die' <<<"$BLOQUE" && grep -q 'ASSERT_HEAD' <<<"$BLOQUE" && grep -q 'stop_backend_only' <<<"$BLOQUE"; then
  ok "stack-native.sh restart:backend: pidfile propio + procedencia re-verificada"
else bad "stack-native.sh restart:backend falta o no exige pidfile propio / no re-verifica procedencia"; fi
grep -q "restart:backend" "$RUNNER" && ok "el runner reinicia con restart:backend" || bad "el runner no usa restart:backend"

printf '\n'
if [ "$FALLOS" -gt 0 ]; then printf '\033[1;31mROJO: %s/%s casos fallaron.\033[0m\n' "$FALLOS" "$((FALLOS+PASADAS))"; exit 1; fi
printf '\033[1;32mVERDE: %s/%s casos (N=%s): presupuesto por spec de invitado, límite del producto intacto.\033[0m\n' "$PASADAS" "$PASADAS" "$N"

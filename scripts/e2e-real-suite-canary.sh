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
#   7. CONDUCTA de `stack-native.sh restart:backend` (TL-OPS-4; antes era un grep de cadenas): corrido de
#      verdad en un árbol de juguete (`env -i`, puerto 1, sin .git): sin pidfile propio ⇒ rc≠0, dice por
#      qué y no reinicia nada; con pidfile propio ⇒ pasa la guarda y apaga SOLO ese pid
#   8. EJECUCIÓN real (no --dry-run) con un `npx` de mentira que filtra como Playwright 1.56 (cada
#      posicional es una RegExp `gi` contra la ruta absoluta real: `forceRegExp` de lib/util.js): cada
#      tanda corre EXACTAMENTE sus ficheros. `checkout.spec.ts` no arrastra `guest-checkout.spec.ts`
#      (prefijo) ni `sub/checkout.spec.ts` (subcarpeta). QA lo midió con el script de 803c4298:
#      «2 tests in 2 files» y `guest-checkout.spec.ts:137` rojo 2/2.
# Ablación: E2E_SUITE_UNDER_TEST / STACK_UNDER_TEST apuntan a otra versión del runner / del stack.
# Uso: ./scripts/e2e-real-suite-canary.sh [N]
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER="${E2E_SUITE_UNDER_TEST:-$ROOT_DIR/scripts/e2e-real-suite.sh}"; N="${1:-1}"
STACK_SRC="${STACK_UNDER_TEST:-$ROOT_DIR/scripts/stack-native.sh}"
BASE="$(mktemp -d -t e2e-real-suite-canario-XXXXXX)"; BASE="$(cd "$BASE" && pwd -P)"
SLEEPS=()
limpiar() { for p in "${SLEEPS[@]}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$BASE"; }
trap limpiar EXIT
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

# --- 8. Árbol de juguete para EJECUTAR el runner (stack y Playwright de mentira) -------------
X="$BASE/x"; mkdir -p "$X/scripts" "$X/frontend/e2e/sub" "$BASE/bin"
cp "$RUNNER" "$X/scripts/e2e-real-suite.sh"
printf '#!/usr/bin/env bash\necho "RESTART $*" >> "$CANARY_LOG"\n' > "$X/scripts/stack-native.sh"
printf "test('pago con cuenta @real', async () => {});\n" > "$X/frontend/e2e/checkout.spec.ts"
printf "test('pago como invitado @real', async () => {});\n" > "$X/frontend/e2e/guest-checkout.spec.ts"
printf "test('otra carpeta, sin @real', async () => {});\n" > "$X/frontend/e2e/sub/checkout.spec.ts"
printf "test('catálogo @real', async () => {});\n" > "$X/frontend/e2e/n1.spec.ts"
cat > "$BASE/lista-x.txt" <<'EOF'
Listing tests:
  [chromium] › checkout.spec.ts:1:1 › pago con cuenta @real
  [chromium] › guest-checkout.spec.ts:1:1 › pago como invitado @real
  [chromium] › n1.spec.ts:1:1 › catálogo @real
Total: 3 tests in 3 files
EOF
cat > "$BASE/bin/fake-pw.js" <<'EOF'
// Filtro de ficheros de Playwright 1.56 (lib/util.js: parseLocationArg + forceRegExp + createFileMatcher).
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const testDir = fs.realpathSync(path.join(process.cwd(), 'e2e'));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = walk(testDir).filter((f) => f.endsWith('.spec.ts'));
const res = args.map((a) => {
  const m = /^(.*?):(\d+):?(\d+)?$/.exec(a); const p = m ? m[1] : a;
  const r = p.match(/^\/(.*)\/([gi]*)$/); return r ? new RegExp(r[1], r[2]) : new RegExp(p, 'gi');
});
const hit = files.filter((f) => res.length === 0 || res.some((re) => { re.lastIndex = 0; return re.test(f); }));
fs.appendFileSync(process.env.CANARY_LOG, 'TANDA ' + hit.map((f) => path.relative(testDir, f)).sort().join(' ') + '\n');
process.exit(hit.length ? 0 : 1);
EOF
printf '#!/usr/bin/env bash\n[ "$1 $2" = "playwright test" ] || exit 97\nshift 2; exec node "%s" "$@"\n' "$BASE/bin/fake-pw.js" > "$BASE/bin/npx"
chmod +x "$X/scripts/e2e-real-suite.sh" "$X/scripts/stack-native.sh" "$BASE/bin/npx"
ESPERADO_X="RESTART restart:backend
TANDA checkout.spec.ts n1.spec.ts
RESTART restart:backend
TANDA guest-checkout.spec.ts"

# --- 7. Árbol de juguete para `stack-native.sh restart:backend` (conducta, TL-OPS-4) -----------
# reinicio <con-pid|sin-pid> ⇒ $RS = salida, $RC = rc, $SPID = pid propio del pidfile (o vacío)
reinicio() {
  local R; R="$(mktemp -d "$BASE/stk-XXXX")"; mkdir -p "$R/scripts" "$R/.native-stack"; SPID=""
  cp "$STACK_SRC" "$R/scripts/stack-native.sh"
  for f in secrets-preflight.sh webhook-secret-preflight.sh assert-serving-head.sh; do cp "$ROOT_DIR/scripts/$f" "$R/scripts/$f"; done
  if [ "$1" = con-pid ]; then sleep 600 >/dev/null 2>&1 </dev/null & SPID=$!; SLEEPS+=("$SPID"); echo "$SPID" > "$R/.native-stack/backend.pid"; fi
  RS="$(env -i PATH="$PATH" HOME="$BASE" BACKEND_PORT=1 FRONTEND_PORT=2 S3_LOCAL_PORT=3 \
        STACK_EXPECTED_SHA=0123456789abcdef0123456789abcdef01234567 \
        timeout 60 bash "$R/scripts/stack-native.sh" restart:backend 2>&1 </dev/null)"; RC=$?
}

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

  : > "$BASE/log-x.txt"; rm -rf "$X/frontend/test-results-real-suite"
  ( cd "$BASE" && env PATH="$BASE/bin:$PATH" CANARY_LOG="$BASE/log-x.txt" \
      "$X/scripts/e2e-real-suite.sh" --list-file "$BASE/lista-x.txt" >/dev/null 2>&1 ); rc=$?
  LX="$(cat "$BASE/log-x.txt")"
  [ "$rc" -eq 0 ] && [ "$LX" = "$ESPERADO_X" ] \
    && ok "ejecución: cada tanda corre EXACTAMENTE sus specs (checkout ≠ guest-checkout ≠ sub/checkout)" \
    || { bad "ejecución (rc=$rc): las tandas no corrieron exactamente sus specs:"; printf '%s\n' "$LX" | sed 's/^/      /'; }

  reinicio sin-pid
  if [ "$RC" -ne 0 ] && grep -q 'backend.pid' <<<"$RS" && ! grep -q 'Reinicio del backend' <<<"$RS"; then
    ok "restart:backend sin pidfile propio ⇒ rc=$RC, lo dice y no reinicia nada"
  else bad "restart:backend sin pidfile propio ⇒ rc=$RC (esperaba ≠0, el motivo «backend.pid» y ningún reinicio):"; tail -3 <<<"$RS" | sed 's/^/      /'; fi
  reinicio con-pid
  if grep -q 'Reinicio del backend' <<<"$RS" && ! kill -0 "$SPID" 2>/dev/null; then
    ok "restart:backend con pidfile propio ⇒ pasa la guarda y apaga ese pid"
  else bad "restart:backend con pidfile propio ⇒ no pasó la guarda o no apagó su pid (rc=$RC):"; tail -3 <<<"$RS" | sed 's/^/      /'; fi
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
# (El grep de cadenas de `restart:backend` que vivía aquí —TL-OPS-4— lo sustituyen los casos 7 y 8:
# conducta del subcomando y que el runner lo llame antes de cada tanda.)

printf '\n'
if [ "$FALLOS" -gt 0 ]; then printf '\033[1;31mROJO: %s/%s casos fallaron.\033[0m\n' "$FALLOS" "$((FALLOS+PASADAS))"; exit 1; fi
printf '\033[1;32mVERDE: %s/%s casos (N=%s): presupuesto por spec de invitado, límite del producto intacto.\033[0m\n' "$PASADAS" "$PASADAS" "$N"

#!/usr/bin/env bash
#
# check-stack-prisma-client.sh — «¿`stack-native.sh` arranca el backend con un cliente Prisma de OTRO
# schema?»   · devops (tester-e2e vía QA, rechazo de 803c4298, 2026-10-23 · DEVOPS_NOTES §103.4)
# =============================================================================
# El fallo medido: con `backend/node_modules/.prisma/client` viejo, el backend moría al arrancar con
# `TypeError: Cannot convert undefined or null to object` (`measurement-drain.service.ts:42`).
#
# CONDUCTA, no presencia: corre el `stack-native.sh restart:backend` REAL dentro de un árbol de juguete
# (copia de los scripts; sin .git, sin Postgres, puerto 1, `env -i` ⇒ ninguna credencial heredada) con
# un `npx` de mentira que (a) en `prisma generate` copia el schema al cliente como hace Prisma, y (b) en
# `ts-node … src/main.ts` anota si el cliente coincide con el schema EN EL MOMENTO DE ARRANCAR y sale.
# El backend «muere» siempre (no hay backend de verdad): lo que se mide es el estado del cliente al
# arrancar y qué se ejecutó antes.
#   1. cliente viejo            ⇒ `prisma generate` y arranque con el cliente al día
#   2. cliente al día           ⇒ SIN generate (idempotente) y arranque al día
#   3. sin cliente              ⇒ generate y arranque al día
#   4. generate falla           ⇒ NO arranca, rc≠0, mensaje con el remedio
#   5. generate no actualiza    ⇒ NO arranca, rc≠0, «sigue sin coincidir»
#   6. (estático) en `up`, el cliente se pone al día ANTES de `seed_synthetic`; y el generador del
#      schema real no declara `output` (la ruta que se compara es la de por defecto)
# Ablación: STACK_UNDER_TEST=<otro stack-native.sh> mide esa versión (la anterior a §103.4 ⇒ 1-3 rojos).
# Uso: ./scripts/check-stack-prisma-client.sh [N]
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK_SRC="${STACK_UNDER_TEST:-$ROOT_DIR/scripts/stack-native.sh}"; N="${1:-1}"
BASE="$(mktemp -d -t stack-prisma-canario-XXXXXX)"
SLEEPS=()
limpiar() { for p in "${SLEEPS[@]}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$BASE"; }
trap limpiar EXIT
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }

BIN="$BASE/bin"; mkdir -p "$BIN"
cat > "$BIN/npx" <<'EOF'
#!/usr/bin/env bash
# npx de mentira del canario: solo entiende lo que stack-native.sh le pide al backend.
S="$PWD/prisma/schema.prisma"; C="$PWD/node_modules/.prisma/client/schema.prisma"
case "$1 $2" in
  "prisma generate")
    echo "GENERATE" >> "$CANARY_LOG"
    case "${FAKE_GEN:-ok}" in
      ok)   mkdir -p "$(dirname "$C")" && cp "$S" "$C" ;;
      noop) : ;;
      *)    echo "Error: fallo simulado de prisma generate" >&2; exit 1 ;;
    esac ;;
  "ts-node --transpile-only")
    if cmp -s "$S" "$C"; then echo "ARRANQUE cliente=al-dia" >> "$CANARY_LOG"
    else echo "ARRANQUE cliente=viejo" >> "$CANARY_LOG"
         echo "TypeError: Cannot convert undefined or null to object" >&2; fi
    exit 1 ;;
  *) echo "npx de mentira: no sé hacer '$*'" >&2; exit 97 ;;
esac
EOF
chmod +x "$BIN/npx"

# arbol <estado-cliente: viejo|al-dia|ausente> ⇒ deja en $R la raíz del árbol de juguete. Sin `$( )`:
# el `sleep` del pidfile heredaría la tubería de la sustitución y la colgaría 600 s (medido al escribirlo).
arbol() {
  R="$(mktemp -d "$BASE/arbol-XXXX")"
  mkdir -p "$R/scripts" "$R/backend/prisma" "$R/backend/src" "$R/backend/node_modules" "$R/.native-stack"
  cp "$STACK_SRC" "$R/scripts/stack-native.sh"
  for f in secrets-preflight.sh webhook-secret-preflight.sh assert-serving-head.sh; do
    cp "$ROOT_DIR/scripts/$f" "$R/scripts/$f"
  done
  printf 'enum MeasurementDestination {\n  meta_capi\n  ga4_mp\n}\n' > "$R/backend/prisma/schema.prisma"
  echo "// juguete" > "$R/backend/src/main.ts"
  case "$1" in
    viejo)  mkdir -p "$R/backend/node_modules/.prisma/client"; echo "// schema de antes" > "$R/backend/node_modules/.prisma/client/schema.prisma" ;;
    al-dia) mkdir -p "$R/backend/node_modules/.prisma/client"; cp "$R/backend/prisma/schema.prisma" "$R/backend/node_modules/.prisma/client/schema.prisma" ;;
  esac
  sleep 600 >/dev/null 2>&1 </dev/null & SLEEPS+=("$!"); echo "$!" > "$R/.native-stack/backend.pid"
}
# corre <raíz> <FAKE_GEN> ⇒ deja salida en $R/salida.txt, log en $R/log.txt, rc en $RC
corre() {
  local R="$1"; : > "$R/log.txt"
  env -i PATH="$BIN:$PATH" HOME="$BASE" BACKEND_PORT=1 FRONTEND_PORT=2 S3_LOCAL_PORT=3 \
    STACK_EXPECTED_SHA=0123456789abcdef0123456789abcdef01234567 FAKE_GEN="$2" CANARY_LOG="$R/log.txt" \
    bash "$R/scripts/stack-native.sh" restart:backend > "$R/salida.txt" 2>&1
  RC=$?
}
log_de() { tr '\n' '|' < "$1/log.txt"; }

for ((r=1;r<=N;r++)); do
  printf '\n\033[1m== stack-native · cliente Prisma, ronda %s/%s ==\033[0m\n' "$r" "$N"
  arbol viejo; corre "$R" ok
  [ "$(log_de "$R")" = "GENERATE|ARRANQUE cliente=al-dia|" ] && ok "cliente viejo ⇒ generate y arranque con el cliente al día" \
    || { bad "cliente viejo ⇒ log: $(log_de "$R") (esperaba GENERATE|ARRANQUE cliente=al-dia|)"; tail -5 "$R/salida.txt" | sed 's/^/      /'; }
  arbol al-dia; corre "$R" ok
  [ "$(log_de "$R")" = "ARRANQUE cliente=al-dia|" ] && ok "cliente al día ⇒ sin generate (idempotente)" \
    || bad "cliente al día ⇒ log: $(log_de "$R") (esperaba solo ARRANQUE cliente=al-dia|)"
  arbol ausente; corre "$R" ok
  [ "$(log_de "$R")" = "GENERATE|ARRANQUE cliente=al-dia|" ] && ok "sin cliente ⇒ generate y arranque al día" \
    || bad "sin cliente ⇒ log: $(log_de "$R")"
  arbol viejo; corre "$R" fail
  if [ "$RC" -ne 0 ] && ! grep -q ARRANQUE "$R/log.txt" && grep -q 'prisma generate` falló' "$R/salida.txt"; then
    ok "generate falla ⇒ no arranca (rc=$RC) y dice el remedio"
  else bad "generate falla ⇒ rc=$RC log: $(log_de "$R")"; fi
  arbol viejo; corre "$R" noop
  if [ "$RC" -ne 0 ] && ! grep -q ARRANQUE "$R/log.txt" && grep -q 'sigue sin coincidir' "$R/salida.txt"; then
    ok "generate que no actualiza ⇒ no arranca (rc=$RC)"
  else bad "generate que no actualiza ⇒ rc=$RC log: $(log_de "$R")"; fi
done

# --- 6. Estáticos (dichos como tales: el camino `up` necesita Postgres) ---------------
UP="$(awk '/^  up\)/{f=1} f&&/^    ;;/{print; exit} f' "$STACK_SRC")"
if awk '/ensure_prisma_client/{e=NR} /seed_synthetic/{s=NR} END{exit !(e && s && e<s)}' <<<"$UP"; then
  ok "up: el cliente se pone al día antes de seed_synthetic (estático)"
else bad "up: seed_synthetic corre sin ensure_prisma_client antes (estático)"; fi
GEN="$(awk '/^generator client/{f=1} f{print} f&&/^}/{exit}' "$ROOT_DIR/backend/prisma/schema.prisma" 2>/dev/null)"
if [ -n "$GEN" ] && ! grep -qE '^\s*output\s*=' <<<"$GEN"; then
  ok "schema real: el generador usa la ruta por defecto (sin output)"
else bad "schema real: el generador declara output o no se encontró — la comparación de stack-native.sh mira otra ruta"; fi

printf '\n'
if [ "$FALLOS" -gt 0 ]; then printf '\033[1;31mROJO: %s/%s casos fallaron.\033[0m\n' "$FALLOS" "$((FALLOS+PASADAS))"; exit 1; fi
printf '\033[1;32mVERDE: %s/%s casos (N=%s): el backend nunca arranca con un cliente Prisma de otro schema.\033[0m\n' "$PASADAS" "$PASADAS" "$N"

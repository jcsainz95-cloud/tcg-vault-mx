#!/usr/bin/env bash
#
# check-stack-prisma-client.sh — «¿`stack-native.sh` arranca el backend con un cliente Prisma de OTRO
# schema?»   · devops (tester-e2e vía QA, rechazo de 803c4298 y de 96cda136, 2026-10-23 · DEVOPS_NOTES §103.4)
# =============================================================================
# El fallo medido: con `backend/node_modules/.prisma/client` viejo, el backend moría al arrancar con
# `TypeError: Cannot convert undefined or null to object` (`measurement-drain.service.ts:42`).
# Y el del primer arreglo (QA, 96cda136, 3/3): `prisma generate` REFORMATEA el schema al copiarlo
# (Prisma 5.22 realinea columnas), así que comparar por bytes abortaba en todo clon limpio. Este canario
# no lo cazaba porque su `npx` falso copiaba con `cp`. Ahora el `npx` falso REFORMATEA al copiar.
#
# CONDUCTA, no presencia: corre el `stack-native.sh restart:backend` REAL dentro de un árbol de juguete
# (copia de los scripts; sin .git, sin Postgres, puerto 1, `env -i` ⇒ ninguna credencial heredada) con
# un `npx` de mentira que (a) en `prisma generate` copia el schema al cliente REALINEANDO columnas, como
# hace Prisma, y (b) en `ts-node … src/main.ts` anota si el cliente coincide con el schema (ignorando
# espacios, `diff -w`) EN EL MOMENTO DE ARRANCAR y sale. El backend «muere» siempre (no hay backend de
# verdad): lo que se mide es el estado del cliente al arrancar y qué se ejecutó antes.
#   1. cliente viejo                 ⇒ generate y arranque al día (y la copia NO es byte a byte el schema:
#                                      si lo fuera, el `npx` falso no reformatea y el canario no mide nada)
#   2. segunda pasada, ya sellado    ⇒ SIN generate (idempotente) y arranque al día
#   3. sin cliente                   ⇒ generate y arranque al día
#   4. cliente al día sin sello      ⇒ generate una vez (p. ej. tras `npm ci`) y arranque al día
#   5. sellado y luego schema editado         ⇒ generate y arranque al día
#   6. sellado y luego cliente de otro schema ⇒ generate y arranque al día (generate a mano en otra rama)
#   7. generate falla                ⇒ NO arranca, rc≠0, mensaje con el remedio
#   8. generate no actualiza         ⇒ NO arranca, rc≠0, «sigue sin coincidir»
#   9. (estático) en `up`, el cliente se pone al día ANTES de `seed_synthetic`; y el generador del
#      schema real no declara `output` (la ruta que se compara es la de por defecto)
#  10. generate que PARTE un `É` de un comentario en U+FFFD U+FFFD (lo que hace Prisma 5.22 cuando el
#      carácter cae en el borde de un trozo de 64 KiB de su tubería; medido 2026-11-03 en d4ba9e91, 16/19)
#      ⇒ arranca al día y AVISA de que la diferencia es solo de comentarios (antes: «sigue sin coincidir»)
#  11. generate que corrompe CÓDIGO (un nombre de campo)          ⇒ NO arranca (ignorar comentarios no tapa código)
#  12. generate que cambia lo que va tras `//` DENTRO de una cadena ⇒ NO arranca (`"https://…"` no es comentario)
#  13. (I-7, qa 2026-11-23) schema con DOS líneas vacías seguidas y una de solo espacios, que generate
#      colapsa en una (lo que hace Prisma con schema.prisma:4064-4065) ⇒ arranca al día, sin el aviso de
#      «solo en comentarios». Se repite con CADA awk instalado (mawk, gawk, busybox awk) puesto como `awk`
#      en el PATH: con mawk 1.3.4 el modismo `{ $1 = $1 } NF` no quitaba las vacías y todo `up` moría en
#      «sigue sin coincidir». El awk que no esté instalado se dice NO MEDIDO (no se da por verde).
# Ablación: STACK_UNDER_TEST=<otro stack-native.sh> mide esa versión (la de 96cda136, con `cmp`, ⇒ rojo;
# la de 283bb760, huella sin ignorar comentarios, ⇒ rojo en 10; la de e6d731fa ⇒ rojo en 13 con mawk).
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
# Como Prisma 5.22: la copia del cliente lleva las columnas de cada campo realineadas (solo espacios)
# y las líneas vacías consecutivas (o de solo espacios) colapsadas en UNA (caso 13).
reformatea() { awk '/^  [A-Za-z]/ && NF>=2 { n=$1; $1=""; sub(/^ +/, ""); printf "  %-14s %s\n", n, $0; next } { print }' "$1" \
  | awk '/^[ \t]*$/ { if (v) next; v = 1; print ""; next } { v = 0; print }'; }
case "$1 $2" in
  "prisma generate")
    echo "GENERATE" >> "$CANARY_LOG"
    case "${FAKE_GEN:-ok}" in
      ok)   mkdir -p "$(dirname "$C")" && reformatea "$S" > "$C" ;;
      # Como Prisma 5.22 con un multibyte en el borde de un trozo: c3|89 ⇒ ef bf bd ef bf bd.
      fffd) mkdir -p "$(dirname "$C")" && reformatea "$S" | sed 's/y QUÉ\./y QU\xef\xbf\xbd\xef\xbf\xbd./' > "$C" ;;
      codigo) mkdir -p "$(dirname "$C")" && reformatea "$S" | sed 's/^  email /  correo /' > "$C" ;;
      cadena) mkdir -p "$(dirname "$C")" && reformatea "$S" | sed 's|"https://x"|"https://y"|' > "$C" ;;
      noop) : ;;
      *)    echo "Error: fallo simulado de prisma generate" >&2; exit 1 ;;
    esac ;;
  "ts-node --transpile-only")
    # «Al día» = mismo schema salvo formato y comentarios (los comentarios no cambian el cliente).
    sc() { sed 's#[[:space:]]*//[^"]*$##' "$1"; }
    if [ -f "$C" ] && diff -w -B -q <(sc "$S") <(sc "$C") >/dev/null; then echo "ARRANQUE cliente=al-dia" >> "$CANARY_LOG"
    else echo "ARRANQUE cliente=viejo" >> "$CANARY_LOG"
         echo "TypeError: Cannot convert undefined or null to object" >&2; fi
    exit 1 ;;
  *) echo "npx de mentira: no sé hacer '$*'" >&2; exit 97 ;;
esac
EOF
chmod +x "$BIN/npx"

# pid_propio <raíz>: un pidfile de «backend propio» (restart:backend solo reinicia lo que lanzó este clon).
# Sin `$( )`: el `sleep` heredaría la tubería de la sustitución y la colgaría 600 s (medido al escribirlo).
pid_propio() { sleep 600 >/dev/null 2>&1 </dev/null & SLEEPS+=("$!"); echo "$!" > "$1/.native-stack/backend.pid"; }
# arbol <estado-cliente: viejo|al-dia|ausente> ⇒ deja en $R la raíz del árbol de juguete.
arbol() {
  R="$(mktemp -d "$BASE/arbol-XXXX")"
  mkdir -p "$R/scripts" "$R/backend/prisma" "$R/backend/src" "$R/backend/node_modules" "$R/.native-stack"
  cp "$STACK_SRC" "$R/scripts/stack-native.sh"
  for f in secrets-preflight.sh webhook-secret-preflight.sh assert-serving-head.sh; do
    cp "$ROOT_DIR/scripts/$f" "$R/scripts/$f"
  done
  # Schema SIN formatear (columnas sin alinear), como el `model User` del repo frente a su copia.
  # Con un comentario con `É` (caso 10) y una cadena con `//` (caso 12).
  printf 'enum MeasurementDestination {\n  meta_capi\n  ga4_mp\n}\n\nmodel User {\n  id String @id\n  // A QUIÉN SE LE DEBE y QUÉ.\n  email String? @unique\n  web String @default("https://x") // url\n}\n' \
    > "$R/backend/prisma/schema.prisma"
  echo "// juguete" > "$R/backend/src/main.ts"
  local C="$R/backend/node_modules/.prisma/client/schema.prisma"
  case "$1" in
    viejo)  mkdir -p "$(dirname "$C")"; echo "// schema de antes" > "$C" ;;
    al-dia) mkdir -p "$(dirname "$C")"; ( cd "$R/backend" && CANARY_LOG=/dev/null "$BIN/npx" prisma generate ) ;;
  esac
  pid_propio "$R"
}
# corre <raíz> <FAKE_GEN> ⇒ deja salida en $R/salida.txt, log en $R/log.txt, rc en $RC
corre() {
  local R="$1"; : > "$R/log.txt"
  env -i PATH="${AWKDIR:+$AWKDIR:}$BIN:$PATH" HOME="$BASE" BACKEND_PORT=1 FRONTEND_PORT=2 S3_LOCAL_PORT=3 \
    STACK_EXPECTED_SHA=0123456789abcdef0123456789abcdef01234567 FAKE_GEN="$2" CANARY_LOG="$R/log.txt" \
    bash "$R/scripts/stack-native.sh" restart:backend > "$R/salida.txt" 2>&1
  RC=$?
}
log_de() { tr '\n' '|' < "$1/log.txt"; }
espera() {  # espera <raíz> <log esperado> <descripción>
  if [ "$(log_de "$1")" = "$2" ]; then ok "$3"
  else bad "$3 — log: $(log_de "$1") (esperaba $2)"; tail -5 "$1/salida.txt" | sed 's/^/      /'; fi
}
G="GENERATE|ARRANQUE cliente=al-dia|"; A="ARRANQUE cliente=al-dia|"
# Variantes de awk instaladas, cada una como `awk` en un directorio propio (caso 13).
AWKS=()
for v in mawk gawk busybox; do
  command -v "$v" >/dev/null 2>&1 || continue
  mkdir -p "$BASE/awk-$v"
  if [ "$v" = busybox ]; then
    busybox awk 'BEGIN{exit 0}' >/dev/null 2>&1 || continue
    printf '#!/bin/sh\nexec busybox awk "$@"\n' > "$BASE/awk-$v/awk"; chmod +x "$BASE/awk-$v/awk"
  else ln -s "$(command -v "$v")" "$BASE/awk-$v/awk"; fi
  AWKS+=("$v")
done

for ((r=1;r<=N;r++)); do
  printf '\n\033[1m== stack-native · cliente Prisma, ronda %s/%s ==\033[0m\n' "$r" "$N"
  arbol viejo; corre "$R" ok
  espera "$R" "$G" "1. cliente viejo ⇒ generate y arranque con el cliente al día"
  if cmp -s "$R/backend/prisma/schema.prisma" "$R/backend/node_modules/.prisma/client/schema.prisma"; then
    bad "1b. la copia del cliente es byte a byte el schema: el npx falso NO reformatea (el canario no mide)"
  else ok "1b. la copia del cliente está reformateada (como Prisma 5.22), no es byte a byte el schema"; fi
  pid_propio "$R"; corre "$R" ok
  espera "$R" "$A" "2. segunda pasada ya sellada ⇒ sin generate (idempotente)"
  arbol ausente; corre "$R" ok
  espera "$R" "$G" "3. sin cliente ⇒ generate y arranque al día"
  arbol al-dia; corre "$R" ok
  espera "$R" "$G" "4. cliente al día sin sello (npm ci) ⇒ generate una vez y arranque al día"
  pid_propio "$R"; printf 'enum Nuevo {\n  a\n}\n' >> "$R/backend/prisma/schema.prisma"; corre "$R" ok
  espera "$R" "$G" "5. sellado y luego schema editado ⇒ generate y arranque al día"
  pid_propio "$R"; echo "// schema de otra rama" > "$R/backend/node_modules/.prisma/client/schema.prisma"; corre "$R" ok
  espera "$R" "$G" "6. sellado y luego cliente de otro schema ⇒ generate y arranque al día"
  arbol viejo; corre "$R" fail
  if [ "$RC" -ne 0 ] && ! grep -q ARRANQUE "$R/log.txt" && grep -q 'prisma generate` falló' "$R/salida.txt"; then
    ok "7. generate falla ⇒ no arranca (rc=$RC) y dice el remedio"
  else bad "7. generate falla ⇒ rc=$RC log: $(log_de "$R")"; fi
  arbol viejo; corre "$R" noop
  if [ "$RC" -ne 0 ] && ! grep -q ARRANQUE "$R/log.txt" && grep -q 'sigue sin coincidir' "$R/salida.txt"; then
    ok "8. generate que no actualiza ⇒ no arranca (rc=$RC)"
  else bad "8. generate que no actualiza ⇒ rc=$RC log: $(log_de "$R")"; fi
  arbol viejo; corre "$R" fffd
  if [ "$(log_de "$R")" = "$G" ] && grep -q $'QU\xef\xbf\xbd' "$R/backend/node_modules/.prisma/client/schema.prisma" \
     && grep -q 'SOLO en comentarios' "$R/salida.txt"; then
    ok "10. generate parte un É de un comentario (U+FFFD) ⇒ arranca al día y avisa «solo en comentarios»"
  else bad "10. generate parte un É de un comentario ⇒ rc=$RC log: $(log_de "$R")"; tail -4 "$R/salida.txt" | sed 's/^/      /'; fi
  arbol viejo; corre "$R" codigo
  if [ "$RC" -ne 0 ] && ! grep -q ARRANQUE "$R/log.txt" && grep -q 'sigue sin coincidir' "$R/salida.txt"; then
    ok "11. generate que corrompe código ⇒ no arranca (rc=$RC)"
  else bad "11. generate que corrompe código ⇒ rc=$RC log: $(log_de "$R")"; fi
  arbol viejo; corre "$R" cadena
  if [ "$RC" -ne 0 ] && ! grep -q ARRANQUE "$R/log.txt" && grep -q 'sigue sin coincidir' "$R/salida.txt"; then
    ok "12. generate que cambia una cadena con // ⇒ no arranca (rc=$RC)"
  else bad "12. generate que cambia una cadena con // ⇒ rc=$RC log: $(log_de "$R")"; fi
  for v in "${AWKS[@]}"; do
    arbol viejo
    printf '\n\n   \t\nenum Otro {\n  a\n\n\n  b\n}\n' >> "$R/backend/prisma/schema.prisma"
    AWKDIR="$BASE/awk-$v" corre "$R" ok
    LS="$(wc -l < "$R/backend/prisma/schema.prisma")"; LC="$(wc -l < "$R/backend/node_modules/.prisma/client/schema.prisma" 2>/dev/null || echo 0)"
    if [ "$(log_de "$R")" = "$G" ] && [ "$LC" -lt "$LS" ] && grep -q 'sellado' "$R/salida.txt" \
       && ! grep -q 'SOLO en comentarios' "$R/salida.txt"; then
      ok "13. [$v] líneas vacías seguidas que generate colapsa ($LS ⇒ $LC líneas) ⇒ arranca al día, sin aviso falso"
    else bad "13. [$v] líneas vacías seguidas que generate colapsa ($LS ⇒ $LC líneas) ⇒ rc=$RC log: $(log_de "$R")"; grep -E 'sigue sin coincidir|SOLO en comentarios' "$R/salida.txt" | sed 's/^/      /'; fi
  done
  [ "${#AWKS[@]}" -gt 0 ] || bad "13. no hay mawk, gawk ni busybox awk instalados: el caso de líneas vacías no se midió"
done

# --- 9. Estáticos (dichos como tales: el camino `up` necesita Postgres) ---------------
UP="$(awk '/^  up\)/{f=1} f&&/^    ;;/{print; exit} f' "$STACK_SRC")"
if awk '/ensure_prisma_client/{e=NR} /seed_synthetic/{s=NR} END{exit !(e && s && e<s)}' <<<"$UP"; then
  ok "9. up: el cliente se pone al día antes de seed_synthetic (estático)"
else bad "9. up: seed_synthetic corre sin ensure_prisma_client antes (estático)"; fi
GEN="$(awk '/^generator client/{f=1} f{print} f&&/^}/{exit}' "$ROOT_DIR/backend/prisma/schema.prisma" 2>/dev/null)"
if [ -n "$GEN" ] && ! grep -qE '^\s*output\s*=' <<<"$GEN"; then
  ok "9. schema real: el generador usa la ruta por defecto (sin output)"
else bad "9. schema real: el generador declara output o no se encontró — la comparación de stack-native.sh mira otra ruta"; fi

for v in mawk gawk busybox; do case " ${AWKS[*]} " in *" $v "*) ;; *) printf '  · 13 con %s: NO MEDIDO (no instalado aquí)\n' "$v" ;; esac; done
printf '\n'
if [ "$FALLOS" -gt 0 ]; then printf '\033[1;31mROJO: %s/%s casos fallaron.\033[0m\n' "$FALLOS" "$((FALLOS+PASADAS))"; exit 1; fi
printf '\033[1;32mVERDE: %s/%s casos (N=%s): el backend nunca arranca con un cliente Prisma de otro schema.\033[0m\n' "$PASADAS" "$PASADAS" "$N"

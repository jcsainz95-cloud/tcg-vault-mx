#!/usr/bin/env bash
#
# sast-gitleaks-canary.sh — «¿gitleaks MUERDE con una clave de prueba real, y
# deja pasar los canarios por su RUTA?»                                · devops
# =============================================================================
# DE DÓNDE VIENE (S-GL-1 / C4 y P-GL-FP, 2026-09-11)
# ---------------------------------------------------------------------------
# · S-GL-1 (seguridad): la allowlist decía `sk_test_[0-9a-zA-Z_]*` — sin anclas
#   y con `*`, casaba CUALQUIER `sk_test_…`, incluida la clave de prueba REAL con
#   la que opera la tienda. Si se commiteaba por error, gitleaks la aprobaba.
# · P-GL-FP: los dos canarios de `scripts/` plantan secretos falsos por
#   construcción y ponían rojo el job (run 34554095125, 9 hallazgos). El arreglo
#   es permitirlos POR RUTA, no ensanchar ninguna regex.
#
# Las dos cosas se miden juntas porque chocan si se hacen por separado: cerrar
# la regex sin la ruta deja los canarios en rojo; abrir la ruta sin cerrar la
# regex deja la clave real en verde.
#
# QUÉ EXIGE (con el MISMO binario y la MISMA config que el job `gitleaks`):
#   ROJO  · una `sk_test_51` + 24 caracteres mixtos (forma de clave real) en un
#           fichero de la app;
#         · una `sk_live_…` y un `whsec_…` de forma real;
#         · el CONTENIDO de un canario copiado a OTRA ruta (la allowlist es por
#           ruta, no por contenido);
#         · en modo `git` (el que usa CI): commit con la clave real ⇒ rojo.
#         · P-GL-2 / CL-2 (2026-10-05): `sk_live_`, `rk_live_` y `whsec_` de
#           forma real plantadas en 5 sitios (backend/src, .md en la raíz,
#           docs/*.md, security/*.toml, docker-compose*.yml) ⇒ las tres vistas
#           en los 5: exige 5/5, en dir y en git. Con la exención por ruta
#           antigua salía 2/5;
#         · una ficción eximida por valor con dos caracteres de más ⇒ rojo.
#   VERDE · los dos canarios en SUS rutas exactas (dir y git);
#         · la ficción que ya vive en docs/ (eximida por VALOR exacto);
#         · los placeholders que el repo usa (`sk_test_dummy`, `sk_test_e2e_dummy`,
#           `pk_test_ci_dummy`, `sk_test_CHANGE_ME`, `sk_test_xxx…`);
#         · un árbol limpio.
#
# Uso:  ./security/scripts/sast-gitleaks-canary.sh
#       GITLEAKS_BIN=/ruta/gitleaks ./security/scripts/sast-gitleaks-canary.sh
# Sale 0 si todos los casos salen como deben; 1 con el caso exacto; 127 sin
# binario (NO es verde: el canario no pudo medir).
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEC_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${SEC_DIR}/.." && pwd)"
CONFIG="${GITLEAKS_CONFIG:-$SEC_DIR/gitleaks.toml}"
GL="${GITLEAKS_BIN:-gitleaks}"

command -v "$GL" >/dev/null 2>&1 || { echo "✗ gitleaks no está en PATH (GITLEAKS_BIN=…). El canario NO puede medir: eso no es verde."; exit 127; }
[ -f "$CONFIG" ] || { echo "✗ falta $CONFIG"; exit 1; }
for c in scripts/check-secret-defaults-canary.sh scripts/check-stripe-webhook-failclosed-canary.sh; do
  [ -f "$ROOT_DIR/$c" ] || { echo "✗ falta $c en el árbol: el canario no puede probar la allowlist por ruta."; exit 1; }
done

FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }

printf '\n\033[1m== ¿gitleaks muerde con una clave de prueba real y deja pasar los canarios por su ruta? ==\033[0m\n'
printf '   binario: %s · config: %s\n\n' "$("$GL" version 2>/dev/null | head -1)" "${CONFIG#"$ROOT_DIR"/}"

BASE="$(mktemp -d -t gitleaks-canario-XXXXXX)"; trap 'rm -rf "$BASE"' EXIT
N=0

# Claves de FICCIÓN con la FORMA de las reales (jamás valores reales).
# Se construyen por concatenación para que este propio fichero no las lleve
# escritas de una pieza (el escáner del repo también lo lee).
FAKE_SK_TEST="sk_test_51$(printf 'Qz7Lm3Np8Rt2Vx9Wk4Hb6Jd1Fg5Cs0Yq')"
FAKE_SK_LIVE="sk_live_51$(printf 'Ab3Cd4Ef5Gh6Ij7Kl8Mn9Op0Qr1St2Uv')"
FAKE_WHSEC="whsec_$(printf 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6')"

# `arbol <nombre>` → crea un árbol nuevo y devuelve su ruta.
arbol() { N=$((N+1)); local d="$BASE/t$N-$1"; mkdir -p "$d/backend/src" "$d/scripts"; printf '%s\n' 'export const ok = 1;' > "$d/backend/src/ok.ts"; echo "$d"; }

# `escaneo_dir <dir>` → rc de gitleaks dir con la config real.
escaneo_dir() { ( cd "$1" && "$GL" dir . --config "$CONFIG" --no-banner --exit-code 1 --report-format json --report-path "$1/.report.json" >"$1/.log" 2>&1 ); }
# `escaneo_git <dir>` → rc de gitleaks git (modo de CI) sobre un repo temporal.
escaneo_git() { ( cd "$1" && "$GL" git . --config "$CONFIG" --no-banner --exit-code 1 --report-format json --report-path "$1/.report.json" >"$1/.log" 2>&1 ); }
reglas() { jq -r '.[].RuleID' "$1/.report.json" 2>/dev/null | sort -u | paste -sd, - ; }
ficheros() { jq -r '.[].File' "$1/.report.json" 2>/dev/null | sort -u | paste -sd, - ; }

# `caso ROJO|VERDE dir|git <nombre> <dir> [regla_o_fichero_esperado]`
caso() {
  local esperado="$1" modo="$2" nombre="$3" dir="$4" debe="${5:-}" rc
  if [ "$modo" = git ]; then escaneo_git "$dir"; else escaneo_dir "$dir"; fi; rc=$?
  if [ "$esperado" = ROJO ]; then
    if [ "$rc" -eq 0 ]; then bad "$nombre — gitleaks VERDE (rc=0). Se dejó pasar."; return; fi
    if [ "$rc" -ne 1 ]; then bad "$nombre — gitleaks rc=$rc (no es un hallazgo: es un error). $(tail -1 "$dir/.log")"; return; fi
    # En variable y no en tubería: con `pipefail`, `grep -q` cierra el pipe al
    # primer match y el productor muere con SIGPIPE ⇒ falso rojo (medido aquí,
    # 4/11 falsos, y ya documentado en check-dast-gate-live.sh).
    local visto; visto="$(reglas "$dir"),$(ficheros "$dir")"
    if [ -n "$debe" ] && [[ "$visto" != *"$debe"* ]]; then
      bad "$nombre — rojo, pero no por «$debe» (visto: $visto)."; return
    fi
    ok "$nombre — ROJO (reglas: $(reglas "$dir"))."
  else
    if [ "$rc" -ne 0 ]; then bad "$nombre — gitleaks rc=$rc sobre algo legítimo (reglas: $(reglas "$dir"); ficheros: $(ficheros "$dir"))."; return; fi
    ok "$nombre — VERDE, como debe."
  fi
}

# --- Controles ---------------------------------------------------------------
D="$(arbol limpio)"
caso VERDE dir "árbol limpio" "$D"

# --- S-GL-1: la clave de prueba con forma REAL tiene que ser roja -------------
D="$(arbol sk-test-real)"
printf '%s\n' "export const STRIPE_KEY = '$FAKE_SK_TEST';" > "$D/backend/src/stripe.ts"
caso ROJO dir "sk_test_51 + 32 mixtos en backend/src (forma de clave real)" "$D" "stripe-access-token"

D="$(arbol sk-test-real-env)"
printf '%s\n' "STRIPE_SECRET_KEY=$FAKE_SK_TEST" > "$D/scripts/arranque.sh"
caso ROJO dir "la misma clave como \`STRIPE_SECRET_KEY=…\` en scripts/" "$D" "stripe-access-token"

D="$(arbol sk-live)"
printf '%s\n' "STRIPE_SECRET_KEY=$FAKE_SK_LIVE" > "$D/scripts/arranque.sh"
caso ROJO dir "sk_live_ con forma real" "$D"

D="$(arbol whsec)"
printf '%s\n' "STRIPE_WEBHOOK_SECRET=$FAKE_WHSEC" > "$D/scripts/arranque.sh"
caso ROJO dir "whsec_ con forma real" "$D" "stripe-webhook-secret"

# --- Los placeholders que el repo usa siguen pasando --------------------------
D="$(arbol placeholders)"
{
  echo 'STRIPE_SECRET_KEY=sk_test_dummy'
  echo 'STRIPE_SECRET_KEY=sk_test_e2e_dummy'
  echo 'STRIPE_SECRET_KEY=sk_test_CHANGE_ME'
  echo 'STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxx'
  echo 'STRIPE_SECRET_KEY=sk_test_dummydummydummydummy'
  echo 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_ci_dummy'
} > "$D/scripts/placeholders.sh"
caso VERDE dir "placeholders del repo (dummy / CHANGE_ME / sin dígitos)" "$D"

# --- P-GL-FP: los canarios pasan POR RUTA, no por contenido -------------------
D="$(arbol canarios-en-su-ruta)"
cp "$ROOT_DIR/scripts/check-secret-defaults-canary.sh" "$D/scripts/"
cp "$ROOT_DIR/scripts/check-stripe-webhook-failclosed-canary.sh" "$D/scripts/"
caso VERDE dir "los dos canarios en sus rutas exactas" "$D"

D="$(arbol canario-en-otra-ruta)"
cp "$ROOT_DIR/scripts/check-secret-defaults-canary.sh" "$D/scripts/otro-fichero.sh"
caso ROJO dir "el MISMO contenido de un canario en otra ruta" "$D" "scripts/otro-fichero.sh"

D="$(arbol canario-en-subcarpeta)"
mkdir -p "$D/tools/scripts"
cp "$ROOT_DIR/scripts/check-secret-defaults-canary.sh" "$D/tools/scripts/"
caso ROJO dir "el canario bajo tools/scripts/ (la ruta está anclada a la raíz)" "$D" "tools/scripts/check-secret-defaults-canary.sh"

# --- P-GL-2 / CL-2: una clave live se ve en TODOS los sitios -----------------
# Seguridad (2026-10-05, §3.1) plantó la misma `sk_live_` y un `whsec_` en 5
# sitios con este binario y esta config: 2/5. La allowlist GLOBAL eximía por
# ruta `docs/*.md`, `security/*.toml|md|yml` y `docker-compose*.yml` — justo
# donde se pega una clave al escribir una guía. Aquí se plantan las TRES formas
# live (`sk_live_`, `rk_live_`, `whsec_`) en los MISMOS 5 sitios y se exige que
# cada sitio dé hallazgo de las tres: 5/5. Con cualquiera de las tres rutas de
# vuelta en la allowlist, esto sale rojo y nombra el sitio que se escapa.
FAKE_RK_LIVE="rk_live_51$(printf 'Zy9Xw8Vu7Ts6Rq5Po4Nm3Lk2Ji1Hg0Fe')"
SITIOS_PGL2=(backend/src/plant.ts NOTA_RAIZ.md docs/NOTA_PLANT.md security/plant.toml docker-compose.plant.yml)
plantar_pgl2() {
  local d="$1"; mkdir -p "$d/docs" "$d/security"
  printf '%s\n' "export const K = '$FAKE_SK_LIVE';" "export const R = '$FAKE_RK_LIVE';" "export const W = '$FAKE_WHSEC';" > "$d/backend/src/plant.ts"
  printf '%s\n' "Pega esto en Railway: \`STRIPE_SECRET_KEY=$FAKE_SK_LIVE\`" "Restringida: \`$FAKE_RK_LIVE\`" "Webhook: \`$FAKE_WHSEC\`" > "$d/NOTA_RAIZ.md"
  cp "$d/NOTA_RAIZ.md" "$d/docs/NOTA_PLANT.md"
  printf '%s\n' "stripe_key = \"$FAKE_SK_LIVE\"" "stripe_rk = \"$FAKE_RK_LIVE\"" "stripe_whsec = \"$FAKE_WHSEC\"" > "$d/security/plant.toml"
  printf '%s\n' "services:" "  backend:" "    environment:" "      STRIPE_SECRET_KEY: $FAKE_SK_LIVE" "      STRIPE_RESTRICTED_KEY: $FAKE_RK_LIVE" "      STRIPE_WEBHOOK_SECRET: $FAKE_WHSEC" > "$d/docker-compose.plant.yml"
}
# `cinco_de_cinco <modo> <dir>` → exige, por cada sitio, un hallazgo de cada prefijo.
cinco_de_cinco() {
  local modo="$1" d="$2" rc s pref n falta vistos=0 escapan=""
  if [ "$modo" = git ]; then escaneo_git "$d"; else escaneo_dir "$d"; fi; rc=$?
  if [ "$rc" -ne 1 ]; then
    bad "P-GL-2 ($modo) — gitleaks rc=$rc sobre los 5 sitios plantados (esperado 1: hallazgos). $(tail -1 "$d/.log")"; return
  fi
  for s in "${SITIOS_PGL2[@]}"; do
    falta=""
    for pref in sk_live_ rk_live_ whsec_; do
      n="$(jq --arg f "$s" --arg p "$pref" '[.[] | select(.File == $f and (.Secret | startswith($p)))] | length' "$d/.report.json" 2>/dev/null)"
      [ "${n:-0}" -ge 1 ] || falta="$falta $pref"
    done
    if [ -z "$falta" ]; then vistos=$((vistos+1)); else escapan="$escapan $s(${falta# })"; fi
  done
  if [ "$vistos" -eq "${#SITIOS_PGL2[@]}" ]; then
    ok "P-GL-2 ($modo) — clave live (sk/rk/whsec) vista en ${vistos}/${#SITIOS_PGL2[@]} sitios, incluidos docs/*.md, security/*.toml y docker-compose*.yml."
  else
    bad "P-GL-2 ($modo) — clave live vista solo en ${vistos}/${#SITIOS_PGL2[@]} sitios. Se escapa en:${escapan}. ¿Volvió una exención POR RUTA a [allowlist].paths?"
  fi
}
D="$(arbol p-gl-2-cinco-sitios)"; plantar_pgl2 "$D"
cinco_de_cinco dir "$D"

# Las exenciones que sustituyen a las rutas son POR VALOR EXACTO: los valores de
# ficción que el repo ya tiene en docs/ pasan; uno de más (mismo prefijo, dos
# caracteres extra) vuelve a ser rojo. Sin esto, «por valor» podría degradar a
# un patrón amplio sin que el 5/5 de arriba lo notara.
D="$(arbol p-gl-2-ficcion-docs)"
mkdir -p "$D/docs"
{
  echo "solo ficción: \`sk_live_51ClaveRealDelDueno\` y \`PPT=ppt_live_ABC123\`"
  echo '  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",'
} > "$D/docs/NOTA.md"
caso VERDE dir "P-GL-2 — la ficción ya publicada en docs/ pasa por su VALOR exacto" "$D"

D="$(arbol p-gl-2-ancla)"
mkdir -p "$D/docs"
# Por concatenación: escrita de una pieza entraría al manifiesto de publicados.
echo "no es la ficción: \`sk_live_51ClaveRealDelDueno$(printf X7)\`" > "$D/docs/NOTA.md"
caso ROJO dir "P-GL-2 — la ficción con 2 caracteres de más en docs/ (el ancla no se afloja)" "$D" "docs/NOTA.md"

# --- Modo git (el de CI): mismas dos respuestas ------------------------------
if command -v git >/dev/null 2>&1; then
  D="$(arbol git-canarios)"
  cp "$ROOT_DIR/scripts/check-secret-defaults-canary.sh" "$D/scripts/"
  cp "$ROOT_DIR/scripts/check-stripe-webhook-failclosed-canary.sh" "$D/scripts/"
  git -C "$D" init -q && git -C "$D" add -A && git -C "$D" -c user.email=c@c -c user.name=c commit -qm "canarios"
  caso VERDE git "modo git: commit con los dos canarios en su ruta" "$D"

  D="$(arbol git-clave-real)"
  printf '%s\n' "export const STRIPE_KEY = '$FAKE_SK_TEST';" > "$D/backend/src/stripe.ts"
  git -C "$D" init -q && git -C "$D" add -A && git -C "$D" -c user.email=c@c -c user.name=c commit -qm "clave"
  caso ROJO git "modo git: commit con la clave de prueba de forma real" "$D" "stripe-access-token"

  D="$(arbol git-p-gl-2)"; plantar_pgl2 "$D"
  git -C "$D" init -q && git -C "$D" add -A && git -C "$D" -c user.email=c@c -c user.name=c commit -qm "guia con clave live"
  cinco_de_cinco git "$D"
else
  bad "sin git no puedo ejercitar el modo que usa CI."
fi

TOTAL=$((PASADAS+FALLOS))
printf '\n'
if [ "$FALLOS" -gt 0 ]; then
  printf '\033[1;31m✗ Canario de gitleaks: %s/%s. O la clave real pasa en verde (S-GL-1) o los canarios vuelven a ponerse rojos (P-GL-FP).\033[0m\n\n' "$PASADAS" "$TOTAL"
  exit 1
fi
printf '\033[1;32m✓ Canario de gitleaks: %s/%s — la clave de prueba real es roja, los canarios pasan por su ruta y solo por ella.\033[0m\n\n' "$PASADAS" "$TOTAL"
exit 0

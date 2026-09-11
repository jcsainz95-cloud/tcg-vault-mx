#!/usr/bin/env bash
#
# check-secret-masking.sh — «¿todo secreto que este repo GENERA sale tapado del
#                            log, y sale intacto por la tubería?»        · devops
# =============================================================================
# DE DÓNDE VIENE (`S-MASK-1`, 2026-09-11)
# ---------------------------------------------------------------------------
# Repo PÚBLICO. En el run `34650494939` el bloque `env:` de CADA paso imprimía en
# claro los secretos que el propio workflow genera: `POSTGRES_PASSWORD`,
# `MINIO_ROOT_PASSWORD`, `S3_SECRET_ACCESS_KEY`, `STAGING_JWT_ACCESS_SECRET`,
# `STAGING_JWT_REFRESH_SECRET`, `STAGING_PII_ENCRYPTION_KEY`, `STAGING_PII_HMAC_KEY`,
# `STAGING_POSTGRES_PASSWORD`, `STAGING_SEED_*`, `STRIPE_TEST_WEBHOOK_SECRET`,
# `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `SEED_ADMIN_PASSWORD`.
#
# GitHub tapa los secretos REGISTRADOS (`secrets.*` → `***`). Los GENERADOS no
# pasaron nunca por `::add-mask::`, así que no los tapa nadie.
#
#     ► «Un secreto que no está en el repo pero sí en el log público del repo
#        es exactamente el mismo secreto publicado.»
#
# Son efímeros y el stack se destruye ⇒ daño directo BAJO, y así queda dicho. Lo
# que NO es bajo es la clase: es `S-88-1` una capa más abajo, y dos de los valores
# son la pareja cifrado+HMAC de PII.
#
# QUÉ COMPRUEBA (las dos mitades, porque arreglar una rompiendo la otra es fácil)
# ---------------------------------------------------------------------------
#   1. **Tapado:** por cada `VAR=valor` generado, hay un `::add-mask::valor` en el
#      flujo que el runner lee. Si falta uno solo, rojo con el NOMBRE (nunca el valor).
#   2. **Intacto:** por `stdout` NO puede salir ni un `::add-mask::`. El valor nace
#      dentro de `$(...)`; una máscara por stdout se metería DENTRO del secreto y
#      el fallo aparecería ocho pasos más tarde, en el `compose`, apuntando al
#      sitio equivocado. Es justo el patrón de `S-88-1`.
#   3. **Sin ruido fuera de CI:** sin `GITHUB_ACTIONS=true` no se emite máscara
#      alguna (sale sola en la salida de un operador y no significa nada ahí).
#
# ⛔ Este guion NUNCA imprime un valor completo: solo nombres y longitudes.
#
# Uso:  ./scripts/check-secret-masking.sh
# Sale 0 si toda la clase está tapada; 1 con el nombre de lo que falta; 2 si no
# pudo medir.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR" || exit 2

SP="$ROOT_DIR/scripts/secrets-preflight.sh"
WP="$ROOT_DIR/scripts/webhook-secret-preflight.sh"
for f in "$SP" "$WP"; do
  [ -x "$f" ] || { echo "::error::falta $f (o no es ejecutable). NO concluyente."; exit 2; }
done

FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
mal() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }

TMP="$(mktemp -d -t secret-masking-XXXXXX)"; trap 'rm -rf "$TMP"' EXIT

echo "── Candado S-MASK-1 · ¿sale tapado del log lo que generamos? ──"

# ---------------------------------------------------------------------------
# 1) `secrets-preflight.sh github-env` — la ruta que alimenta `$GITHUB_ENV`.
#    Se pide el CATÁLOGO COMPLETO (el derivado de los compose), no una lista a
#    mano: una lista aquí volvería a ser «las siete variables» con otro disfraz,
#    y una forma nueva de secreto entraría sin que este candado se entere.
# ---------------------------------------------------------------------------
CAT="$(SECRETS_ENV=desechable "$SP" catalogo 2>/dev/null | tr '\n' ' ')"
if [ -z "$(printf '%s' "$CAT" | tr -d '[:space:]')" ]; then
  echo "::error::el catálogo de secretos salió vacío: no puedo saber qué debería taparse. NO concluyente."; exit 2
fi
# shellcheck disable=SC2086
SECRETS_ENV=desechable GITHUB_ACTIONS=true "$SP" github-env $CAT >"$TMP/out" 2>"$TMP/err" || {
  echo "::error::secrets-preflight github-env falló (rc≠0). NO concluyente."; exit 2; }

N=0; TAPADOS=0; SIN_TAPAR=""
while IFS='=' read -r k v; do
  [ -n "$k" ] || continue
  N=$((N+1))
  if grep -qF -- "::add-mask::$v" "$TMP/err"; then TAPADOS=$((TAPADOS+1)); else SIN_TAPAR="$SIN_TAPAR $k"; fi
done <"$TMP/out"

if [ "$N" -eq 0 ]; then
  echo "::error::github-env no generó ni un valor: el candado no estaría midiendo nada. NO concluyente."; exit 2
fi
if [ "$TAPADOS" -eq "$N" ]; then
  ok "github-env: $TAPADOS/$N valores generados llevan su \`::add-mask::\` (catálogo completo)"
else
  mal "github-env: SIN TAPAR ⇒$SIN_TAPAR  (tapados $TAPADOS/$N). Esos salen EN CLARO en el log público."
fi

grep -q '::add-mask::' "$TMP/out" \
  && mal "github-env: hay \`::add-mask::\` en STDOUT — se está metiendo dentro del valor y corrompe el secreto" \
  || ok "github-env: stdout limpio de máscaras (el valor viaja intacto por \$(...))"

# ---------------------------------------------------------------------------
# 2) `webhook-secret-preflight.sh resolve` — el secreto EFÍMERO de P-WH-1.
# ---------------------------------------------------------------------------
WH_OUT="$(STRIPE_WEBHOOK_UNREACHABLE=1 SECRETS_ENV=desechable GITHUB_ACTIONS=true \
  env -u STRIPE_WEBHOOK_SECRET -u STRIPE_TEST_WEBHOOK_SECRET -u STRIPE_SECRET_KEY \
  "$WP" resolve 2>"$TMP/wherr")"
if [ -z "$WH_OUT" ]; then
  mal "webhook resolve: no devolvió valor; no puedo comprobar su tapado"
else
  case "$WH_OUT" in
    *::add-mask::*) mal "webhook resolve: la máscara se coló DENTRO del secreto (stdout contaminado)" ;;
    *) ok "webhook resolve: el secreto sale limpio por stdout (longitud ${#WH_OUT})" ;;
  esac
  grep -qF -- "::add-mask::$WH_OUT" "$TMP/wherr" \
    && ok "webhook resolve: el secreto efímero lleva su \`::add-mask::\`" \
    || mal "webhook resolve: el secreto efímero NO se enmascara ⇒ sale en claro en el log público"
fi

# ---------------------------------------------------------------------------
# 3) `env-file` — la otra ruta de generación (arnés local y `dast-ephemeral.sh`).
# ---------------------------------------------------------------------------
: >"$TMP/envfile"
SECRETS_ENV=desechable GITHUB_ACTIONS=true "$SP" env-file "$TMP/envfile" >/dev/null 2>"$TMP/err2" || {
  mal "env-file: rc≠0"; }
NF=0; TF=0; FALTAN=""
while IFS='=' read -r k v; do
  case "$k" in ''|\#*) continue ;; esac
  [ -n "$v" ] || continue
  NF=$((NF+1))
  grep -qF -- "::add-mask::$v" "$TMP/err2" || { FALTAN="$FALTAN $k"; continue; }
  TF=$((TF+1))
done <"$TMP/envfile"
if [ "$NF" -gt 0 ]; then
  [ "$TF" -eq "$NF" ] && ok "env-file: $TF/$NF valores generados llevan su \`::add-mask::\`" \
    || mal "env-file: SIN TAPAR ⇒$FALTAN (tapados $TF/$NF)"
else
  ok "env-file: no generó valores nuevos en esta corrida (nada que tapar)"
fi

# ---------------------------------------------------------------------------
# 4) Fuera de CI, ni una máscara: la salida del operador no se ensucia.
# ---------------------------------------------------------------------------
# shellcheck disable=SC2086
SECRETS_ENV=desechable env -u GITHUB_ACTIONS "$SP" github-env $CAT >/dev/null 2>"$TMP/err3"
grep -q '::add-mask::' "$TMP/err3" \
  && mal "fuera de Actions se emiten máscaras (ruido que no significa nada ahí)" \
  || ok "fuera de Actions no se emite ninguna máscara"

echo
if [ "$FALLOS" -eq 0 ]; then
  printf '\033[1;32m✓ S-MASK-1: %s/%s — lo generado sale tapado del log y entero por la tubería.\033[0m\n' "$PASADAS" "$PASADAS"
  exit 0
fi
printf '\033[1;31m✗ S-MASK-1: %s fallo(s) de %s. Hay secretos generados que acaban EN CLARO en un log público.\033[0m\n' \
  "$FALLOS" "$((PASADAS+FALLOS))"
exit 1

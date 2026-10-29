#!/usr/bin/env bash
# =============================================================================
# check-dyn-prod-measure.sh — candado + canario de scripts/dyn-prod-measure.sh · devops · 2026-10-29
# -----------------------------------------------------------------------------
# Las dos consultas de §DYN (4.7 coste PSA y 5.9 casos vigentes) se corren en PRODUCCIÓN una sola
# vez, por el dueño, con un rol de solo lectura. Lo que no se puede permitir es que ese día el
# script falle, cuente mal o use una credencial que escribe. Este candado lo mide contra un
# Postgres LOCAL DESECHABLE: crea una base `dynm_<azar>` con las columnas que las consultas leen,
# siembra un caso conocido, y comprueba:
#   1. rol de solo lectura ⇒ rc 0 y las cifras exactas: 3 cartas raw publicadas de plataforma
#      (no cuenta la vendida, la de cliente ni la gradeada), 2 sets en alcance, 1 sin mapear,
#      W = 2 × 5 cartas de catálogo = 10; casos vigentes 2 con base y 1 sin base (no cuenta
#      `accepted`, ni el de sellado, ni el de producto);
#   2. rol que PUEDE ESCRIBIR ⇒ rc 2 y no imprime cifra;
#   3. base sin la tabla `PriceReviewCase` (M-75 sin aplicar) ⇒ rc 0, «0 casos»;
#   4. `--target prod` contra host local ⇒ rc 2;  sin DATABASE_URL_RO ⇒ rc 2.
# Al salir borra la base y los dos roles.
#
# Necesita un Postgres local y una vía de superusuario: ADMIN_DATABASE_URL (CI, servicio
# postgres) o, si falta, `su postgres` (máquina de desarrollo). Sin ninguna ⇒ rc 2.
# Uso:  ./scripts/check-dyn-prod-measure.sh [--canary]
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d -t dynm-XXXXXX)"
SUF="$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
DB="dynm_$SUF"; RO="dynm_ro_$SUF"; RW="dynm_rw_$SUF"
PW_RO="$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"; PW_RW="$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"
PGHOST_LOCAL="${PGHOST_LOCAL:-127.0.0.1}"; PGPORT_LOCAL="${PGPORT_LOCAL:-5432}"

admin() {  # SQL por stdin; $1 = base (opcional)
  if [ -n "${ADMIN_DATABASE_URL:-}" ]; then
    local u="$ADMIN_DATABASE_URL"; [ -z "${1:-}" ] || u="${u%/*}/$1"
    psql "$u" -X -q -At -v ON_ERROR_STOP=1 -f -
  else
    su postgres -s /bin/sh -c 'exec psql -X -q -At -v ON_ERROR_STOP=1 ${1:+-d "$1"} -f -' -- _ "${1:-}"
  fi
}
limpiar() {
  admin >/dev/null 2>&1 <<SQL
DROP DATABASE IF EXISTS "$DB";
DROP DATABASE IF EXISTS "${DB}_pre";
DROP ROLE IF EXISTS "$RO";
DROP ROLE IF EXISTS "$RW";
SQL
  rm -rf "$TMP"
}
trap limpiar EXIT
command -v psql >/dev/null || { echo "∅ sin psql (NO concluyente)"; exit 2; }
echo 'SELECT 1;' | admin >/dev/null 2>&1 || { echo "∅ sin vía de superusuario a Postgres (ADMIN_DATABASE_URL o su postgres) — NO concluyente"; exit 2; }

ESQUEMA="$(cat <<'SQL'
CREATE TABLE "CardSet" (id text PRIMARY KEY, "pptSetId" text);
CREATE TABLE "Card" (id text PRIMARY KEY, "setId" text NOT NULL REFERENCES "CardSet"(id));
CREATE TABLE "InventoryItem" (id text PRIMARY KEY, "cardId" text, "ownerType" text, status text, "productType" text);
INSERT INTO "CardSet" VALUES ('s1','ppt-1'),('s2',NULL),('s3','ppt-3');
INSERT INTO "Card" VALUES ('c1','s1'),('c2','s1'),('c3','s1'),('c4','s2'),('c5','s2'),('c6','s3');
INSERT INTO "InventoryItem" VALUES
  ('i1','c1','platform','listed','raw'),('i2','c2','platform','listed','raw'),
  ('i2b','c2','platform','listed','raw'),('i3','c4','platform','listed','raw'),
  ('i4','c3','platform','sold','raw'),('i5','c6','customer','listed','raw'),
  ('i6','c6','platform','listed','graded');
SQL
)"
PRC="$(cat <<'SQL'
CREATE TYPE "PriceReviewStatus" AS ENUM ('open','accepted','kept','manual','superseded');
CREATE TABLE "PriceReviewCase" (id text PRIMARY KEY, status "PriceReviewStatus", "baselineMxnCents" int,
  "cardProductId" text, "sealedProductId" text);
INSERT INTO "PriceReviewCase" VALUES ('r1','open',184,NULL,NULL),('r2','kept',500,NULL,NULL),
  ('r3','open',NULL,NULL,NULL),('r4','accepted',NULL,NULL,NULL),('r5','open',NULL,NULL,'sp1'),
  ('r6','kept',NULL,'cp1',NULL);
SQL
)"
GRANTS='GRANT USAGE ON SCHEMA public TO "@RO@","@RW@"; GRANT SELECT ON ALL TABLES IN SCHEMA public TO "@RO@";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "@RW@";'
GRANTS="${GRANTS//@RO@/$RO}"; GRANTS="${GRANTS//@RW@/$RW}"

admin >/dev/null <<SQL || { echo "∅ no pude crear la base desechable (NO concluyente)"; exit 2; }
CREATE ROLE "$RO" LOGIN PASSWORD '$PW_RO';
CREATE ROLE "$RW" LOGIN PASSWORD '$PW_RW';
CREATE DATABASE "$DB"; CREATE DATABASE "${DB}_pre";
GRANT CONNECT ON DATABASE "$DB" TO "$RO","$RW"; GRANT CONNECT ON DATABASE "${DB}_pre" TO "$RO","$RW";
SQL
printf '%s\n%s\n%s\n' "$ESQUEMA" "$PRC" "$GRANTS" | admin "$DB" >/dev/null || { echo "∅ esquema (NO concluyente)"; exit 2; }
printf '%s\n%s\n' "$ESQUEMA" "$GRANTS" | admin "${DB}_pre" >/dev/null || { echo "∅ esquema pre (NO concluyente)"; exit 2; }
URL_RO="postgresql://$RO:$PW_RO@$PGHOST_LOCAL:$PGPORT_LOCAL/$DB"
URL_RW="postgresql://$RW:$PW_RW@$PGHOST_LOCAL:$PGPORT_LOCAL/$DB"
URL_PRE="postgresql://$RO:$PW_RO@$PGHOST_LOCAL:$PGPORT_LOCAL/${DB}_pre"

comprobar() {  # $1 dyn-prod-measure.sh
  local f="$1" out rc fallos=0
  ok() { echo "  ✔ $*"; }
  ko() { echo "  ✗ $*"; fallos=$((fallos+1)); }
  out="$(DATABASE_URL_RO="$URL_RO" bash "$f" --target local 2>&1)"; rc=$?
  if [ "$rc" = 0 ] && printf '%s' "$out" | grep -qF '§DYN.4.7: 3 cartas, 2 sets (1 sin mapear), W=10/sem' \
     && printf '%s' "$out" | grep -qF '§DYN.5.9: 2 con base, 1 sin base'; then ok "solo lectura ⇒ rc 0 y cifras exactas (3/2/1/W=10 · 2 con base, 1 sin base)"
  else ko "solo lectura: rc=$rc — $(printf '%s' "$out" | grep -E 'PEGAR|^\|' -A1 | tail -n 1)$(printf '%s' "$out" | grep -m1 error)"; fi
  out="$(DATABASE_URL_RO="$URL_RW" bash "$f" --target local 2>&1)"; rc=$?
  { [ "$rc" = 2 ] && printf '%s' "$out" | grep -q 'PUEDE ESCRIBIR' && ! printf '%s' "$out" | grep -q '§DYN.4.7:'; } \
    && ok "rol con escritura ⇒ rc 2, sin cifras" || ko "rol con escritura: rc=$rc"
  out="$(DATABASE_URL_RO="$URL_PRE" bash "$f" --target local 2>&1)"; rc=$?
  { [ "$rc" = 0 ] && printf '%s' "$out" | grep -qF '§DYN.5.9: 0 con base, 0 sin base'; } \
    && ok "sin PriceReviewCase ⇒ rc 0 y 0 casos" || ko "sin PriceReviewCase: rc=$rc $(printf '%s' "$out" | grep -m1 error)"
  out="$(DATABASE_URL_RO="$URL_RO" bash "$f" --target prod 2>&1)"; rc=$?
  [ "$rc" = 2 ] && ok "--target prod con host local ⇒ rc 2" || ko "--target prod local: rc=$rc"
  out="$(env -u DATABASE_URL_RO bash "$f" --target local 2>&1)"; rc=$?
  [ "$rc" = 2 ] && ok "sin DATABASE_URL_RO ⇒ rc 2" || ko "sin URL: rc=$rc"
  [ "$fallos" = 0 ]
}

SRC="$ROOT_DIR/scripts/dyn-prod-measure.sh"
if [ "${1:-}" != "--canary" ]; then
  echo "== dyn-prod-measure.sh contra un Postgres local desechable =="
  comprobar "$SRC" && { echo "✓ OK"; exit 0; }
  echo "✗ ROJO"; exit 1
fi
echo "== Canario de check-dyn-prod-measure =="
comprobar "$SRC" >/dev/null 2>&1 || { echo "✗ el original ya está rojo: el canario no concluye"; exit 2; }
muerde=0; total=0
mutar() {
  total=$((total+1)); local m="$TMP/m$total.sh"; sed "$2" "$SRC" > "$m"
  cmp -s "$m" "$SRC" && { echo "  ✗ mutación '$1' no cambió nada (canario ciego)"; return; }
  if comprobar "$m" >/dev/null 2>&1; then echo "  ✗ '$1' ⇒ VERDE (el candado NO muerde)"
  else echo "  ✔ '$1' ⇒ ROJO"; muerde=$((muerde+1)); fi
}
mutar "no mira si el rol escribe"      's|awk -F.\\t. .\$3=="t". \| grep -q \.; then|false; then|'
mutar "cuenta también lo vendido"      "s|status='listed' AND \"productType\"='raw'|\"productType\"='raw'|"
mutar "casos sin filtrar por estado"   "s|WHERE status::text IN ('open','kept') AND|WHERE|"
mutar "W sin el ×2"                    's|^       2 \* (SELECT count(\*) FROM "Card"|       1 * (SELECT count(*) FROM "Card"|'
mutar "sin la tabla de casos revienta" 's|^\[ "\$HAY_PRC" = 1 \] \|\| SQL_PRC=""$|:|'
echo "Canario: $muerde/$total mutaciones salen ROJAS."
[ "$muerde" = "$total" ]

#!/usr/bin/env bash
#
# release-reservation-census-canary.sh — «¿el censo de C8 cuenta lo que dice
#                        contar, y se niega a contar cuando no debe?»    · devops
# =============================================================================
# DE DÓNDE VIENE (2026-09-11)
# ---------------------------------------------------------------------------
# `release-reservation-census.sh` produce las tres cifras con las que se cierra
# `SEC-SB-1`, y esas cifras **solo existen alrededor de la ventana de despliegue**:
# si salen mal, no hay segunda oportunidad para notarlo. Los dos modos de fallo
# que importan no son «el guion peta» —eso se ve—, sino:
#
#   1. **Contar lo que no es.** En fase PRE la columna `reservedByOrderId` NO
#      existe: la consulta literal de C8(a) muere con `42703`. Un guion que
#      tragase ese error y escribiese `0` cerraría `SEC-SB-1` con una mentira.
#   2. **Contar en el sitio equivocado.** Anotar como producción unas cifras de
#      la base de desarrollo. Sale un número plausible y nadie lo revisa nunca.
#
# Este canario levanta bases DESECHABLES en el Postgres local, con filas cuyo
# conteo se conoce de antemano, y exige que el guion REAL dé esos conteos y que
# aborte con rc=2 en cada camino en el que no puede saber.
#
# ⚠️ NO toca producción, NO toca la base del stack local: crea y destruye sus
# propias bases `c8_census_canary_*`.
#
# Uso:  ./scripts/release-reservation-census-canary.sh
#       (toma la credencial LOCAL de .native-stack/secrets.env, o de PGHOST/PGUSER/
#        PGPASSWORD/CANARY_ADMIN_URL si se pasan)
# Sale 0 si todos los casos salen como deben; 1 con el caso exacto; 2 si no hay
# Postgres local con el que medir (y eso NO es un verde).
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/release-reservation-census.sh"
[ -x "$SCRIPT" ] || { echo "✗ falta scripts/release-reservation-census.sh (o no es ejecutable)"; exit 1; }
command -v psql >/dev/null 2>&1 || { echo "✗ sin psql no puedo medir nada. NO concluyente."; exit 2; }

FALLOS=0; PASADAS=0
ok()   { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
mal()  { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }

# --- Credencial LOCAL para crear las bases desechables -----------------------
ADMIN_URL="${CANARY_ADMIN_URL:-}"
if [ -z "$ADMIN_URL" ] && [ -f "$ROOT_DIR/.native-stack/secrets.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$ROOT_DIR/.native-stack/secrets.env"; set +a
  [ -n "${NATIVE_DB_PASSWORD:-}" ] && ADMIN_URL="postgresql://tcg:${NATIVE_DB_PASSWORD}@127.0.0.1:5432/postgres"
fi
[ -n "$ADMIN_URL" ] || { echo "✗ sin credencial local (CANARY_ADMIN_URL o .native-stack/secrets.env). NO concluyente."; exit 2; }
psql "$ADMIN_URL" -Atc 'SELECT 1' >/dev/null 2>&1 || { echo "✗ no hay Postgres local accesible. NO concluyente."; exit 2; }

SUF="$$_$RANDOM"
DB_PRE="c8_census_canary_pre_$SUF"
DB_POST="c8_census_canary_post_$SUF"
limpia() { for d in "$DB_PRE" "$DB_POST"; do psql "$ADMIN_URL" -Atc "DROP DATABASE IF EXISTS \"$d\" WITH (FORCE);" >/dev/null 2>&1; done; }
trap limpia EXIT

url_de() { printf '%s' "${ADMIN_URL%/postgres}/$1"; }

DDL_COMUN=$(cat <<'EOSQL'
CREATE TYPE "InventoryStatus" AS ENUM ('in_stock','listed','reserved','in_custody','picking','shipped','delivered','lost','damaged','withdrawn');
CREATE TYPE "OrderStatus" AS ENUM ('pending','settled','failed','refunded','chargeback');
CREATE TYPE "SellRequestStatus" AS ENUM ('cotizada','ofertada','aceptada','en_transito','recibida','verificacion','aprobada','pagada','rechazada','abandonada','expirada');
CREATE TABLE "Order" ("id" TEXT PRIMARY KEY, "status" "OrderStatus" NOT NULL, "userId" TEXT);
CREATE TABLE "SellRequest" ("id" TEXT PRIMARY KEY, "status" "SellRequestStatus" NOT NULL,
  "closedAt" TIMESTAMP(3), "offerSentAt" TIMESTAMP(3), "receivedAt" TIMESTAMP(3), "verifiedAt" TIMESTAMP(3));
EOSQL
)

# ---------------------------------------------------------------------------
# Las CIFRAS ESPERADAS se escriben aquí y las filas se generan a partir de ellas:
# si alguien cambia una, el caso cambia con ella y no queda un número huérfano.
# ---------------------------------------------------------------------------
N_RESERVED_HUERFANAS=7     # `reserved` sin dueño  → (a) en las dos fases
N_RESERVED_CON_DUENO=4     # `reserved` CON dueño  → solo existe en POST; NO debe contar en (a)
N_NO_RESERVED=11           # otras filas de inventario → solo cuentan en (c)
N_ORDER_VAULT_PENDING=3    # pending con userId    → (b)  ⇒ dispara C9
N_ORDER_PENDING_INVITADO=2 # pending sin userId    → NO debe contar en (b)
N_ORDER_SETTLED=5          # settled con userId    → NO debe contar en (b)
N_COTIZADA_SIN_OFERTA=2
N_VERIF_SALTADA=3
C_ESPERADO=$((N_RESERVED_HUERFANAS + N_RESERVED_CON_DUENO + N_NO_RESERVED))

siembra_comun() { # $1 = url
  psql "$1" -v ON_ERROR_STOP=1 --no-psqlrc -q >/dev/null <<EOSQL
INSERT INTO "Order"("id","status","userId")
  SELECT 'o-v-'||g, 'pending', 'u-'||g FROM generate_series(1,$N_ORDER_VAULT_PENDING) g;
INSERT INTO "Order"("id","status","userId")
  SELECT 'o-g-'||g, 'pending', NULL FROM generate_series(1,$N_ORDER_PENDING_INVITADO) g;
INSERT INTO "Order"("id","status","userId")
  SELECT 'o-s-'||g, 'settled', 'u-s-'||g FROM generate_series(1,$N_ORDER_SETTLED) g;
INSERT INTO "SellRequest"("id","status","offerSentAt")
  SELECT 'sr-c-'||g, 'cotizada', NULL FROM generate_series(1,$N_COTIZADA_SIN_OFERTA) g;
INSERT INTO "SellRequest"("id","status","receivedAt","verifiedAt")
  SELECT 'sr-v-'||g, 'verificacion', NULL, NULL FROM generate_series(1,$N_VERIF_SALTADA) g;
INSERT INTO "SellRequest"("id","status","closedAt") VALUES ('sr-p-1','pagada', now());
EOSQL
}

echo "── Canario del censo C8 · bases desechables en el Postgres local ──"

# =============================================================================
# CASO PRE — la columna NO existe (producción HOY, antes de M-53)
# =============================================================================
psql "$ADMIN_URL" -Atc "CREATE DATABASE \"$DB_PRE\";" >/dev/null 2>&1 || { echo "✗ no pude crear la base desechable. NO concluyente."; exit 2; }
URL_PRE="$(url_de "$DB_PRE")"
psql "$URL_PRE" -v ON_ERROR_STOP=1 --no-psqlrc -q >/dev/null <<EOSQL
$DDL_COMUN
CREATE TABLE "InventoryItem" ("id" TEXT PRIMARY KEY, "status" "InventoryStatus" NOT NULL);
INSERT INTO "InventoryItem"("id","status") SELECT 'i-r-'||g, 'reserved'
  FROM generate_series(1,$((N_RESERVED_HUERFANAS + N_RESERVED_CON_DUENO))) g;
INSERT INTO "InventoryItem"("id","status") SELECT 'i-n-'||g, 'in_stock' FROM generate_series(1,$N_NO_RESERVED) g;
EOSQL
siembra_comun "$URL_PRE"

SAL_PRE="$(DATABASE_URL="$URL_PRE" "$SCRIPT" --target local 2>&1)"; RC_PRE=$?
[ "$RC_PRE" -eq 0 ] && ok "fase PRE: rc=0" || mal "fase PRE: rc=$RC_PRE (esperaba 0)"
grep -q 'fase medida : PRE' <<<"$SAL_PRE" && ok "fase PRE: la detecta sola (columna ausente ⇒ M-53 SIN aplicar)" \
  || mal "fase PRE: no la detectó. Salida: $(tr '\n' ' ' <<<"$SAL_PRE" | cut -c1-200)"
grep -qE '\(a\) reservas legadas [. ]+ '"$((N_RESERVED_HUERFANAS + N_RESERVED_CON_DUENO))"'( |$)' <<<"$SAL_PRE" \
  && ok "fase PRE: (a)=$((N_RESERVED_HUERFANAS + N_RESERVED_CON_DUENO)) — TODAS las \`reserved\`, que es el conjunto que M-53 dejará en NULL" \
  || mal "fase PRE: (a) no es $((N_RESERVED_HUERFANAS + N_RESERVED_CON_DUENO)). $(grep -F '(a) reservas' <<<"$SAL_PRE")"
grep -qE '\(b\) órdenes de bóveda pending c/dueño +'"$N_ORDER_VAULT_PENDING"'( |$)' <<<"$SAL_PRE" \
  && ok "fase PRE: (b)=$N_ORDER_VAULT_PENDING — ni las de invitado ni las \`settled\` se colaron" \
  || mal "fase PRE: (b) no es $N_ORDER_VAULT_PENDING. $(grep -F '(b) órdenes' <<<"$SAL_PRE")"
grep -qE '\(c\) filas de "InventoryItem" [. ]+ '"$C_ESPERADO"'( |$)' <<<"$SAL_PRE" \
  && ok "fase PRE: (c)=$C_ESPERADO filas (el dato del lock de CREATE INDEX de M-53)" \
  || mal "fase PRE: (c) no es $C_ESPERADO. $(grep -F '(c) filas' <<<"$SAL_PRE")"
grep -q 'C9 SE ABRE' <<<"$SAL_PRE" && ok "fase PRE: con (b)>0 grita que C9 SE ABRE y a quién le toca" \
  || mal "fase PRE: (b)>0 y no abrió C9"
grep -qE 'cotizada` SIN offerSentAt: '"$N_COTIZADA_SIN_OFERTA" <<<"$SAL_PRE" \
  && ok "paso 1 (d): cotizadas sin oferta = $N_COTIZADA_SIN_OFERTA" || mal "paso 1 (d) mal: $(grep -F 'offerSentAt' <<<"$SAL_PRE")"
grep -qE 'verificacion\|aprobada con receivedAt o verifiedAt NULL: '"$N_VERIF_SALTADA" <<<"$SAL_PRE" \
  && ok "paso 1 (e): verificación saltada = $N_VERIF_SALTADA" || mal "paso 1 (e) mal: $(grep -F 'verifiedAt NULL' <<<"$SAL_PRE")"

# La consulta LITERAL de C8(a) contra esta base tiene que MORIR. Es el motivo de
# que el guion tenga dos ramas: si aquí saliera un 0, C8 se cerraría con humo.
LIT="$(psql "$URL_PRE" -Atc 'SELECT count(*) FROM "InventoryItem" WHERE status='"'"'reserved'"'"' AND "reservedByOrderId" IS NULL;' 2>&1)"
grep -qiE 'does not exist|no existe' <<<"$LIT" \
  && ok "la consulta LITERAL de C8(a) contra el esquema de HOY falla (42703), no devuelve 0 — por eso el guion tiene fase PRE" \
  || mal "la consulta literal de C8(a) NO falló en PRE; devolvió: $LIT"

# =============================================================================
# CASO POST — M-53 aplicada; (a) tiene que contar SOLO las huérfanas
# =============================================================================
psql "$ADMIN_URL" -Atc "CREATE DATABASE \"$DB_POST\";" >/dev/null 2>&1
URL_POST="$(url_de "$DB_POST")"
psql "$URL_POST" -v ON_ERROR_STOP=1 --no-psqlrc -q >/dev/null <<EOSQL
$DDL_COMUN
CREATE TABLE "InventoryItem" ("id" TEXT PRIMARY KEY, "status" "InventoryStatus" NOT NULL,
  "reservedByOrderId" TEXT, "reservedUntil" TIMESTAMP(3));
INSERT INTO "InventoryItem"("id","status","reservedByOrderId") SELECT 'i-h-'||g, 'reserved', NULL
  FROM generate_series(1,$N_RESERVED_HUERFANAS) g;
INSERT INTO "InventoryItem"("id","status","reservedByOrderId") SELECT 'i-d-'||g, 'reserved', 'o-v-1'
  FROM generate_series(1,$N_RESERVED_CON_DUENO) g;
INSERT INTO "InventoryItem"("id","status") SELECT 'i-n-'||g, 'in_stock' FROM generate_series(1,$N_NO_RESERVED) g;
EOSQL
siembra_comun "$URL_POST"

SAL_POST="$(DATABASE_URL="$URL_POST" "$SCRIPT" --target local 2>&1)"; RC_POST=$?
[ "$RC_POST" -eq 0 ] && ok "fase POST: rc=0" || mal "fase POST: rc=$RC_POST (esperaba 0)"
grep -q 'fase medida : POST' <<<"$SAL_POST" && ok "fase POST: la detecta sola (columna presente)" || mal "fase POST: no la detectó"
grep -qE '\(a\) reservas legadas [. ]+ '"$N_RESERVED_HUERFANAS"'( |$)' <<<"$SAL_POST" \
  && ok "fase POST: (a)=$N_RESERVED_HUERFANAS — cuenta SOLO las huérfanas; las $N_RESERVED_CON_DUENO con dueño NO se cuelan" \
  || mal "fase POST: (a) no es $N_RESERVED_HUERFANAS. $(grep -F '(a) reservas' <<<"$SAL_POST")"
grep -q 'SEC-SB-1 tiene cuerpo' <<<"$SAL_POST" && ok "fase POST: con (a)>0 nombra SEC-SB-1 en vez de dejar un número mudo" \
  || mal "fase POST: (a)>0 y no nombró SEC-SB-1"

# =============================================================================
# LOS CAMINOS EN LOS QUE TIENE QUE NEGARSE A MEDIR
# =============================================================================
SAL="$(env -u DATABASE_URL "$SCRIPT" --target prod 2>&1)"; RC=$?
{ [ "$RC" -eq 2 ] && grep -q 'NO concluyente' <<<"$SAL"; } \
  && ok "sin DATABASE_URL: rc=2 y «NO concluyente» (no un 0 con cara de dato)" || mal "sin DATABASE_URL: rc=$RC"

SAL="$(DATABASE_URL="$URL_POST" "$SCRIPT" 2>&1)"; RC=$?
[ "$RC" -eq 2 ] && ok "sin --target: rc=2 (el declarante no puede quedar implícito)" || mal "sin --target: rc=$RC"

SAL="$(DATABASE_URL="$URL_POST" "$SCRIPT" --target prod 2>&1)"; RC=$?
{ [ "$RC" -eq 2 ] && grep -q 'host del DATABASE_URL es LOCAL' <<<"$SAL"; } \
  && ok "--target prod contra un host LOCAL: rc=2 — el error clásico del censo, cerrado" \
  || mal "--target prod contra localhost NO abortó (rc=$RC). Ése es justo el fallo que congela SEC-SB-1 con un número falso"

SAL="$(DATABASE_URL="$URL_POST" "$SCRIPT" --target local --phase pre 2>&1)"; RC=$?
{ [ "$RC" -eq 2 ] && grep -q "la base dice fase 'post'" <<<"$SAL"; } \
  && ok "--phase pre contra una base ya migrada: rc=2 («no estás donde crees»)" || mal "discrepancia de fase no detectada (rc=$RC)"

SAL="$(DATABASE_URL="postgresql://127.0.0.1:5432/no_existe_$SUF" "$SCRIPT" --target local 2>&1)"; RC=$?
{ [ "$RC" -eq 2 ] && ! grep -qE '\(a\) reservas legadas' <<<"$SAL"; } \
  && ok "base inalcanzable: rc=2 y NO imprime ninguna cifra" || mal "base inalcanzable: rc=$RC y/o imprimió cifras"

# --- Que la credencial no salga por pantalla (repo PÚBLICO) ------------------
PASS_LOCAL="$(node -e 'console.log(new URL(process.argv[1]).password)' "$URL_POST" 2>/dev/null)"
if [ -n "$PASS_LOCAL" ]; then
  TODO="$SAL_PRE$SAL_POST$SAL"
  grep -qF "$PASS_LOCAL" <<<"$TODO" && mal "la contraseña del DATABASE_URL aparece en la salida" \
    || ok "la contraseña NO aparece en ninguna salida (ni en el camino de error)"
  grep -qE 'huella del host [0-9a-f]{8}' <<<"$SAL_POST" \
    && ok "el objetivo se identifica por HUELLA (sha256/8), pegable en un doc público" || mal "no imprimió huella del host"
fi

# --- m-ro: que el preámbulo del guion sea DE VERDAD de solo lectura ----------
# Mutación sobre una COPIA: al mismo preámbulo se le cuela un INSERT. Si Postgres
# no lo mata con 25006, el «solo lee» del guion es una intención, no un candado.
RO="$(psql "$URL_POST" -v ON_ERROR_STOP=1 --no-psqlrc -Atc "
BEGIN TRANSACTION READ ONLY;
INSERT INTO \"Order\"(\"id\",\"status\",\"userId\") VALUES ('mutante','pending','u-x');
COMMIT;" 2>&1)"
grep -qiE '25006|read-only transaction|transacción de sólo lectura|solo lectura' <<<"$RO" \
  && ok "m-ro: con el preámbulo del guion, un INSERT muere (25006). «Solo lee» es un candado, no una promesa" \
  || mal "m-ro: el INSERT NO murió bajo BEGIN TRANSACTION READ ONLY. Salida: $RO"

echo
if [ "$FALLOS" -eq 0 ]; then
  printf '\033[1;32m✓ Canario del censo C8: %s/%s — cuenta lo que dice y se niega cuando no puede saber.\033[0m\n' "$PASADAS" "$PASADAS"
  exit 0
fi
printf '\033[1;31m✗ Canario del censo C8: %s fallo(s) de %s casos.\033[0m\n' "$FALLOS" "$((PASADAS+FALLOS))"
exit 1

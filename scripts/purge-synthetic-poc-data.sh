#!/usr/bin/env bash
# =============================================================================
# scripts/purge-synthetic-poc-data.sh — borra los datos que sembraron el red team
# y los PoC de QA/seguridad.   Propiedad: devops.   ·   TCG Vault MX
# =============================================================================
# POR QUÉ EXISTE
#   `docs/ARCHITECTURE.md` §9 (fila BL-35) lo pide con estas palabras: «el pentester
#   dejó filas sintéticas doble-pagadas en la BD local — **purgar antes de cualquier
#   snapshot**». QA lo levantó como MENOR-3. `docs/SECURITY_NOTES.md` §10 lista las
#   filas una a una.
#   Es SOLO LOCAL. Pero lo que hay ahí dentro es un libro de caja con pagos falsos:
#   una solicitud liquidada DOS veces (`SPEI-DOUBLESPEND-777`), dos liquidadas sin
#   haber recibido nunca la mercancía (`receivedAt = NULL`), y un usuario víctima con
#   CLABE y KYC sintéticos. Si eso llega a un snapshot o a un entorno compartido, deja
#   de ser evidencia y pasa a ser contaminación.
#
# CUÁNDO CORRERLO  ·  NO ES AUTOMÁTICO, Y ES A PROPÓSITO
#   Estas filas son la EVIDENCIA de un hallazgo abierto (BL-35 eje 2) y backend las
#   puede necesitar para su test de regresión. Por eso:
#     · El modo por defecto es SIMULACIÓN: hace el borrado dentro de una transacción
#       y la DESHACE. Reporta los números EXACTOS sin tocar un byte.
#     · Borrar de verdad exige `--apply`, escrito a mano, por una persona.
#     · No hay ningún gancho que lo llame solo. `stack-native.sh` NO lo invoca.
#
# QUÉ BORRA (cohorte declarada abajo en TARGETS, no adivinada)
#   A) Los 4 usuarios `redteam.*@e2e.local` y TODO lo que cuelga de ellos.
#   B) Las SellRequest marcadas como PoC por su `speiReference`.
#   C) Las filas de `AuditLog` de esos actores y las que apuntan a esas solicitudes
#      — el AuditLog no tiene FK a `User` (verificado), así que sin este paso el
#      libro de caja falso SOBREVIVE a la purga. Es justo lo que no queremos.
#
# QUÉ **NO** BORRA
#   · Los usuarios deterministas del seed (`customer@e2e.local`, `operator@…`,
#     `admin@…`): son el fixture, no contaminación. Dos de las tres solicitudes PoC
#     cuelgan de `customer@e2e.local`, así que se borran POR MARCA (su `speiReference`),
#     nunca por usuario.
#   · Nada de `Card`/`CardSet`/`ConfigSetting`/`PriceReference`: no es cohorte del PoC.
#
# POR QUÉ NO USA LA API
#   Va por SQL directo. Además de ser más rápido, esquiva un hecho medido por seguridad
#   (SECURITY_NOTES §10): los usuarios `redteam.*` NO loguean con la contraseña que
#   documentó el pentester (`*Pass123!` no casa con el hash argon2; `INVALID_CREDENTIALS`,
#   cuenta activa, sin lockout). Un script de purga que dependiera de esas credenciales
#   no funcionaría. Éste no las necesita.
#
# USO
#   ./scripts/purge-synthetic-poc-data.sh              # SIMULACRO (por defecto). No borra.
#   ./scripts/purge-synthetic-poc-data.sh --apply      # borra de verdad, en UNA transacción
#   ./scripts/purge-synthetic-poc-data.sh --census     # solo cuenta, sin simular el borrado
#   DATABASE_URL=… ./scripts/purge-synthetic-poc-data.sh --apply
#
# GARANTÍAS
#   · IDEMPOTENTE y REEJECUTABLE: la 2ª corrida encuentra 0 filas y sale 0.
#   · ATÓMICO: todo en una transacción. O se va la cohorte entera, o no se va nada.
#   · Con `lock_timeout`/`statement_timeout`: si el backend está escribiendo en esas
#     filas, falla en segundos en vez de quedarse colgado bloqueándolo.
#   · Se PLANTA (RAISE EXCEPTION, transacción abortada) antes que corromper:
#       - si un usuario redteam posee piezas de `InventoryItem` (el FK es SET NULL:
#         borrarlo convertiría bóveda de un cliente en stock de plataforma en silencio);
#       - si alguna pieza de inventario apunta a items de las solicitudes a purgar
#         (`InventoryItem.sourceSellRequestItemId` NO tiene FK: quedaría colgando);
#       - si la base no contiene usuarios `@e2e.local` (⇒ no es una base de fixtures
#         sintéticos y este script no pinta nada ahí).
#
# NO ESCRIBE SECRETOS. `DATABASE_URL` por defecto es la credencial de DESARROLLO LOCAL
# documentada en `.env.example` y usada por `stack-native.sh`; se enmascara al imprimir.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

MODE="dry-run"
for a in "${@:-}"; do
  case "$a" in
    --apply)  MODE="apply" ;;
    --census) MODE="census" ;;
    --dry-run|'') ;;
    -h|--help) sed -n '2,75p' "$0"; exit 0 ;;
    *) echo "purge-synthetic-poc-data: opción desconocida '$a' (usa --apply | --census | --dry-run)" >&2; exit 2 ;;
  esac
done

log()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ⚠ %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
mask_url() { printf '%s' "$1" | sed -E 's#(//[^:]+):[^@]+@#\1:****@#'; }

DATABASE_URL="${DATABASE_URL:-postgresql://tcg:tcg_local_dev_password@localhost:5432/tcg_marketplace?schema=public}"

# psql NO acepta parámetros de query que no sean suyos: con `?schema=public` (que es
# de Prisma) aborta con `invalid URI query parameter: "schema"`. MEDIDO, no supuesto.
PSQL_URL="${DATABASE_URL%%\?*}"

# --- Guardia de objetivo ------------------------------------------------------
# Un script que borra usuarios no se protege con una lista de lo prohibido, sino con
# una lista de lo permitido. Host local + nombre de base conocido + (más abajo, en
# SQL) la base tiene que contener fixtures `@e2e.local`.
DB_HOST="$(printf '%s' "$PSQL_URL" | sed -E 's#^[a-z+]+://([^@]*@)?([^:/?]+).*#\2#')"
DB_NAME="$(printf '%s' "$PSQL_URL" | sed -E 's#.*/([^/?]+)$#\1#')"
case "$DB_HOST" in
  localhost|127.0.0.1|::1|'') ;;
  *) die "OBJETIVO NO PERMITIDO: host '$DB_HOST'.
     Este script solo corre contra una base LOCAL. No es una limitación cosmética:
     borra usuarios y filas de dinero, y la única razón por la que es seguro es que
     los datos son sintéticos. Contra cualquier otro host, párate y piensa." ;;
esac
case "$DB_NAME" in
  tcg_marketplace|tcg_marketplace_test|tcg_marketplace_e2e) ;;
  *) die "OBJETIVO NO PERMITIDO: base '$DB_NAME' no está en la lista blanca
     (tcg_marketplace | tcg_marketplace_test | tcg_marketplace_e2e).
     Si de verdad necesitas otra, edítala en este fichero A PROPÓSITO." ;;
esac
[ "${NODE_ENV:-}" != "production" ] || die "NODE_ENV=production. No."

command -v psql >/dev/null 2>&1 || die "Falta \`psql\`."

log "Purga de datos sintéticos del red team y de los PoC"
echo "  objetivo : $(mask_url "$PSQL_URL")"
echo "  modo     : $MODE$( [ "$MODE" = dry-run ] && printf '  (SIMULACRO: borra dentro de una transacción y la deshace)' )"

# -----------------------------------------------------------------------------
# El SQL. Heredoc CITADO (<<'SQL'): el shell no expande NADA aquí dentro, así que no
# hay forma de que una variable del entorno se convierta en sintaxis SQL. Toda la
# cohorte está declarada como literales en este fichero, a la vista.
# -----------------------------------------------------------------------------
SQL_FILE="$(mktemp)"
trap 'rm -f "$SQL_FILE"' EXIT

cat > "$SQL_FILE" <<'SQL'
\set ON_ERROR_STOP on
BEGIN;

-- Si el backend está escribiendo justo en estas filas, prefiero fallar en 5s a
-- quedarme bloqueando su transacción.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ─── TARGETS ────────────────────────────────────────────────────────────────
-- (A) Usuarios sembrados por el red team. Ancla al dominio reservado de fixtures.
CREATE TEMP TABLE _rt_user ON COMMIT DROP AS
  SELECT id, email FROM "User"
   WHERE email ~ '^redteam\.[a-z0-9_.-]+@e2e\.local$';

-- (B) Solicitudes de venta de los PoC. Se identifican por MARCA en `speiReference`
--     (no por usuario): dos de las tres cuelgan de `customer@e2e.local`, que es un
--     usuario del fixture y NO se toca. Se añaden por id las tres documentadas en
--     SECURITY_NOTES §10, por si alguien limpiara la referencia a mano.
CREATE TEMP TABLE _poc_sr ON COMMIT DROP AS
  SELECT DISTINCT sr.id
    FROM "SellRequest" sr
   WHERE sr."speiReference" ~ '^(SPEI-DOUBLESPEND|SPEI-EJE2|QA-BL35|PENTEST-|POC-|REDTEAM-)'
      OR sr.id IN (
           'afc4ab63-4633-4b3f-80ab-2d98234f1719',  -- doble pago SPEI (P1)
           'b6e3b8e0-0c7b-4fd8-921e-cc8703267470',  -- PoC eje 2 (seguridad)
           '1f151cea-7953-44ec-b71b-2222cf63fb31'   -- PoC eje 2 (QA)
         )
      OR sr."userId" IN (SELECT id FROM _rt_user);

-- ─── PRECONDICIONES QUE BLOQUEAN ────────────────────────────────────────────
DO $guard$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM "User" WHERE email LIKE '%@e2e.local';
  IF n = 0 THEN
    RAISE EXCEPTION 'BLOQUEO: esta base no contiene NINGÚN usuario @e2e.local ⇒ no es una base de fixtures sintéticos. Este script no pinta nada aquí.';
  END IF;

  -- InventoryItem.ownerUserId es SET NULL: borrar al dueño convertiría en silencio
  -- bóveda de un cliente en stock de plataforma. Eso es corromper inventario, no
  -- limpiar. Antes se para.
  SELECT count(*) INTO n FROM "InventoryItem" WHERE "ownerUserId" IN (SELECT id FROM _rt_user);
  IF n > 0 THEN
    RAISE EXCEPTION 'BLOQUEO: % pieza(s) de InventoryItem pertenecen a usuarios redteam. Borrarlos las dejaría como stock de PLATAFORMA (el FK es SET NULL). Resuélvelo a mano y vuelve.', n;
  END IF;

  -- InventoryItem.sourceSellRequestItemId NO tiene FK (verificado en pg_constraint):
  -- nadie impediría dejarla apuntando al vacío.
  SELECT count(*) INTO n
    FROM "InventoryItem" ii
   WHERE ii."sourceSellRequestItemId" IN (
           SELECT sri.id FROM "SellRequestItem" sri WHERE sri."sellRequestId" IN (SELECT id FROM _poc_sr));
  IF n > 0 THEN
    RAISE EXCEPTION 'BLOQUEO: % pieza(s) de InventoryItem apuntan a items de las solicitudes a purgar y esa columna NO tiene FK: quedarían colgando. Resuélvelo a mano y vuelve.', n;
  END IF;
END
$guard$;

-- ─── CENSO ANTES ────────────────────────────────────────────────────────────
\echo ''
\echo '── CENSO ANTES ─────────────────────────────────────────────────────────'
SELECT 'usuarios redteam'          AS cohorte, count(*) AS filas FROM _rt_user
UNION ALL SELECT 'SellRequest PoC',          count(*) FROM _poc_sr
UNION ALL SELECT 'SellRequestItem (cascada)', count(*) FROM "SellRequestItem" WHERE "sellRequestId" IN (SELECT id FROM _poc_sr)
UNION ALL SELECT 'AuditLog del PoC',          count(*) FROM "AuditLog"
            WHERE "actorUserId" IN (SELECT id FROM _rt_user)
               OR ("entityType" = 'SellRequest' AND "entityId" IN (SELECT id FROM _poc_sr));

\echo ''
\echo '── LAS FILAS DE DINERO QUE SE VAN (para que quede constancia) ───────────'
SELECT sr.id, sr.status, sr."speiReference", sr."paidAt", sr."receivedAt", u.email
  FROM "SellRequest" sr LEFT JOIN "User" u ON u.id = sr."userId"
 WHERE sr.id IN (SELECT id FROM _poc_sr)
 ORDER BY sr."paidAt";

-- ─── BORRADO ────────────────────────────────────────────────────────────────
-- Orden dictado por los FK REALES (medidos en pg_constraint, no supuestos):
--   Dispute / Order / SellRequest / ShipmentRequest → User  son RESTRICT ⇒ van antes.
--   SellRequestItem, OrderItem, OrderAccessToken, ShipmentItem son CASCADE ⇒ solos.
--   Address / AuthToken / BillingProfile / KycProfile / PortfolioSnapshot son CASCADE
--   desde User, pero se borran explícitamente para poder CONTARLOS en el informe.
CREATE TEMP TABLE _purge_log (paso text, filas bigint) ON COMMIT DROP;

DO $purge$
DECLARE n bigint;
BEGIN
  DELETE FROM "AuditLog"
   WHERE "actorUserId" IN (SELECT id FROM _rt_user)
      OR ("entityType" = 'SellRequest' AND "entityId" IN (SELECT id FROM _poc_sr));
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO _purge_log VALUES ('AuditLog', n);

  DELETE FROM "ShipmentRequest" WHERE "userId" IN (SELECT id FROM _rt_user);
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO _purge_log VALUES ('ShipmentRequest (+ShipmentItem)', n);

  DELETE FROM "Dispute" WHERE "userId" IN (SELECT id FROM _rt_user);
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO _purge_log VALUES ('Dispute', n);

  DELETE FROM "SellRequest" WHERE id IN (SELECT id FROM _poc_sr);
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO _purge_log VALUES ('SellRequest (+SellRequestItem)', n);

  DELETE FROM "Order" WHERE "userId" IN (SELECT id FROM _rt_user);
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO _purge_log VALUES ('Order (+OrderItem, +OrderAccessToken)', n);

  DELETE FROM "KycProfile" WHERE "userId" IN (SELECT id FROM _rt_user);
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO _purge_log VALUES ('KycProfile (CLABE/INE sintéticos)', n);

  DELETE FROM "Address" WHERE "userId" IN (SELECT id FROM _rt_user);
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO _purge_log VALUES ('Address', n);

  DELETE FROM "BillingProfile" WHERE "userId" IN (SELECT id FROM _rt_user);
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO _purge_log VALUES ('BillingProfile', n);

  DELETE FROM "PortfolioSnapshot" WHERE "userId" IN (SELECT id FROM _rt_user);
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO _purge_log VALUES ('PortfolioSnapshot', n);

  DELETE FROM "SealedRestockSubscription" WHERE "userId" IN (SELECT id FROM _rt_user);
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO _purge_log VALUES ('SealedRestockSubscription', n);

  DELETE FROM "AuthToken" WHERE "userId" IN (SELECT id FROM _rt_user);
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO _purge_log VALUES ('AuthToken (sesiones)', n);

  DELETE FROM "User" WHERE id IN (SELECT id FROM _rt_user);
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO _purge_log VALUES ('User (redteam.*)', n);
END
$purge$;

\echo ''
\echo '── BORRADO ─────────────────────────────────────────────────────────────'
SELECT paso, filas FROM _purge_log WHERE filas > 0
UNION ALL SELECT '— total —', sum(filas) FROM _purge_log;

-- ─── VERIFICACIÓN DE CIERRE ─────────────────────────────────────────────────
-- No basta con haber ejecutado los DELETE: hay que comprobar que la cohorte YA NO
-- ESTÁ. Es el mismo criterio que el `down` del stack nativo (informar éxito por
-- haber lanzado los kills no es informar éxito).
DO $verify$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM "User" WHERE email ~ '^redteam\.[a-z0-9_.-]+@e2e\.local$';
  IF n > 0 THEN RAISE EXCEPTION 'VERIFICACIÓN FALLIDA: quedan % usuarios redteam.', n; END IF;

  SELECT count(*) INTO n FROM "SellRequest"
   WHERE "speiReference" ~ '^(SPEI-DOUBLESPEND|SPEI-EJE2|QA-BL35|PENTEST-|POC-|REDTEAM-)';
  IF n > 0 THEN RAISE EXCEPTION 'VERIFICACIÓN FALLIDA: quedan % SellRequest con marca de PoC.', n; END IF;

  SELECT count(*) INTO n FROM "AuditLog"
   WHERE "entityType" = 'SellRequest'
     AND "entityId" IN ('afc4ab63-4633-4b3f-80ab-2d98234f1719',
                        'b6e3b8e0-0c7b-4fd8-921e-cc8703267470',
                        '1f151cea-7953-44ec-b71b-2222cf63fb31');
  IF n > 0 THEN RAISE EXCEPTION 'VERIFICACIÓN FALLIDA: quedan % filas de AuditLog del PoC.', n; END IF;
END
$verify$;

\echo ''
\echo '── DESPUÉS: usuarios @e2e.local que SIGUEN en pie (el fixture, intacto) ─'
SELECT email, role FROM "User" WHERE email LIKE '%@e2e.local' ORDER BY email;
SQL

if [ "$MODE" = "census" ]; then
  # Censo: se corta antes del bloque de borrado. Se queda con lo que hay hasta
  # «LAS FILAS DE DINERO QUE SE VAN» y deshace la transacción.
  sed -i '/^-- ─── BORRADO/,$d' "$SQL_FILE"
  printf '\nROLLBACK;\n' >> "$SQL_FILE"
elif [ "$MODE" = "apply" ]; then
  printf '\nCOMMIT;\n' >> "$SQL_FILE"
else
  # SIMULACRO. Se ejecuta TODO —incluidos los DELETE y la verificación de cierre—
  # y se deshace. Por eso los números del simulacro son los REALES y no una
  # estimación: es el borrado de verdad, con marcha atrás.
  printf '\nROLLBACK;\n' >> "$SQL_FILE"
fi

set +e
psql "$PSQL_URL" -X -v ON_ERROR_STOP=1 -f "$SQL_FILE"
RC=$?
set -e

echo ""
if [ "$RC" -ne 0 ]; then
  die "La purga NO se aplicó (psql salió $RC). La transacción se deshizo entera:
     la base está EXACTAMENTE como estaba. Lee el error de arriba — si es un
     'BLOQUEO:', es una precondición a propósito, no un fallo del script."
fi

case "$MODE" in
  census)
    ok "Censo hecho. No se simuló ni se aplicó nada."
    echo "     Simulacro (borra y deshace):  $0"
    echo "     Aplicar de verdad:            $0 --apply" ;;
  dry-run)
    ok "SIMULACRO completo: el borrado se ejecutó y se DESHIZO. La base está intacta."
    warn "Los números de arriba son los reales. Para aplicarlos:  $0 --apply"
    warn "Antes de aplicar: confirma con BACKEND que ya no necesita estas filas para su"
    warn "test de regresión de BL-35 (son la evidencia del hallazgo)." ;;
  apply)
    ok "PURGA APLICADA y verificada en la misma transacción."
    ok "Reejecutable: una segunda corrida encontrará 0 filas y saldrá 0."
    echo ""
    echo "  Si necesitas volver a tener el fixture completo (sin la contaminación):"
    echo "      ./scripts/stack-native.sh up --seed"
    echo "  OJO: \`--seed\` es destructivo por diseño (borra el estado transaccional de los"
    echo "  usuarios del fixture). No lo corras si aún hay evidencia que conservar." ;;
esac

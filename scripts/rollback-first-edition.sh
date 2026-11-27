#!/usr/bin/env bash
#
# rollback-first-edition.sh — deja la BASE legible para el código anterior a §AUTO-ENLACE fase 4
#                             (production 9091542a) quitando todo uso del valor de enum `Finish.first_edition`.
#                             · Propiedad: devops · docs/DECISIONES.md §AUTO-ENLACE punto 16 (AE-8)
# =============================================================================
# POR QUÉ EXISTE
#   La migración `20261213120000_finish_first_edition` añade `first_edition` al enum "Finish". Desde la
#   primera corrida del job diario (y con cada decisión de `finish-review`) ese valor se escribe en filas.
#   El Prisma de 9091542a NO conoce ese valor: al leer CUALQUIER fila que lo tenga, falla. Postgres no
#   permite quitar un valor de un enum, así que la reversa no toca el tipo: quita las FILAS/valores.
#   `first_edition_holofoil` ya existía en 9091542a: el código viejo lo lee bien y NO se toca.
#
# CUÁNDO USARLO Y EN QUÉ ORDEN (obligatorio, DECISIONES §AUTO-ENLACE 16)
#   1. Apagar el job: ajuste `auto_link_enabled` = off (panel super_admin). Sin eso --apply se niega
#      (el job volvería a escribir `first_edition` en la siguiente corrida).
#   2. PREFERIR corregir hacia adelante. Este script es solo para cuando hay que REVERTIR EL CÓDIGO
#      a 9091542a (o anterior) habiendo corrido ya el código nuevo.
#   3. Con el código NUEVO aún desplegado: correr este script en simulación, revisar, y --apply.
#      (El código nuevo lee perfectamente la base ya limpia: no hay ventana rota.)
#   4. Comprobar conteo 0 (el --apply lo verifica dentro de su transacción; una 2.ª simulación da 0).
#   5. SOLO ENTONCES revertir el despliegue al código viejo. No hace falta tocar `_prisma_migrations`
#      ni el enum: `first_edition` se queda en el tipo, inerte sin filas.
#   6. Tras revertir: el recálculo de precios de venta (`ListingPrice`) del código viejo regenera las
#      filas borradas en su corrida diaria; hasta entonces esas piezas se precian en vivo.
#   ⛔ Si se corre con el código viejo YA desplegado, el viejo puede estar fallando mientras tanto:
#      por eso el paso 3 va ANTES del 5.
#
# QUÉ HACE --apply (UNA transacción; si algo falla, ROLLBACK y no cambia nada)
#   a) Listas `Finish[]`: quita `first_edition` de CardProduct.finishes, StampedProductCandidate.finishes,
#      Card.availableFinishes/catalogFinishes/pricedFinishesSnapshot/structuralFinishes. Si
#      `availableFinishes` queda vacía ⇒ {normal} (nunca vacía, invariante del esquema).
#   b) Precios derivados de ese acabado: BORRA PriceReference, PendingPriceEntry, VariantPriceOverride y
#      PriceReviewCase con finish = first_edition, y ListingPrice con llave `…|first_edition`
#      (se regeneran / no tienen equivalente en el código viejo; convertirlos a `normal` cobraría el
#      precio de 1.ª edición como Unlimited ⇒ prohibido).
#   c) InventoryItem con finish = first_edition: vuelve al acabado ANTERIOR que guarda la bitácora
#      (`AuditLog` action `catalog.finish_review`, decisión `first_edition`, `before.finish`); sin
#      bitácora ⇒ `normal` (1.ª edición no holo ≈ normal). Escribe una fila de AuditLog por pieza
#      (`devops.first_edition_rollback`, before/after). Si la carta no ofrece ese acabado, se añade a
#      `availableFinishes` (orden FINISH_ORDER).
#   d) WishlistItem / FeaturedSelectionItem: pasan a `normal`; si ya existe la gemela `normal`
#      (llave única), se borra la de first_edition.
#   e) REGISTROS DE NEGOCIO (OrderItem, SellRequestItem, SupplyRequest, SupplyPurchase,
#      SupplySuggestion): reescribir historia no lo decide un script. Si hay filas, --apply se NIEGA
#      salvo `--also-records`, que las pasa a `normal` (con respaldo). Escalar al dueño antes.
#   f) Verifica DENTRO de la transacción: 0 filas con first_edition en TODA columna de tipo
#      "Finish"/"Finish[]" (catálogo de Postgres, no lista a mano) y 0 ListingPrice `…|first_edition`.
#      Si no es 0 ⇒ ROLLBACK.
#   Antes de cambiar nada, respalda cada fila afectada (JSON, una por línea) en `--backup-dir`.
#
# MODOS
#   (sin flags)   SIMULACIÓN. `BEGIN TRANSACTION READ ONLY`: cuenta filas por columna, piezas con y sin
#                 bitácora, columnas desconocidas, estado de `auto_link_enabled`, e imprime la HUELLA.
#   --apply --confirm <huella> --backup-dir <dir> [--also-records]
#                 Aplica. La huella liga la aplicación a ESA base y a ESOS conteos: si algo cambió
#                 desde la simulación, se niega. Idempotente: una 2.ª corrida no encuentra nada.
#
# CÓDIGOS DE SALIDA
#   0  simulación: nada que hacer, o --apply dejaría la base legible · apply: aplicado y verificado.
#   1  simulación/apply: bloqueado (auto_link encendido, columna Finish desconocida con filas, o
#      registros de negocio sin --also-records). Nada cambiado.
#   2  NO CONCLUYENTE / rechazado (sin URL, sin psql/node, SQL falló ⇒ ROLLBACK, huella que no cuadra).
#
# USO (la credencial vive en TU shell; nunca en un fichero ni en el chat):
#   export DATABASE_URL='postgresql://…'
#   ./scripts/rollback-first-edition.sh
#   ./scripts/rollback-first-edition.sh --apply --confirm <huella> --backup-dir ./respaldo-fe
#   unset DATABASE_URL
#   El respaldo contiene datos de clientes (wishlist, pedidos): guárdalo fuera del repo y bórralo al cerrar.
# =============================================================================
set -uo pipefail

MODE="simulacion"; CONFIRM=""; BACKUP_DIR=""; ALSO_RECORDS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) MODE="apply"; shift ;;
    --confirm) CONFIRM="${2:-}"; shift 2 ;;
    --backup-dir) BACKUP_DIR="${2:-}"; shift 2 ;;
    --also-records) ALSO_RECORDS=1; shift ;;
    -h|--help) sed -n '2,70p' "$0"; exit 0 ;;
    *) echo "::error::opción desconocida '$1'. Uso: $0 [--apply --confirm <huella> --backup-dir <dir> [--also-records]]"; exit 2 ;;
  esac
done

command -v psql >/dev/null 2>&1 || { echo "::error::no hay \`psql\` en el PATH. NO concluyente."; exit 2; }
command -v node >/dev/null 2>&1 || { echo "::error::no hay \`node\` en el PATH. NO concluyente."; exit 2; }
command -v sha256sum >/dev/null 2>&1 || { echo "::error::no hay \`sha256sum\`. NO concluyente."; exit 2; }
[ -n "${DATABASE_URL:-}" ] || { echo "::error::sin DATABASE_URL no hay base. NO concluyente (exporta la variable en tu shell)."; exit 2; }

# URL de Prisma ⇒ URL de libpq (mismo parser que rollback-m61.sh). Del URL solo se imprime el nombre de la base.
PARSED="$(DBURL="$DATABASE_URL" node -e '
  let u; try { u = new URL(process.env.DBURL); } catch (e) { console.log("ERR"); process.exit(0); }
  const keep = new Set(["sslmode","sslrootcert","sslcert","sslkey","sslpassword","connect_timeout","application_name","target_session_attrs","options","channel_binding"]);
  const schema = u.searchParams.get("schema") || "public";
  for (const k of [...u.searchParams.keys()]) if (!keep.has(k)) u.searchParams.delete(k);
  const host = (u.hostname || "").toLowerCase();
  const db = decodeURIComponent((u.pathname || "").replace(/^\//, "")) || "(sin nombre)";
  const local = ["localhost","127.0.0.1","::1","0.0.0.0","db","postgres","host.docker.internal"].includes(host);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) { console.log("ERR"); process.exit(0); }
  console.log([u.toString(), schema, db, host + ":" + (u.port || "5432"), local ? "LOCAL" : "REMOTO"].join("\t"));
' 2>/dev/null)"
case "$PARSED" in ''|ERR*) echo "::error::DATABASE_URL no es un URL parseable. NO concluyente."; exit 2 ;; esac
IFS=$'\t' read -r PGURL SCHEMA DB_NAME HOSTPORT CLASE <<<"$PARSED"
export PGOPTIONS="-c search_path=${SCHEMA}"
PSQL=(psql "$PGURL" -X -q -v ON_ERROR_STOP=1 -At -F $'\t')
podar() { sed -E 's#postgres(ql)?://[^ ]*#postgresql://<oculto>#g'; }

# Clasificación de cada columna conocida de tipo Finish / Finish[] (schema.prisma en HEAD de §AUTO-ENLACE).
declare -A KIND=(
  [CardProduct.finishes]=array [StampedProductCandidate.finishes]=array
  [Card.availableFinishes]=array [Card.catalogFinishes]=array [Card.pricedFinishesSnapshot]=array [Card.structuralFinishes]=array
  [PriceReference.finish]=delete [PendingPriceEntry.finish]=delete [VariantPriceOverride.finish]=delete [PriceReviewCase.finish]=delete
  [InventoryItem.finish]=inventory
  [WishlistItem.finish]=dedup [FeaturedSelectionItem.finish]=dedup
  [OrderItem.finish]=record [SellRequestItem.finish]=record [SupplyRequest.finish]=record [SupplyPurchase.finish]=record [SupplySuggestion.finish]=record
)

# --------------------------------------------------------------------------- medición (solo lectura)
medir() {
  "${PSQL[@]}" 2>&1 <<'SQL'
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '120s';
SELECT 'enum_tiene_valor', count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
 WHERE t.typname = 'Finish' AND e.enumlabel = 'first_edition' AND t.typnamespace = current_schema()::regnamespace;
SELECT 'auto_link', coalesce((SELECT "valueJson" #>> '{}' FROM "ConfigSetting" WHERE "key" = 'auto_link_enabled'), '(sin fila ⇒ on)');
-- Toda columna de tipo Finish o Finish[] del esquema (catálogo), con su conteo de filas que usan first_edition.
SELECT CASE WHEN t.typname = 'Finish'
         THEN format('SELECT %L, count(*) FROM %I.%I WHERE %I = ''first_edition''', 'col' || chr(9) || c.relname || '.' || a.attname, n.nspname, c.relname, a.attname)
         ELSE format('SELECT %L, count(*) FROM %I.%I WHERE ''first_edition'' = ANY (%I)', 'col' || chr(9) || c.relname || '.' || a.attname, n.nspname, c.relname, a.attname) END
  FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE t.typname IN ('Finish', '_Finish') AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped AND n.nspname = current_schema()
 ORDER BY c.relname, a.attname
\gexec
SELECT 'listing_price', count(*) FROM "ListingPrice" WHERE right("variantKey", 14) = '|first_edition';
SELECT 'inv_con_bitacora', count(*) FROM "InventoryItem" i WHERE i."finish" = 'first_edition' AND EXISTS (
  SELECT 1 FROM "AuditLog" x WHERE x."action" = 'catalog.finish_review' AND x."entityId" = i."id" AND x."after"->>'decision' = 'first_edition');
SELECT 'card_vacia_tras_quitar', count(*) FROM "Card" WHERE "availableFinishes" = ARRAY['first_edition']::"Finish"[];
COMMIT;
SQL
}

OUT="$(medir)"; rc=$?
if [ $rc -ne 0 ]; then echo "::error::la medición falló (rc=$rc). NO concluyente:"; echo "$OUT" | podar; exit 2; fi
val() { awk -F'\t' -v k="$1" '$1==k{print $2}' <<<"$OUT"; }

echo "== rollback-first-edition · modo: $MODE · base: $DB_NAME ($CLASE) · esquema: $SCHEMA"
ENUM_HAS="$(val enum_tiene_valor)"
echo "   valor de enum Finish.first_edition presente: $([ "$ENUM_HAS" = 1 ] && echo sí || echo no)"
if [ "$ENUM_HAS" != 1 ]; then
  echo "== La migración 20261213120000_finish_first_edition no está aplicada: ninguna fila puede tener first_edition. Nada que hacer."
  exit 0
fi
AUTO="$(val auto_link)"; echo "   auto_link_enabled: $AUTO"

TOTAL=0; UNKNOWN=0; RECORDS=0; FP_SRC="$HOSTPORT/$DB_NAME/$SCHEMA"
printf '   %-42s %-10s %s\n' "columna" "acción" "filas con first_edition"
while IFS=$'\t' read -r tag col n; do
  [ "$tag" = col ] || continue
  k="${KIND[$col]:-DESCONOCIDA}"
  printf '   %-42s %-10s %s\n' "$col" "$k" "$n"
  FP_SRC+="|$col=$n"; TOTAL=$((TOTAL + n))
  if [ "$n" -gt 0 ]; then
    [ "$k" = DESCONOCIDA ] && UNKNOWN=$((UNKNOWN + n))
    [ "$k" = record ] && RECORDS=$((RECORDS + n))
  fi
done <<<"$OUT"
LP="$(val listing_price)"; INV_AUD="$(val inv_con_bitacora)"; VACIAS="$(val card_vacia_tras_quitar)"
printf '   %-42s %-10s %s\n' "ListingPrice.variantKey (…|first_edition)" "delete" "$LP"
FP_SRC+="|lp=$LP|invaud=$INV_AUD"; TOTAL=$((TOTAL + LP))
echo "   InventoryItem: $INV_AUD de ellas vuelven al acabado de la bitácora; el resto ⇒ normal"
echo "   Card cuya availableFinishes era solo {first_edition} (⇒ {normal}): $VACIAS"
HUELLA="$(printf '%s' "$FP_SRC" | sha256sum | cut -c1-12)"
echo "   TOTAL filas a tocar: $TOTAL · huella: $HUELLA"

BLOCK=0
if [ "$TOTAL" -gt 0 ] && [ "$AUTO" != off ]; then echo "::error::auto_link_enabled no está en off: apágalo primero (paso 1), o el job vuelve a escribir first_edition."; BLOCK=1; fi
if [ "$UNKNOWN" -gt 0 ]; then echo "::error::hay $UNKNOWN fila(s) en columnas Finish que este script no conoce (DESCONOCIDA). Escalar a backend/devops; no se aplica."; BLOCK=1; fi
if [ "$RECORDS" -gt 0 ] && [ "$ALSO_RECORDS" != 1 ]; then echo "::error::hay $RECORDS fila(s) en registros de negocio (record). Escalar al dueño; para pasarlas a 'normal' añade --also-records."; BLOCK=1; fi

if [ "$MODE" = simulacion ]; then
  if [ "$TOTAL" -eq 0 ]; then echo "== Conteo 0 en todas las columnas Finish: el código viejo (9091542a) puede leer la base."; exit 0; fi
  [ "$BLOCK" = 1 ] && { echo "== SIMULACIÓN: BLOQUEADO (ver errores). Nada cambiado."; exit 1; }
  echo "== SIMULACIÓN: nada cambiado. Para aplicar: $0 --apply --confirm $HUELLA --backup-dir <dir>$([ "$ALSO_RECORDS" = 1 ] && echo ' --also-records')"
  exit 0
fi

# --------------------------------------------------------------------------- apply
[ "$CONFIRM" = "$HUELLA" ] || { echo "::error::--confirm '$CONFIRM' no cuadra con la huella actual '$HUELLA' (otra base o los conteos cambiaron). Vuelve a simular."; exit 2; }
if [ "$TOTAL" -eq 0 ]; then echo "== Nada que aplicar (idempotente): conteo 0."; exit 0; fi
[ "$BLOCK" = 1 ] && { echo "== APPLY: BLOQUEADO. Nada cambiado."; exit 1; }
[ -n "$BACKUP_DIR" ] || { echo "::error::--apply exige --backup-dir <dir> (respaldo de las filas afectadas)."; exit 2; }
mkdir -p "$BACKUP_DIR" || { echo "::error::no se pudo crear $BACKUP_DIR"; exit 2; }
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"
case "$BACKUP_DIR" in *"'"*|*'\'*) echo "::error::--backup-dir no puede llevar comillas ni barras invertidas."; exit 2 ;; esac
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"; B="$BACKUP_DIR/fe-$STAMP"

SQLF="$(mktemp)"; trap 'rm -f "$SQLF"' EXIT
{
cat <<'SQL'
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '600s';
CREATE TEMP TABLE _fe_inv ON COMMIT DROP AS
SELECT i."id", i."cardId",
       CASE WHEN a.prev IN ('normal', 'holofoil') THEN a.prev ELSE 'normal' END::"Finish" AS restore_to,
       (a.prev IS NOT NULL) AS from_audit
  FROM "InventoryItem" i
  LEFT JOIN LATERAL (
    SELECT coalesce(x."before"->>'finish', x."after"->'before'->>'finish') AS prev
      FROM "AuditLog" x
     WHERE x."action" = 'catalog.finish_review' AND x."entityId" = i."id" AND x."after"->>'decision' = 'first_edition'
     ORDER BY x."createdAt" DESC LIMIT 1) a ON true
 WHERE i."finish" = 'first_edition';
SQL
# Respaldos (una fila JSON por línea) ANTES de cambiar nada, dentro de la misma transacción.
bk() { printf "\\\\o '%s.%s.jsonl'\nSELECT row_to_json(t) FROM \"%s\" t WHERE %s;\n\\\\o\n" "$B" "$1" "$1" "$2"; }
bk Card "'first_edition' = ANY (t.\"availableFinishes\") OR 'first_edition' = ANY (t.\"catalogFinishes\") OR 'first_edition' = ANY (t.\"pricedFinishesSnapshot\") OR 'first_edition' = ANY (t.\"structuralFinishes\") OR t.\"id\" IN (SELECT \"cardId\" FROM _fe_inv)"
bk CardProduct "'first_edition' = ANY (t.\"finishes\")"
bk StampedProductCandidate "'first_edition' = ANY (t.\"finishes\")"
for tb in PriceReference PendingPriceEntry VariantPriceOverride PriceReviewCase InventoryItem WishlistItem FeaturedSelectionItem OrderItem SellRequestItem SupplyRequest SupplyPurchase SupplySuggestion; do
  bk "$tb" "t.\"finish\" = 'first_edition'"
done
bk ListingPrice "right(t.\"variantKey\", 14) = '|first_edition' OR t.\"inventoryItemId\" IN (SELECT \"id\" FROM _fe_inv)"
cat <<'SQL'
-- a) listas Finish[]
UPDATE "CardProduct" SET "finishes" = array_remove("finishes", 'first_edition') WHERE 'first_edition' = ANY ("finishes");
UPDATE "StampedProductCandidate" SET "finishes" = array_remove("finishes", 'first_edition') WHERE 'first_edition' = ANY ("finishes");
UPDATE "Card" SET "availableFinishes" = array_remove("availableFinishes", 'first_edition'),
                  "catalogFinishes" = array_remove("catalogFinishes", 'first_edition'),
                  "pricedFinishesSnapshot" = array_remove("pricedFinishesSnapshot", 'first_edition'),
                  "structuralFinishes" = array_remove("structuralFinishes", 'first_edition')
 WHERE 'first_edition' = ANY ("availableFinishes") OR 'first_edition' = ANY ("catalogFinishes")
    OR 'first_edition' = ANY ("pricedFinishesSnapshot") OR 'first_edition' = ANY ("structuralFinishes");
UPDATE "Card" SET "availableFinishes" = ARRAY['normal']::"Finish"[] WHERE cardinality("availableFinishes") = 0;
-- b) precios derivados del acabado
DELETE FROM "ListingPrice" WHERE right("variantKey", 14) = '|first_edition' OR "inventoryItemId" IN (SELECT "id" FROM _fe_inv);
DELETE FROM "PriceReference" WHERE "finish" = 'first_edition';
DELETE FROM "PendingPriceEntry" WHERE "finish" = 'first_edition';
DELETE FROM "VariantPriceOverride" WHERE "finish" = 'first_edition';
DELETE FROM "PriceReviewCase" WHERE "finish" = 'first_edition';
-- c) piezas: acabado anterior de la bitácora (o normal) + rastro en AuditLog
UPDATE "InventoryItem" i SET "finish" = r.restore_to FROM _fe_inv r WHERE i."id" = r."id";
INSERT INTO "AuditLog" ("id", "actorUserId", "actorRole", "action", "entityType", "entityId", "before", "after", "createdAt")
SELECT gen_random_uuid()::text, NULL, NULL, 'devops.first_edition_rollback', 'InventoryItem', r."id",
       jsonb_build_object('finish', 'first_edition'),
       jsonb_build_object('finish', r.restore_to, 'fromAudit', r.from_audit, 'script', 'scripts/rollback-first-edition.sh'),
       now()
  FROM _fe_inv r;
UPDATE "Card" c SET "availableFinishes" = ARRAY(
         SELECT f FROM unnest(ARRAY['normal','reverse_holo','holofoil','first_edition_holofoil']::"Finish"[]) WITH ORDINALITY u(f, o)
          WHERE f = ANY (c."availableFinishes") OR f IN (SELECT r.restore_to FROM _fe_inv r WHERE r."cardId" = c."id")
          ORDER BY o)
 WHERE c."id" IN (SELECT r."cardId" FROM _fe_inv r WHERE NOT (r.restore_to = ANY (c."availableFinishes")));
-- d) deseos y selección destacada: a normal; si ya existe la gemela normal, se borra la de first_edition
DELETE FROM "WishlistItem" w WHERE w."finish" = 'first_edition' AND EXISTS (
  SELECT 1 FROM "WishlistItem" o WHERE o."userId" = w."userId" AND o."cardId" = w."cardId" AND o."finish" = 'normal');
UPDATE "WishlistItem" SET "finish" = 'normal' WHERE "finish" = 'first_edition';
DELETE FROM "FeaturedSelectionItem" s WHERE s."finish" = 'first_edition' AND EXISTS (
  SELECT 1 FROM "FeaturedSelectionItem" o WHERE o."businessDate" = s."businessDate" AND o."cardId" = s."cardId"
     AND o."productType" = s."productType" AND o."gradeKey" = s."gradeKey" AND o."finish" = 'normal');
UPDATE "FeaturedSelectionItem" SET "finish" = 'normal' WHERE "finish" = 'first_edition';
SQL
if [ "$ALSO_RECORDS" = 1 ]; then
  for tb in OrderItem SellRequestItem SupplyRequest SupplyPurchase SupplySuggestion; do
    printf 'UPDATE "%s" SET "finish" = '"'"'normal'"'"' WHERE "finish" = '"'"'first_edition'"'"';\n' "$tb"
  done
fi
cat <<'SQL'
-- f) verificación dentro de la transacción: si queda algo, ROLLBACK
DO $$
DECLARE r record; n bigint; total bigint := 0;
BEGIN
  FOR r IN SELECT c.relname, a.attname, t.typname FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid JOIN pg_class c ON c.oid = a.attrelid
            WHERE t.typname IN ('Finish', '_Finish') AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped AND c.relnamespace = current_schema()::regnamespace
  LOOP
    IF r.typname = 'Finish' THEN EXECUTE format('SELECT count(*) FROM %I WHERE %I = ''first_edition''', r.relname, r.attname) INTO n;
    ELSE EXECUTE format('SELECT count(*) FROM %I WHERE ''first_edition'' = ANY (%I)', r.relname, r.attname) INTO n; END IF;
    IF n > 0 THEN RAISE WARNING 'quedan % fila(s) en %.%', n, r.relname, r.attname; END IF;
    total := total + n;
  END LOOP;
  SELECT count(*) INTO n FROM "ListingPrice" WHERE right("variantKey", 14) = '|first_edition'; total := total + n;
  IF total > 0 THEN RAISE EXCEPTION 'verificación: quedan % fila(s) con first_edition; ROLLBACK', total; END IF;
END $$;
SELECT 'reverted_inventory', count(*), count(*) FILTER (WHERE from_audit) FROM _fe_inv;
COMMIT;
SQL
} >"$SQLF"

AOUT="$("${PSQL[@]}" -f "$SQLF" 2>&1)"; rc=$?
if [ $rc -ne 0 ]; then echo "::error::--apply falló (rc=$rc) ⇒ ROLLBACK, nada cambiado:"; echo "$AOUT" | podar; exit 2; fi
echo "$AOUT" | podar | awk -F'\t' '$1=="reverted_inventory"{print "   piezas devueltas: " $2 " (de bitácora: " $3 ")"; next} {print "   " $0}'
echo "   respaldo: $B.*.jsonl"
echo "== APLICADO y verificado en la misma transacción: 0 filas con first_edition en columnas Finish y en ListingPrice."
echo "   Siguiente: revertir el despliegue al código viejo (paso 5 de la cabecera)."
exit 0

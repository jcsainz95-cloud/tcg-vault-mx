#!/usr/bin/env bash
#
# rollback-m61.sh — el paso de BASE DE DATOS que hace falta para volver al código anterior a M-61
#                   (`20260929120000_m61_shipment_prep_refunds`) sin romperlo, y para volver a
#                   avanzar después. · Propiedad: devops · docs/DEVOPS_NOTES.md §71.4
# =============================================================================
# POR QUÉ EXISTE (medido 2026-09-29, DEVOPS_NOTES §71.4)
# ---------------------------------------------------------------------------
#   M-61 es aditiva, pero añade un CHECK a una tabla que el código VIEJO (origin/production a2da420)
#   SÍ escribe:
#       "VaultPlacementItem_missing_reason_chk"  CHECK (("missingReason" IS NOT NULL) = ("prepStatus" = 'missing'))
#   El código viejo marca «no está» con `{ prepStatus: 'missing', … }` SIN `missingReason`
#   (vault-placement.service.ts:258-261 en a2da420) ⇒ el CHECK lo rechaza ⇒ 500. Y al revés:
#   una carta que el código NUEVO dejó `missing` + `not_found`, el viejo no puede regresarla a
#   `pending` (deja `missingReason` puesto) ⇒ 500. Medido con el backend viejo VIVO: 3/3 y 3/3.
#   Los otros tres CHECKs de M-61 sobre tablas existentes (ShipmentRequest_prepared_seal_chk,
#   ShipmentItem_prep_mark_chk, ShipmentItem_missing_reason_chk) solo miran columnas que el código
#   viejo no conoce ni escribe: NO se tocan (medido: suite de integración vieja, ver §71.4).
#
# QUÉ HACE CADA MODO
# ---------------------------------------------------------------------------
#   --check      SOLO LEE (`BEGIN TRANSACTION READ ONLY`). Vale con un rol de solo lectura.
#                Dice: si M-61 está aplicada, qué CHECKs hay, cuántas filas usan valores de enum
#                que el código viejo NO sabe leer, cuánto dinero/casos «en vuelo» quedarían
#                invisibles con el código viejo, y la HUELLA que pide --apply.
#   --apply      Quita UN CHECK: `ALTER TABLE "VaultPlacementItem" DROP CONSTRAINT IF EXISTS
#                "VaultPlacementItem_missing_reason_chk"`. Nada más. Idempotente. No borra filas,
#                ni tablas, ni columnas, ni toca `_prisma_migrations`.
#   --reforward  Para volver a avanzar (redeploy del código NUEVO): normaliza `missingReason` de
#                lo que escribió el código viejo mientras tanto y RE-AÑADE el CHECK idéntico al de
#                M-61. Idempotente. Se corre ANTES de volver a publicar el código nuevo.
#
# ⛔ LO QUE ESTE SCRIPT NUNCA HACE (y por qué)
#   · No borra `PaymentRefund`, `ReplacementCase`, `ManualRefund` ni ninguna columna: son el libro
#     de reembolsos (qué se devolvió, a quién, con qué llave de Stripe). El código viejo las ignora.
#   · No borra la fila de M-61 en `_prisma_migrations`: con ella, el `migrate deploy` del código
#     viejo dice «No pending migrations» (medido) y el del nuevo tampoco re-ejecuta M-61. Sin ella,
#     el nuevo intentaría re-crear tipos y tablas que ya existen y el arranque FALLARÍA (medido).
#   · No quita valores de enum (Postgres no tiene DROP VALUE) ni reescribe filas que los usen: si
#     existen, --check sale rc=1 y el redeploy del código viejo NO es seguro — se escala a backend
#     y al dueño (reescribir historia de movimientos no lo decide un script).
#   · Nunca corre solo: --apply/--reforward exigen `--confirm <huella>` (la que imprime --check
#     contra ESA base) Y escribir la frase en una terminal interactiva. Sin TTY ⇒ rc=2.
#
# CÓDIGOS DE SALIDA
#   0  medido / aplicado; en --check: el redeploy del código viejo es seguro TRAS --apply.
#   1  --check/--apply: hay filas con valores de enum nuevos ⇒ el redeploy del código viejo NO es
#      seguro (--apply igual quita el CHECK: es inocuo para el código nuevo). --reforward ignora
#      esas filas: el código nuevo sí sabe leerlas.
#   2  NO CONCLUYENTE / rechazado (sin URL, sin psql, SQL falló, huella que no cuadra, sin TTY…).
#
# USO (la credencial vive en TU shell; no se pega en ningún fichero ni chat):
#   export DATABASE_URL='postgresql://…'
#   ./scripts/rollback-m61.sh --check
#   ./scripts/rollback-m61.sh --apply     --confirm <huella>   # antes del redeploy del código viejo
#   ./scripts/rollback-m61.sh --reforward --confirm <huella>   # antes de volver a publicar el nuevo
#   unset DATABASE_URL
# =============================================================================
set -uo pipefail

MIG='20260929120000_m61_shipment_prep_refunds'
CHK='VaultPlacementItem_missing_reason_chk'
# Definición tal cual la guarda Postgres 16 tras M-61 (pg_get_constraintdef, medido 2026-09-29).
CHK_DEF_PG='CHECK ((("missingReason" IS NOT NULL) = ("prepStatus" = '"'"'missing'"'"'::"PreparationItemStatus")))'
FRASE='VOLVER ATRAS M-61'
FRASE_FWD='AVANZAR M-61'

MODE=""; CONFIRM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check|--apply|--reforward) [ -z "$MODE" ] || { echo "::error::un solo modo por corrida."; exit 2; }; MODE="${1#--}"; shift ;;
    --confirm) CONFIRM="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,55p' "$0"; exit 0 ;;
    *) echo "::error::opción desconocida '$1'. Uso: $0 --check | --apply --confirm <huella> | --reforward --confirm <huella>"; exit 2 ;;
  esac
done
[ -n "$MODE" ] || { echo "::error::falta el modo: --check | --apply | --reforward"; exit 2; }

command -v psql >/dev/null 2>&1 || { echo "::error::no hay \`psql\` en el PATH. NO concluyente."; exit 2; }
command -v node >/dev/null 2>&1 || { echo "::error::no hay \`node\` en el PATH. NO concluyente."; exit 2; }
[ -n "${DATABASE_URL:-}" ] || { echo "::error::sin DATABASE_URL no hay base. NO concluyente (exporta la variable en tu shell; nunca en un fichero)."; exit 2; }

# URL de Prisma ⇒ URL de libpq: `?schema=` (y los parámetros de pool de Prisma) no los entiende psql.
# El esquema pasa a `search_path`. Del URL solo se imprimen el nombre de la base y una huella.
PARSED="$(DBURL="$DATABASE_URL" node -e '
  const crypto = require("crypto");
  let u; try { u = new URL(process.env.DBURL); } catch (e) { console.log("ERR"); process.exit(0); }
  const keep = new Set(["sslmode","sslrootcert","sslcert","sslkey","sslpassword","connect_timeout","application_name","target_session_attrs","options","channel_binding"]);
  const schema = u.searchParams.get("schema") || "public";
  for (const k of [...u.searchParams.keys()]) if (!keep.has(k)) u.searchParams.delete(k);
  const host = (u.hostname || "").toLowerCase();
  const db = decodeURIComponent((u.pathname || "").replace(/^\//, "")) || "(sin nombre)";
  const fp = crypto.createHash("sha256").update(host + ":" + (u.port || "5432") + "/" + db).digest("hex").slice(0, 8);
  const local = ["localhost","127.0.0.1","::1","0.0.0.0","db","postgres","host.docker.internal"].includes(host);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) { console.log("ERR"); process.exit(0); }
  console.log([u.toString(), schema, db, fp, local ? "LOCAL" : "REMOTO"].join("\t"));
' 2>/dev/null)"
case "$PARSED" in ''|ERR*) echo "::error::DATABASE_URL no es un URL parseable (o su ?schema= no es un identificador simple). NO concluyente."; exit 2 ;; esac
IFS=$'\t' read -r PGURL SCHEMA DB_NAME HUELLA CLASE <<<"$PARSED"

export PGOPTIONS="-c search_path=${SCHEMA}"
PSQL=(psql "$PGURL" -X -q -v ON_ERROR_STOP=1 -At -F $'\t')
podar() { sed -E 's#postgres(ql)?://[^ ]*#postgresql://<oculto>#g'; }

# --------------------------------------------------------------------------- medición (solo lectura)
medir() {
  "${PSQL[@]}" 2>&1 <<'SQL'
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
SELECT 'reloj', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
SELECT 'mig', coalesce((SELECT CASE WHEN finished_at IS NOT NULL AND rolled_back_at IS NULL THEN 'aplicada' ELSE 'a_medias' END
                        FROM "_prisma_migrations" WHERE migration_name = '20260929120000_m61_shipment_prep_refunds'
                        ORDER BY started_at DESC LIMIT 1), 'ausente');
SELECT 'chk_def', coalesce((SELECT pg_get_constraintdef(oid) FROM pg_constraint
                            WHERE conname = 'VaultPlacementItem_missing_reason_chk' AND conrelid = '"VaultPlacementItem"'::regclass), '-');
SELECT 'otros_chk', count(*) FROM pg_constraint
 WHERE conname IN ('ShipmentRequest_prepared_seal_chk','ShipmentItem_prep_mark_chk','ShipmentItem_missing_reason_chk');
SELECT 'tiene_col', count(*) FROM information_schema.columns
 WHERE table_schema = current_schema() AND table_name = 'VaultPlacementItem' AND column_name = 'missingReason';
SELECT 'owner_ok', (SELECT pg_has_role(current_user, c.relowner, 'USAGE') FROM pg_class c WHERE c.oid = '"VaultPlacementItem"'::regclass);
-- Valores de enum que el Prisma VIEJO no conoce, en TODA columna de esos tipos (catálogo, no lista a mano).
SELECT 'enum_cols', count(*) FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid JOIN pg_class c ON c.oid = a.attrelid
 WHERE t.typname IN ('MovementReason','VaultPlacementCancelReason') AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
   AND c.relnamespace = current_schema()::regnamespace;
SELECT format('SELECT %L, count(*) FROM %I.%I WHERE %I::text IN (''replacement'',''refund_return'',''full_refund'')',
              'enum:' || c.relname || '.' || a.attname, n.nspname, c.relname, a.attname)
  FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE t.typname IN ('MovementReason','VaultPlacementCancelReason') AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
   AND n.nspname = current_schema()
\gexec
COMMIT;
SQL
}
medir_m61() {  # solo si M-61 está (tablas y columnas existen)
  "${PSQL[@]}" 2>&1 <<'SQL'
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
SELECT 'vpi_missing',           count(*) FROM "VaultPlacementItem" WHERE "prepStatus" = 'missing';
SELECT 'vpi_missing_sin_motivo',count(*) FROM "VaultPlacementItem" WHERE "prepStatus" = 'missing' AND "missingReason" IS NULL;
SELECT 'vpi_motivo_sobrante',   count(*) FROM "VaultPlacementItem" WHERE "prepStatus" <> 'missing' AND "missingReason" IS NOT NULL;
SELECT 'pr_en_vuelo',  count(*) FROM "PaymentRefund" WHERE status IN ('requested','submitted');
SELECT 'pr_fallidos',  count(*) FROM "PaymentRefund" WHERE status = 'failed';
SELECT 'pr_total',     count(*) FROM "PaymentRefund";
SELECT 'rc_abiertos',  count(*) FROM "ReplacementCase" WHERE status = 'open';
SELECT 'mr_pendientes',count(*) FROM "ManualRefund" WHERE status = 'pending';
SELECT 'sr_preparados',count(*) FROM "ShipmentRequest" WHERE "preparedAt" IS NOT NULL;
SELECT 'si_marcadas',  count(*) FROM "ShipmentItem" WHERE "prepStatus" <> 'pending';
COMMIT;
SQL
}
val() { printf '%s\n' "$1" | awk -F'\t' -v k="$2" '$1==k {print $2; f=1} END {if(!f) print "?"}'; }
enum_filas() { printf '%s\n' "$1" | awk -F'\t' '$1 ~ /^enum:/ && $2 > 0 {print "      " substr($1,6) ": " $2}'; }
enum_total() { printf '%s\n' "$1" | awk -F'\t' '$1 ~ /^enum:/ {s += $2} END {print s+0}'; }

M="$(medir)" || { echo "::error::la consulta de medición falló. NO concluyente:"; printf '%s\n' "$M" | podar | sed 's/^/    /'; exit 2; }
RELOJ="$(val "$M" reloj)"; MIGST="$(val "$M" mig)"; CHKDEF="$(val "$M" chk_def)"; OTROS="$(val "$M" otros_chk)"
TIENE_COL="$(val "$M" tiene_col)"; OWNER_OK="$(val "$M" owner_ok)"; ENUM_COLS="$(val "$M" enum_cols)"
ENUM_N="$(enum_total "$M")"
case "$ENUM_COLS" in ''|*[!0-9]*) echo "::error::no pude contar las columnas de enum ('$ENUM_COLS'). NO concluyente."; exit 2 ;; esac
[ "$ENUM_COLS" -ge 2 ] || { echo "::error::esperaba ≥2 columnas de MovementReason/VaultPlacementCancelReason y hay $ENUM_COLS: ¿esquema equivocado? NO concluyente."; exit 2; }

case "$CHKDEF" in
  -) CHK_ST="AUSENTE" ;;
  "$CHK_DEF_PG") CHK_ST="PRESENTE (idéntico al de M-61)" ;;
  *) CHK_ST="PRESENTE PERO DISTINTO: $CHKDEF" ;;
esac

echo
echo "── rollback-m61 · $MODE ──"
printf '  objetivo      : base «%s» · huella %s (%s) · esquema %s\n' "$DB_NAME" "$HUELLA" "$CLASE" "$SCHEMA"
printf '  reloj (UTC)   : %s\n' "$RELOJ"
printf '  M-61          : %s en _prisma_migrations\n' "$MIGST"
printf '  CHECK %s : %s\n' "$CHK" "$CHK_ST"
printf '  otros CHECKs de M-61 sobre tablas existentes: %s/3 (se QUEDAN: el código viejo no escribe sus columnas)\n' "$OTROS"

if [ "$MIGST" = "ausente" ] && [ "$TIENE_COL" = "0" ]; then
  echo '  · M-61 NO está aplicada en esta base: no hay nada que revertir. Redeploy del código viejo sin paso de datos.'
  exit 0
fi
if [ "$MIGST" != "aplicada" ] || [ "$TIENE_COL" != "1" ]; then
  echo "::error::estado raro: migración «$MIGST», columna missingReason=$TIENE_COL. No toco nada: se escala a backend. NO concluyente."
  exit 2
fi

D="$(medir_m61)" || { echo "::error::la medición de M-61 falló. NO concluyente:"; printf '%s\n' "$D" | podar | sed 's/^/    /'; exit 2; }
for k in vpi_missing vpi_missing_sin_motivo vpi_motivo_sobrante pr_en_vuelo pr_fallidos pr_total rc_abiertos mr_pendientes sr_preparados si_marcadas; do
  v="$(val "$D" "$k")"; case "$v" in ''|*[!0-9]*) echo "::error::cifra '$k' no numérica ('$v'). NO concluyente."; exit 2 ;; esac
  printf -v "N_$k" '%s' "$v"
done

echo "  cartas de bóveda «no está»        : $N_vpi_missing (sin motivo: $N_vpi_missing_sin_motivo · motivo sobrante: $N_vpi_motivo_sobrante)"
echo "  retiros «preparados» (sello nuevo): $N_sr_preparados · cartas de retiro marcadas: $N_si_marcadas   [el código viejo no los ve; quedan]"
echo "  reembolsos (PaymentRefund)        : $N_pr_total en total · EN VUELO (requested/submitted): $N_pr_en_vuelo · fallidos: $N_pr_fallidos"
echo "  casos «Por reponer» abiertos      : $N_rc_abiertos · transferencias SPEI pendientes: $N_mr_pendientes"
if [ $((N_pr_en_vuelo + N_pr_fallidos + N_rc_abiertos + N_mr_pendientes)) -gt 0 ]; then
  printf '  \033[1;33m▲ trabajo de dinero ABIERTO que el código viejo NO muestra\033[0m: mientras dure el rollback nadie lo ve en el panel\n'
  echo '    ni lo avanza (el webhook charge.refund.updated cae en «evento no manejado»). No se pierde: reaparece al avanzar.'
fi
echo "  filas con valores de enum nuevos  : $ENUM_N"
enum_filas "$M"

VEREDICTO=0
if [ "$ENUM_N" -gt 0 ] && [ "$MODE" != "reforward" ]; then  # al AVANZAR no importan: el código nuevo sí los conoce
  VEREDICTO=1
  printf '  \033[1;31m✖ NO es seguro volver al código viejo\033[0m: su Prisma no sabe leer esos valores (replacement / refund_return /\n'
  echo '    full_refund) y las pantallas que lean esas filas fallarán. Postgres no permite quitar un valor de enum y'
  echo '    reescribir movimientos es decisión del dueño con backend. Escalar ANTES del redeploy.'
fi

# --------------------------------------------------------------------------- --check termina aquí
if [ "$MODE" = "check" ]; then
  echo
  if [ "$VEREDICTO" -eq 0 ]; then
    case "$CHK_ST" in
      AUSENTE) echo '  VEREDICTO: el paso de datos YA está hecho (CHECK ausente). Se puede volver al código viejo.' ;;
      *)       echo "  VEREDICTO: volver al código viejo es seguro DESPUÉS de: $0 --apply --confirm $HUELLA" ;;
    esac
  fi
  echo "  huella para --apply/--reforward: $HUELLA"
  exit "$VEREDICTO"
fi

# --------------------------------------------------------------------------- modos que escriben
[ "$OWNER_OK" = "t" ] || { echo "::error::el rol conectado no es dueño de \"VaultPlacementItem\": no puede cambiar CHECKs. Usa la credencial de la app/dueño. NO concluyente."; exit 2; }
[ -n "$CONFIRM" ] || { echo "::error::--$MODE exige --confirm <huella>. Corre antes --check contra ESTA base y copia su huella."; exit 2; }
[ "$CONFIRM" = "$HUELLA" ] || { echo "::error::la huella no cuadra (--confirm $CONFIRM ≠ $HUELLA): esta NO es la base que mediste. Nada escrito."; exit 2; }
[ -t 0 ] || { echo "::error::--$MODE solo corre en una terminal interactiva (stdin no es TTY). Nunca corre solo ni en CI. Nada escrito."; exit 2; }
if [ "$MODE" = "apply" ]; then PIDE="$FRASE"; else PIDE="$FRASE_FWD"; fi
printf '\n  Vas a escribir en «%s» (huella %s). Escribe exactamente «%s» para seguir: ' "$DB_NAME" "$HUELLA" "$PIDE"
IFS= read -r RESP || RESP=""
[ "$RESP" = "$PIDE" ] || { echo; echo "::error::frase distinta. Nada escrito."; exit 2; }

if [ "$MODE" = "apply" ]; then
  OUT="$("${PSQL[@]}" 2>&1 <<'SQL'
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE "VaultPlacementItem" DROP CONSTRAINT IF EXISTS "VaultPlacementItem_missing_reason_chk";
SELECT 'quedan', count(*) FROM pg_constraint WHERE conname = 'VaultPlacementItem_missing_reason_chk';
COMMIT;
SQL
)" || { echo "::error::el DDL falló (nada cambió: va en una transacción):"; printf '%s\n' "$OUT" | podar | sed 's/^/    /'; exit 2; }
  [ "$(val "$OUT" quedan)" = "0" ] || { echo "::error::el CHECK sigue ahí tras el DDL. NO concluyente."; exit 2; }
  echo "  ✔ CHECK $CHK quitado (o ya no estaba). Nada más cambió."
  echo "  Siguiente: redeploy del código anterior (Railway «Redeploy» del deploy previo; Vercel «Promote» del build previo)."
  echo "  Para volver a avanzar: $0 --reforward --confirm $HUELLA  (ANTES de publicar otra vez el código nuevo)."
else
  OUT="$("${PSQL[@]}" 2>&1 <<'SQL'
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
-- Lo que escribió el código viejo durante el rollback: `missing` sin motivo (para él «missing» era
-- «no la encontré»: el mismo backfill de M-61) y motivos que quedaron colgando al desmarcar.
WITH a AS (UPDATE "VaultPlacementItem" SET "missingReason" = 'not_found'
           WHERE "prepStatus" = 'missing' AND "missingReason" IS NULL RETURNING 1)
SELECT 'fijados', count(*) FROM a;
WITH b AS (UPDATE "VaultPlacementItem" SET "missingReason" = NULL
           WHERE "prepStatus" <> 'missing' AND "missingReason" IS NOT NULL RETURNING 1)
SELECT 'limpiados', count(*) FROM b;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VaultPlacementItem_missing_reason_chk'
                 AND conrelid = '"VaultPlacementItem"'::regclass) THEN
    ALTER TABLE "VaultPlacementItem" ADD CONSTRAINT "VaultPlacementItem_missing_reason_chk"
      CHECK (("missingReason" IS NOT NULL) = ("prepStatus" = 'missing'));
  END IF;
END $$;
SELECT 'def', pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'VaultPlacementItem_missing_reason_chk';
COMMIT;
SQL
)" || { echo "::error::el paso falló (nada cambió: va en una transacción):"; printf '%s\n' "$OUT" | podar | sed 's/^/    /'; exit 2; }
  [ "$(val "$OUT" def)" = "$CHK_DEF_PG" ] || { echo "::error::el CHECK re-añadido no es idéntico al de M-61 ('$(val "$OUT" def)'). NO concluyente."; exit 2; }
  echo "  ✔ normalizadas: $(val "$OUT" fijados) cartas «no está» sin motivo ⇒ not_found · $(val "$OUT" limpiados) motivos sobrantes ⇒ NULL"
  echo "  ✔ CHECK $CHK presente e idéntico al de M-61. Ya se puede publicar otra vez el código nuevo"
  echo "    (su migrate deploy no re-ejecuta M-61: la fila de _prisma_migrations nunca se tocó)."
fi
echo "  Anotar en DEVOPS_NOTES §71.4: | $RELOJ | $MODE | $HUELLA | enum nuevos: $ENUM_N |"
exit "$VEREDICTO"

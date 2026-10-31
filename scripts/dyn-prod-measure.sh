#!/usr/bin/env bash
#
# dyn-prod-measure.sh — las dos mediciones de producción que pide §DYN, con USUARIO DE SOLO
#                       LECTURA, listas para que las corra EL DUEÑO donde vive la credencial. · devops
# =============================================================================
# QUÉ MIDE (literales de API_CONTRACT; si difieren, manda el contrato y se corrige aquí)
# ---------------------------------------------------------------------------
#   1. §DYN.4.7 — COSTE PSA. Cartas raw publicadas de plataforma, sets en alcance, sets sin
#      mapear (`pptSetId` nulo) y W = 2 × cartas de catálogo de esos sets (créditos/semana bajo
#      «cobro por carta devuelta»). Se imprime además W/7 contra el tope de 3 000/día: dice si
#      el tope alcanza. Lo cierra junto con la línea `COSTE MEDIDO` de la primera corrida.
#   2. §DYN.5.9 — CASOS VIGENTES de `PriceReviewCase` (status open|kept, sin producto/sellado)
#      con y sin `baselineMxnCents`. `sin_base` = variantes que dejan de venderse con v1.114
#      hasta que el dueño las acepte en la cola. Va en la solicitud de fusión (P-RP-6).
#      Se compara `status::text` (no el enum): así no revienta si la base aún no tiene `kept`.
#
# SEGURIDAD (mismo patrón que vault-full-refund-residue.sh)
# ---------------------------------------------------------------------------
#   · SOLO acepta `DATABASE_URL_RO`; ignora `DATABASE_URL` a propósito.
#   · Aborta (rc=2) si el rol puede escribir (INSERT/UPDATE/DELETE) en CUALQUIERA de las
#     tablas que lee: "InventoryItem", "Card", "CardSet", "PriceReviewCase".
#   · Todo dentro de `BEGIN TRANSACTION READ ONLY` con `statement_timeout`. Nada se escribe.
#   · No imprime la credencial: base + huella sha256 (8 hex) del host. `--target prod|local`
#     obligatorio y cruzado contra el host.
#   · rc=0 midió · rc=2 NO CONCLUYENTE (sin URL/psql, rol con escritura, tabla/columna
#     ausente, SQL falló). Nunca 0 con una cifra que no leyó.
#
# Cómo lo corre el dueño: docs/DEVOPS_NOTES.md §104.4 (crear el rol de solo lectura, correr,
# pegar las dos líneas en la solicitud de fusión, `DROP ROLE`).
#   export DATABASE_URL_RO='postgresql://dyn_ro:…@<host público de Railway>:<puerto>/<base>'
#   ./scripts/dyn-prod-measure.sh --target prod
#   unset DATABASE_URL_RO
# Candado y canario: scripts/check-dyn-prod-measure.sh (Postgres local desechable).
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR" || exit 2

TARGET=""; CAP_REF="${DYN_CAP_REF:-3000}"
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    -h|--help) sed -n '1,40p' "$0"; exit 0 ;;
    *) echo "::error::opción desconocida '$1'. Uso: $0 --target prod|local"; exit 2 ;;
  esac
done
case "$TARGET" in prod|local) ;; *) echo "::error::falta --target prod|local."; exit 2 ;; esac
command -v psql >/dev/null 2>&1 || { echo "::error::no hay \`psql\` en el PATH. NO concluyente."; exit 2; }
command -v node >/dev/null 2>&1 || { echo "::error::no hay \`node\` en el PATH. NO concluyente."; exit 2; }
if [ -z "${DATABASE_URL_RO:-}" ]; then
  echo "::error::sin DATABASE_URL_RO no mido (NO concluyente, que no es «0»). Rol de solo lectura: DEVOPS_NOTES §104.4." >&2
  exit 2
fi

IDENT="$(DBURL="$DATABASE_URL_RO" node -e '
  const crypto = require("crypto"); let u;
  try { u = new URL(process.env.DBURL); } catch (e) { console.log("ERR"); process.exit(0); }
  const host = (u.hostname || "").toLowerCase();
  const db = decodeURIComponent((u.pathname || "").replace(/^\//, "")) || "(sin nombre)";
  const fp = crypto.createHash("sha256").update(host).digest("hex").slice(0, 8);
  const local = ["localhost", "127.0.0.1", "::1", "0.0.0.0", "db", "postgres", "host.docker.internal"].includes(host);
  console.log([db, fp, local ? "LOCAL" : "REMOTO"].join("\t"));
' 2>&1)"
[ "$IDENT" != "ERR" ] || { echo "::error::DATABASE_URL_RO no es un URL parseable. NO concluyente."; exit 2; }
IFS=$'\t' read -r DB_NAME HOST_FP HOST_CLASE <<<"$IDENT"
[ "$TARGET" = prod ] && [ "$HOST_CLASE" = LOCAL ] && { echo "::error::--target prod con host LOCAL. Abortado."; exit 2; }
[ "$TARGET" = local ] && [ "$HOST_CLASE" = REMOTO ] && { echo "::error::--target local con host REMOTO (huella $HOST_FP). Abortado."; exit 2; }

PSQL=(psql "$DATABASE_URL_RO" -v ON_ERROR_STOP=1 --no-psqlrc -At -F $'\t')
podar() { sed -E 's#postgres(ql)?://[^ ]*#postgresql://<oculto>#g'; }
falla() { echo "::error::$1. NO concluyente:"; printf '%s\n' "$2" | podar | sed 's/^/    /'; exit 2; }

# --- 1) Tablas y columnas que se leen; y que el rol NO pueda escribir en ninguna -----------
EST="$("${PSQL[@]}" <<'SQL' 2>&1
SELECT t, (to_regclass(format('public.%I', t)) IS NOT NULL),
       COALESCE(to_regclass(format('public.%I', t)) IS NOT NULL AND (
         has_table_privilege(current_user, format('public.%I', t), 'INSERT') OR
         has_table_privilege(current_user, format('public.%I', t), 'UPDATE') OR
         has_table_privilege(current_user, format('public.%I', t), 'DELETE')), false)
  FROM unnest(ARRAY['InventoryItem','Card','CardSet','PriceReviewCase']) AS t;
SELECT 'col', count(*) FROM information_schema.columns
 WHERE table_schema='public' AND ((table_name='CardSet' AND column_name='pptSetId')
    OR (table_name='PriceReviewCase' AND column_name IN ('baselineMxnCents','cardProductId','sealedProductId','status')));
SQL
)" || falla "no pude conectar ni leer el catálogo" "$EST"
if printf '%s\n' "$EST" | awk -F'\t' '$3=="t"' | grep -q .; then
  echo "::error::el rol de DATABASE_URL_RO PUEDE ESCRIBIR en: $(printf '%s\n' "$EST" | awk -F'\t' '$3=="t"{printf "%s ", $1}'). Abortado: una credencial que escribe no se usa para medir (DEVOPS_NOTES §104.4)."
  exit 2
fi
# (awk y no `grep -P`: el dueño lo corre en su máquina, que puede ser macOS.)
existe() { printf '%s\n' "$EST" | awk -F'\t' -v t="$1" '$1==t && $2=="t"{ok=1} END{exit !ok}'; }
for t in InventoryItem Card CardSet; do
  existe "$t" || { echo "::error::falta la tabla \"$t\". NO concluyente."; exit 2; }
done
HAY_PRC=0; existe PriceReviewCase && HAY_PRC=1
NCOL="$(printf '%s\n' "$EST" | awk -F'\t' '$1=="col"{print $2}')"
if [ "$HAY_PRC" = 1 ] && [ "$NCOL" != 5 ]; then echo "::error::faltan columnas (esperadas 5, hay $NCOL). NO concluyente."; exit 2; fi
if [ "$HAY_PRC" = 0 ] && [ "$NCOL" != 1 ]; then echo "::error::falta \"CardSet\".\"pptSetId\". NO concluyente."; exit 2; fi

# --- 2) Las dos consultas, en una transacción de solo lectura --------------------------------
SQL_PRC="SELECT 'prc', (\"baselineMxnCents\" IS NULL), count(*) FROM \"PriceReviewCase\"
          WHERE status::text IN ('open','kept') AND \"cardProductId\" IS NULL AND \"sealedProductId\" IS NULL GROUP BY 2;"
[ "$HAY_PRC" = 1 ] || SQL_PRC=""
SALIDA="$("${PSQL[@]}" <<SQL 2>&1
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '120s';
SELECT 'reloj', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI');
WITH pub AS (SELECT DISTINCT "cardId" FROM "InventoryItem"
             WHERE "ownerType"='platform' AND status='listed' AND "productType"='raw'),
     s   AS (SELECT DISTINCT c."setId", (cs."pptSetId" IS NOT NULL) AS mapped
             FROM pub JOIN "Card" c ON c.id = pub."cardId" JOIN "CardSet" cs ON cs.id = c."setId")
SELECT 'psa',
       (SELECT count(*) FROM pub)                                       AS cartas_publicadas,
       (SELECT count(*) FROM s)                                         AS sets_en_alcance,
       (SELECT count(*) FROM s WHERE NOT mapped)                        AS sets_sin_mapear,
       2 * (SELECT count(*) FROM "Card" WHERE "setId" IN (SELECT "setId" FROM s)) AS w_semanal_cobro_por_carta_devuelta;
$SQL_PRC
COMMIT;
SQL
)" || falla "la consulta falló" "$SALIDA"

PSA="$(printf '%s\n' "$SALIDA" | awk -F'\t' '$1=="psa"')"
IFS=$'\t' read -r _ CARTAS SETS SIN_MAPEAR W <<<"$PSA"
RELOJ="$(printf '%s\n' "$SALIDA" | awk -F'\t' '$1=="reloj"{print $2}')"
for v in "$CARTAS" "$SETS" "$SIN_MAPEAR" "$W"; do case "$v" in ''|*[!0-9]*) echo "::error::cifra no numérica en §DYN.4.7 ('$PSA'). NO concluyente."; exit 2 ;; esac; done
CON_BASE=0; SIN_BASE=0
if [ "$HAY_PRC" = 1 ]; then
  CON_BASE="$(printf '%s\n' "$SALIDA" | awk -F'\t' '$1=="prc" && $2=="f"{print $3}')"; CON_BASE="${CON_BASE:-0}"
  SIN_BASE="$(printf '%s\n' "$SALIDA" | awk -F'\t' '$1=="prc" && $2=="t"{print $3}')"; SIN_BASE="${SIN_BASE:-0}"
fi
DIA=$(( (W + 6) / 7 ))
ALCANZA=$([ "$DIA" -le "$CAP_REF" ] && echo "SÍ alcanza" || echo "NO alcanza")

echo
echo "── §DYN: mediciones de solo lectura ──"
printf '  objetivo : base «%s» · huella del host %s (%s) · --target %s · reloj UTC %s\n' "$DB_NAME" "$HOST_FP" "$HOST_CLASE" "$TARGET" "$RELOJ"
printf '  rol      : solo lectura verificado (sin INSERT/UPDATE/DELETE en las 4 tablas)\n'
echo
echo "  1) §DYN.4.7 coste PSA"
printf '     cartas raw publicadas: %s · sets en alcance: %s · sets sin mapear: %s\n' "$CARTAS" "$SETS" "$SIN_MAPEAR"
printf '     W (cobro por carta devuelta): %s créditos/semana ⇒ %s/día vs tope %s ⇒ %s\n' "$W" "$DIA" "$CAP_REF" "$ALCANZA"
echo "     (el régimen real lo dice la línea COSTE MEDIDO de la primera corrida; sin ella esto es el techo)"
echo
echo "  2) §DYN.5.9 casos vigentes (open|kept, por variante)"
if [ "$HAY_PRC" = 1 ]; then
  printf '     con base: %s · SIN base: %s  ⇒ %s variante(s) dejarían de venderse hasta aceptarlas en la cola\n' "$CON_BASE" "$SIN_BASE" "$SIN_BASE"
else
  echo '     la tabla "PriceReviewCase" no existe en esta base (M-75 sin aplicar) ⇒ 0 casos vigentes.'
fi
echo
echo "── PEGAR EN LA SOLICITUD DE FUSIÓN ──"
printf '| %s UTC | %s/%s | §DYN.4.7: %s cartas, %s sets (%s sin mapear), W=%s/sem (%s/día vs %s) | §DYN.5.9: %s con base, %s sin base |\n' \
  "$RELOJ" "$TARGET" "$HOST_FP" "$CARTAS" "$SETS" "$SIN_MAPEAR" "$W" "$DIA" "$CAP_REF" "$CON_BASE" "$SIN_BASE"
exit 0

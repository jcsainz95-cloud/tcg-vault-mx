#!/usr/bin/env bash
#
# vault-full-refund-residue.sh — la consulta de residuo de M-61 (§M4-SHIP.18 / seguridad B13),
#                    ejecutable en la ventana de despliegue con USUARIO DE SOLO LECTURA. · devops
# =============================================================================
# QUÉ MIDE
# ---------------------------------------------------------------------------
# M-61 (§M4-SHIP.18) hace que el reembolso TOTAL de una orden `vault` deshaga la venta
# (cartas de vuelta a plataforma `picking`, colocación `pending` cancelada, sello
# `Order.fullRefundClosedAt`). Antes de M-61 ese cierre NO existía: una orden `vault`
# reembolsada entera antes de este release dejó su carta como del cliente. Esas órdenes
# son el RESIDUO del hueco. La migración no hace backfill (⛔ ningún script las toca solo):
# se cuentan aquí y las resuelve el súper-admin a mano.
#
#   fase PRE  (columna "Order"."fullRefundClosedAt" ausente: M-61 sin aplicar)
#       SELECT count(*) FROM "Order" WHERE "fulfillmentMode"='vault' AND status='refunded';
#       ⇒ el literal de API_CONTRACT §M4-SHIP.18 (bloque M-61). Todas son residuo por definición.
#   fase POST (columna presente)
#       … AND "fullRefundClosedAt" IS NULL;   ⇒ «refunded sin sello» (seguridad B13).
#       Es estable después del despliegue: el código nuevo siempre escribe el sello.
#
# ⚠ La consulta dueña es la de backend (BACKEND_NOTES). Este guion lleva el literal del contrato
#   y NO la reemplaza: si difieren, manda la de backend y se corrige aquí (una sola fuente).
#
# SEGURIDAD (mismo patrón que release-reservation-census.sh y db-disk-watch.sh)
# ---------------------------------------------------------------------------
#   · SOLO acepta `DATABASE_URL_RO`. Ignora `DATABASE_URL` a propósito: una credencial de
#     escritura no se usa para medir. Además, aborta (rc=2) si el rol conectado tiene
#     privilegio de escritura sobre "Order" (`has_table_privilege … UPDATE|INSERT|DELETE`).
#   · `BEGIN TRANSACTION READ ONLY` + timeout. Nada se escribe.
#   · No imprime la credencial: del URL solo salen el nombre de la base y la huella sha256
#     (8 hex) del host. Con `--list` los ids salen truncados a 8 caracteres.
#   · `--target prod|local` obligatorio y cruzado contra el host.
#   · rc=2 = NO CONCLUYENTE (sin URL, sin psql, rol con escritura, SQL falló). Nunca 0 con una
#     cifra que no leyó. rc=0 = midió (el resultado puede ser >0: léelo). rc=0 con n>0 imprime la
#     instrucción; el bloqueo lo decide el dueño en la ventana, no el script.
#
# Uso:
#   DATABASE_URL_RO='postgresql://…' ./scripts/vault-full-refund-residue.sh --target prod
#   DATABASE_URL_RO='…' ./scripts/vault-full-refund-residue.sh --target prod --list
#   (después de `unset DATABASE_URL_RO`; el valor no se pega en ningún fichero del repo)
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR" || exit 2

TARGET=""; LIST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --list)   LIST=1; shift ;;
    -h|--help) sed -n '1,45p' "$0"; exit 0 ;;
    *) echo "::error::opción desconocida '$1'. Uso: $0 --target prod|local [--list]"; exit 2 ;;
  esac
done
case "$TARGET" in
  prod|local) ;;
  *) echo "::error::falta --target prod|local (sin él, cifras locales se anotan como producción)."; exit 2 ;;
esac

command -v psql >/dev/null 2>&1 || { echo "::error::no hay \`psql\` en el PATH. NO concluyente."; exit 2; }
command -v node >/dev/null 2>&1 || { echo "::error::no hay \`node\` en el PATH. NO concluyente."; exit 2; }
if [ -z "${DATABASE_URL_RO:-}" ]; then
  cat >&2 <<'SINURL'
::error::sin DATABASE_URL_RO no puedo medir. NO concluyente (y «no concluyente» no es «0»).
  Este guion solo acepta una credencial de SOLO LECTURA y no trae ninguna. Para producción:
  crea el rol de solo lectura (docs/DEVOPS_NOTES.md, sección «Residuo de M-61») o que lo corra
  el dueño donde la credencial ya vive.
      export DATABASE_URL_RO='postgresql://…'   # NO se pega en ningún fichero del repo
      ./scripts/vault-full-refund-residue.sh --target prod
      unset DATABASE_URL_RO
SINURL
  exit 2
fi

IDENT="$(DBURL="$DATABASE_URL_RO" node -e '
  const crypto = require("crypto");
  let u;
  try { u = new URL(process.env.DBURL); } catch (e) { console.log("ERR url no parseable"); process.exit(0); }
  const host = (u.hostname || "").toLowerCase();
  const db = decodeURIComponent((u.pathname || "").replace(/^\//, "")) || "(sin nombre)";
  const fp = crypto.createHash("sha256").update(host).digest("hex").slice(0, 8);
  const local = ["localhost", "127.0.0.1", "::1", "0.0.0.0", "db", "postgres", "host.docker.internal"].includes(host);
  console.log([db, fp, local ? "LOCAL" : "REMOTO"].join("\t"));
' 2>&1)"
case "$IDENT" in
  ERR*) echo "::error::DATABASE_URL_RO no es un URL parseable. NO concluyente."; exit 2 ;;
esac
IFS=$'\t' read -r DB_NAME HOST_FP HOST_CLASE <<<"$IDENT"

if [ "$TARGET" = "prod" ] && [ "$HOST_CLASE" = "LOCAL" ]; then
  echo "::error::dijiste --target prod pero el host es LOCAL. Abortado a propósito."; exit 2
fi
if [ "$TARGET" = "local" ] && [ "$HOST_CLASE" = "REMOTO" ]; then
  echo "::error::dijiste --target local pero el host NO es local (huella $HOST_FP). Producción se mide con --target prod y en ventana."; exit 2
fi

PSQL=(psql "$DATABASE_URL_RO" -v ON_ERROR_STOP=1 --no-psqlrc -At -F $'\t')
podar() { sed -E 's#postgres(ql)?://[^ ]*#postgresql://<oculto>#g'; }

# --- 1) ¿El rol es de verdad de solo lectura? Si puede escribir, no se mide. --
PRIV="$("${PSQL[@]}" -c "SELECT has_table_privilege(current_user,'\"Order\"','INSERT') OR has_table_privilege(current_user,'\"Order\"','UPDATE') OR has_table_privilege(current_user,'\"Order\"','DELETE');" 2>&1)" || {
  echo "::error::no pude conectar/consultar privilegios. NO concluyente:"; printf '%s\n' "$PRIV" | podar | sed 's/^/    /'; exit 2; }
case "$PRIV" in
  f) ;;
  t) echo "::error::el rol de DATABASE_URL_RO TIENE privilegio de escritura sobre \"Order\". Abortado: una credencial que puede escribir no se usa para medir. Crea el rol de solo lectura (DEVOPS_NOTES, «Residuo de M-61»)."; exit 2 ;;
  *) echo "::error::has_table_privilege devolvió '$PRIV'. NO concluyente."; exit 2 ;;
esac

# --- 2) Fase: ¿existe la columna del sello? ----------------------------------
COL="$("${PSQL[@]}" -c "SELECT count(*) FROM information_schema.columns WHERE table_name='Order' AND column_name='fullRefundClosedAt';" 2>&1)" || {
  echo "::error::no pude consultar information_schema. NO concluyente:"; printf '%s\n' "$COL" | podar | sed 's/^/    /'; exit 2; }
case "$COL" in
  0) FASE="pre";  WHERE_SELLO=""; NOTA='literal del contrato (M-61 sin aplicar; todas son residuo)' ;;
  1) FASE="post"; WHERE_SELLO=' AND "fullRefundClosedAt" IS NULL'; NOTA='refunded SIN sello (B13); estable tras el deploy' ;;
  *) echo "::error::information_schema devolvió '$COL'. NO concluyente."; exit 2 ;;
esac
SQL_N="SELECT count(*) FROM \"Order\" WHERE \"fulfillmentMode\"='vault' AND status='refunded'${WHERE_SELLO};"
SQL_L="SELECT left(id::text,8) FROM \"Order\" WHERE \"fulfillmentMode\"='vault' AND status='refunded'${WHERE_SELLO} ORDER BY \"createdAt\" LIMIT 200;"

SALIDA="$("${PSQL[@]}" <<SQL 2>&1
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
SELECT 'reloj', now() AT TIME ZONE 'UTC';
SELECT 'n', (${SQL_N%;});
COMMIT;
SQL
)" || { echo "::error::la consulta falló. NO concluyente — no hay cifra que anotar:"; printf '%s\n' "$SALIDA" | podar | sed 's/^/    /'; exit 2; }

val() { printf '%s\n' "$SALIDA" | awk -F'\t' -v k="$1" '$1==k {print $2; found=1} END {if(!found) print "?"}'; }
RELOJ="$(val reloj)"; N="$(val n)"
case "$N" in ''|*[!0-9]*) echo "::error::la cifra no es un número ('$N'). NO concluyente."; exit 2 ;; esac

echo
echo "── Residuo de M-61 · órdenes vault reembolsadas enteras sin cierre ──"
printf '  objetivo    : base «%s» · huella del host %s (%s) · --target %s\n' "$DB_NAME" "$HOST_FP" "$HOST_CLASE" "$TARGET"
printf '  fase medida : %s  (columna "Order"."fullRefundClosedAt" %s)\n' "$(printf '%s' "$FASE" | tr '[:lower:]' '[:upper:]')" "$([ "$FASE" = post ] && echo PRESENTE || echo AUSENTE)"
printf '  rol         : solo lectura verificado (sin INSERT/UPDATE/DELETE sobre "Order")\n'
printf '  reloj (UTC) : %s\n' "$RELOJ"
printf '  RESIDUO     : %s   [%s]\n' "$N" "$NOTA"
printf '  consulta    : %s\n' "$SQL_N"
if [ "$N" -gt 0 ]; then
  printf '  \033[1;33m▲ HAY RESIDUO (%s).\033[0m Esas órdenes NO las toca ningún script: se listan en BACKEND_NOTES (ids completos,\n' "$N"
  echo '    desde tu propia terminal) y el súper-admin las resuelve a mano (reclaim-vault / chargeback-inventory).'
  echo '    No bloquea el despliegue por sí solo: es conocimiento para el dueño ANTES de fusionar.'
  if [ "$LIST" -eq 1 ]; then
    echo '  ids (8 primeros caracteres, máx. 200):'
    "${PSQL[@]}" -c "BEGIN TRANSACTION READ ONLY; ${SQL_L}" 2>&1 | grep -v '^BEGIN$' | podar | sed 's/^/    /'
  fi
else
  echo '  · Sin residuo: nada que resolver a mano.'
fi
[ "$FASE" = "pre" ] && echo '  · Fase PRE: repite con la columna presente (POST) tras `migrate deploy` si quieres la cifra «sin sello».'
echo
echo "── PEGAR EN docs/DEVOPS_NOTES.md (residuo M-61) ──"
printf '| %s | %s | %s/%s | %s |\n' "$RELOJ" "$FASE" "$TARGET" "$HOST_FP" "$N"
echo "(columnas: fecha UTC | fase | objetivo/huella | residuo)"
exit 0

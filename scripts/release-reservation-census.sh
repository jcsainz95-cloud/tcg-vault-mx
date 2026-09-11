#!/usr/bin/env bash
#
# release-reservation-census.sh — el paso 1 de `ARCHITECTURE §4.48.7`, ejecutable
#                    en la ventana de despliegue de Stream B.          · devops
# =============================================================================
# POR QUÉ EXISTE (condición C8 de `SECURITY_NOTES`, hallazgo `SEC-SB-1`, 2026-09-11)
# ---------------------------------------------------------------------------
# `M-53` añade `InventoryItem.reservedByOrderId` **sin backfill**. En el instante
# de la migración, TODA pieza `reserved` que venga del pasado nace con la columna
# en `NULL`, y ninguno de los dos barridos la cubre (`SEC-SB-1`): el nuevo la
# excluye por `reservedByOrderId IS NOT NULL`, el legado por `guestEmail NOT NULL`
# + `direct_ship`. Ese conjunto es inventario congelado —piezas únicas que nadie
# puede comprar— y **su tamaño solo se puede conocer alrededor de la ventana**.
#
#     ► «Si no se mide hoy, se mide nunca, y `SEC-SB-1` queda abierto sin forma
#        de cerrarlo.»
#
# EL DETALLE QUE ROMPE LA CONSULTA DE C8 TAL CUAL ESTÁ ESCRITA
# ---------------------------------------------------------------------------
# C8(a) dice:
#     SELECT count(*) FROM "InventoryItem"
#      WHERE status='reserved' AND "reservedByOrderId" IS NULL;   -- «ANTES del deploy»
# En producción (`c8bee65`) esa columna **NO EXISTE**: la crea `M-53`, que viaja
# en ESTE release (medido: `git cat-file -e c8bee65:…/20260911130000_m53_reservation_owner/`
# → no existe; en `5d2c62b` → sí). Corrida antes del deploy, esa consulta no
# devuelve 0: devuelve `42703 column … does not exist`, y un 0 leído de un error
# es la peor cifra posible. Por eso este guion **detecta la fase** y usa en cada
# una la consulta que sí mide lo que C8 quiere:
#
#   fase PRE  (columna ausente, M-53 sin aplicar)
#       SELECT count(*) FROM "InventoryItem" WHERE status='reserved';
#       ⇒ es EXACTAMENTE el conjunto que M-53 dejará en `NULL` (no hay backfill),
#         más lo que el artefacto viejo reserve entre esta lectura y la migración.
#   fase POST (columna presente)
#       SELECT count(*) FROM "InventoryItem"
#        WHERE status='reserved' AND "reservedByOrderId" IS NULL;   -- literal de C8(a)
#       ⇒ cifra definitiva: el código nuevo escribe SIEMPRE la columna, así que
#         este conjunto ya no crece; solo baja cuando alguien lo libere (`C9`).
#
# Lo honesto es correrlo **dos veces**: PRE justo antes de `migrate deploy` y POST
# justo después. Las dos cifras juntas también dicen cuánto se reservó durante la
# ventana. Si solo se puede una, que sea la **POST**: es la que cierra `SEC-SB-1`.
#
# QUÉ MÁS MIDE (el paso 1 completo, no solo las tres cifras de C8)
# ---------------------------------------------------------------------------
#   (a) reservas legadas · (b) órdenes de bóveda `pending` con dueño [dispara C9]
#   (c) filas de "InventoryItem" [duración del lock de `CREATE INDEX`, §5 de SECURITY_NOTES]
#   (d) `SellRequest` vivas por estado, y las `cotizada` sin `offerSentAt`
#   (e) `SellRequest` que llegaron a verificación saltándose un paso (el agujero de P-58)
# NO mide la consulta de P-68 / `FxRate`: §4.48.7(1) la marca «solo para B-3», y
# §4.48.11 deja B-3 **fuera** de esta ventana. Medir lo que no se publica es ruido.
#
# SEGURIDAD DE ESTE GUION
# ---------------------------------------------------------------------------
#   · **Solo lee.** Abre `BEGIN TRANSACTION READ ONLY` + `default_transaction_read_only`:
#     un `INSERT` que se colara moriría con `25006`, no con un dato de menos.
#   · **No imprime la credencial.** Del `DATABASE_URL` solo salen el NOMBRE de la
#     base y una HUELLA del host (sha256, 8 hex). Repo público: la huella permite
#     probar que dos corridas fueron al mismo sitio sin publicar el sitio.
#   · **`--target` es obligatorio** y cruza contra el host: `--target prod` contra
#     `localhost` aborta. El error clásico de este censo es anotar como producción
#     unas cifras de la base de desarrollo, y de ahí no se vuelve.
#
# Uso:
#   DATABASE_URL='postgresql://…' ./scripts/release-reservation-census.sh --target prod
#   DATABASE_URL='…' ./scripts/release-reservation-census.sh --target local --phase post
#
#   --target prod|local   (obligatorio)  contra qué se está midiendo, declarado a mano
#   --phase auto|pre|post (por defecto auto)  `auto` mira si la columna existe
#
# Sale 0 si midió; 2 si NO pudo medir (sin URL, sin psql, target incoherente, SQL
# que falla). ⛔ Nunca sale 0 con una cifra que no leyó.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR" || exit 2

TARGET=""; PHASE="auto"
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --phase)  PHASE="${2:-}";  shift 2 ;;
    -h|--help) sed -n '1,80p' "$0"; exit 0 ;;
    *) echo "::error::opción desconocida '$1'. Uso: $0 --target prod|local [--phase auto|pre|post]"; exit 2 ;;
  esac
done

case "$TARGET" in
  prod|local) ;;
  *) echo "::error::falta --target prod|local. NO es un trámite: sin él, unas cifras de la base de desarrollo se anotan como producción y nadie lo nota."; exit 2 ;;
esac
case "$PHASE" in
  auto|pre|post) ;;
  *) echo "::error::--phase debe ser auto|pre|post (recibí '$PHASE')."; exit 2 ;;
esac

command -v psql >/dev/null 2>&1 || { echo "::error::no hay \`psql\` en el PATH. NO concluyente."; exit 2; }
[ -n "${DATABASE_URL:-}" ] || {
  cat >&2 <<'SINURL'
::error::sin DATABASE_URL no puedo medir. NO concluyente (y «no concluyente» no es «0»).
  Este guion NO trae credencial ninguna: la pone quien abre la ventana, en su shell y
  solo durante la ventana. Para producción, el valor es el `DATABASE_URL` del servicio
  de Postgres de Railway (proyecto «marvelous-kindness», entorno `production`).
      export DATABASE_URL='postgresql://…'   # NO se pega en ningún fichero del repo
      ./scripts/release-reservation-census.sh --target prod
      unset DATABASE_URL
SINURL
  exit 2
}

# --- Identidad del objetivo, sin publicar el objetivo ------------------------
# Del URL salen solo: nombre de base y huella del host. Ni usuario, ni contraseña,
# ni host en claro (repo PÚBLICO). `node` ya es dependencia de otros guiones de CI.
IDENT="$(DBURL="$DATABASE_URL" node -e '
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
  ERR*) echo "::error::DATABASE_URL no es un URL parseable (${IDENT#ERR }). NO concluyente."; exit 2 ;;
esac
IFS=$'\t' read -r DB_NAME HOST_FP HOST_CLASE <<<"$IDENT"

if [ "$TARGET" = "prod" ] && [ "$HOST_CLASE" = "LOCAL" ]; then
  echo "::error::dijiste --target prod pero el host del DATABASE_URL es LOCAL. Abortado a propósito: unas cifras locales anotadas como producción cierran \`SEC-SB-1\` con un número inventado."
  exit 2
fi
if [ "$TARGET" = "local" ] && [ "$HOST_CLASE" = "REMOTO" ]; then
  echo "::error::dijiste --target local pero el host del DATABASE_URL NO es local (huella $HOST_FP). Abortado: si eso es producción, se entra con --target prod y en ventana autorizada."
  exit 2
fi

PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --no-psqlrc -At -F $'\t')

# --- ¿Está M-53 aplicada? ----------------------------------------------------
COL="$("${PSQL[@]}" -c "SELECT count(*) FROM information_schema.columns WHERE table_name='InventoryItem' AND column_name='reservedByOrderId';" 2>&1)" || {
  echo "::error::no pude consultar information_schema: $COL"
  echo "::error::NO concluyente. Sin conexión no hay censo (y sin censo no se publica: C8 es bloqueante)."
  exit 2
}
case "$COL" in
  0) FASE_MEDIDA="pre" ;;
  1) FASE_MEDIDA="post" ;;
  *) echo "::error::information_schema devolvió '$COL' para la columna reservedByOrderId. NO concluyente."; exit 2 ;;
esac
if [ "$PHASE" != "auto" ] && [ "$PHASE" != "$FASE_MEDIDA" ]; then
  echo "::error::pediste --phase $PHASE pero la base dice fase '$FASE_MEDIDA' (columna reservedByOrderId $([ "$FASE_MEDIDA" = post ] && echo presente || echo ausente)). Abortado: la discrepancia significa que no estás donde crees."
  exit 2
fi

if [ "$FASE_MEDIDA" = "post" ]; then
  SQL_A='SELECT count(*) FROM "InventoryItem" WHERE status='"'"'reserved'"'"' AND "reservedByOrderId" IS NULL;'
  NOTA_A='literal de C8(a) — cifra DEFINITIVA de `SEC-SB-1`'
else
  SQL_A='SELECT count(*) FROM "InventoryItem" WHERE status='"'"'reserved'"'"';'
  NOTA_A='equivalente PRE (la columna aún no existe; M-53 no hace backfill ⇒ todas éstas nacerán NULL)'
fi

# --- El censo, en UNA transacción de solo lectura ----------------------------
SALIDA="$("${PSQL[@]}" <<SQL 2>&1
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
SELECT 'reloj', now() AT TIME ZONE 'UTC';
SELECT 'version', substring(version() from 'PostgreSQL [0-9.]+');
SELECT 'a', (${SQL_A%;});
SELECT 'b', (SELECT count(*) FROM "Order" WHERE status='pending' AND "userId" IS NOT NULL);
SELECT 'c', (SELECT count(*) FROM "InventoryItem");
SELECT 'c_size', pg_size_pretty(pg_total_relation_size('"InventoryItem"'));
SELECT 'd', string_agg(s || '=' || n, ', ' ORDER BY s) FROM (
  SELECT status::text AS s, count(*) AS n FROM "SellRequest"
   WHERE "closedAt" IS NULL AND status NOT IN ('pagada','rechazada','abandonada','expirada')
   GROUP BY status) t;
SELECT 'd_sin_oferta', (SELECT count(*) FROM "SellRequest"
   WHERE "closedAt" IS NULL AND status='cotizada' AND "offerSentAt" IS NULL);
SELECT 'e', (SELECT count(*) FROM "SellRequest"
   WHERE status IN ('verificacion','aprobada') AND ("receivedAt" IS NULL OR "verifiedAt" IS NULL));
COMMIT;
SQL
)" || {
  echo "::error::el censo falló. NO concluyente — no hay ninguna cifra que anotar:"
  # La salida de psql puede traer el URL en un mensaje de conexión: se poda el esquema.
  printf '%s\n' "$SALIDA" | sed -E 's#postgres(ql)?://[^ ]*#postgresql://<oculto>#g' | sed 's/^/    /'
  exit 2
}

val() { printf '%s\n' "$SALIDA" | awk -F'\t' -v k="$1" '$1==k {print $2; found=1} END {if(!found) print "?"}'; }
RELOJ="$(val reloj)"; VER="$(val version)"
A="$(val a)"; B="$(val b)"; C="$(val c)"; C_SIZE="$(val c_size)"
D="$(val d)"; D_SIN="$(val d_sin_oferta)"; E="$(val e)"
[ "$D" = "" ] && D="(ninguna viva)"

for n in "$A" "$B" "$C"; do
  case "$n" in
    ''|*[!0-9]*) echo "::error::una de las tres cifras de C8 no es un número ('$n'). NO concluyente."; exit 2 ;;
  esac
done

SHA_ARBOL="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"

echo
echo "── Censo de reservas legadas · ARCHITECTURE §4.48.7 paso 1 · condición C8 ──"
printf '  objetivo    : base «%s» · huella del host %s (%s) · %s\n' "$DB_NAME" "$HOST_FP" "$HOST_CLASE" "$VER"
printf '  declarado   : --target %s\n' "$TARGET"
printf '  fase medida : %s  (columna "InventoryItem.reservedByOrderId" %s ⇒ M-53 %s)\n' \
  "$(printf '%s' "$FASE_MEDIDA" | tr '[:lower:]' '[:upper:]')" \
  "$([ "$FASE_MEDIDA" = post ] && echo PRESENTE || echo AUSENTE)" \
  "$([ "$FASE_MEDIDA" = post ] && echo aplicada || echo 'SIN aplicar')"
printf '  reloj (UTC) : %s   ·  árbol local: %s\n' "$RELOJ" "$SHA_ARBOL"
echo
printf '  (a) reservas legadas ................. %s   [%s]\n' "$A" "$NOTA_A"
printf '      consulta: %s\n' "$SQL_A"
printf '  (b) órdenes de bóveda pending c/dueño  %s\n' "$B"
printf '  (c) filas de "InventoryItem" ......... %s   (tamaño total en disco: %s)\n' "$C" "$C_SIZE"
echo
printf '  (d) SellRequest vivas por estado: %s\n' "$D"
printf '      de ellas, `cotizada` SIN offerSentAt: %s\n' "$D_SIN"
printf '  (e) SellRequest en verificacion|aprobada con receivedAt o verifiedAt NULL: %s\n' "$E"
echo

if [ "$B" -gt 0 ]; then
  printf '  \033[1;33m▲ C9 SE ABRE: hay %s orden(es) de bóveda `pending` con dueño.\033[0m\n' "$B"
  echo '    Dueño: backend. Ficha en docs/TECH_DEBT.md con ESTE número y su disparador; y la rama'
  echo '    `IS NULL` de `reservationGuard` NO se retira hasta que (a) sea 0 medido en el objetivo.'
else
  echo '  · C9 no se abre por (b)=0. (a) manda igual: si (a)>0 hay piezas congeladas que liberar.'
fi
if [ "$A" -gt 0 ]; then
  printf '  \033[1;33m▲ SEC-SB-1 tiene cuerpo: %s pieza(s) quedarán `reserved` sin dueño y ningún barrido las cubre.\033[0m\n' "$A"
fi
if [ "$FASE_MEDIDA" = "pre" ]; then
  echo '  · Fase PRE: (a) es el conjunto que M-53 dejará en NULL. Vuelve a correr con --phase post'
  echo '    justo DESPUÉS de `prisma migrate deploy` para la cifra definitiva.'
fi
echo
echo "── PEGAR TAL CUAL EN docs/DEVOPS_NOTES.md (C8) ──"
printf '| %s | %s | %s | %s | %s | %s | %s | %s | %s |\n' \
  "$RELOJ" "$FASE_MEDIDA" "$TARGET/$HOST_FP" "$A" "$B" "$C" "$C_SIZE" "$D_SIN" "$E"
echo "(columnas: fecha UTC | fase | objetivo/huella | (a) legadas | (b) bóveda pending | (c) filas | (c) tamaño | cotizada sin oferta | verificación saltada)"
echo
exit 0

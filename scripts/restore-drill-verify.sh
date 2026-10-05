#!/usr/bin/env bash
#
# restore-drill-verify.sh — simulacro de restauración de la base (LIVE-13)
#                                                                        · devops
# =============================================================================
# POR QUÉ EXISTE (API_CONTRACT §14.11, LIVE-13)
# ---------------------------------------------------------------------------
# `DEVOPS_NOTES.md:459` dice «backups automáticos + point-in-time». Que estén
# ACTIVADOS en el plan del dueño: NO MEDIDO. Que un respaldo se haya restaurado
# alguna vez: NO HAY REGISTRO. Un respaldo que nunca se restauró es una
# esperanza, no un respaldo. Con dinero real, la pregunta «¿y si se pierde la
# base?» tiene que tener una respuesta MEDIDA: cuánto se tarda (RTO) y cuánto se
# pierde (RPO).
#
# CUATRO MODOS
#   --snapshot  (en PRODUCCIÓN, solo lectura; o en local)
#       Foto de control: filas por tabla, SUM("totalCents") y filas de "Order" por
#       estado, PaymentRefund y ManualRefund por estado, y la última migración.
#       Con `--dump FICHERO` hace ADEMÁS el `pg_dump -Fc` dentro de la MISMA foto
#       de la base (pg_export_snapshot + pg_dump --snapshot): la foto y el volcado
#       describen exactamente el mismo instante, aunque la tienda siga vendiendo.
#       Sin `--dump`, cualquier escritura entre la foto y el volcado aparecerá
#       luego como diferencia (y se verá cuál).
#   --restore FICHERO  (en la base TEMPORAL del simulacro)
#       `pg_restore` del volcado. ⛔ Se NIEGA si la base de destino tiene una sola
#       tabla en `public`: producción nunca está vacía, así que esta guarda hace
#       imposible restaurar ENCIMA de producción por error. Mide la duración.
#   --verify FOTO  (en la base restaurada, solo lectura)
#       Toma la misma foto y la compara línea a línea. rc 0 solo si TODO cuadra.
#       Imprime la antigüedad del respaldo (RPO medido).
#   --selftest-compare A B   (sin base; lo usa el canario)
#
# SEGURIDAD
#   · --snapshot y --verify: `BEGIN TRANSACTION READ ONLY`. No escriben nada.
#   · Ni el DATABASE_URL ni su host salen por pantalla: solo el NOMBRE de la base y
#     una HUELLA del host (sha256, 8 hex). El repositorio es PÚBLICO.
#   · La foto contiene CONTEOS y SUMAS (datos de negocio, no personales); el
#     VOLCADO contiene datos PERSONALES (CLABE/RFC cifrados, correos, direcciones):
#     ⛔ ni la foto ni el volcado van al repositorio, a un artefacto de Actions ni
#     a un chat. Disco cifrado del dueño (§14.11 paso 3).
#   · --target obligatorio y cruzado con el host: prod|local para --snapshot;
#     drill|local para --restore/--verify (⛔ --target prod no restaura ni verifica).
#
# Uso (procedimiento entero: DEVOPS_NOTES §85.5):
#   DATABASE_URL='<conexión pública de Railway, idealmente usuario de solo lectura>' \
#     ./scripts/restore-drill-verify.sh --snapshot --target prod --out foto.tsv --dump respaldo.dump
#   DATABASE_URL='<base TEMPORAL vacía>' ./scripts/restore-drill-verify.sh --restore respaldo.dump --target drill
#   DATABASE_URL='<base TEMPORAL>'       ./scripts/restore-drill-verify.sh --verify foto.tsv --target drill
#
# rc: 0 OK/cuadra · 1 NO cuadra · 2 no concluyente (args, sin psql, SQL falló, guarda).
# =============================================================================
set -uo pipefail

MODE=""; TARGET=""; OUT=""; DUMP=""; ARG=""; ARG2=""
while [ $# -gt 0 ]; do
  case "$1" in
    --snapshot) MODE=snapshot; shift ;;
    --restore) MODE=restore; ARG="${2:-}"; shift 2 ;;
    --verify) MODE=verify; ARG="${2:-}"; shift 2 ;;
    --selftest-compare) MODE=selftest; ARG="${2:-}"; ARG2="${3:-}"; shift 3 ;;
    --target) TARGET="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --dump) DUMP="${2:-}"; shift 2 ;;
    -h|--help) sed -n '1,55p' "$0"; exit 0 ;;
    *) echo "::error::opción desconocida '$1'"; exit 2 ;;
  esac
done
die2() { echo "::error::$*"; exit 2; }

# --- comparación (pura) ------------------------------------------------------
# Formato de la foto: «clave<TAB>valor», una por línea. Las claves `meta.*` no se
# comparan (fecha, huella del host, nombre de la base cambian por construcción).
comparar() { # <foto origen> <foto destino>
  local a="$1" b="$2"
  [ -s "$a" ] || die2 "la foto de origen '$a' no existe o está vacía."
  [ -s "$b" ] || die2 "la foto de destino '$b' no existe o está vacía."
  grep -q $'^meta.formato\trestore-drill/v1$' "$a" || die2 "'$a' no es una foto restore-drill/v1."
  grep -q $'^meta.formato\trestore-drill/v1$' "$b" || die2 "'$b' no es una foto restore-drill/v1."
  grep -q '^migracion\.ultima' "$a" || die2 "'$a' no trae la última migración: foto incompleta."
  grep -q '^filas\.' "$a" || die2 "'$a' no trae conteos de tablas: foto incompleta."
  local da db_; da="$(grep -v '^meta\.' "$a" | LC_ALL=C sort)"; db_="$(grep -v '^meta\.' "$b" | LC_ALL=C sort)"
  local n; n="$(grep -vc '^meta\.' "$a")"
  if [ "$da" = "$db_" ]; then
    echo "  ✔ las $n líneas de control cuadran (tablas, sumas de Order, reembolsos, última migración)."
    return 0
  fi
  echo "  ✗ NO cuadra. Diferencias (< origen · > restaurada):"
  diff <(printf '%s\n' "$da") <(printf '%s\n' "$db_") | grep '^[<>]' | sed 's/^/      /' | head -60
  return 1
}

if [ "$MODE" = "selftest" ]; then
  comparar "$ARG" "$ARG2"; exit $?
fi

case "$MODE" in
  snapshot) case "$TARGET" in prod|local) ;; *) die2 "--snapshot exige --target prod|local." ;; esac ;;
  restore|verify) case "$TARGET" in drill|local) ;; prod) die2 "--$MODE con --target prod: NO. El simulacro se hace en una base que NO es producción." ;; *) die2 "--$MODE exige --target drill|local." ;; esac
    [ -n "$ARG" ] && [ -s "$ARG" ] || die2 "falta el fichero de --$MODE, o está vacío." ;;
  *) die2 "elige un modo: --snapshot | --restore FICHERO | --verify FOTO (ver --help)." ;;
esac
command -v psql >/dev/null 2>&1 || die2 "no hay psql en el PATH."
command -v node >/dev/null 2>&1 || die2 "no hay node para leer el URL sin imprimirlo."
[ -n "${DATABASE_URL:-}" ] || die2 "falta DATABASE_URL (en la terminal del dueño, nunca en el repo ni en un chat)."

# --- identidad sin publicar el objetivo; URL limpio para libpq ----------------
IDENT="$(DBURL="$DATABASE_URL" node -e '
  const crypto=require("crypto"); let u;
  try { u=new URL(process.env.DBURL); } catch { console.log("ERR"); process.exit(0); }
  const host=(u.hostname||"").toLowerCase();
  const db=decodeURIComponent((u.pathname||"").replace(/^\//,""))||"(sin nombre)";
  const fp=crypto.createHash("sha256").update(host).digest("hex").slice(0,8);
  const local=["localhost","127.0.0.1","::1"].includes(host);
  console.log([db, fp, local?"LOCAL":"REMOTO"].join("\t"));
' 2>&1)"
[ "$IDENT" != "ERR" ] || die2 "DATABASE_URL no es un URL parseable."
IFS=$'\t' read -r DB_NAME HOST_FP HOST_CLASE <<<"$IDENT"
# Prisma añade parámetros que libpq rechaza (`schema`, `connection_limit`, `pool_timeout`, `pgbouncer`).
PGURL="$(DBURL="$DATABASE_URL" node -e '
  const u=new URL(process.env.DBURL);
  for (const k of ["schema","connection_limit","pool_timeout","pgbouncer","socket_timeout","statement_cache_size"]) u.searchParams.delete(k);
  console.log(u.toString());
')"
if [ "$TARGET" = "local" ] && [ "$HOST_CLASE" != "LOCAL" ]; then die2 "dijiste --target local pero el host NO es local (huella $HOST_FP)."; fi
if [ "$TARGET" = "prod" ] && [ "$HOST_CLASE" = "LOCAL" ]; then die2 "dijiste --target prod pero el host es LOCAL: una foto local anotada como producción engaña."; fi
echo "── restore-drill (LIVE-13) · modo $MODE · --target $TARGET · base «$DB_NAME» · huella host $HOST_FP ($HOST_CLASE) ──"

PSQL=(psql "$PGURL" -X -q -At -F $'\t' -v ON_ERROR_STOP=1)

# Consultas de la foto. Se ejecutan dentro de la transacción que abre el llamador.
SQL_FOTO=$(cat <<'SQL'
SET LOCAL statement_timeout = '300s';
SELECT 'migracion.ultima', migration_name || '|' || COALESCE(to_char(finished_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS'),'(sin terminar)')
  FROM "_prisma_migrations" ORDER BY finished_at DESC NULLS LAST, migration_name DESC LIMIT 1;
SELECT 'migracion.terminadas', count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
SELECT 'order.total_cents.' || status::text, COALESCE(SUM("totalCents"),0) FROM "Order" GROUP BY status;
SELECT 'order.filas.' || status::text, count(*) FROM "Order" GROUP BY status;
SELECT 'payment_refund.' || status::text, count(*) FROM "PaymentRefund" GROUP BY status;
SELECT 'manual_refund.' || status::text, count(*) FROM "ManualRefund" GROUP BY status;
SELECT format('SELECT %L, count(*) FROM public.%I', 'filas.' || tablename, tablename)
  FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
\gexec
SQL
)

cabecera_foto() {
  printf 'meta.formato\trestore-drill/v1\n'
  printf 'meta.tomada_utc\t%s\n' "$(date -u +%FT%TZ)"
  printf 'meta.base\t%s\n' "$DB_NAME"
  printf 'meta.host_huella\t%s\n' "$HOST_FP"
  printf 'meta.target\t%s\n' "$TARGET"
}

case "$MODE" in
# =============================================================================
snapshot)
  OUT="${OUT:-restore-drill-foto-$(date -u +%Y%m%dT%H%M%SZ).tsv}"
  [ -e "$OUT" ] && die2 "'$OUT' ya existe; no lo piso."
  if [ -z "$DUMP" ]; then
    { cabecera_foto
      printf 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n%s\nCOMMIT;\n' "$SQL_FOTO" | "${PSQL[@]}" -f - ; } > "$OUT.tmp" \
      || { rm -f "$OUT.tmp"; die2 "la foto falló (SQL). Nada escrito."; }
    mv "$OUT.tmp" "$OUT"
    echo "  foto: $OUT ($(grep -vc '^meta\.' "$OUT") líneas de control)"
    echo "  ⚠️  sin --dump: si se escribe en la base entre esta foto y el volcado, el --verify lo mostrará como diferencia."
    exit 0
  fi
  command -v pg_dump >/dev/null 2>&1 || die2 "no hay pg_dump en el PATH."
  [ -e "$DUMP" ] && die2 "'$DUMP' ya existe; no lo piso."
  # Foto y volcado en el MISMO instante: una sesión exporta su snapshot y lo
  # mantiene abierto; la foto lo importa y pg_dump lo usa con --snapshot.
  coproc HOLD { "${PSQL[@]}" 2>&1; }
  printf 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT pg_export_snapshot();\n' >&"${HOLD[1]}"
  SNAP=""
  read -r -t 30 SNAP <&"${HOLD[0]}" || true
  case "$SNAP" in
    [0-9A-F]*-*-*) ;;
    *) kill "$HOLD_PID" 2>/dev/null; die2 "no pude exportar el snapshot de la base (respuesta: ${SNAP:-vacía})." ;;
  esac
  echo "  snapshot exportado: $SNAP (la foto y el volcado lo comparten)"
  T0=$(date +%s)
  { cabecera_foto
    printf 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET TRANSACTION SNAPSHOT %s;\n%s\nCOMMIT;\n' "'$SNAP'" "$SQL_FOTO" | "${PSQL[@]}" -f - ; } > "$OUT.tmp" \
    || { printf 'ROLLBACK;\n\\q\n' >&"${HOLD[1]}"; rm -f "$OUT.tmp"; die2 "la foto falló (SQL). Nada escrito."; }
  pg_dump "$PGURL" --snapshot="$SNAP" -Fc --no-owner --no-privileges -f "$DUMP.tmp" \
    || { printf 'ROLLBACK;\n\\q\n' >&"${HOLD[1]}"; rm -f "$OUT.tmp" "$DUMP.tmp"; die2 "pg_dump falló. Nada escrito."; }
  T1=$(date +%s)
  printf 'COMMIT;\n\\q\n' >&"${HOLD[1]}"; wait "$HOLD_PID" 2>/dev/null
  mv "$OUT.tmp" "$OUT"; mv "$DUMP.tmp" "$DUMP"; chmod 600 "$DUMP" 2>/dev/null
  echo "  foto    : $OUT ($(grep -vc '^meta\.' "$OUT") líneas de control)"
  echo "  volcado : $DUMP ($(du -h "$DUMP" | cut -f1)) en $((T1-T0)) s · ⛔ contiene datos personales: disco cifrado, nunca al repo."
  exit 0 ;;
# =============================================================================
restore)
  command -v pg_restore >/dev/null 2>&1 || die2 "no hay pg_restore en el PATH."
  N_TABLAS="$(printf "SELECT count(*) FROM pg_tables WHERE schemaname='public';\n" | "${PSQL[@]}" -f -)" \
    || die2 "no pude contar las tablas de la base de destino."
  if [ "$N_TABLAS" != "0" ]; then
    die2 "la base de destino tiene $N_TABLAS tabla(s) en public. ⛔ Solo se restaura en una base VACÍA (producción nunca lo está). Crea una base nueva para el simulacro."
  fi
  T0=$(date +%s)
  pg_restore --no-owner --no-privileges --exit-on-error -d "$PGURL" "$ARG" \
    || die2 "pg_restore falló (la base temporal puede haber quedado a medias: bórrala y repite)."
  T1=$(date +%s)
  echo "  ✔ restaurado en $((T1-T0)) s (parte del RTO: súmale crear la base y cambiar la conexión)."
  exit 0 ;;
# =============================================================================
verify)
  ORIGEN="$ARG"
  TMPF="$(mktemp -t restore-drill-XXXXXX)"; trap 'rm -f "$TMPF"' EXIT
  { cabecera_foto
    printf 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n%s\nCOMMIT;\n' "$SQL_FOTO" | "${PSQL[@]}" -f - ; } > "$TMPF" \
    || die2 "la foto de la base restaurada falló (SQL)."
  TOMADA="$(sed -n 's/^meta\.tomada_utc\t//p' "$ORIGEN")"
  if [ -n "$TOMADA" ]; then
    EDAD=$(( $(date -u +%s) - $(date -u -d "$TOMADA" +%s 2>/dev/null || echo "$(date -u +%s)") ))
    echo "  respaldo tomado: $TOMADA · antigüedad hoy: $((EDAD/3600)) h $(((EDAD%3600)/60)) min (RPO si la caída fuera ahora)"
  fi
  comparar "$ORIGEN" "$TMPF"; exit $? ;;
esac

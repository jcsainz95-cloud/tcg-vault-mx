#!/usr/bin/env bash
#
# db-disk-watch.sh — vigilancia PROPIA del disco de Postgres y del ritmo de
#                    filas/día de PriceReference (P-53).                 · devops
# =============================================================================
# POR QUÉ EXISTE (P-53, medido 2026-09)
# ---------------------------------------------------------------------------
# El volumen de Postgres se llenó y NOS ENTERAMOS TARDE, por la alerta de Railway
# (primero al 77%, luego al 86%). Railway avisa cuando ya casi no hay margen; para
# entonces la única salida barata (acotar el WAL) exige respaldo y ventana, y la
# de fondo (escribir menos filas/día) es un release money-critical. Un aviso
# PROPIO, con semanas de antelación, es lo que convierte «apaga el incendio hoy»
# en «tienes tres semanas para decidir».
#
#     ► «Descubrir el tope a pocos días es no tener margen para la cura buena.»
#
# QUÉ MIDE (todo SOLO LECTURA, todo por SQL — no necesita shell en el contenedor)
# ---------------------------------------------------------------------------
#   · uso estimado del volumen = suma de tamaños de TODAS las bases + WAL total
#     (pg_ls_waldir()). Es la señal temprana; el número autoritativo del VOLUMEN
#     total lo da el panel de Railway (no hay SQL que lo lea en Postgres gestionado
#     — por eso el tamaño del volumen se PASA con --volume-bytes; default 1 GiB).
#   · WAL: nº de ficheros y bytes (pg_ls_waldir()) — mide si el parche de
#     scripts/db-wal-tuning.sql ya surtió efecto.
#   · replication slots (pg_replication_slots): P-53 esperaba 0. >0 ⇒ FUGA ⇒ ROJO.
#   · max_wal_size / min_wal_size efectivos (pg_settings): dice si el WAL ya está
#     acotado o sigue de fábrica (1GB).
#   · PriceReference: filas totales, bytes/fila, y filas/día de los últimos días
#     (GROUP BY "capturedDate"). De ahí sale el RITMO real de crecimiento.
#   · PROYECCIÓN: días hasta llenar el volumen al ritmo medido.
#
# VEREDICTO (umbrales configurables)
#   ROJO  (rc=1)  → uso ≥ --crit-pct (90) · o días-al-tope ≤ --min-days (21) · o
#                    hay ≥1 replication slot (fuga de WAL). Un cron lo NOTIFICA.
#   AVISO (rc=0)  → uso ≥ --warn-pct (80). Sale ::warning:: visible; aún hay margen.
#   OK    (rc=0)  → por debajo de todo.
#   ⛔ rc=2 = NO CONCLUYENTE (sin URL, sin psql, target incoherente, SQL falló).
#            Nunca sale 0 con una cifra que no leyó.
#
# SEGURIDAD DE ESTE GUION (igual doctrina que release-reservation-census.sh)
#   · Solo lee: BEGIN TRANSACTION READ ONLY + default_transaction_read_only.
#   · No imprime la credencial: del DATABASE_URL solo salen el NOMBRE de la base
#     y una HUELLA del host (sha256, 8 hex). Repo PÚBLICO.
#   · --target prod|local obligatorio en modo vivo y cruzado contra el host.
#
# Uso:
#   DATABASE_URL='postgresql://…' ./scripts/db-disk-watch.sh --target prod
#   DATABASE_URL='…' ./scripts/db-disk-watch.sh --target prod --volume-bytes 1073741824
#   ./scripts/db-disk-watch.sh --print-queries     # las consultas de P-53, para pegar
#   ./scripts/db-disk-watch.sh --selftest-eval U V P S M   # solo el veredicto (canario)
#
#   --target prod|local        (obligatorio en modo vivo)
#   --volume-bytes N           tamaño del volumen en bytes (default 1073741824 = 1 GiB)
#   --warn-pct N               umbral de AVISO en % de uso (default 80)
#   --crit-pct N               umbral ROJO en % de uso (default 90)
#   --min-days N               ROJO si faltan ≤ N días al tope (default 21)
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR" || exit 2

TARGET=""
VOLUME_BYTES=1073741824      # 1 GiB — el volumen de prod de P-53. El dueño lo ajusta.
WARN_PCT=80
CRIT_PCT=90
MIN_DAYS=21

# --- Las consultas de diagnóstico de P-53, verbatim (referencia solo-lectura) --
imprimir_consultas() {
  cat <<'SQL'
-- P-53 · consultas de diagnóstico SOLO LECTURA (pegar en psql contra la base):

-- 1) tamaño por tabla (las 15 mayores):
SELECT relname AS tabla,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='r' AND n.nspname='public'
 ORDER BY pg_total_relation_size(c.oid) DESC
 LIMIT 15;

-- 2) tamaño del WAL (equivalente SQL de `du -sh …/pgdata/pg_wal`):
SELECT count(*) AS wal_files, pg_size_pretty(sum(size)) AS wal_total FROM pg_ls_waldir();
--    (en la consola de Railway, además: du -sh /var/lib/postgresql/data/pgdata/*)

-- 3) replication slots (P-53: cero = no hay fuga):
SELECT * FROM pg_replication_slots;

-- 4) ritmo de escritura de PriceReference (filas/día):
SELECT "capturedDate", count(*) FROM "PriceReference" GROUP BY 1 ORDER BY 1 DESC;
SQL
}

# --- EVALUADOR PURO del veredicto (sin base): usado en vivo Y por el canario ---
# evaluar USED_BYTES VOLUME_BYTES BYTES_PER_DAY SLOTS MAXWAL_MB
# Imprime el veredicto legible y una línea "VERDICT=<NIVEL>"; devuelve el rc.
evaluar() {
  local used="$1" vol="$2" perday="$3" slots="$4" maxwal_mb="${5:-?}"
  local pct days_txt nivel rc razon
  read -r pct days_txt < <(awk -v u="$used" -v v="$vol" -v p="$perday" 'BEGIN{
      if (v<=0){ printf "0 ?\n"; exit }
      pct = u*100.0/v;
      if (p>0){ d=(v-u)/p; printf "%.1f %.0f\n", pct, d }
      else    { printf "%.1f INF\n", pct }
  }')
  nivel="OK"; rc=0; razon=""
  # AVISO por uso
  if awk -v a="$pct" -v b="$WARN_PCT" 'BEGIN{exit !(a>=b)}'; then nivel="AVISO"; fi
  # ROJO por uso crítico
  if awk -v a="$pct" -v b="$CRIT_PCT" 'BEGIN{exit !(a>=b)}'; then
    nivel="ROJO"; rc=1; razon="uso ${pct}% ≥ crit ${CRIT_PCT}%"
  fi
  # ROJO por proyección
  if [ "$days_txt" != "INF" ] && [ "$days_txt" != "?" ]; then
    if [ "$days_txt" -le "$MIN_DAYS" ] 2>/dev/null; then
      nivel="ROJO"; rc=1
      razon="${razon:+$razon; }faltan ${days_txt}d al tope ≤ min ${MIN_DAYS}d"
    fi
  fi
  # ROJO por fuga de WAL
  if [ "${slots:-0}" -gt 0 ] 2>/dev/null; then
    nivel="ROJO"; rc=1
    razon="${razon:+$razon; }${slots} replication slot(s) — FUGA de WAL (P-53 esperaba 0)"
  fi

  local color; case "$nivel" in
    ROJO)  color='1;31' ;; AVISO) color='1;33' ;; *) color='1;32' ;;
  esac
  printf '  \033[%sm● %s\033[0m — uso %s%% del volumen · ' "$color" "$nivel" "$pct"
  if [ "$days_txt" = "INF" ]; then printf 'crecimiento ~0 (sin proyección)\n'
  elif [ "$days_txt" = "?" ]; then printf 'volumen inválido\n'
  else printf 'faltan ~%s días al tope al ritmo actual\n' "$days_txt"; fi
  [ -n "$razon" ] && printf '     motivo del ROJO: %s\n' "$razon"
  [ "$maxwal_mb" != "?" ] && printf '     max_wal_size efectivo: %s MB %s\n' "$maxwal_mb" \
    "$([ "${maxwal_mb%.*}" -ge 512 ] 2>/dev/null && echo '(¡aún de FÁBRICA! aplica scripts/db-wal-tuning.sql — P-53)' || echo '(acotado)')"
  echo "VERDICT=$nivel"
  return $rc
}

# --- Parse de argumentos -----------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --target)       TARGET="${2:-}"; shift 2 ;;
    --volume-bytes) VOLUME_BYTES="${2:-}"; shift 2 ;;
    --warn-pct)     WARN_PCT="${2:-}"; shift 2 ;;
    --crit-pct)     CRIT_PCT="${2:-}"; shift 2 ;;
    --min-days)     MIN_DAYS="${2:-}"; shift 2 ;;
    --print-queries) imprimir_consultas; exit 0 ;;
    --selftest-eval)
      # canario: evalúa el veredicto sobre cifras sintéticas, sin base.
      shift
      [ $# -ge 4 ] || { echo "::error::--selftest-eval necesita USED VOL PERDAY SLOTS [MAXWAL_MB]"; exit 2; }
      evaluar "$1" "$2" "$3" "$4" "${5:-?}"
      exit $?
      ;;
    -h|--help) sed -n '1,64p' "$0"; exit 0 ;;
    *) echo "::error::opción desconocida '$1'."; exit 2 ;;
  esac
done

[[ "$VOLUME_BYTES" =~ ^[0-9]+$ ]] || { echo "::error::--volume-bytes debe ser entero de bytes (recibí '$VOLUME_BYTES')."; exit 2; }

case "$TARGET" in
  prod|local) ;;
  *) echo "::error::falta --target prod|local. Sin él, unas cifras de la base de desarrollo se anotan como producción y nadie lo nota."; exit 2 ;;
esac

command -v psql >/dev/null 2>&1 || { echo "::error::no hay \`psql\` en el PATH. NO concluyente."; exit 2; }
[ -n "${DATABASE_URL:-}" ] || {
  cat >&2 <<'SINURL'
::error::sin DATABASE_URL no puedo medir. NO concluyente (y «no concluyente» no es «0»).
  Este guion NO trae credencial: la pone quien lo corre, en su shell, y solo mientras corre.
  Para producción es el DATABASE_URL del servicio de Postgres de Railway (idealmente un
  USUARIO DE SOLO LECTURA miembro de `pg_monitor`; ver DEVOPS_NOTES §"P-53 · Vigilancia").
      export DATABASE_URL='postgresql://…'   # NO se pega en ningún fichero del repo
      ./scripts/db-disk-watch.sh --target prod
      unset DATABASE_URL
SINURL
  exit 2
}
command -v node >/dev/null 2>&1 || { echo "::error::no hay \`node\` para parsear el URL sin filtrarlo. NO concluyente."; exit 2; }

# --- Identidad del objetivo, sin publicar el objetivo (igual que el censo) ----
IDENT="$(DBURL="$DATABASE_URL" node -e '
  const crypto = require("crypto");
  let u;
  try { u = new URL(process.env.DBURL); } catch (e) { console.log("ERR url no parseable"); process.exit(0); }
  const host = (u.hostname || "").toLowerCase();
  const db = decodeURIComponent((u.pathname || "").replace(/^\//, "")) || "(sin nombre)";
  const fp = crypto.createHash("sha256").update(host).digest("hex").slice(0, 8);
  const local = ["localhost","127.0.0.1","::1","0.0.0.0","db","postgres","host.docker.internal"].includes(host);
  console.log([db, fp, local ? "LOCAL" : "REMOTO"].join("\t"));
' 2>&1)"
case "$IDENT" in
  ERR*) echo "::error::DATABASE_URL no es un URL parseable (${IDENT#ERR }). NO concluyente."; exit 2 ;;
esac
IFS=$'\t' read -r DB_NAME HOST_FP HOST_CLASE <<<"$IDENT"

if [ "$TARGET" = "prod" ] && [ "$HOST_CLASE" = "LOCAL" ]; then
  echo "::error::dijiste --target prod pero el host del DATABASE_URL es LOCAL. Abortado: una vigilancia local anotada como producción da falsa tranquilidad."; exit 2
fi
if [ "$TARGET" = "local" ] && [ "$HOST_CLASE" = "REMOTO" ]; then
  echo "::error::dijiste --target local pero el host NO es local (huella $HOST_FP). Si es producción, se entra con --target prod."; exit 2
fi

PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --no-psqlrc -At -F $'\t')

# --- La medición, en UNA transacción de solo lectura -------------------------
SALIDA="$("${PSQL[@]}" <<'SQL' 2>&1
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
SELECT 'reloj', now() AT TIME ZONE 'UTC';
SELECT 'version', substring(version() from 'PostgreSQL [0-9.]+');
-- uso: suma de TODAS las bases (base de datos) + WAL total (bytes)
SELECT 'db_bytes', (SELECT coalesce(sum(pg_database_size(datname)),0) FROM pg_database);
SELECT 'wal_bytes', (SELECT coalesce(sum(size),0) FROM pg_ls_waldir());
SELECT 'wal_files', (SELECT count(*) FROM pg_ls_waldir());
SELECT 'slots', (SELECT count(*) FROM pg_replication_slots);
-- max/min_wal_size en MB, robusto ante la unidad que reporte pg_settings.
SELECT 'max_wal_mb', (SELECT round(setting::numeric * CASE unit
         WHEN 'kB' THEN 1/1024.0 WHEN '8kB' THEN 8/1024.0 WHEN 'MB' THEN 1
         WHEN 'GB' THEN 1024 ELSE 1 END) FROM pg_settings WHERE name='max_wal_size');
SELECT 'min_wal_mb', (SELECT round(setting::numeric * CASE unit
         WHEN 'kB' THEN 1/1024.0 WHEN '8kB' THEN 8/1024.0 WHEN 'MB' THEN 1
         WHEN 'GB' THEN 1024 ELSE 1 END) FROM pg_settings WHERE name='min_wal_size');
-- PriceReference: tamaño total, filas, y ritmo de los últimos 7 días con datos
SELECT 'pr_bytes', pg_total_relation_size('"PriceReference"');
SELECT 'pr_rows', (SELECT count(*) FROM "PriceReference");
SELECT 'pr_perday', (
  SELECT round(avg(n)) FROM (
    SELECT count(*) AS n FROM "PriceReference"
     GROUP BY "capturedDate" ORDER BY "capturedDate" DESC LIMIT 7
  ) t);
COMMIT;
SQL
)" || {
  echo "::error::la medición falló. NO concluyente — no hay cifra que anotar:"
  printf '%s\n' "$SALIDA" | sed -E 's#postgres(ql)?://[^ ]*#postgresql://<oculto>#g' | sed 's/^/    /'
  exit 2
}

val() { printf '%s\n' "$SALIDA" | awk -F'\t' -v k="$1" '$1==k {print $2; found=1} END {if(!found) print ""}'; }
RELOJ="$(val reloj)"; VER="$(val version)"
DB_BYTES="$(val db_bytes)"; WAL_BYTES="$(val wal_bytes)"; WAL_FILES="$(val wal_files)"
SLOTS="$(val slots)"; MAXWAL_MB="$(val max_wal_mb)"; MINWAL_MB="$(val min_wal_mb)"
PR_BYTES="$(val pr_bytes)"; PR_ROWS="$(val pr_rows)"; PR_PERDAY="$(val pr_perday)"

for n in "$DB_BYTES" "$WAL_BYTES" "$SLOTS" "$PR_BYTES" "$PR_ROWS"; do
  case "$n" in ''|*[!0-9]*) echo "::error::una cifra base no es numérica ('$n'). NO concluyente."; exit 2 ;; esac
done
[ -n "$PR_PERDAY" ] || PR_PERDAY=0
case "$PR_PERDAY" in *[!0-9]*) PR_PERDAY=0 ;; esac

USED_BYTES=$(( DB_BYTES + WAL_BYTES ))
# bytes/día ≈ filas/día × bytes por fila de PriceReference (el motor del crecimiento).
BYTES_PER_ROW=$(awk -v b="$PR_BYTES" -v r="$PR_ROWS" 'BEGIN{ if(r>0) printf "%.0f", b/r; else print 0 }')
BYTES_PER_DAY=$(( PR_PERDAY * BYTES_PER_ROW ))
# max_wal_mb/min_wal_mb ya vienen en MB de la consulta (robusto ante la unidad).
case "$MAXWAL_MB" in ''|*[!0-9]*) MAXWAL_MB="?" ;; esac
case "$MINWAL_MB" in ''|*[!0-9]*) MINWAL_MB="?" ;; esac

hp() { printf '%s' "$1" | awk '{ s=$1; u="B"; if(s>=1073741824){s/=1073741824;u="GiB"} else if(s>=1048576){s/=1048576;u="MiB"} else if(s>=1024){s/=1024;u="KiB"}; printf "%.1f %s", s, u }'; }

echo
echo "── db-disk-watch · vigilancia del disco de Postgres · P-53 ──"
printf '  objetivo   : base «%s» · huella host %s (%s) · %s\n' "$DB_NAME" "$HOST_FP" "$HOST_CLASE" "$VER"
printf '  declarado  : --target %s · volumen %s (--volume-bytes %s)\n' "$TARGET" "$(hp "$VOLUME_BYTES")" "$VOLUME_BYTES"
printf '  reloj (UTC): %s\n' "$RELOJ"
echo
printf '  uso estimado (bases + WAL) : %s de %s\n' "$(hp "$USED_BYTES")" "$(hp "$VOLUME_BYTES")"
printf '    · datos (todas las bases): %s\n' "$(hp "$DB_BYTES")"
printf '    · WAL                    : %s  (%s ficheros · max_wal_size=%s MB · min_wal_size=%s MB)\n' \
  "$(hp "$WAL_BYTES")" "$WAL_FILES" "$MAXWAL_MB" "$MINWAL_MB"
printf '    · replication slots      : %s\n' "$SLOTS"
printf '  PriceReference             : %s filas · %s en disco · ~%s B/fila\n' "$PR_ROWS" "$(hp "$PR_BYTES")" "$BYTES_PER_ROW"
printf '    · ritmo (prom. 7 días)   : ~%s filas/día ⇒ ~%s/día\n' "$PR_PERDAY" "$(hp "$BYTES_PER_DAY")"
echo
echo "── veredicto (umbrales: aviso ${WARN_PCT}% · rojo ${CRIT_PCT}% · rojo si ≤${MIN_DAYS}d al tope) ──"
evaluar "$USED_BYTES" "$VOLUME_BYTES" "$BYTES_PER_DAY" "$SLOTS" "$MAXWAL_MB"
RC=$?
echo
echo "── PEGAR TAL CUAL en docs/DEVOPS_NOTES.md (bitácora de P-53) ──"
printf '| %s | %s/%s | %s | %s | %s | %s | %s | ~%s/día |\n' \
  "$RELOJ" "$TARGET" "$HOST_FP" "$(hp "$USED_BYTES")" "$(hp "$DB_BYTES")" "$(hp "$WAL_BYTES")" "$SLOTS" "$PR_PERDAY" "$(hp "$BYTES_PER_DAY")"
echo "(columnas: fecha UTC | objetivo/huella | uso | datos | WAL | slots | filas/día | crecimiento)"
echo
exit $RC

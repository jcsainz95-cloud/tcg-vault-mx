#!/usr/bin/env bash
# =============================================================================
# m50-rollback-gate.sh — el PASO DE DATOS del rollback de M-50, y su candado.
# Propiedad: devops.   DEVOPS_NOTES §46.1.
#
# ⛔⛔ LEE ESTO ANTES DE TOCAR NADA: **M-50 NO ES REVERSIBLE SOLO CON CÓDIGO.**
#
# La cabecera de `20260909120000_m50_price_convention/migration.sql` dice
# «ADITIVA Y REVERSIBLE SIN CEREMONIA» y para TRES de sus cinco columnas es
# cierto. Para las otras DOS es **falso**, y ejecutar el rollback como si fuera
# cierto **tumba el checkout entero**:
#
#   | columna                              | tras revertir el código |
#   |--------------------------------------|-------------------------|
#   | `Order.ivaTransferPct`               | NULLABLE → inerte ✅     |
#   | `ShipmentRequest.ivaTransferPct`     | NULLABLE → inerte ✅     |
#   | `ShipmentRequest.shippingCostIvaCents` | NOT NULL **DEFAULT 0** → inerte ✅ |
#   | `Order.priceConvention`              | NOT NULL **SIN default** → ⛔ TODO `INSERT` LANZA |
#   | `ShipmentRequest.priceConvention`    | NOT NULL **SIN default** → ⛔ TODO `INSERT` LANZA |
#
# MEDIDO (2026-09-10, Postgres 16 local con M-50 aplicada, dentro de una tx que
# se hizo ROLLBACK). Se reprodujo el `INSERT` del código ANTERIOR al candidato
# (que tiene **0 referencias** a `priceConvention` en `orders/`, `shipments/` y
# `payments/` — contado por QA) copiando una fila real de `Order`:
#
#   A) sin paso de datos →
#      ERROR: null value in column "priceConvention" of relation "Order"
#             violates not-null constraint
#      (la fila que reventó era un checkout de INVITADO real, `TCG-000209`)
#   B) tras `SET DEFAULT 'IVA_EXCLUSIVE'` → INSERT 0 1, con
#      priceConvention='IVA_EXCLUSIVE' e ivaTransferPct=NULL.
#
# ⇒ Alcance del daño si se revierte el código a pelo: **checkout registrado,
#   checkout de invitado y creación de envíos**. El negocio entero.
#
# -----------------------------------------------------------------------------
# ¿Y NO ES ESTO REINTRODUCIR EL DEFECTO QUE M-50 PROHÍBE? No, y la distinción
# es exactamente la misma que la migración usa para permitir el PASO 3-BIS: es
# de SIGNIFICADO, no de sintaxis.
#
#   · §4.44.e prohíbe el default porque, **bajo el régimen nuevo**, un camino de
#     escritura que OLVIDE el campo cobraría bajo una convención y archivaría
#     bajo la otra. El default convierte un hueco en una AFIRMACIÓN FALSA.
#   · Durante una VENTANA DE ROLLBACK no existe régimen nuevo: el único código
#     vivo es el anterior, cuya aritmética **es** `IVA_EXCLUSIVE` por definición.
#     Ahí `IVA_EXCLUSIVE` no es una suposición: es lo que de verdad pasó.
#
# ⚠️⚠️ Y POR ESO MISMO EL DEFAULT ES **TEMPORAL Y OBLIGATORIO DE QUITAR**. En el
# instante en que se vuelva a desplegar el candidato, el régimen nuevo existe y
# el default recupera toda su capacidad de mentir — para siempre y en silencio.
# `--assert-forward-safe` es el candado que impide ese roll-forward.
#
# ⛔ Y NO CONFÍES EN QUE LO ATRAPE OTRO: `IVA-3(c)`
# (`backend/test/migration.m50-no-default.spec.ts`) lee **el TEXTO de la
# migración en el repo**, no la base. Un `SET DEFAULT` aplicado a mano en
# producción le es INVISIBLE. La mitad que sí mira `information_schema` vive en
# `test/integration/iva-price-convention.e2e-spec.ts`, que corre contra la BD de
# CI y **jamás contra producción**. Es decir: sin este script, el default que
# deja el rollback **no tiene ningún vigilante en prod**.
#
# -----------------------------------------------------------------------------
# USO
#   export DATABASE_URL=...            # el de la BD que se va a operar
#   ./scripts/m50-rollback-gate.sh --status
#   ./scripts/m50-rollback-gate.sh --assert-forward-safe   # gate PRE-deploy
#   ./scripts/m50-rollback-gate.sh --prepare-rollback [--yes]
#   ./scripts/m50-rollback-gate.sh --finish-rollforward [--yes]
#
# Sin `--yes` los dos que ESCRIBEN sólo imprimen el SQL y salen 0. Es a
# propósito: el DDL sobre una tabla de dinero se lee antes de correrlo.
# =============================================================================
set -Eeuo pipefail

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; BLD=$'\033[1m'; RST=$'\033[0m'
[ -t 1 ] || { RED=""; GRN=""; YEL=""; BLD=""; RST=""; }
log()  { printf '%s==>%s %s\n' "$BLD" "$RST" "$*"; }
ok()   { printf '  %s✔%s %s\n' "$GRN" "$RST" "$*"; }
bad()  { printf '  %s✘%s %s\n' "$RED" "$RST" "$*"; }
warn() { printf '  %s!%s %s\n' "$YEL" "$RST" "$*"; }
die()  { printf '%s✖ %s%s\n' "$RED" "$*" "$RST" >&2; exit 1; }

MODE=""; YES=0
for a in "$@"; do
  case "$a" in
    --status|--assert-forward-safe|--prepare-rollback|--finish-rollforward) MODE="$a" ;;
    --yes) YES=1 ;;
    *) die "Opción desconocida: $a" ;;
  esac
done
[ -n "$MODE" ] || die "Uso: $0 {--status|--assert-forward-safe|--prepare-rollback|--finish-rollforward} [--yes]"

: "${DATABASE_URL:?falta DATABASE_URL (la BD que se va a operar).}"
command -v psql >/dev/null || die "falta \`psql\` en el PATH."

# -----------------------------------------------------------------------------
# `DATABASE_URL` en este proyecto es una URL de **Prisma**, y Prisma admite
# parámetros que libpq NO conoce. Medido aquí mismo la primera vez que se corrió
# este script:
#     psql "postgresql://…/tcg_marketplace?schema=public"
#     → psql: error: invalid URI query parameter: "schema"
# ...y el script culpaba a los PERMISOS. Un diagnóstico falso en la herramienta
# de rollback es justo lo que no puede pasar a las 3 de la mañana: manda a
# revisar credenciales a quien tiene el checkout caído. Se limpian los
# parámetros que son SÓLO de Prisma y se deja pasar el resto.
# -----------------------------------------------------------------------------
libpq_url() {
  local u="$1" base query out=""
  case "$u" in *\?*) base="${u%%\?*}"; query="${u#*\?}" ;; *) echo "$u"; return ;; esac
  local IFS='&' kv
  for kv in $query; do
    case "${kv%%=*}" in
      schema|connection_limit|pool_timeout|pgbouncer|socket_timeout|sslaccept|relationMode) ;;
      '') ;;
      *) out="${out:+$out&}$kv" ;;
    esac
  done
  echo "${base}${out:+?$out}"
}
PSQL_URL="$(libpq_url "$DATABASE_URL")"

q() { psql "$PSQL_URL" -qtAX -c "$1"; }

# --- Precondición: M-50 tiene que estar APLICADA. Si no lo está, todo lo demás
#     de este script es una respuesta a una pregunta que nadie hizo, y correrlo
#     sólo puede hacer daño. -----------------------------------------------------
applied="$(q "SELECT count(*) FROM \"_prisma_migrations\" WHERE migration_name='20260909120000_m50_price_convention' AND finished_at IS NOT NULL;" 2>/dev/null || echo "?")"
if [ "$applied" = "?" ]; then
  die "No pude leer \`_prisma_migrations\` en esa BD.
     URL usada (enmascarada): $(echo "$PSQL_URL" | sed -E 's#(//[^:]+):[^@]*@#\1:***@#')
     Comprueba, EN ESTE ORDEN: (1) que la URL apunte a la base que crees; (2) que
     el rol tenga lectura; (3) que la base tenga migraciones de Prisma aplicadas."
fi
if [ "$applied" = "0" ]; then
  ok "M-50 NO está aplicada en esta base."
  echo "     ⇒ Aquí el rollback SÍ es sólo-código: no hay columna \`NOT NULL\` que estorbe."
  echo "        Este script no tiene nada que hacer. Sal y sigue el runbook normal."
  exit 0
fi

# --- Estado del DDL vivo (esto es lo que NINGÚN test mira en producción) -------
read_default() { q "SELECT COALESCE(column_default,'') FROM information_schema.columns WHERE table_name='$1' AND column_name='$2';"; }
read_nullable() { q "SELECT is_nullable FROM information_schema.columns WHERE table_name='$1' AND column_name='$2';"; }

O_DEF="$(read_default Order priceConvention)"
S_DEF="$(read_default ShipmentRequest priceConvention)"
OT_DEF="$(read_default Order ivaTransferPct)"
ST_DEF="$(read_default ShipmentRequest ivaTransferPct)"

print_status() {
  log "Estado del DDL VIVO (M-50 aplicada)"
  printf '     %-38s %-10s %s\n' "columna" "nullable" "default"
  for pair in 'Order:priceConvention' 'ShipmentRequest:priceConvention' \
              'Order:ivaTransferPct' 'ShipmentRequest:ivaTransferPct' \
              'ShipmentRequest:shippingCostIvaCents'; do
    t="${pair%%:*}"; c="${pair##*:}"
    printf '     %-38s %-10s %s\n' "$t.$c" "$(read_nullable "$t" "$c")" "$(read_default "$t" "$c" | sed 's/^$/<NINGUNO>/')"
  done
}

SQL_SET="ALTER TABLE \"Order\"           ALTER COLUMN \"priceConvention\" SET DEFAULT 'IVA_EXCLUSIVE';
ALTER TABLE \"ShipmentRequest\" ALTER COLUMN \"priceConvention\" SET DEFAULT 'IVA_EXCLUSIVE';"
SQL_DROP="ALTER TABLE \"Order\"           ALTER COLUMN \"priceConvention\" DROP DEFAULT;
ALTER TABLE \"ShipmentRequest\" ALTER COLUMN \"priceConvention\" DROP DEFAULT;"

case "$MODE" in
  --status)
    print_status
    echo
    if [ -n "$O_DEF" ] || [ -n "$S_DEF" ]; then
      warn "HAY DEFAULT PUESTO en \`priceConvention\` ⇒ esta base está EN VENTANA DE ROLLBACK."
      echo "     · Con el código VIEJO sirviendo, esto es CORRECTO y necesario."
      echo "     · Con el código NUEVO sirviendo, esto es un DEFECTO DE DINERO ACTIVO:"
      echo "       un camino que olvide el campo archivará \`IVA_EXCLUSIVE\` una venta"
      echo "       cobrada como inclusiva, en silencio. Quítalo YA: --finish-rollforward"
    else
      ok "sin default ⇒ base en estado NORMAL (candidato desplegado, o pre-rollback)."
      echo "     ⚠️  Un rollback de código AHORA, sin --prepare-rollback, TUMBA el checkout."
    fi
    ;;

  --assert-forward-safe)
    # GATE PRE-DEPLOY del candidato. Verde = se puede rodar hacia adelante.
    print_status; echo
    if [ -n "$O_DEF" ] || [ -n "$S_DEF" ] || [ -n "$OT_DEF" ] || [ -n "$ST_DEF" ]; then
      bad "QUEDA UN \`DEFAULT\` VIVO en una columna de convención."
      [ -n "$O_DEF" ]  && echo "        Order.priceConvention           = $O_DEF"
      [ -n "$S_DEF" ]  && echo "        ShipmentRequest.priceConvention = $S_DEF"
      [ -n "$OT_DEF" ] && echo "        Order.ivaTransferPct            = $OT_DEF"
      [ -n "$ST_DEF" ] && echo "        ShipmentRequest.ivaTransferPct  = $ST_DEF"
      echo
      echo "     ⛔ NO DESPLIEGUES EL CANDIDATO CON ESTO PUESTO."
      echo "        Casi con seguridad es el residuo de un \`--prepare-rollback\` que"
      echo "        nadie limpió. Bajo el código nuevo ese default es exactamente el"
      echo "        defecto que §4.44.e existe para impedir: convierte «nadie dijo con"
      echo "        qué regla se cobró» en la AFIRMACIÓN FALSA «se cobró exclusiva»."
      echo "        Y no lo verá ningún test: IVA-3(c) lee el fichero, no la base."
      echo
      echo "     ARREGLO:  ./scripts/m50-rollback-gate.sh --finish-rollforward --yes"
      exit 1
    fi
    ok "sin defaults residuales ⇒ es seguro desplegar el candidato (IVA-3(e) intacto)."
    ;;

  --prepare-rollback)
    log "PASO DE DATOS — va ANTES de revertir el código. Nunca después."
    echo
    echo "  Qué hace y por qué es seguro AQUÍ (y sólo aquí):"
    echo "    · Deja que el código VIEJO —que nunca escribe la columna— vuelva a insertar."
    echo "    · El valor que graba, 'IVA_EXCLUSIVE', es VERDAD mientras sirva ese código:"
    echo "      su aritmética ES la exclusiva. No inventa un hecho, lo constata."
    echo "    · NO toca ni un importe. NO reescribe ninguna fila existente."
    echo
    echo "$SQL_SET" | sed 's/^/    /'
    echo
    if [ "$YES" != 1 ]; then
      warn "SIMULACRO (sin --yes): no se ejecutó nada."
      echo "     Para aplicarlo:  $0 --prepare-rollback --yes"
      echo "     ⚠️  Y APÚNTALO: hay que quitarlo con --finish-rollforward antes de"
      echo "        volver a desplegar el candidato. Es el paso que se olvida."
      exit 0
    fi
    psql "$PSQL_URL" -v ON_ERROR_STOP=1 -X -c "BEGIN; $SQL_SET COMMIT;"
    ok "default puesto. El código viejo ya puede insertar \`Order\` y \`ShipmentRequest\`."
    warn "DEUDA ABIERTA: este default DEBE quitarse antes del próximo roll-forward."
    echo "     El candado que lo impide:  $0 --assert-forward-safe"
    ;;

  --finish-rollforward)
    log "Retirar el default — va ANTES de volver a desplegar el candidato."
    if [ -z "$O_DEF" ] && [ -z "$S_DEF" ]; then
      ok "no hay default que quitar. Nada que hacer (idempotente)."
      exit 0
    fi
    echo
    echo "$SQL_DROP" | sed 's/^/    /'
    echo
    if [ "$YES" != 1 ]; then
      warn "SIMULACRO (sin --yes): no se ejecutó nada. Aplícalo con --yes."
      exit 0
    fi
    psql "$PSQL_URL" -v ON_ERROR_STOP=1 -X -c "BEGIN; $SQL_DROP COMMIT;"
    ok "default retirado. \`IVA-3(e)\` vuelve a estar armado: un INSERT que omita la"
    echo "     convención vuelve a LANZAR, que es la funcionalidad."
    ;;
esac

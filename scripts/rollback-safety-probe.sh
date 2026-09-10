#!/usr/bin/env bash
# =============================================================================
# rollback-safety-probe.sh — ¿este release se puede revertir SOLO con código?
# Propiedad: devops.   DEVOPS_NOTES §46.3.
#
# EL PROBLEMA QUE RESUELVE, CON NOMBRE Y FECHA
#   Hasta 2026-09-10 este repo repetía en §26.4, §27.4 y §28.6 la misma doctrina:
#   «la migración es ADITIVA ⇒ rollback = redeploy del commit anterior». Con
#   M-50 esa frase pasó a ser FALSA y peligrosa: M-50 es aditiva —no borra ni
#   reescribe nada— y aun así revertir el código a pelo **tumba el checkout**,
#   porque añade `priceConvention` como `NOT NULL` **sin default** y el código
#   anterior no la escribe nunca.
#
#   ⇒ «ADITIVA» NO IMPLICA «REVERSIBLE». Son cosas distintas:
#       · aditiva     = no destruye datos existentes (mira hacia ATRÁS)
#       · reversible  = el código anterior puede seguir ESCRIBIENDO (mira hacia
#                       ADELANTE, y es lo único que importa en un rollback)
#
# LA REGLA, ENUNCIADA PARA QUE NO HAGA FALTA CRITERIO A LAS 3 DE LA MAÑANA
#   Un release es reversible-sólo-con-código  ⟺  para toda columna `NOT NULL`
#   SIN default de la base, el commit al que se revierte la conoce.
#   Si el destino no la conoce, su cliente Prisma jamás la incluirá en el
#   `INSERT`, Postgres rechazará la fila y esa tabla queda MUERTA para escritura.
#
# Y ESTO ES LO QUE HACE ESTE SCRIPT: comprobarlo, en vez de opinarlo.
#   1. Pregunta a la BD VIVA qué columnas son `NOT NULL` sin default.
#   2. Lee el `schema.prisma` DEL COMMIT DESTINO (`git show <ref>:…`).
#   3. Cruza. Lo que esté en (1) y no en (2) es una tabla que dejará de aceptar
#      escrituras en cuanto se despliegue ese commit.
#
# ⚠️ LÍMITE DECLARADO, sin adornos: esto cubre el modo de fallo `NOT NULL` sin
# default, que es el que nos mordió y el más común. NO cubre CHECK constraints
# nuevos, triggers, tipos de enum a los que el código viejo no sabe mapear, ni
# columnas que el destino conoce pero con otro tipo. Un verde aquí significa
# «no hay columnas obligatorias huérfanas», no «revertir es gratis».
#
# USO
#   export DATABASE_URL=...
#   ./scripts/rollback-safety-probe.sh origin/main       # destino del rollback
#   ./scripts/rollback-safety-probe.sh <sha-del-deploy-anterior>
# =============================================================================
set -Eeuo pipefail

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; BLD=$'\033[1m'; RST=$'\033[0m'
[ -t 1 ] || { RED=""; GRN=""; YEL=""; BLD=""; RST=""; }
die() { printf '%s✖ %s%s\n' "$RED" "$*" "$RST" >&2; exit 1; }

TARGET="${1:-}"
[ -n "$TARGET" ] || die "Uso: $0 <git-ref del commit al que se revertiría>   (p. ej. origin/main)"
: "${DATABASE_URL:?falta DATABASE_URL (la BD que se va a operar).}"
command -v psql >/dev/null || die "falta \`psql\`."
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Prisma admite parámetros de URL que libpq no conoce (`?schema=`), y sin esto el
# script culpa a los permisos de un fallo de sintaxis. Misma limpieza que en
# `m50-rollback-gate.sh`, y por el mismo susto.
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

git -C "$ROOT_DIR" rev-parse --verify --quiet "$TARGET^{commit}" >/dev/null \
  || die "No existe el ref '$TARGET'. ¿Hiciste \`git fetch\`?"
SCHEMA="$(git -C "$ROOT_DIR" show "$TARGET:backend/prisma/schema.prisma" 2>/dev/null)" \
  || die "El commit '$TARGET' no tiene \`backend/prisma/schema.prisma\`."

printf '%s==>%s Reversibilidad hacia %s (%s)\n' "$BLD" "$RST" "$TARGET" \
  "$(git -C "$ROOT_DIR" rev-parse --short "$TARGET")"

# Columnas obligatorias SIN default. `is_identity`/`is_generated` fuera: las
# rellena Postgres, no el cliente.
LIVE="$(psql "$PSQL_URL" -qtAX -F'|' -c "
  SELECT c.table_name, c.column_name
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
  WHERE c.table_schema='public'
    AND c.is_nullable='NO' AND c.column_default IS NULL
    AND c.is_identity='NO' AND c.is_generated='NEVER'
    AND c.table_name NOT LIKE '\\_prisma%'
  ORDER BY c.table_name, c.column_name;")" || die "No pude consultar la BD."

[ -n "$LIVE" ] || die "La consulta no devolvió NI UNA columna obligatoria. Eso no es
     plausible en este esquema: casi seguro DATABASE_URL apunta a una base vacía.
     Un verde aquí sería un verde sin blanco — se para."

printf '%s\n' "$LIVE" | SCHEMA_TEXT="$SCHEMA" TARGET_REF="$TARGET" python3 -c '
import os, re, sys

schema = os.environ["SCHEMA_TEXT"]
target = os.environ["TARGET_REF"]

# Mapa tabla_en_BD -> {columnas_en_BD}. Prisma renombra con @@map / @map.
models = {}
for m in re.finditer(r"^model\s+(\w+)\s*\{(.*?)^\}", schema, re.S | re.M):
    name, body = m.group(1), m.group(2)
    mm = re.search(r"@@map\(\"([^\"]+)\"\)", body)
    table = mm.group(1) if mm else name
    cols = set()
    for line in body.splitlines():
        line = line.strip()
        if not line or line.startswith("//") or line.startswith("@@"):
            continue
        fm = re.match(r"(\w+)\s+\S+", line)
        if not fm:
            continue
        col = fm.group(1)
        cm = re.search(r"@map\(\"([^\"]+)\"\)", line)
        cols.add(cm.group(1) if cm else col)
    models[table] = cols

huerfanas = {}
total = 0
for raw in sys.stdin:
    raw = raw.strip()
    if not raw:
        continue
    table, col = raw.split("|", 1)
    total += 1
    known = models.get(table)
    if known is None:
        # La tabla entera no existe en el destino: sus INSERT no le importan a
        # ese commit (no la usa). No es un bloqueo de rollback.
        continue
    if col not in known:
        huerfanas.setdefault(table, []).append(col)

print("     %d columna(s) NOT NULL sin default en la base; %d modelo(s) en el schema de %s"
      % (total, len(models), target))
print()
if not huerfanas:
    print("  \033[32m✔\033[0m REVERSIBLE SOLO CON CÓDIGO (para este modo de fallo).")
    print("     Toda columna obligatoria de la base la conoce el commit destino:")
    print("     sus INSERT la incluirán y ninguna tabla se queda muda.")
    sys.exit(0)

print("  \033[31m✘\033[0m NO ES REVERSIBLE SOLO CON CÓDIGO.")
print()
print("     Estas columnas son OBLIGATORIAS en la base y el commit destino NO las conoce.")
print("     Su cliente Prisma no las pondrá en el INSERT ⇒ Postgres rechaza la fila ⇒")
print("     esas tablas quedan MUERTAS PARA ESCRITURA en cuanto se despliegue:")
print()
for t in sorted(huerfanas):
    print("       · %-22s %s" % (t, ", ".join(sorted(huerfanas[t]))))
print()
print("     ⇒ El rollback EXIGE un paso de DATOS antes del redeploy (orden de oro §7:")
print("       datos primero, código después). Para M-50 ese paso está escrito y probado:")
print("           ./scripts/m50-rollback-gate.sh --prepare-rollback --yes")
print("       Para cualquier OTRA columna que salga aquí: NO improvises un DEFAULT.")
print("       Un default sólo es honesto si el código destino escribe de verdad bajo esa")
print("       semántica. Si no puedes afirmarlo, NO HAY ROLLBACK SEGURO por esta vía:")
print("       escala al arquitecto y considera restaurar del snapshot (§7).")
sys.exit(1)
'

#!/usr/bin/env bash
#
# check-ids-ro-workflow.sh — candado del botón que mide Q1 de D-IDS-1 en producción (G-IDS-RO).   · devops
# =============================================================================
# `.github/workflows/medir-ids-produccion.yml` lleva un secreto que abre la base de producción (idealmente un rol de
# solo lectura, pero el candado NO lo da por hecho: si el dueño pega la URL de dueño, esto tiene que seguir sin poder
# escribir). Estático (sin red, sin base), exige:
#   [A] solo `workflow_dispatch`, SIN `inputs:` (nada de texto ajeno que acabe en SQL), sin pull_request_target/workflow_run
#   [C] el secreto aparece UNA vez (IDS_RO_DATABASE_URL), solo en `env:` del paso «Medir»; sin `env:` de job ni `run:`
#       que interpole secrets.*; sin `npm ci`/`npm install` en el job (ninguna dependencia lo ve)
#   [D] el job exige la rama `production` y el entorno `medicion-ro`
#   [E] `contents: read` y ningún permiso de escritura
#   [F] «Medir» llama a scripts/ids/medir-q1-produccion.sh, y este corre scripts/ids/ids-q1-boton.sql
#   [G] el script: URL solo de IDS_RO_DATABASE_URL, ::add-mask:: antes de partirla y de psql, sin `set -x`, sin imprimir
#       la URL/contraseña, la URL nunca en la línea de psql, ON_ERROR_STOP, stderr de psql nunca volcado, exige el aviso 25006
#   [R] el SQL (ids-q1-boton.sql + ids-d1-q1.sql): primera orden `BEGIN TRANSACTION READ ONLY;`, la prueba de escritura
#       (UPDATE … WHERE false con handler read_only_sql_transaction) ANTES de leer, última orden `ROLLBACK;`, ningún
#       COMMIT/END/BEGIN/SET TRANSACTION/READ WRITE, ningún verbo que escriba salvo esa prueba, sin metaórdenes de psql
#       peligrosas (\! \copy \o \c \gexec \g \i); `\ir` solo de ids-d1-q1.sql
#   [Q] Q1c (H-Q1) filtra ownerType='customer', status <> 'withdrawn' y kind promo/deck_exclusive, y no saca ids de cliente/pieza
#   [K] PT-IDS-6 (el resumen de un repo público es público): `K_ANON = 3` (o más); Q1c-detalle pasa por `anonimizar(` antes
#       del resumen y oculta Σ/mín/máx de ref y de Q con < K_ANON clientes distintos o piezas detrás; el SQL proyecta
#       clientes_con_ref / clientes_con_q
#   [S] PT-IDS-7: sslmode por defecto `require`; solo require/verify-ca/verify-full fuera de loopback (localhost/127.0.0.1/::1),
#       un modo más débil ⇒ rc 1 antes de psql; ningún literal "prefer"/"allow"/"disable" en el código
#   [H] todo `uses:` fijado por sha de 40 hex (TL-CHK-8)
# Los comentarios no cuentan. Canario: check-ids-ro-workflow-canary.sh.
# Uso: ./scripts/check-ids-ro-workflow.sh [--root DIR]      DEVOPS_NOTES §108.5.
# =============================================================================
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "${1:-}" = "--root" ]; then ROOT="$2"; fi
WF="$ROOT/.github/workflows/medir-ids-produccion.yml"
SH="$ROOT/scripts/ids/medir-q1-produccion.sh"
SQLB="$ROOT/scripts/ids/ids-q1-boton.sql"
SQLQ="$ROOT/scripts/ids/ids-d1-q1.sql"

FALLOS=0
bad() { printf '  ✗ [%s] %s\n' "$1" "$2"; FALLOS=$((FALLOS+1)); }

[ -f "$WF" ] || { printf '  ✗ [A] no existe %s\n' "${WF#"$ROOT"/}"; exit 1; }
for f in "$SH" "$SQLB" "$SQLQ"; do [ -f "$f" ] || { printf '  ✗ [F] no existe %s\n' "${f#"$ROOT"/}"; exit 1; }; done

wf="$(sed -E 's/^[[:space:]]*#.*$//; s/[[:space:]]+#[[:space:]].*$//' "$WF")"
sh="$(sed -E 's/^[[:space:]]*#.*$//' "$SH")"
sqlb="$(sed -E 's/--.*$//' "$SQLB")"
sqlq="$(sed -E 's/--.*$//' "$SQLQ")"
# Para buscar verbos: además sin literales '…' (has_table_privilege(…, 'INSERT') no escribe).
sinlit() { printf '%s\n' "$1" | sed -E "s/'[^']*'/''/g"; }
linea() { printf '%s\n' "$wf" | grep -nE -- "$1" | head -1 | cut -d: -f1; }

# [A] disparadores, sin entradas
on_line="$(printf '%s\n' "$wf" | grep -nE '^(on|"on"|true):' | head -1)"
if [ -z "$on_line" ] || [ "$(printf '%s' "$on_line" | cut -d: -f2- | sed -E 's/^[^:]*:[[:space:]]*//')" != "" ]; then
  bad A "el bloque \`on:\` debe ser un mapa con solo workflow_dispatch (forma en línea no admitida)"
else
  n="${on_line%%:*}"
  keys="$(printf '%s\n' "$wf" | awk -v s="$n" 'NR>s { if ($0 ~ /^[^[:space:]]/ && $0 != "") exit; if ($0 ~ /^  [A-Za-z_]+:/) { sub(/^  /,""); sub(/:.*/,""); print } }' | sort -u | tr '\n' ' ')"
  [ "$keys" = "workflow_dispatch " ] || bad A "disparadores «${keys% }»: solo se admite workflow_dispatch"
fi
printf '%s\n' "$wf" | grep -E '^[[:space:]]+inputs:' >/dev/null && bad A "el botón tiene \`inputs:\` (texto ajeno hacia el SQL)"
printf '%s\n' "$wf" | grep -E 'pull_request_target|workflow_run' >/dev/null && bad A "aparece pull_request_target/workflow_run"

# [C] el secreto
nsec="$(printf '%s\n' "$wf" | grep -oE 'secrets\.[A-Za-z0-9_]+' | wc -l | tr -d ' ')"
sec_l="$(linea 'IDS_RO_DATABASE_URL:[[:space:]]*\$\{\{[[:space:]]*secrets\.IDS_RO_DATABASE_URL[[:space:]]*\}\}')"
me_l="$(linea '^[[:space:]]+- name: Medir[[:space:]]*$')"
[ "$nsec" = 1 ] || bad C "hay $nsec referencias a secrets.*; debe haber exactamente una (IDS_RO_DATABASE_URL)"
if [ -z "$sec_l" ] || [ -z "$me_l" ]; then
  bad C "falta el paso «Medir» o su env IDS_RO_DATABASE_URL"
else
  [ "$sec_l" -gt "$me_l" ] || bad C "el secreto no está dentro del paso «Medir»"
  sig="$(printf '%s\n' "$wf" | awk -v s="$me_l" 'NR>s && /^[[:space:]]+- (name|uses):/ {print NR; exit}')"
  [ -z "$sig" ] || [ "$sec_l" -lt "$sig" ] || bad C "el secreto está en un paso posterior a «Medir»"
fi
printf '%s\n' "$wf" | awk '/^    env:/ {f=1} END {exit !f}' && bad C "hay \`env:\` a nivel de job (el secreto pasaría a todos los pasos)"
printf '%s\n' "$wf" | grep -E '^env:' >/dev/null && bad C "hay \`env:\` a nivel de workflow"
printf '%s\n' "$wf" | grep -E 'run:.*secrets\.' >/dev/null && bad C "un \`run:\` interpola secrets.* directamente"
printf '%s\n' "$wf" | grep -E 'npm (ci|install)|yarn|pnpm|pip install' >/dev/null && bad C "el job instala dependencias (verían el entorno del runner)"

# [D] rama y entorno
printf '%s\n' "$wf" | grep -E "^    if:[[:space:]]*github\.ref[[:space:]]*==[[:space:]]*'refs/heads/production'[[:space:]]*$" >/dev/null \
  || bad D "el job no exige github.ref == 'refs/heads/production'"
printf '%s\n' "$wf" | grep -E '^    environment:[[:space:]]*medicion-ro[[:space:]]*$' >/dev/null || bad D "el job no usa el entorno medicion-ro"

# [E] permisos
printf '%s\n' "$wf" | grep -E '^permissions:' >/dev/null || bad E "falta \`permissions:\` a nivel de workflow"
printf '%s\n' "$wf" | grep -E '^  contents:[[:space:]]*read[[:space:]]*$' >/dev/null || bad E "falta contents: read"
printf '%s\n' "$wf" | grep -E ':[[:space:]]*write([[:space:]]|$)|write-all' >/dev/null && bad E "hay un permiso de escritura"

# [F] qué corre
printf '%s\n' "$wf" | grep -E '^[[:space:]]+run:[[:space:]]*\./scripts/ids/medir-q1-produccion\.sh[[:space:]]*$' >/dev/null \
  || bad F "«Medir» no llama (solo) a ./scripts/ids/medir-q1-produccion.sh"
printf '%s\n' "$sh" | grep -E '^SQL="\$ROOT/scripts/ids/ids-q1-boton\.sql"$' >/dev/null || bad F "el script no corre scripts/ids/ids-q1-boton.sql"

# [G] el script
shl() { printf '%s\n' "$sh" | grep -nE -- "$1" | head -1 | cut -d: -f1; }
printf '%s\n' "$sh" | grep -E '^URL="\$\{IDS_RO_DATABASE_URL:-\}"$' >/dev/null || bad G "la URL no se lee solo de IDS_RO_DATABASE_URL"
printf '%s\n' "$sh" | grep -E '(^|[;[:space:]])set[[:space:]]+-[a-z]*x' >/dev/null && bad G "set -x (imprimiría la URL)"
printf '%s\n' "$sh" | grep -E '(echo|printf)[^|]*\$\{?(URL|IDS_RO_DATABASE_URL|PGPASSWORD|pgenv)\b' >/dev/null && bad G "imprime la URL o la contraseña"
psql_l="$(shl '^[^#]*\bpsql[[:space:]]+-')"
if [ -z "$psql_l" ]; then bad G "no hay invocación de psql"; else
  pl="$(printf '%s\n' "$sh" | sed -n "${psql_l}p")"
  printf '%s' "$pl" | grep -E '\$\{?(URL|IDS_RO_DATABASE_URL|DATABASE_URL|pgenv)\b' >/dev/null && bad G "la URL va en la línea de órdenes de psql"
  printf '%s' "$pl" | grep -E 'ON_ERROR_STOP=1' >/dev/null || bad G "psql sin ON_ERROR_STOP=1"
  printf '%s' "$pl" | grep -E -- '-f "\$SQL"' >/dev/null || bad G "psql no corre -f \"\$SQL\""
fi
mask_l="$(shl '::add-mask::')"; eval_l="$(shl '^eval ')"
if [ -z "$mask_l" ] || [ -z "$eval_l" ] || [ -z "$psql_l" ] || [ "$mask_l" -gt "$eval_l" ] || [ "$mask_l" -gt "$psql_l" ]; then
  bad G "el enmascarado (::add-mask::) no va antes de partir la URL (eval) y de psql"
fi
printf '%s\n' "$sh" | grep -E '\b(cat|head|tail|less|more|sed|awk|tee)\b[^|;]*\$\{?errf' >/dev/null && bad G "vuelca el stderr de psql (trae host/IP)"
printf '%s\n' "$sh" | grep -E '<[[:space:]]*"?\$\{?errf' >/dev/null && bad G "lee el stderr de psql hacia la salida"
printf '%s\n' "$sh" | grep -F "IDS-RO: escritura rechazada (SQLSTATE 25006)" >/dev/null || bad G "el script no exige el aviso de la prueba de escritura (25006)"

# [R] el SQL
primera="$(printf '%s\n' "$sqlb" | grep -E '^[[:space:]]*[A-Za-z]' | head -1 | sed -E 's/[[:space:]]+$//')"
[ "$primera" = "BEGIN TRANSACTION READ ONLY;" ] || bad R "la primera orden no es «BEGIN TRANSACTION READ ONLY;» (es «$primera»)"
ultima="$(printf '%s\n' "$sqlb" | grep -E '^[[:space:]]*[A-Za-z\\]' | tail -1 | sed -E 's/[[:space:]]+$//')"
[ "$ultima" = "ROLLBACK;" ] || bad R "la última orden no es «ROLLBACK;» (es «$ultima»)"
upd="$(printf '%s\n%s\n' "$(sinlit "$sqlb")" "$(sinlit "$sqlq")" | grep -ciE '\bupdate\b')"
probe_l="$(printf '%s\n' "$sqlb" | grep -nE '^[[:space:]]*UPDATE "InventoryItem" SET status = status WHERE false;[[:space:]]*$' | head -1 | cut -d: -f1)"
[ "$upd" = 1 ] && [ -n "$probe_l" ] || bad R "UPDATE: solo se admite la prueba «UPDATE \"InventoryItem\" SET status = status WHERE false;» (hay $upd)"
printf '%s\n' "$sqlb" | grep -E 'EXCEPTION WHEN read_only_sql_transaction THEN' >/dev/null || bad R "falta el handler read_only_sql_transaction de la prueba"
printf '%s\n' "$sqlb" | grep -F "RAISE NOTICE 'IDS-RO: escritura rechazada (SQLSTATE 25006)'" >/dev/null || bad R "falta el aviso de la prueba (25006)"
printf '%s\n' "$sqlb" | grep -E "RAISE EXCEPTION 'IDS-RO: la escritura NO fue rechazada" >/dev/null || bad R "la prueba no aborta si la escritura NO falla"
first_read="$(printf '%s\n' "$sqlb" | grep -nE '^[[:space:]]*(SELECT|\\ir)\b' | head -1 | cut -d: -f1)"
[ -n "$probe_l" ] && [ -n "$first_read" ] && [ "$probe_l" -lt "$first_read" ] || bad R "la prueba de escritura no va antes de la primera lectura"
for par in "boton:$(sinlit "$sqlb")" "q1:$(sinlit "$sqlq")"; do
  nom="${par%%:*}"; txt="${par#*:}"
  printf '%s\n' "$txt" | grep -iE '\b(commit|abort|savepoint|start[[:space:]]+transaction)\b|^[[:space:]]*end[[:space:]]*;|read[[:space:]]+write|set[[:space:]]+(local[[:space:]]+|session[[:space:]]+)?(transaction|session[[:space:]]+characteristics|default_transaction_read_only)|transaction_read_only[[:space:]]*(=|to)' >/dev/null \
    && bad R "$nom: COMMIT/END/SAVEPOINT/READ WRITE o cambio del modo de la transacción"
  printf '%s\n' "$txt" | grep -iE '\b(insert|delete|truncate|alter|drop|create|grant|revoke|copy|merge|vacuum|reindex|cluster|lock|call|notify|refresh|comment|security[[:space:]]+label|import)\b' >/dev/null \
    && bad R "$nom: un verbo que escribe"
  printf '%s\n' "$txt" | grep -E '\\(!|copy|o\b|out\b|c\b|connect\b|gexec|g\b|w\b|write\b|i\b|include\b|setenv|set[[:space:]]+AUTOCOMMIT)' >/dev/null \
    && bad R "$nom: metaorden de psql peligrosa (\\! \\copy \\o \\c \\gexec \\g \\w \\i \\setenv AUTOCOMMIT)"
done
printf '%s\n' "$sqlb" | grep -E '^[[:space:]]*BEGIN\b' | grep -vE '^[[:space:]]*BEGIN TRANSACTION READ ONLY;[[:space:]]*$' | grep -vE '^[[:space:]]*BEGIN[[:space:]]*$' >/dev/null && bad R "boton: un segundo BEGIN"
[ "$(printf '%s\n' "$sqlb" | grep -cE '^[[:space:]]*BEGIN TRANSACTION')" = 1 ] || bad R "boton: debe haber exactamente un BEGIN TRANSACTION"
printf '%s\n' "$sqlq" | grep -E '^[[:space:]]*BEGIN\b' >/dev/null && bad R "q1: abre transacción (lo incluye un envoltorio READ ONLY)"
inc="$(printf '%s\n' "$sqlb" | grep -E '\\ir\b' | sed -E 's/[[:space:]]+$//' | tr '\n' ' ')"
[ "$inc" = '\ir ids-d1-q1.sql ' ] || bad R "boton: \\ir debe ser exactamente uno, de ids-d1-q1.sql (es «${inc% }»)"
printf '%s\n' "$sqlq" | grep -E '\\ir\b' >/dev/null && bad R "q1: incluye otro fichero"

# [Q] Q1c y Q1c-detalle (H-Q1, §IDS.9 v1.116.4): piezas de CLIENTES, solo agregados. Sin el filtro de dueño medirían
#     (también) plataforma y el número sería otro sin que nada se pusiera rojo; la proyección exterior (el SELECT de
#     columna 0 hasta su FROM) no puede sacar ownerUserId fuera de count(DISTINCT …), ni ids, folios o correos.
q1c_bloque() { printf '%s\n' "$sqlq" | awk -v tag="$1" 'index($0, "\\echo '"'"'== " tag " ") == 1 {f=1} f {print} f && /;[[:space:]]*$/ && !/^\\echo/ {exit}'; }
for q in Q1c Q1c-detalle; do
  blk="$(q1c_bloque "$q")"
  if [ -z "$blk" ]; then bad Q "falta la sección $q en ids-d1-q1.sql"; continue; fi
  printf '%s\n' "$blk" | grep -E "i\.\"ownerType\"[[:space:]]*=[[:space:]]*'customer'" >/dev/null || bad Q "$q no filtra i.\"ownerType\" = 'customer'"
  printf '%s\n' "$blk" | grep -E "i\.status[[:space:]]*<>[[:space:]]*'withdrawn'" >/dev/null || bad Q "$q no filtra el portafolio (status <> 'withdrawn')"
  printf '%s\n' "$blk" | grep -E "cp\.kind IN \('promo', 'deck_exclusive'\)" >/dev/null || bad Q "$q no filtra kind promo/deck_exclusive"
  proy="$(printf '%s\n' "$blk" | awk '/^SELECT/ {p=""; f=1} f && /^FROM/ {f=0} f {p = p $0 "\n"} END {printf "%s", p}')"
  [ -n "$proy" ] || bad Q "$q sin proyección exterior (SELECT en columna 0)"
  printf '%s\n' "$proy" | sed -E 's/count\(DISTINCT [a-z]+\."ownerUserId"\)//g; s/=[[:space:]]*[a-z]+\.id\b//g; s/\b[a-z]+\.id[[:space:]]*=//g' | grep -iE 'ownerUserId|customerUserId|"User"|email|\b[a-z]+\.id\b|folio|orderNumber' >/dev/null \
    && bad Q "$q expone ids de cliente, pieza u orden (solo agregados)"
done

# [K] umbral de anonimato del resumen público (PT-IDS-6)
printf '%s\n' "$sh" | grep -cE '^K_ANON = ([3-9]|[1-9][0-9]+)[[:space:]]*$' | grep -qx 1 || bad K "falta «K_ANON = 3» (o mayor), exactamente una vez"
printf '%s\n' "$sh" | grep -E '^K_ANON = ' | grep -vE '^K_ANON = ([3-9]|[1-9][0-9]+)[[:space:]]*$' >/dev/null && bad K "K_ANON < 3"
printf '%s\n' "$sh" | grep -E '^[[:space:]]+det = anonimizar\(rows\["Q1c-detalle"\]\)' >/dev/null || bad K "Q1c-detalle no pasa por anonimizar( antes del resumen"
[ "$(printf '%s\n' "$sh" | grep -cF 'rows["Q1c-detalle"]')" = 1 ] || bad K "rows[\"Q1c-detalle\"] se usa fuera de anonimizar("
for c in clientes_con_ref clientes_con_q; do
  printf '%s\n' "$sh" | grep -F "_n(r, \"$c\") < K_ANON" >/dev/null || bad K "anonimizar no exige ≥ K_ANON en $c"
  printf '%s\n' "$(q1c_bloque Q1c-detalle)" | grep -E "count\(DISTINCT l\.\"ownerUserId\"\) FILTER \(WHERE [a-z]\.[a-z_]+ IS NOT NULL\) AS $c\b" >/dev/null \
    || bad K "Q1c-detalle no proyecta $c (clientes distintos detrás de la cifra)"
done
printf '%s\n' "$sh" | grep -F '_n(r, "con_ref_base") < K_ANON' >/dev/null || bad K "anonimizar no exige ≥ K_ANON piezas con referencia"
printf '%s\n' "$sh" | grep -F '_n(r, "piezas") - _n(r, "sin_origen") < K_ANON' >/dev/null || bad K "anonimizar no exige ≥ K_ANON piezas con Q"

# [S] TLS obligatorio (PT-IDS-7)
printf '%s\n' "$sh" | grep -E '^SSL_OK = \("require", "verify-ca", "verify-full"\)[[:space:]]*$' >/dev/null || bad S "SSL_OK no es exactamente (require, verify-ca, verify-full)"
printf '%s\n' "$sh" | grep -E '^LOOPBACK = \("localhost", "127\.0\.0\.1", "::1"\)[[:space:]]*$' >/dev/null || bad S "LOOPBACK no es exactamente (localhost, 127.0.0.1, ::1)"
printf '%s\n' "$sh" | grep -E '^ssl = q\.get\("sslmode", "require"\)[[:space:]]*$' >/dev/null || bad S "el sslmode por defecto no es require"
printf '%s\n' "$sh" | grep -A1 -E '^if ssl not in SSL_OK and u\.hostname not in LOOPBACK:[[:space:]]*$' | grep -F 'print("ERR=ssl")' >/dev/null || bad S "un sslmode débil no aborta (ERR=ssl)"
printf '%s\n' "$sh" | grep -E '^[[:space:]]+ERR=ssl\*\).*exit 1' >/dev/null || bad S "el shell no sale 1 ante ERR=ssl"
[ "$(printf '%s\n' "$sh" | grep -c 'PGSSLMODE')" = 1 ] && printf '%s\n' "$sh" | grep -E '^[[:space:]]+"PGSSLMODE": ssl,' >/dev/null || bad S "PGSSLMODE no sale (solo) de la variable validada"
printf '%s\n' "$sh" | grep -E '"(prefer|allow|disable)"' >/dev/null && bad S "aparece un literal de sslmode débil"

# [H] acciones fijadas por sha
while IFS= read -r u; do
  [ -n "$u" ] || continue
  printf '%s' "$u" | grep -E '@[0-9a-f]{40}[[:space:]]*$' >/dev/null || bad H "acción sin sha de 40 hex: «$(printf '%s' "$u" | sed -E 's/^[[:space:]]*-?[[:space:]]*//')»"
done <<< "$(printf '%s\n' "$wf" | grep -E '^[[:space:]]*-?[[:space:]]*uses:')"

if [ "$FALLOS" -ne 0 ]; then printf 'check-ids-ro-workflow: ROJO (%s)\n' "$FALLOS"; exit 1; fi
echo "check-ids-ro-workflow: VERDE (A, C–H, K, Q, R, S)"

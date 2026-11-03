#!/usr/bin/env bash
#
# check-ids-ro-workflow-canary.sh — ¿el candado G-IDS-RO se pone ROJO cuando el botón de solo lectura deja de serlo? · devops
# =============================================================================
# Copia workflow, script y los dos .sql a un directorio temporal, exige VERDE en el prístino y en casos de solo
# comentario, y planta una por una las formas de convertir el botón en un peligro. Cada mutación tiene que dar ROJO
# **y** nombrar su bloque. Determinista (sin red ni reloj): una corrida por caso basta. DEVOPS_NOTES §108.5.
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE="$ROOT_DIR/scripts/check-ids-ro-workflow.sh"
WF_REL=".github/workflows/medir-ids-produccion.yml"
SH_REL="scripts/ids/medir-q1-produccion.sh"
SB_REL="scripts/ids/ids-q1-boton.sql"
SQ_REL="scripts/ids/ids-d1-q1.sql"
[ -f "$GATE" ] || { echo "✗ no existe el candado: eso ya es el rojo"; exit 1; }

FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '  ✔ %s\n' "$*"; }
bad() { FALLOS=$((FALLOS+1)); printf '  ✗ %s\n' "$*"; }
BASE="$(mktemp -d -t ids-ro-canario-XXXXXX)"
trap 'rm -rf "$BASE"' EXIT

caso() { # caso ROJO|VERDE <nombre> <bloque|-> <mutador>
  local esperado="$1" nombre="$2" bloque="$3" mutador="$4" d="$BASE/caso" salida rc f
  rm -rf "$d"; mkdir -p "$d/.github/workflows" "$d/scripts/ids"
  for f in "$WF_REL" "$SH_REL" "$SB_REL" "$SQ_REL"; do cp "$ROOT_DIR/$f" "$d/$f"; done
  "$mutador" "$d"
  salida="$(bash "$GATE" --root "$d" 2>&1)"; rc=$?
  if [ "$esperado" = VERDE ]; then
    [ "$rc" -eq 0 ] && ok "VERDE  $nombre" || { bad "debía ser VERDE (rc=$rc): $nombre"; printf '%s\n' "$salida" | sed 's/^/      /'; }
  elif [ "$rc" -ne 0 ] && printf '%s\n' "$salida" | grep -q -- "✗ \[$bloque\]"; then
    ok "ROJO   $nombre  [$bloque]"
  else
    bad "debía ser ROJO en [$bloque] (rc=$rc): $nombre"; printf '%s\n' "$salida" | sed 's/^/      /'
  fi
}

W()  { printf '%s/%s' "$1" "$WF_REL"; }
S()  { printf '%s/%s' "$1" "$SH_REL"; }
SB() { printf '%s/%s' "$1" "$SB_REL"; }
SQ() { printf '%s/%s' "$1" "$SQ_REL"; }
py() { python3 -I -c "import sys;p=sys.argv[1];s=open(p).read();a,b=sys.argv[2],sys.argv[3];assert a in s,('no está',a);open(p,'w').write(s.replace(a,b,1))" "$@"; }

nada()             { :; }
comentario()       { py "$(W "$1")" "  workflow_dispatch:" "  # push: (no: ver cabecera)
  workflow_dispatch:"; }
comentario_sql()   { py "$(SB "$1")" "ROLLBACK;" "-- aquí NO va COMMIT; ni INSERT
ROLLBACK;"; }
con_push()         { py "$(W "$1")" "  workflow_dispatch:" "  push:
    branches: [production]
  workflow_dispatch:"; }
con_inputs()       { py "$(W "$1")" "  workflow_dispatch:
" "  workflow_dispatch:
    inputs:
      consulta:
        type: string
"; }
env_de_job()       { py "$(W "$1")" "    environment: medicion-ro
" "    environment: medicion-ro
    env:
      X: \${{ secrets.IDS_RO_DATABASE_URL }}
"; py "$(W "$1")" "          IDS_RO_DATABASE_URL: \${{ secrets.IDS_RO_DATABASE_URL }}
" ""; }
otro_secreto()     { py "$(W "$1")" "          IDS_RO_DATABASE_URL: \${{ secrets.IDS_RO_DATABASE_URL }}
" "          IDS_RO_DATABASE_URL: \${{ secrets.IDS_RO_DATABASE_URL }}
          RAILWAY_TOKEN: \${{ secrets.RAILWAY_TOKEN }}
"; }
run_interpola()    { py "$(W "$1")" 'run: ./scripts/ids/medir-q1-produccion.sh' 'run: IDS_RO_DATABASE_URL="${{ secrets.IDS_RO_DATABASE_URL }}" ./scripts/ids/medir-q1-produccion.sh'; }
con_npm()          { py "$(W "$1")" "      - name: Medir" "      - run: npm ci
      - name: Medir"; }
sin_rama()         { py "$(W "$1")" "    if: github.ref == 'refs/heads/production'
" ""; }
otro_entorno()     { py "$(W "$1")" "    environment: medicion-ro" "    environment: catalogo-cp"; }
escribe()          { py "$(W "$1")" "  contents: read" "  contents: write"; }
otro_script()      { py "$(W "$1")" 'run: ./scripts/ids/medir-q1-produccion.sh' 'run: psql -f scripts/ids/ids-d1-produccion.sql'; }
por_etiqueta()     { py "$(W "$1")" "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09" "actions/checkout@v5"; }
url_argumento()    { py "$(S "$1")" 'URL="${IDS_RO_DATABASE_URL:-}"' 'URL="${1:-${IDS_RO_DATABASE_URL:-}}"'; }
con_set_x()        { py "$(S "$1")" 'set -uo pipefail' 'set -xuo pipefail'; }
sin_mascara()      { py "$(S "$1")" 'print("::add-mask::" + raw)' 'pass'; py "$(S "$1")" 'print("::add-mask::" + p)' 'pass'; py "$(S "$1")" 'print("::add-mask::" + urllib.parse.unquote(p))' 'pass'; }
imprime_url()      { py "$(S "$1")" 'eval "${pgenv#ERR=}"' 'echo "conectando a $URL"
eval "${pgenv#ERR=}"'; }
url_en_psql()      { py "$(S "$1")" 'psql -X -q' 'psql "$URL" -X -q'; }
sin_on_error()     { py "$(S "$1")" 'psql -X -q -v ON_ERROR_STOP=1 --csv' 'psql -X -q --csv'; }
vuelca_stderr()    { py "$(S "$1")" 'unset PGPASSWORD' 'unset PGPASSWORD
cat "$errf" >&2'; }
sin_aviso_25006()  { py "$(S "$1")" "if ! grep -q 'IDS-RO: escritura rechazada (SQLSTATE 25006)' \"\$errf\"; then" "if false; then"; }
sin_read_only()    { py "$(SB "$1")" "BEGIN TRANSACTION READ ONLY;" "BEGIN;"; }
read_write()       { py "$(SB "$1")" "BEGIN TRANSACTION READ ONLY;" "BEGIN TRANSACTION READ ONLY;
SET TRANSACTION READ WRITE;"; }
commit_final()     { py "$(SB "$1")" "ROLLBACK;" "COMMIT;"; }
commit_en_q1()     { printf 'COMMIT;\n' >> "$(SQ "$1")"; }
insert_en_q1()     { printf 'INSERT INTO "AuditLog"(id) VALUES (1);\n' >> "$(SQ "$1")"; }
update_real()      { py "$(SB "$1")" 'SET status = status WHERE false;' 'SET status = status;'; }
sin_handler()      { py "$(SB "$1")" "EXCEPTION WHEN read_only_sql_transaction THEN" "EXCEPTION WHEN others THEN"; }
prueba_despues()   { py "$(SB "$1")" "\\echo '== ROL =='" "\\ir ids-d1-q1.sql
\\echo '== ROL =='"; py "$(SB "$1")" "\\ir ids-d1-q1.sql

ROLLBACK;" "
ROLLBACK;"; py "$(SB "$1")" "SET LOCAL lock_timeout = '5s';" "SET LOCAL lock_timeout = '5s';
SELECT 1;"; }
shell_en_sql()     { printf '\\! env\n' >> "$(SQ "$1")"; }
copy_a_fichero()   { printf '\\copy (SELECT 1) TO /tmp/x\n' >> "$(SQ "$1")"; }
otro_include()     { py "$(SB "$1")" "\\ir ids-d1-q1.sql" "\\ir ids-d1-q1.sql
\\ir ../geo/otro.sql"; }

echo "Canario G-IDS-RO (check-ids-ro-workflow.sh):"
caso VERDE "prístino"                                        -  nada
caso VERDE "un comentario que nombra push"                   -  comentario
caso VERDE "un comentario SQL que nombra COMMIT/INSERT"      -  comentario_sql
caso ROJO  "se dispara también en push"                      A  con_push
caso ROJO  "el botón acepta una entrada de texto"            A  con_inputs
caso ROJO  "el secreto en env de job"                        C  env_de_job
caso ROJO  "un segundo secreto"                              C  otro_secreto
caso ROJO  "un run: interpola el secreto"                    C  run_interpola
caso ROJO  "npm ci en el job"                                C  con_npm
caso ROJO  "sin la condición de rama production"             D  sin_rama
caso ROJO  "otro entorno (catalogo-cp)"                      D  otro_entorno
caso ROJO  "contents: write"                                 E  escribe
caso ROJO  "«Medir» corre otra cosa"                         F  otro_script
caso ROJO  "acción fijada por etiqueta"                      H  por_etiqueta
caso ROJO  "la URL puede venir de un argumento"              G  url_argumento
caso ROJO  "set -x"                                          G  con_set_x
caso ROJO  "sin ::add-mask::"                                G  sin_mascara
caso ROJO  "imprime la URL"                                  G  imprime_url
caso ROJO  "la URL en la línea de psql"                      G  url_en_psql
caso ROJO  "psql sin ON_ERROR_STOP"                          G  sin_on_error
caso ROJO  "vuelca el stderr de psql"                        G  vuelca_stderr
caso ROJO  "no exige el aviso 25006"                         G  sin_aviso_25006
caso ROJO  "BEGIN sin READ ONLY"                             R  sin_read_only
caso ROJO  "SET TRANSACTION READ WRITE"                      R  read_write
caso ROJO  "COMMIT en vez de ROLLBACK"                       R  commit_final
caso ROJO  "COMMIT dentro de ids-d1-q1.sql"                  R  commit_en_q1
caso ROJO  "INSERT dentro de ids-d1-q1.sql"                  R  insert_en_q1
caso ROJO  "la prueba escribe de verdad (sin WHERE false)"   R  update_real
caso ROJO  "el handler traga cualquier error"                R  sin_handler
caso ROJO  "se lee antes de la prueba"                       R  prueba_despues
caso ROJO  "\\! en el SQL"                                   R  shell_en_sql
caso ROJO  "\\copy a fichero en el SQL"                      R  copy_a_fichero
caso ROJO  "incluye otro fichero"                            R  otro_include

TOTAL=$((PASADAS+FALLOS))
if [ "$FALLOS" -ne 0 ]; then echo "canario G-IDS-RO: ROJO — $FALLOS de $TOTAL casos no se comportan"; exit 1; fi
echo "canario G-IDS-RO: $PASADAS/$TOTAL"

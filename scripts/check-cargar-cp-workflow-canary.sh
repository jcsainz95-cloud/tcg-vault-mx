#!/usr/bin/env bash
#
# check-cargar-cp-workflow-canary.sh — ¿el candado G-CP-BOTON se pone ROJO cuando el botón deja de ser seguro? · devops
# =============================================================================
# Copia el workflow y el script a un directorio temporal, exige VERDE en el prístino y en un caso de solo comentario, y
# planta una por una las formas de convertir el botón en un peligro. Cada mutación tiene que dar ROJO **y** nombrar su
# bloque. Determinista (sin red ni reloj): una corrida por caso basta. DEVOPS_NOTES §107.
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE="$ROOT_DIR/scripts/check-cargar-cp-workflow.sh"
WF_REL=".github/workflows/cargar-codigos-postales.yml"
SH_REL="scripts/geo/cargar-cp-produccion.sh"
[ -f "$GATE" ] || { echo "✗ no existe el candado: eso ya es el rojo"; exit 1; }

FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '  ✔ %s\n' "$*"; }
bad() { FALLOS=$((FALLOS+1)); printf '  ✗ %s\n' "$*"; }
BASE="$(mktemp -d -t cargar-cp-canario-XXXXXX)"
trap 'rm -rf "$BASE"' EXIT

caso() { # caso ROJO|VERDE <nombre> <bloque|-> <mutador>
  local esperado="$1" nombre="$2" bloque="$3" mutador="$4" d="$BASE/caso" salida rc
  rm -rf "$d"; mkdir -p "$d/.github/workflows" "$d/scripts/geo"
  cp "$ROOT_DIR/$WF_REL" "$d/$WF_REL"; cp "$ROOT_DIR/$SH_REL" "$d/$SH_REL"
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

W() { printf '%s/%s' "$1" "$WF_REL"; }
S() { printf '%s/%s' "$1" "$SH_REL"; }
py() { python3 -I -c "import sys;p=sys.argv[1];s=open(p).read();a,b=sys.argv[2],sys.argv[3];assert a in s,('no está',a);open(p,'w').write(s.replace(a,b,1))" "$@"; }

nada()             { :; }
comentario()       { py "$(W "$1")" "  workflow_dispatch:" "  # push: (no: ver cabecera)
  workflow_dispatch:"; }
con_push()         { py "$(W "$1")" "  workflow_dispatch:" "  push:
    branches: [production]
  workflow_dispatch:"; }
con_cron()         { py "$(W "$1")" "  workflow_dispatch:" "  schedule:
    - cron: \"0 6 * * 1\"
  workflow_dispatch:"; }
en_linea()         { py "$(W "$1")" "on:
  workflow_dispatch:" "on: [push, workflow_dispatch]
_x:
  workflow_dispatch:"; }
defecto_cargar()   { py "$(W "$1")" "default: simulacro" "default: cargar"; }
env_de_job()       { py "$(W "$1")" "    environment: catalogo-cp
" "    environment: catalogo-cp
    env:
      X: \${{ secrets.SEPOMEX_DATABASE_URL }}
"; py "$(W "$1")" "          SEPOMEX_DATABASE_URL: \${{ secrets.SEPOMEX_DATABASE_URL }}
" ""; }
antes_de_npm()     { py "$(W "$1")" "        working-directory: backend
" "        working-directory: backend
        env:
          SEPOMEX_DATABASE_URL: \${{ secrets.SEPOMEX_DATABASE_URL }}
"; py "$(W "$1")" "          SEPOMEX_DATABASE_URL: \${{ secrets.SEPOMEX_DATABASE_URL }}
          ACCION" "          ACCION"; }
otro_secreto()     { py "$(W "$1")" "          ACCION: \${{ inputs.accion }}
        run: ./scripts/geo" "          ACCION: \${{ inputs.accion }}
          RAILWAY_TOKEN: \${{ secrets.RAILWAY_TOKEN }}
        run: ./scripts/geo"; }
run_interpola()    { py "$(W "$1")" 'run: ./scripts/geo/cargar-cp-produccion.sh "$ACCION"' 'run: SEPOMEX_DATABASE_URL="${{ secrets.SEPOMEX_DATABASE_URL }}" ./scripts/geo/cargar-cp-produccion.sh "$ACCION"'; }
sin_rama()         { py "$(W "$1")" "    if: github.ref == 'refs/heads/production'
" ""; }
sin_entorno()      { py "$(W "$1")" "    environment: catalogo-cp
" ""; }
escribe()          { py "$(W "$1")" "  contents: read" "  contents: write"; }
sin_pin()          { py "$(W "$1")" "        run: ./scripts/check-sepomex-pin.sh" "        run: echo sin pin"; }
sin_strict()       { py "$(S "$1")" 'import --file "$FILE" --strict; resumen' 'import --file "$FILE"; resumen'; }
con_shrink()       { py "$(S "$1")" 'import --file "$FILE" --strict; resumen' 'import --file "$FILE" --strict --allow-shrink; resumen'; }
con_set_x()        { py "$(S "$1")" 'set -uo pipefail' 'set -xuo pipefail'; }
sin_mascara()      { py "$(S "$1")" 'print("::add-mask::" + raw)' 'pass'; py "$(S "$1")" 'print("::add-mask::" + p)' 'pass'; py "$(S "$1")" 'print("::add-mask::" + urllib.parse.unquote(p))' 'pass'; }
imprime_url()      { py "$(S "$1")" 'export DATABASE_URL="$URL"' 'echo "conectando a $URL"
export DATABASE_URL="$URL"'; }
checkout_etiqueta() { py "$(W "$1")" "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09" "actions/checkout@v5"; }
node_etiqueta()    { py "$(W "$1")" "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444" "actions/setup-node@main"; }
url_de_argumento() { py "$(S "$1")" 'URL="${SEPOMEX_DATABASE_URL:-}"' 'URL="${2:-${SEPOMEX_DATABASE_URL:-}}"'; }

echo "Canario G-CP-BOTON (check-cargar-cp-workflow.sh):"
caso VERDE "prístino"                                        -  nada
caso VERDE "un comentario que nombra push"                   -  comentario
caso ROJO  "se dispara también en push"                      A  con_push
caso ROJO  "se dispara también por cron"                     A  con_cron
caso ROJO  "on: en línea con push"                           A  en_linea
caso ROJO  "por defecto «cargar»"                            B  defecto_cargar
caso ROJO  "el secreto en env de job"                        C  env_de_job
caso ROJO  "el secreto entra en el paso de npm ci"           C  antes_de_npm
caso ROJO  "un segundo secreto"                              C  otro_secreto
caso ROJO  "un run: interpola el secreto"                    C  run_interpola
caso ROJO  "sin la condición de rama production"             D  sin_rama
caso ROJO  "sin el entorno catalogo-cp"                      D  sin_entorno
caso ROJO  "contents: write"                                 E  escribe
caso ROJO  "sin comprobar el pin del archivo"                F  sin_pin
caso ROJO  "import sin --strict"                             G  sin_strict
caso ROJO  "import con --allow-shrink"                       G  con_shrink
caso ROJO  "set -x"                                          G  con_set_x
caso ROJO  "sin ::add-mask::"                                G  sin_mascara
caso ROJO  "imprime la URL"                                  G  imprime_url
caso ROJO  "la URL puede venir de un argumento"              G  url_de_argumento
caso ROJO  "checkout fijado por etiqueta (TL-CHK-8)"         H  checkout_etiqueta
caso ROJO  "setup-node por rama móvil (TL-CHK-8)"            H  node_etiqueta

TOTAL=$((PASADAS+FALLOS))
if [ "$FALLOS" -ne 0 ]; then echo "canario G-CP-BOTON: ROJO — $FALLOS de $TOTAL casos no se comportan"; exit 1; fi
echo "canario G-CP-BOTON: $PASADAS/$TOTAL"

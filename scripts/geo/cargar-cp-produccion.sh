#!/usr/bin/env bash
#
# cargar-cp-produccion.sh — carga/verifica el catálogo de CP de SEPOMEX en la base que diga el secreto, desde el
# workflow «Cargar códigos postales» (`.github/workflows/cargar-codigos-postales.yml`).   · devops
#
#   SEPOMEX_DATABASE_URL=… scripts/geo/cargar-cp-produccion.sh simulacro    # import --dry-run + verify: NADA escrito
#   SEPOMEX_DATABASE_URL=… scripts/geo/cargar-cp-produccion.sh cargar       # import (una tx: entero o ROLLBACK) + verify
#   SEPOMEX_DATABASE_URL=… scripts/geo/cargar-cp-produccion.sh verificar    # solo verify (solo lectura)
#
# Siempre `--strict` (modo de producción, §81.1) y siempre el archivo FIJADO del repo (§92). ⛔ Nunca `--allow-shrink`:
# si la carga quitara > 10 % de lo que hay, aborta y eso lo decide una persona, no un botón.
# La URL viene SOLO del entorno, nunca de un argumento; nunca se imprime. En GitHub Actions se enmascaran antes de
# cualquier salida la URL entera, la contraseña, el usuario, el host y el puerto (::add-mask::).
# Salida: 0 bien · 1 error / alarma / no cumple · 64 uso.  Runbook: docs/DEVOPS_NOTES.md §107.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FILE="$ROOT/scripts/geo/data/CPdescarga.txt"
IMPORTER="$ROOT/scripts/geo/import-sepomex.sh"
ACCION="${1:-}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

case "$ACCION" in
  simulacro|cargar|verificar) ;;
  *) sed -n '5,7p' "$0"; exit 64 ;;
esac

URL="${SEPOMEX_DATABASE_URL:-}"
if [ -z "$URL" ]; then
  echo "::error title=Falta el secreto::No hay secreto SEPOMEX_DATABASE_URL en el entorno «catalogo-cp». Nada se tocó. Ver docs/DEVOPS_NOTES.md §107."
  printf '### Códigos postales: falta el secreto\n\nNo hay `SEPOMEX_DATABASE_URL`. Nada se tocó.\n' >> "$SUMMARY"
  exit 1
fi

# 1) Enmascarar ANTES de cualquier otra salida. GitHub ya oculta el secreto entero, no sus trozos (un error de
#    conexión de Prisma imprime «host:puerto»); por eso cada componente va aparte. python3 viene en el runner.
if [ -n "${GITHUB_ACTIONS:-}" ]; then
  python3 -I - <<'PY'
import os, urllib.parse
raw = os.environ.get("SEPOMEX_DATABASE_URL", "")
print("::add-mask::" + raw)
try:
    u = urllib.parse.urlsplit(raw)
    parts = [u.password, u.username, u.hostname]
    try:
        parts.append(str(u.port) if u.port else None)
    except ValueError:
        pass
    for p in parts:
        if p:
            print("::add-mask::" + p)
            print("::add-mask::" + urllib.parse.unquote(p))
except Exception:
    pass
PY
fi

# 2) La URL tiene que ser una base Postgres alcanzable desde fuera de Railway. Sin imprimirla.
host="$(SEPOMEX_DATABASE_URL="$URL" python3 -I -c '
import os, urllib.parse
u = urllib.parse.urlsplit(os.environ["SEPOMEX_DATABASE_URL"])
print((u.scheme or "") + " " + (u.hostname or ""))' 2>/dev/null || true)"
scheme="${host%% *}"; host="${host#* }"
case "$scheme" in
  postgres|postgresql) ;;
  *) echo "::error title=El secreto no es una URL de Postgres::Debe empezar por postgresql:// (copia DATABASE_PUBLIC_URL del servicio Postgres en Railway)."; exit 1 ;;
esac
case "$host" in
  "") echo "::error::El secreto no trae host."; exit 1 ;;
  *.railway.internal)
    echo "::error title=Copiaste la URL interna::Esa es DATABASE_URL (red interna de Railway, inalcanzable desde GitHub). Copia DATABASE_PUBLIC_URL del servicio Postgres."
    exit 1 ;;
esac

export DATABASE_URL="$URL"
unset DATABASE_PUBLIC_URL SEPOMEX_DATABASE_URL SEED_E2E_ALLOW_HOST

correr() { # correr <etiqueta> <args…>: corre el importador, guarda su salida y su rc
  local etiqueta="$1"; shift
  echo "::group::$etiqueta"
  salida="$("$IMPORTER" "$@" 2>&1)"; rc=$?
  printf '%s\n' "$salida"
  echo "::endgroup::"
  echo "[cargar-cp] $etiqueta ⇒ rc=$rc"
}

# Al resumen del run solo van líneas de cifras y veredictos del importador (sin host: §79 describeUrl), nunca un error.
resumen() { printf '%s\n' "$salida" | grep -E '^\[sepomex\] (filas:|dry-run ·|DRY-RUN|C-GEO-1|⛔ C-GEO-1|catálogo vacío|verify ·|import ·)' | sed 's/^/    /' >> "$SUMMARY" || true; }

printf '### Códigos postales (SEPOMEX): %s\n\nCommit `%s`. Archivo fijado `scripts/geo/data/CPdescarga.txt`.\n\n' \
  "$ACCION" "${GITHUB_SHA:-local}" >> "$SUMMARY"

fallo=0
case "$ACCION" in
  simulacro)
    correr "import --dry-run (nada escrito)" import --file "$FILE" --strict --dry-run; resumen
    [ "$rc" -eq 0 ] || fallo=1
    correr "verify (solo lectura)" verify --file "$FILE" --strict; resumen
    # 2 = tabla vacía: en un simulacro es lo esperado antes de cargar, no un fallo.
    [ "$rc" -eq 0 ] || [ "$rc" -eq 2 ] || fallo=1
    ;;
  cargar)
    correr "import (una transacción: entero o ROLLBACK)" import --file "$FILE" --strict; resumen
    if [ "$rc" -ne 0 ]; then
      fallo=1
    else
      correr "verify (solo lectura)" verify --file "$FILE" --strict; resumen
      [ "$rc" -eq 0 ] || fallo=1
    fi
    ;;
  verificar)
    correr "verify (solo lectura)" verify --file "$FILE" --strict; resumen
    [ "$rc" -eq 0 ] || fallo=1
    ;;
esac

if [ "$fallo" -ne 0 ]; then
  printf '\n**Resultado: ⛔ FALLÓ.** Si fue `cargar`, la transacción hizo ROLLBACK: la base quedó como estaba.\n' >> "$SUMMARY"
  echo "::error title=Códigos postales::$ACCION falló. Ver el log del paso; la base quedó como estaba (ROLLBACK)."
  exit 1
fi
printf '\n**Resultado: OK.**\n' >> "$SUMMARY"
echo "[cargar-cp] $ACCION: OK"

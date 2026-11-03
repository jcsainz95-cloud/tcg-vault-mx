#!/usr/bin/env bash
#
# medir-q1-produccion.sh — Q1/Q1b de D-IDS-1 contra la base que diga el secreto, en SOLO LECTURA, desde el workflow
# «Medir D-IDS-1 en producción» (`.github/workflows/medir-ids-produccion.yml`).   · devops
#
#   IDS_RO_DATABASE_URL=… scripts/ids/medir-q1-produccion.sh
#
# Corre scripts/ids/ids-q1-boton.sql (BEGIN TRANSACTION READ ONLY → prueba de que una escritura falla → rol → Q1/Q1b/Q1c →
# ROLLBACK). Al resumen del run solo van cifras: la tabla Q1, si promo/deck_exclusive > 0 la lista Q1b, y Q1c (piezas de
# clientes en bóveda con promo/deck_exclusive, solo agregados: kind, estado, conteos). Q1b sin datos
# personales: kind, ids de catálogo, nombre de producto/carta, acabado, conteos, precios.
# La URL viene SOLO del entorno, nunca de un argumento; nunca se imprime ni va en la línea de órdenes de psql (se pasa
# por PGHOST/PGUSER/PGPASSWORD…). En GitHub Actions se enmascaran antes de cualquier salida la URL entera, la
# contraseña, el usuario, el host y el puerto. El stderr de psql NO se vuelca al log (un fallo de conexión trae
# host e IP): se clasifica.
# Salida: 0 medido (Q1 sea 0 o no: decidir es del dueño) · 1 error / la prueba de solo lectura no se cumplió.
# Runbook: docs/DEVOPS_NOTES.md §108.5.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SQL="$ROOT/scripts/ids/ids-q1-boton.sql"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

URL="${IDS_RO_DATABASE_URL:-}"
if [ -z "$URL" ]; then
  echo "::error title=Falta el secreto::No hay secreto IDS_RO_DATABASE_URL en el entorno «medicion-ro». Nada se leyó. Ver docs/DEVOPS_NOTES.md §108.5."
  printf '### D-IDS-1 · Q1: falta el secreto\n\nNo hay `IDS_RO_DATABASE_URL`. Nada se leyó.\n' >> "$SUMMARY"
  exit 1
fi

# 1) Enmascarar ANTES de cualquier otra salida. GitHub oculta el secreto entero, no sus trozos.
if [ -n "${GITHUB_ACTIONS:-}" ]; then
  python3 -I - <<'PY'
import os, urllib.parse
raw = os.environ.get("IDS_RO_DATABASE_URL", "")
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

# 2) Partir la URL en variables PG* (psql las lee del entorno: la URL no aparece en la línea de órdenes). Sin imprimirla.
pgenv="$(IDS_RO_DATABASE_URL="$URL" python3 -I - <<'PY' 2>/dev/null
import os, shlex, urllib.parse
u = urllib.parse.urlsplit(os.environ["IDS_RO_DATABASE_URL"])
if u.scheme not in ("postgres", "postgresql"):
    print("ERR=esquema"); raise SystemExit
if not u.hostname:
    print("ERR=host"); raise SystemExit
if u.hostname.endswith(".railway.internal"):
    print("ERR=interna"); raise SystemExit
q = dict(urllib.parse.parse_qsl(u.query))
kv = {
    "PGHOST": u.hostname,
    "PGPORT": str(u.port or 5432),
    "PGUSER": urllib.parse.unquote(u.username or ""),
    "PGPASSWORD": urllib.parse.unquote(u.password or ""),
    "PGDATABASE": urllib.parse.unquote(u.path.lstrip("/")) or "postgres",
    "PGSSLMODE": q.get("sslmode", "prefer"),
    "PGCONNECT_TIMEOUT": "15",
    "PGAPPNAME": "ids-q1-boton",
}
print("ERR=")
for k, v in kv.items():
    print(f"export {k}={shlex.quote(v)}")
PY
)"
case "$pgenv" in
  ERR=esquema*) echo "::error title=El secreto no es una URL de Postgres::Debe empezar por postgresql:// (§108.5)."; exit 1 ;;
  ERR=host*)    echo "::error::El secreto no trae host."; exit 1 ;;
  ERR=interna*) echo "::error title=Copiaste la URL interna::Esa URL es de la red interna de Railway (*.railway.internal), inalcanzable desde GitHub. Usa la pública (§108.5)."; exit 1 ;;
  ERR=$'\n'*) ;;
  *) echo "::error::No se pudo leer el secreto como URL."; exit 1 ;;
esac
eval "${pgenv#ERR=}"
unset URL IDS_RO_DATABASE_URL DATABASE_URL DATABASE_PUBLIC_URL pgenv

command -v psql >/dev/null || { echo "::error::No hay psql en el runner."; exit 1; }

errf="$(mktemp)"; trap 'rm -f "$errf"' EXIT
salida="$(psql -X -q -v ON_ERROR_STOP=1 --csv -f "$SQL" 2>"$errf")"; rc=$?
unset PGPASSWORD

# 3) stderr clasificado, nunca volcado.
if [ "$rc" -ne 0 ]; then
  if grep -q 'IDS-RO: la escritura NO fue rechazada' "$errf"; then
    motivo="la escritura de prueba NO fue rechazada: la transacción no era de solo lectura. No se leyó nada."
  elif grep -q 'inline_code_block' "$errf" && grep -qiE 'permission denied' "$errf"; then
    motivo="la transacción no era de solo lectura (la escritura de prueba la frenó el permiso del rol, no la transacción). No se leyó nada."
  elif grep -qiE 'password authentication failed|authentication failed' "$errf"; then
    motivo="usuario o contraseña rechazados (¿se rotó la contraseña o se borró el rol?)."
  elif grep -qiE 'could not translate host|timeout expired|Connection refused|could not connect|connection to server' "$errf"; then
    motivo="no se pudo conectar (host inalcanzable o red pública del Postgres apagada)."
  elif grep -qiE 'permission denied' "$errf"; then
    motivo="el rol no tiene permiso de lectura sobre alguna tabla (faltó un GRANT SELECT)."
  elif grep -qiE 'does not exist' "$errf"; then
    motivo="una tabla o columna no existe en esa base (¿es la base de la tienda?)."
  else
    motivo="error de psql (detalle omitido del log por seguridad)."
  fi
  echo "::error title=D-IDS-1 · Q1 no medida::$motivo"
  printf '### D-IDS-1 · Q1: NO medida\n\n%s Nada se escribió: la transacción terminó en ROLLBACK.\n' "$motivo" >> "$SUMMARY"
  exit 1
fi
if ! grep -q 'IDS-RO: escritura rechazada (SQLSTATE 25006)' "$errf"; then
  echo "::error title=Sin prueba de solo lectura::La escritura de prueba no dejó su aviso (25006)."
  printf '### D-IDS-1 · Q1: NO concluyente\n\nNo apareció la prueba de que una escritura falla.\n' >> "$SUMMARY"
  exit 1
fi
echo "[ids-q1] escritura de prueba rechazada (25006); transacción READ ONLY; ROLLBACK."

# 4) Resumen: solo cifras. El veredicto lo da python a partir de las tablas (sin red, sin secreto).
SALIDA="$salida" SHA="${GITHUB_SHA:-local}" RESUMEN="$SUMMARY" python3 -I - <<'PY'
import csv, io, os, sys
_out = open(os.environ["RESUMEN"], "a", encoding="utf-8")
def print(*a, **k):  # al resumen del run; solo el ::notice final va al log
    k.setdefault("file", _out); __builtins__.print(*a, **k)
secs, cur = {}, None
for line in os.environ["SALIDA"].splitlines(keepends=True):
    if line.startswith("== "):
        cur = line.split()[1]; secs[cur] = ""
    elif cur:
        secs[cur] += line
rows = {k: list(csv.DictReader(io.StringIO(v))) for k, v in secs.items()}
for k in ("ROL", "Q1", "Q1b", "Q1c", "Q1c-detalle"):
    if k not in rows:
        print(f"### D-IDS-1 · Q1: NO concluyente\n\nFalta la sección {k} en la salida.")
        sys.exit(3)
rol = rows["ROL"][0]
def money(c):
    if c in (None, ""): return "—"
    c = int(c); return f"MX${c // 100:,}.{c % 100:02d}"
def cell(k, v):
    if k.endswith("_cents"): return money(v)
    return (v or "—").replace("|", "\\|").replace("\n", " ")
NOMBRE = {"precio_min_cents": "precio mín.", "precio_max_cents": "precio máx.", "tcgplayerProductId": "producto TCGplayer",
          "con_precio_por_pieza": "con precio por pieza", "con_caso_por_reponer": "con caso «Por reponer» abierto", "en_retiro_activo": "en retiro activo",
          "con_ref_base": "con ref. base", "ref_base_suma_cents": "ref. base Σ", "ref_base_min_cents": "ref. base mín.",
          "ref_base_max_cents": "ref. base máx.", "sin_origen": "sin origen", "q_suma_cents": "Q Σ", "q_min_cents": "Q mín.",
          "q_max_cents": "Q máx.", "productType": "tipo"}
def table(rs, cols):
    out = ["| " + " | ".join(NOMBRE.get(c, c) for c in cols) + " |", "|" + "---|" * len(cols)]
    out += ["| " + " | ".join(cell(c, r.get(c)) for c in cols) + " |" for r in rs]
    return "\n".join(out)
q1 = rows["Q1"]
total = sum(int(r["piezas"]) for r in q1)
promo = sum(int(r["piezas"]) for r in q1 if r["kind"] in ("promo", "deck_exclusive"))
print("### D-IDS-1 · Q1 en producción (solo lectura)\n")
print(f"Commit `{os.environ['SHA']}` · medido en la base a las **{rol['medido_en']}** · transacción de solo lectura: "
      f"**{'sí' if rol['transaccion_solo_lectura'] == 'on' else 'NO'}** · escritura de prueba: **rechazada (25006)** · ROLLBACK.\n")
esc = int(rol["tablas_con_escritura"])
if rol["superusuario"] == "t" or esc > 0:
    print(f"⚠️ El secreto es de un rol que **puede escribir** ({esc} de {rol['tablas']} tablas; superusuario: "
          f"{'sí' if rol['superusuario'] == 't' else 'no'}). Esta medición no escribió, pero lo recomendado es un rol de solo lectura (§108.5).\n")
else:
    print(f"Rol de solo lectura: 0 de {rol['tablas']} tablas con permiso de escritura.\n")
print(f"**Q1 — piezas de plataforma vendibles por tipo de producto** (total {total}):\n")
print(table(q1, ["kind", "piezas"]) if q1 else "_Ninguna pieza de plataforma vendible con producto._")
print()
if promo == 0:
    print("**promo + deck_exclusive = 0** ⇒ D-IDS-1 se confirma: IDS-B17 no mueve ningún precio publicado.")
else:
    print(f"**promo + deck_exclusive = {promo}** ⇒ al desplegar §IDS esas piezas quedan `pending` (se despublican), "
          "salvo las que tienen precio por pieza, que siguen a ese precio (IDS.2 v1.116.3). "
          "La lista va en la solicitud de fusión y **decide el dueño**.\n")
    q1b = rows["Q1b"]; tope = 200
    print(table(q1b[:tope], ["kind", "tcgplayerProductId", "producto", "carta", "finish", "productType", "piezas",
                             "publicadas", "con_precio_por_pieza", "precio_min_cents", "precio_max_cents"]))
    if len(q1b) > tope:
        print(f"\n_…y {len(q1b) - tope} filas más (tope del resumen {tope})._")
print()
# Q1c (H-Q1): piezas de CLIENTES en bóveda que el «falla cerrado» deja sin valor. Solo agregados.
q1c = rows["Q1c"]
clientes_promo = sum(int(r["piezas"]) for r in q1c)
print(f"**Q1c — piezas de clientes en bóveda con producto promo/deck_exclusive = {clientes_promo}**\n")
if clientes_promo == 0:
    print("D-IDS-S no cambia nada visible: ninguna pieza de cliente queda «Precio pendiente» en bóveda ni baja de custody-value.")
else:
    print("Al desplegar §IDS (D-IDS-S) esas piezas pasan a «Precio pendiente» en la bóveda del cliente y bajan del valor de "
          "custodia; en reposición M = null ⇒ R = Q (sin origen ⇒ no_reference). **Decide el dueño** con esta tabla.\n")
    print(table(q1c, ["kind", "piezas", "clientes", "con_caso_por_reponer", "en_retiro_activo"]))
    print("\n**Q1c por producto y acabado** (ref. base: MXN almacenado de la carta base, sin FX viva — aproximación; "
          "Q: lo cobrado en su origen):\n")
    det = rows["Q1c-detalle"]; tope = 200
    print(table(det[:tope], ["kind", "tcgplayerProductId", "producto", "finish", "productType", "piezas", "clientes",
                             "con_ref_base", "ref_base_suma_cents", "ref_base_min_cents", "ref_base_max_cents",
                             "sin_origen", "q_suma_cents", "q_min_cents", "q_max_cents"]))
    if len(det) > tope:
        print(f"\n_…y {len(det) - tope} filas más (tope del resumen {tope})._")
print(f"::notice title=D-IDS-1 Q1::promo+deck_exclusive = {promo} (total {total}) · Q1c clientes = {clientes_promo}", file=sys.stdout)
PY
prc=$?
[ "$prc" -eq 0 ] || { echo "::error title=D-IDS-1 · Q1 no concluyente::La salida no traía las secciones esperadas o no se pudo escribir el resumen (rc $prc)."; exit 1; }
echo "[ids-q1] medido: ver el resumen del run."

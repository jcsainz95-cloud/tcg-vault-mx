#!/usr/bin/env bash
#
# check-db-pool-limit.sh — «el tamaño del pool con el que se mide el defecto de
# dinero de `398c58a` está ESCRITO, no heredado del runner» · devops
# =============================================================================
# EL HALLAZGO QUE ORIGINA ESTE CANDADO — SB-D2 (techlead, COND-2, 2026-09-11)
# ---------------------------------------------------------------------------
# `398c58a` corrigió un 500 en la ruta de DINERO: el checkout pedía DOS
# conexiones por petición (la que retiene la `tx` + otra para
# `PricingService.getReference`), así que con N checkouts concurrentes ≥ pool/2
# el pool se agotaba y la petición moría con `Timed out fetching a new
# connection`. Quien lo hace VISIBLE es el tamaño del pool: con 5, la carrera
# R-3 pasó de 0/10 a 10/10 al corregirlo, y la mutación `m-pool` sale roja 3/3
# (`docs/BACKEND_NOTES.md` §B-1f).
#
# El problema que cierra este fichero es que ese 5 NO ESTABA ESCRITO EN NINGÚN
# SITIO. Ni `ci.yml` ni `e2e.yml` fijaban `connection_limit`: era el DEFAULT de
# Prisma (`num_cpus*2+1`), o sea el tamaño de máquina que GitHub diera ese día.
# Dos consecuencias, las dos malas y las dos silenciosas:
#   (a) si GitHub cambia el runner (4 vCPU ⇒ 9 conexiones), el candado se
#       AFLOJA SOLO, sin que nadie toque una línea ni vea un diff;
#   (b) `scripts/stack-native.sh` tampoco lo fijaba ⇒ una corrida LOCAL nunca
#       reproduce la regresión: el siguiente que la reintroduzca la ve verde en
#       su máquina (es literal lo que dice `398c58a`: «el stack nativo no lo
#       tiene; CI sí»).
# Un candado cuya sensibilidad depende del hardware que te toque no es un
# candado: es una probabilidad que nadie declara.
#
# QUÉ EXIGE (estático, sin red, sin BD, ~1 s)
# ---------------------------------------------------------------------------
#   1. Todo `DATABASE_URL` escrito en `.github/workflows/*.yml` que apunte a una
#      BD LOCAL/de servicio (localhost, 127.0.0.1, postgres, db) lleva
#      `connection_limit` <= 5 y `pool_timeout` <= 10, los dos explícitos.
#      Un `DATABASE_URL` que NO apunte a una BD local (p. ej. una gestionada por
#      el proveedor) se declara «no evaluada» y se imprime — no se finge verde.
#   2. Los DOS anclajes conocidos siguen existiendo y siguen pinchados:
#      `ci.yml` job `backend` y `e2e.yml` job `backend-e2e`. Borrar el env o
#      renombrar el job pone ROJO a propósito: que el cambio sea consciente.
#   3. `scripts/stack-native.sh` fija el MISMO pool por defecto en su subcomando
#      `test:integration` (`NATIVE_TEST_CONNECTION_LIMIT` <= 5,
#      `NATIVE_TEST_POOL_TIMEOUT` <= 10) y lo APLICA de verdad a `DATABASE_URL`
#      dentro de ese bloque.
#   4. Y lo comprueba EJECUTANDO `with_pool_params` (no solo leyéndola): la
#      función tiene que devolver una URL con el pool fijado, incluida una URL
#      que ya traiga un `connection_limit` grande (que debe quedar sustituido,
#      no duplicado).
#
# Por qué el techo y no la igualdad: BAJAR el pool aprieta el candado (la
# carrera se ve antes), subirlo lo afloja. Se prohíbe aflojar.
#
# LÍMITES, dichos antes de que alguien los descubra:
#   · Es estático sobre el YAML: no comprueba lo que Prisma hace en tiempo de
#     ejecución, ni el pool de la app en producción (que lo inyecta el
#     proveedor, no este repo).
#   · No mira `docker-compose*.yml`: ahí la URL es la de la APP corriendo, no la
#     del arnés que MIDE la carrera R-3. Si algún día la suite de integración
#     corre contra compose, este candado hay que ampliarlo (queda dicho).
#   · Si no encuentra NINGÚN `DATABASE_URL` evaluable, sale 2 («no concluyente»):
#     un parser roto no puede reportarse como verde.
#
# Uso:
#   ./scripts/check-db-pool-limit.sh [--root DIR]
# Sale 0 si todo está pinchado; 1 con fichero/job/valor exacto; 2 si no pudo medir.
#
# Que este candado MUERDE se demuestra con:
#   scripts/check-db-pool-limit-canary.sh   (sube el límite, lo borra, lo mueve)
# =============================================================================
set -uo pipefail

MAX_CL=5    # connection_limit máximo tolerado (el de `398c58a`)
MAX_PT=10   # pool_timeout máximo tolerado (segundos)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "${1:-}" = "--root" ] && [ -n "${2:-}" ]; then
  ROOT_DIR="$(cd "$2" && pwd)"
fi
cd "$ROOT_DIR" || exit 2

WF_DIR=".github/workflows"
NATIVE="scripts/stack-native.sh"

FALLOS=0
ok()  { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; FALLOS=$((FALLOS+1)); }

printf '\n\033[1m== ¿El pool que hace visible el defecto de dinero de 398c58a está ESCRITO? (SB-D2) ==\033[0m\n\n'

if [ ! -d "$WF_DIR" ]; then
  echo "::error title=check-db-pool-limit::No existe $WF_DIR en $ROOT_DIR. No concluyente."
  exit 2
fi
if ! python3 -c 'import yaml' >/dev/null 2>&1; then
  echo "::error title=check-db-pool-limit::python3 con PyYAML no disponible. Sin parser no hay medición: NO concluyente (rc=2)."
  exit 2
fi

# ---------------------------------------------------------------------------
# 1+2. Los DATABASE_URL de los workflows.
# ---------------------------------------------------------------------------
SALIDA="$(python3 - "$ROOT_DIR" "$WF_DIR" "$MAX_CL" "$MAX_PT" <<'PY'
import glob, os, re, sys
import yaml

root, wf_dir, max_cl, max_pt = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])

# Anclajes conocidos: (fichero, job). Son los DOS sitios donde corre la suite de
# integración del backend, o sea donde vive la carrera R-3.
ANCLAS = [('.github/workflows/ci.yml', 'backend'),
          ('.github/workflows/e2e.yml', 'backend-e2e')]

LOCAL = re.compile(r'@(localhost|127\.0\.0\.1|postgres|db)[:/]')

def param(url, name):
    m = re.search(r'[?&]%s=([^&\s]+)' % name, url)
    return m.group(1) if m else None

def mask(url):
    return re.sub(r'(//[^:/]+):[^@]*@', r'\1:****@', url)

evaluadas, noeval, violas, anclas_ok = [], [], [], set()

for f in sorted(glob.glob(os.path.join(root, wf_dir, '*.yml')) +
                glob.glob(os.path.join(root, wf_dir, '*.yaml'))):
    rel = os.path.relpath(f, root)
    try:
        doc = yaml.safe_load(open(f, encoding='utf-8'))
    except Exception as e:
        violas.append((rel, '-', f'YAML no parseable: {e}', '-'))
        continue
    doc = doc or {}
    sitios = []  # (scope, valor)
    top = doc.get('env') or {}
    if 'DATABASE_URL' in top:
        sitios.append(('env del workflow', str(top['DATABASE_URL']), None))
    for jname, job in (doc.get('jobs') or {}).items():
        if not isinstance(job, dict):
            continue
        jenv = job.get('env') or {}
        if 'DATABASE_URL' in jenv:
            sitios.append((f'job {jname}', str(jenv['DATABASE_URL']), jname))
        for idx, step in enumerate(job.get('steps') or [], start=1):
            if not isinstance(step, dict):
                continue
            senv = step.get('env') or {}
            if 'DATABASE_URL' in senv:
                nombre = str(step.get('name') or step.get('id') or f'paso {idx}')
                sitios.append((f'job {jname} · paso {idx} «{nombre}»', str(senv['DATABASE_URL']), None))

    for scope, url, jname in sitios:
        if not LOCAL.search(url):
            noeval.append((rel, scope, 'no apunta a una BD local/de servicio: el pool lo fija el proveedor', mask(url)))
            continue
        cl, pt = param(url, 'connection_limit'), param(url, 'pool_timeout')
        prob = None
        if cl is None:
            prob = (f'SIN connection_limit: Prisma usa su default (num_cpus*2+1) ⇒ el tamaño del pool '
                    f'lo decide el runner que GitHub dé ese día, no este repo')
        elif not cl.isdigit():
            prob = f'connection_limit={cl} no es un entero'
        elif int(cl) > max_cl:
            prob = (f'connection_limit={cl} > {max_cl}: con ese pool sobran conexiones para la SEGUNDA '
                    f'que pedía el checkout ⇒ la carrera R-3 sale verde CON el defecto dentro')
        elif pt is None:
            prob = 'SIN pool_timeout: el agotamiento del pool deja de tener un plazo declarado'
        elif not pt.isdigit():
            prob = f'pool_timeout={pt} no es un entero'
        elif int(pt) > max_pt:
            prob = (f'pool_timeout={pt} > {max_pt}: esperar más convierte el agotamiento en LENTITUD '
                    f'en vez de en el 500 que el test busca')
        if prob:
            violas.append((rel, scope, prob, mask(url)))
        else:
            evaluadas.append((rel, scope, cl, pt, mask(url)))
            if jname is not None:
                anclas_ok.add((rel, jname))

for a in ANCLAS:
    if a not in anclas_ok:
        print('ANCLA\t' + '\t'.join(a))
print(f'EVALUADAS={len(evaluadas)}')
for e in evaluadas:
    print('EVAL\t' + '\t'.join(map(str, e)))
for n in noeval:
    print('NOEVAL\t' + '\t'.join(map(str, n)))
for v in violas:
    print('VIOLA\t' + '\t'.join(map(str, v)))
PY
)"
RC_PY=$?
if [ "$RC_PY" -ne 0 ]; then
  echo "::error title=check-db-pool-limit::el parser terminó con rc=$RC_PY. NO concluyente (rc=2)."
  printf '%s\n' "$SALIDA"
  exit 2
fi

EVALUADAS="$(sed -n 's/^EVALUADAS=//p' <<<"$SALIDA")"
EVAL="$(grep '^EVAL	' <<<"$SALIDA" || true)"
NOEVAL="$(grep '^NOEVAL' <<<"$SALIDA" || true)"
VIOLA="$(grep '^VIOLA' <<<"$SALIDA" || true)"
ANCLA="$(grep '^ANCLA' <<<"$SALIDA" || true)"

if [ -n "$EVAL" ]; then
  while IFS=$'\t' read -r _ f s cl pt url; do
    ok "$f · $s → connection_limit=$cl, pool_timeout=$pt  ($url)"
  done <<<"$EVAL"
fi

if [ -n "$NOEVAL" ]; then
  echo
  echo "  No evaluadas (declaradas, no fingidas verdes):"
  while IFS=$'\t' read -r _ f s motivo url; do
    printf '    · %s · %s — %s\n      %s\n' "$f" "$s" "$motivo" "$url"
  done <<<"$NOEVAL"
fi

if [ "${EVALUADAS:-0}" -eq 0 ] && [ -z "$VIOLA" ]; then
  echo
  echo "::error title=check-db-pool-limit::0 DATABASE_URL locales encontradas en $WF_DIR. Este repo tiene dos: o el parser se rompió o alguien las movió. NO concluyente (rc=2)."
  exit 2
fi

if [ -n "$VIOLA" ]; then
  echo
  while IFS=$'\t' read -r _ f s motivo url; do
    bad "$f · $s — $motivo"
    printf '      %s\n' "$url"
    echo "::error file=$f,title=SB-D2 · el pool de \`398c58a\` no está pinchado::$s — $motivo. Escribe '?…&connection_limit=$MAX_CL&pool_timeout=$MAX_PT' en la URL (ver el bloque de comentario en ci.yml). Ese 5 es el candado del defecto de dinero, no una preferencia."
  done <<<"$VIOLA"
fi

if [ -n "$ANCLA" ]; then
  echo
  while IFS=$'\t' read -r _ f j; do
    bad "falta el anclaje: $f · job \`$j\` ya no define un DATABASE_URL local pinchado"
    echo "::error file=$f,title=SB-D2 · anclaje perdido::el job '$j' de $f es uno de los DOS sitios donde corre la carrera R-3. Si lo renombraste o moviste su env, actualiza la lista ANCLAS de scripts/check-db-pool-limit.sh en el MISMO diff — a propósito, no por accidente."
  done <<<"$ANCLA"
fi

# ---------------------------------------------------------------------------
# 3. El arnés nativo fija el MISMO pool por defecto en `test:integration`.
# ---------------------------------------------------------------------------
echo
if [ ! -f "$NATIVE" ]; then
  bad "no existe $NATIVE: el arnés local no se puede comprobar"
else
  BLOQUE="$(awk '/^  test:integration\)/{f=1} f{print} f&&/^    ;;/{exit}' "$NATIVE")"
  if [ -z "$BLOQUE" ]; then
    bad "$NATIVE: no encuentro el bloque \`test:integration)\`. NO se finge verde."
  else
    N_CL="$(grep -oE 'NATIVE_TEST_CONNECTION_LIMIT:-[0-9]+' <<<"$BLOQUE" | head -1 | sed 's/.*-//')"
    N_PT="$(grep -oE 'NATIVE_TEST_POOL_TIMEOUT:-[0-9]+' <<<"$BLOQUE" | head -1 | sed 's/.*-//')"
    if [ -z "$N_CL" ]; then
      bad "$NATIVE · test:integration NO fija connection_limit por defecto: la corrida local hereda el pool grande de Postgres y la regresión de \`398c58a\` sale VERDE en la máquina del que la reintroduzca."
      echo "::error file=$NATIVE,title=SB-D2 · el arnés local no fija el pool::Añade NATIVE_TEST_CONNECTION_LIMIT (default $MAX_CL) y aplícalo a DATABASE_URL con with_pool_params dentro del bloque test:integration."
    elif [ "$N_CL" -gt "$MAX_CL" ]; then
      bad "$NATIVE · test:integration fija connection_limit=$N_CL (> $MAX_CL): el local deja de ver la carrera R-3."
      echo "::error file=$NATIVE,title=SB-D2 · pool local aflojado::connection_limit por defecto = $N_CL, máximo $MAX_CL."
    else
      ok "$NATIVE · test:integration fija connection_limit=$N_CL por defecto (mismo candado que CI)"
    fi
    if [ -z "$N_PT" ]; then
      bad "$NATIVE · test:integration NO fija pool_timeout por defecto."
    elif [ "$N_PT" -gt "$MAX_PT" ]; then
      bad "$NATIVE · test:integration fija pool_timeout=$N_PT (> $MAX_PT): el agotamiento se vuelve espera."
    else
      ok "$NATIVE · test:integration fija pool_timeout=$N_PT por defecto"
    fi
    # Que los valores existan no basta: tienen que APLICARSE a la URL.
    if grep -qE 'DATABASE_URL="\$\(with_pool_params ' <<<"$BLOQUE" && grep -q 'export DATABASE_URL' <<<"$BLOQUE"; then
      ok "$NATIVE · test:integration APLICA el pool a DATABASE_URL (with_pool_params + export)"
    else
      bad "$NATIVE · test:integration declara el pool pero NO lo aplica a DATABASE_URL (falta with_pool_params/export): un default que nadie usa es peor que ninguno, porque parece que está."
      echo "::error file=$NATIVE,title=SB-D2 · pool declarado y no aplicado::dentro de test:integration, DATABASE_URL tiene que pasar por with_pool_params y exportarse."
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 4. Y se EJECUTA la función, no solo se lee.
# ---------------------------------------------------------------------------
if [ -f "$NATIVE" ]; then
  FN="$(sed -n '/^with_pool_params() {/,/^}/p' "$NATIVE")"
  if [ -z "$FN" ]; then
    bad "$NATIVE: no existe la función \`with_pool_params\`."
  else
    SALIDA_FN="$(bash -c "$FN"$'\n''with_pool_params "postgresql://sin_credencial@localhost:5432/d?schema=public&connection_limit=99&pool_timeout=60" '"$MAX_CL $MAX_PT" 2>&1)"
    ESPERADO="postgresql://sin_credencial@localhost:5432/d?schema=public&connection_limit=$MAX_CL&pool_timeout=$MAX_PT"
    if [ "$SALIDA_FN" = "$ESPERADO" ]; then
      ok "with_pool_params SUSTITUYE un connection_limit=99 previo (medido ejecutándola, no leyéndola)"
    else
      bad "with_pool_params no fija el pool. Esperaba:\n      $ESPERADO\n      Obtuvo:\n      $SALIDA_FN"
      echo "::error file=$NATIVE,title=SB-D2 · with_pool_params no pincha el pool::con una URL que ya trae connection_limit=99 debe devolver connection_limit=$MAX_CL&pool_timeout=$MAX_PT."
    fi
  fi
fi

echo
if [ "$FALLOS" -ne 0 ]; then
  printf '\033[1;31m✗ SB-D2: %s comprobación(es) en rojo. El pool que hace visible el 500 de checkout NO está garantizado.\033[0m\n' "$FALLOS"
  exit 1
fi
printf '\033[1;32m✓ SB-D2: el pool está escrito (%s URL(s) de CI + el arnés local), no heredado del runner.\033[0m\n' "${EVALUADAS:-0}"
exit 0

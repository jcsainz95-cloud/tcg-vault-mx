#!/usr/bin/env bash
#
# run-workflow-step.sh — ejecuta EL `run:` REAL de un paso de un workflow, con
# el env REAL del job y del paso, en el cwd EFECTIVO del paso.        · devops
# =============================================================================
# POR QUÉ EXISTE (S-CI-1, tercer pase, 2026-09-11)
# ---------------------------------------------------------------------------
# Arreglé el `working-directory` del paso «Resolver secretos» de e2e.yml,
# probé el candado estático (8/8), commiteé — y el paso murió igual en CI, por
# OTRA causa (faltaba `STRIPE_WEBHOOK_UNREACHABLE: "1"`, que e2e-real.yml sí
# declara). El canario de P-WH-1 ejecutaba el paso real… sólo el de e2e-real.
# La lección, por tercera vez: **un paso se verifica ejecutándolo en el
# contexto del job**, no leyéndolo. Esto es ese ejecutor, para cualquier paso.
#
# QUÉ HACE
#   · Parsea el workflow (python3 + PyYAML), localiza el job y el paso (por
#     prefijo de `name:` o por `id:`), y compone el env: workflow → job → paso.
#   · Sustituye las expresiones que estos pasos usan:
#       ${{ secrets.X }}            -> valor de la variable de entorno X, o vacío
#       ${{ secrets.X || 'lit' }}   -> X si está, si no 'lit'
#       ${{ github.workspace }}     -> raíz del repo
#       ${{ github.run_id }} / run_attempt / sha / ref -> valores de mentira
#       ${{ runner.temp }}          -> un tmp
#     Cualquier otra expresión queda VACÍA y se avisa (no se finge).
#   · Exporta GITHUB_ACTIONS=true, CI=true, GITHUB_ENV/GITHUB_OUTPUT/
#     GITHUB_STEP_SUMMARY apuntando a ficheros temporales, y ejecuta el `run:`
#     con `bash -e` (el shell por defecto de Actions es `bash -e {0}`) en el
#     working-directory efectivo (paso → defaults del job → raíz).
#   · Devuelve el rc del paso. Imprime al final lo que el paso escribió en
#     GITHUB_ENV (con los valores enmascarados).
#
# Uso:
#   ./scripts/run-workflow-step.sh <workflow.yml> <job> <prefijo-de-name|id> [--root DIR]
#   Ejemplo (el paso de hoy, con la clave de prueba de mentira y sin webhook):
#     STRIPE_TEST_SECRET_KEY=sk_test_$(head -c 24 /dev/zero | tr '\0' 0) \
#       ./scripts/run-workflow-step.sh .github/workflows/e2e.yml backend-e2e 'Resolver secretos'
# =============================================================================
set -uo pipefail

WF="${1:?workflow}"; JOB="${2:?job}"; PASO="${3:?prefijo de name o id}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "${4:-}" = "--root" ] && [ -n "${5:-}" ]; then ROOT_DIR="$(cd "$5" && pwd)"; fi
cd "$ROOT_DIR"
[ -f "$WF" ] || { echo "::error::no existe $WF"; exit 2; }
python3 -c 'import yaml' 2>/dev/null || { echo "::error::python3+PyYAML no disponible"; exit 2; }

TMP="$(mktemp -d -t run-step-XXXXXX)"; trap 'rm -rf "$TMP"' EXIT
export GITHUB_ACTIONS=true CI=true RUNNER_TEMP="$TMP" GITHUB_ENV="$TMP/github.env" GITHUB_OUTPUT="$TMP/github.output" GITHUB_STEP_SUMMARY="$TMP/summary.md"
: > "$GITHUB_ENV"; : > "$GITHUB_OUTPUT"; : > "$GITHUB_STEP_SUMMARY"

# El parser escribe: 1) un fichero de env `KEY=VALUE` (ya con expresiones
# sustituidas), 2) el `run:` del paso, 3) el cwd efectivo.
python3 - "$WF" "$JOB" "$PASO" "$ROOT_DIR" "$TMP" <<'PY'
import os, re, sys, yaml
wf, job_id, paso, root, tmp = sys.argv[1:6]
d = yaml.safe_load(open(wf, encoding='utf-8'))
job = (d.get('jobs') or {}).get(job_id)
if not isinstance(job, dict): sys.exit(f"::error::no existe el job '{job_id}' en {wf}")
steps = job.get('steps') or []
hit = [s for s in steps if isinstance(s, dict) and (str(s.get('name','')).startswith(paso) or s.get('id') == paso)]
if not hit: sys.exit(f"::error::no encuentro un paso cuyo name empiece por '{paso}' (o id) en {wf}/{job_id}")
st = hit[0]
if not st.get('run'): sys.exit("::error::el paso no tiene `run:` (¿es un `uses:`?)")

avisos = []
def expr(m):
    e = m.group(1).strip()
    mm = re.fullmatch(r"secrets\.([A-Za-z_][A-Za-z0-9_]*)(?:\s*\|\|\s*'([^']*)')?", e)
    if mm:
        v = os.environ.get(mm.group(1), '')
        return v if v != '' else (mm.group(2) or '')
    mm = re.fullmatch(r"(env|vars)\.([A-Za-z_][A-Za-z0-9_]*)", e)
    if mm: return os.environ.get(mm.group(2), '')
    fijos = {'github.workspace': root, 'github.run_id': '0', 'github.run_attempt': '1',
             'github.sha': '0'*40, 'github.ref': 'refs/heads/canario', 'github.ref_name': 'canario',
             'github.event_name': 'push', 'runner.temp': tmp, 'github.repository': 'canario/canario',
             'github.server_url': 'https://github.com', 'github.run_number': '0'}
    if e in fijos: return fijos[e]
    avisos.append(e); return ''
def sub(v): return re.sub(r'\$\{\{(.*?)\}\}', expr, '' if v is None else str(v))

env = {}
for scope in (d.get('env') or {}), (job.get('env') or {}), (st.get('env') or {}):
    if isinstance(scope, dict):
        for k, v in scope.items(): env[str(k)] = sub(v)
with open(f'{tmp}/step.env', 'w') as f:
    for k, v in env.items(): f.write(f'{k}={v}\n')
open(f'{tmp}/step.sh', 'w').write(sub(st['run']))
cwd = st.get('working-directory', ((job.get('defaults') or {}).get('run') or {}).get('working-directory'))
cwd = '' if cwd is None else sub(cwd)
open(f'{tmp}/step.cwd', 'w').write(cwd)
print(f"paso: «{st.get('name', st.get('id'))}» · job {job_id} · cwd={cwd or '(raíz)'} · env del paso: {len(env)} claves")
for a in sorted(set(avisos)): print(f"::warning::expresión no soportada, queda vacía: ${{{{ {a} }}}}")
PY
RC_PARSE=$?; [ "$RC_PARSE" -eq 0 ] || exit 2

CWD="$(cat "$TMP/step.cwd")"; CWD="${CWD:-$ROOT_DIR}"
case "$CWD" in /*) ;; *) CWD="$ROOT_DIR/$CWD" ;; esac
[ -d "$CWD" ] || { echo "::error::el working-directory efectivo '$CWD' no existe"; exit 2; }

# env del workflow/job/paso, exportado ENCIMA del entorno del invocador
set -a; # shellcheck disable=SC1090
. "$TMP/step.env"; set +a

echo "── ejecutando el run: real (bash -e) en $CWD ──"
( cd "$CWD" && bash -e "$TMP/step.sh" ); RC=$?
echo "── rc=$RC ──"
if [ -s "$GITHUB_ENV" ]; then
  echo "GITHUB_ENV escrito por el paso (valores enmascarados):"
  sed -E 's/^([A-Za-z_][A-Za-z0-9_]*)=(.{0,4}).*/  \1=\2…/' "$GITHUB_ENV"
fi
exit "$RC"

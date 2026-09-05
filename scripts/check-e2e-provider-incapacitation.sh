#!/usr/bin/env bash
# =============================================================================
# scripts/check-e2e-provider-incapacitation.sh — Propiedad: devops
# TCG Vault MX — el entorno donde corre la suite E2E NO puede escribir precios
# automáticos contra un proveedor DE PAGA (ARCHITECTURE §4.38(r.6.1), NORMATIVO)
# =============================================================================
# QUÉ PROBLEMA CIERRA
#   Desde v1.51 (M-48) hay **un solo dial**: `PUT /admin/settings
#   {"gradingHookEnabled":"on"}` publica las cifras **y** autoriza al barrido a
#   pedir datos a PokemonPriceTracker (2 créditos/carta) y a escribir precios.
#   El arnés E2E enciende ese dial **en CADA corrida**. Si el entorno del gate
#   tuviera credencial viva, el gate de CI se convertiría en un consumidor de la
#   cuota de un proveedor de paga, en silencio.
#
#   Frontend ya puso el guardarraíl en tiempo de ejecución
#   (`frontend/e2e/utils/paid-provider-guard.ts`: contra API local OBSERVA el
#   entorno; contra API remota exige la constancia de devops). Este script es la
#   otra mitad, la de devops, y es **estática**: verifica que los jobs que corren
#   E2E declaren la incapacitación **en el YAML**, para que la protección no
#   dependa de que nadie escriba la variable «por si acaso».
#
# -----------------------------------------------------------------------------
# v2 (2026-08-31) — POR QUÉ SE REESCRIBIÓ: el check era MÁS GRUESO QUE SU ENUNCIADO
#   Dos defectos reales de la v1, encontrados por el techlead y confirmados a
#   mano. Los dos producían VERDE sin haber verificado lo que decían verificar:
#
#   (a) **Lista fija de dos workflows.** `DEFAULT_WORKFLOWS` era un literal con
#       `e2e-real.yml` y `e2e.yml`. Un TERCER workflow que corriera E2E no lo
#       revisaba nadie, y nada avisaba de su existencia. Ahora los workflows se
#       **DESCUBREN**: se escanea `.github/workflows/` entero y se marca como
#       E2E todo job que INVOQUE la suite (`npm run test:e2e`,
#       `npm run test:integration`, `playwright test`).
#
#   (b) **El grep era por ARCHIVO, no por JOB.** En `e2e.yml` el job
#       `backend-e2e` declaraba la llave vacía pero NO la constancia, y el job
#       `frontend-e2e` declaraba las dos. Como el `grep` miraba el archivo
#       completo, encontraba la constancia del SEGUNDO job y daba verde por el
#       PRIMERO. Ahora se parsea el YAML y se evalúa el **env efectivo de cada
#       job** (workflow-level `env` + job-level `env` + step-level `env`).
#
#   Y una PRECISIÓN que la v1 no hacía, y que hace falta para que (b) no genere
#   un rojo falso: **las dos exigencias no aplican a los mismos jobs.**
#     · La **llave vacía** se exige a TODO job que corra E2E/integración:
#       cualquiera de ellos levanta el backend, y un backend con credencial viva
#       puede gastar.
#     · La **constancia** (`E2E_GRADING_PROVIDER_INCAPACITATED`) se exige SOLO a
#       los jobs que corren el **arnés Playwright**, que es el único código que
#       la lee (`frontend/e2e/utils/paid-provider-guard.ts`) y el único que
#       enciende el dial. Exigírsela a `backend-e2e` sería pedir una firma que
#       nadie consume.
# -----------------------------------------------------------------------------
#
# QUÉ EXIGE, JOB POR JOB
#   1. Ningún job E2E inyecta `POKEMONPRICETRACKER_API_KEY` con un valor que
#      pueda ser una credencial (`secrets.*`, o un literal que no sea vacío).
#   2. `POKEMONPRICETRACKER_API_KEY: ''` está DECLARADA en el env efectivo del
#      job (ausencia = decisión, no casualidad: el compose la interpola del
#      entorno del runner, así que «hoy no está» no es una garantía).
#   3. `E2E_GRADING_PROVIDER_INCAPACITATED: '1'` está declarada en el env
#      efectivo de los jobs de ARNÉS — la constancia que el guardarraíl exige
#      cuando la API bajo prueba es remota y su entorno no es observable desde
#      el runner.
#   4. **Se descubrió al menos un job E2E.** Cero jobs = el check no verificó
#      nada, y eso NO es verde: es rc=1 con el motivo escrito.
#
# QUÉ **NO** HACE
#   No mira `.env` de nadie ni intenta adivinar el entorno de staging: eso no es
#   observable desde aquí y fingir que sí lo es sería el falso verde que este
#   pase existe para quitar. Solo verifica lo que está escrito en el repo.
#   Tampoco resuelve workflows reutilizables REMOTOS (`uses: org/repo/.github/…`):
#   si un job así parece E2E, se reporta como NO VERIFICABLE y **falla**, en vez
#   de callar.
#
# USO
#   bash scripts/check-e2e-provider-incapacitation.sh            # descubre todos
#   WORKFLOWS='.github/workflows/e2e-real.yml' bash scripts/…    # acota a uno
#
# SALIDA: 0 todo declarado · 1 falta/está mal declarada alguna (o no se descubrió
#         ningún job E2E) · 2 error de uso o de fontanería (sin parser YAML).
# =============================================================================
set -uo pipefail

bad()  { printf '\033[1;31m  ✖ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
log()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || { echo "No pude entrar a $REPO_ROOT" >&2; exit 2; }

# --- Fontanería: hace falta un parser YAML de verdad --------------------------
# El defecto (b) venía de intentar leer YAML con `grep`. No se repite: si no hay
# parser, el script NO se degrada a grep — sale con rc=2 y lo dice. Un check que
# se degrada en silencio es peor que no tenerlo.
PY="${PYTHON:-python3}"
command -v "$PY" >/dev/null 2>&1 || {
  bad "No hay '$PY' en el PATH y este check necesita parsear YAML por JOB."
  echo "      Instálalo o exporta PYTHON=/ruta/a/python3."; exit 2; }
if ! "$PY" -c 'import yaml' >/dev/null 2>&1; then
  printf '\033[1;33m  ⚠ PyYAML ausente; intento instalarlo.\033[0m\n'
  # Tres intentos con flags distintos: los runners recientes marcan el Python del
  # sistema como «externally managed» (PEP 668) y el `pip install` pelado falla.
  for FLAGS in "" "--user" "--break-system-packages"; do
    # shellcheck disable=SC2086
    "$PY" -m pip install --quiet --disable-pip-version-check $FLAGS pyyaml >/dev/null 2>&1 || true
    "$PY" -c 'import yaml' >/dev/null 2>&1 && break
  done
fi
"$PY" -c 'import yaml' >/dev/null 2>&1 || {
  bad "Falta PyYAML y no pude instalarlo. Este check NO se degrada a grep (de ahí venía el defecto)."
  echo "      rc=2 a propósito: 'no pude verificar' NO es 'está bien'."
  echo "      Instala con:  $PY -m pip install pyyaml"
  echo "      O añade al job:  - uses: actions/setup-python@v5"; exit 2; }

log "Incapacitación del entorno E2E frente al proveedor de PAGA (§4.38r.6.1)"

WORKFLOWS="${WORKFLOWS:-}" "$PY" - "$REPO_ROOT" <<'PYEOF'
import os, re, sys, glob, yaml

ROOT       = sys.argv[1]
KEY_VAR    = 'POKEMONPRICETRACKER_API_KEY'
ATTEST_VAR = 'E2E_GRADING_PROVIDER_INCAPACITATED'

R = '\033[1;31m'; G = '\033[1;32m'; Y = '\033[1;33m'; B = '\033[1m'; N = '\033[0m'
def bad(m): print(f'{R}  ✖ {m}{N}')
def ok(m):  print(f'{G}  ✔ {m}{N}')
def warn(m):print(f'{Y}  ⚠ {m}{N}')

# Un job "corre E2E" si INVOCA la suite. Se busca la invocación del comando, no
# la cadena suelta: `detect` en e2e.yml menciona 'test:e2e' dentro de un
# `node -e "…scripts?.['test:e2e']…"` para comprobar que el script EXISTE, y ese
# job no corre nada. Confundirlo sería exigir constancia a quien no la usa.
RUN_E2E   = re.compile(r'\b(?:npm|yarn|pnpm)\s+run\s+test:(?:e2e|integration)\b'
                       r'|\bnpx?\s+playwright\s+test\b'
                       r'|(?<![\w:])playwright\s+test\b')
# De esos, los que corren el ARNÉS Playwright (los únicos que leen la constancia
# y los únicos que encienden el dial).
RUN_HARNESS = re.compile(r'\b(?:npm|yarn|pnpm)\s+run\s+test:e2e\b'
                         r'|\bnpx?\s+playwright\s+test\b'
                         r'|(?<![\w:])playwright\s+test\b')

override = os.environ.get('WORKFLOWS', '').split()
if override:
    files = override
    warn(f'WORKFLOWS acotado a mano ({len(files)} archivo/s): el DESCUBRIMIENTO está desactivado.')
else:
    files = sorted(glob.glob('.github/workflows/*.yml') + glob.glob('.github/workflows/*.yaml'))

rc = 0
e2e_jobs_found = 0

def envmap(d):
    """`env:` de GitHub Actions -> dict str->str. Ignora formas no-mapa."""
    e = (d or {}).get('env')
    return {str(k): ('' if v is None else str(v)) for k, v in e.items()} if isinstance(e, dict) else {}

def verdict_key(value, where):
    """Devuelve (estado, mensaje). estado: 'empty' | 'live'."""
    v = value.strip()
    if v == '':
        return 'empty', f'{KEY_VAR} declarada VACÍA en {where} ⇒ la ausencia es una decisión.'
    return 'live', f'{KEY_VAR} con valor NO vacío en {where}: «{v}»'

for wf in files:
    if not os.path.isfile(wf):
        print(f'\n  {B}{wf}{N}')
        bad('No existe. Si se renombró, el descubrimiento lo habría encontrado solo: '
            'revisa el WORKFLOWS= que pasaste.')
        rc = 1
        continue

    try:
        with open(wf, encoding='utf-8') as fh:
            doc = yaml.safe_load(fh) or {}
    except yaml.YAMLError as exc:
        print(f'\n  {B}{wf}{N}')
        bad(f'YAML ilegible ({exc.__class__.__name__}). No puedo verificar este workflow.')
        rc = 1
        continue

    wf_env = envmap(doc)
    jobs   = doc.get('jobs') or {}
    if not isinstance(jobs, dict):
        continue

    printed_header = False
    for job_id, job in jobs.items():
        if not isinstance(job, dict):
            continue
        steps = job.get('steps') or []
        runs  = ' \n '.join(str(s.get('run', '')) for s in steps if isinstance(s, dict))

        is_e2e     = bool(RUN_E2E.search(runs))
        is_harness = bool(RUN_HARNESS.search(runs))

        # Job que delega en un workflow reutilizable: no tiene steps que mirar.
        # Éste es el caso que la v1 no veía: `deploy.yml` llama a `e2e-real.yml`
        # con `uses:`, y la lista fija de dos archivos ni siquiera abría deploy.yml.
        if not steps and job.get('uses'):
            uses = str(job.get('uses'))
            if not re.search(r'e2e|playwright|integration', f'{job_id} {job.get("name","")} {uses}', re.I):
                continue
            if not printed_header:
                print(f'\n  {B}{wf}{N}'); printed_header = True
            if uses.startswith('./'):
                # OJO: `lstrip('./')` NO sirve aquí — strippea CARACTERES, así que
                # se come el punto de `.github` y deja `github/workflows/…`.
                target = os.path.normpath(uses.split('@')[0].removeprefix('./'))
                if target in {os.path.normpath(f) for f in files}:
                    # El destino se verifica por su cuenta en esta misma corrida.
                    ok(f'job «{job_id}» delega en `{uses}`, que este check YA verifica por separado.')
                    if str(job.get('secrets', '')).strip() == 'inherit':
                        print(f'      Nota: `secrets: inherit`. Es inocuo MIENTRAS el workflow llamado fije')
                        print(f'      {KEY_VAR}: \'\' en el `env:` de su job (lo hace). Heredar secretos NO')
                        print('      inyecta env por sí solo; el riesgo sería que el llamado usara `secrets.*`.')
                else:
                    bad(f'job «{job_id}» delega en `{uses}`, que NO está en el conjunto verificado.')
                    print('      Un job E2E que este check no abre es un agujero, no un verde.')
                    rc = 1
            else:
                bad(f'job «{job_id}» delega en un workflow REMOTO `{uses}`: NO VERIFICABLE desde aquí.')
                print('      Un job E2E que este check no puede leer es un agujero, no un verde.')
                rc = 1
            continue

        if not is_e2e:
            continue

        e2e_jobs_found += 1
        if not printed_header:
            print(f'\n  {B}{wf}{N}'); printed_header = True

        kind = 'ARNÉS Playwright' if is_harness else 'integración'
        print(f'    {B}job «{job_id}»{N}  ({kind})')

        # --- env EFECTIVO del job: workflow < job < step -----------------------
        eff = dict(wf_env); src = {k: 'env del workflow' for k in wf_env}
        for k, v in envmap(job).items():
            eff[k] = v; src[k] = f'env del job «{job_id}»'
        for s in steps:
            if not isinstance(s, dict):
                continue
            if RUN_E2E.search(str(s.get('run', ''))):
                for k, v in envmap(s).items():
                    eff[k] = v; src[k] = f'env del step «{s.get("name", s.get("run",""))[:40]}»'

        # --- (1)+(2) la llave: exigida a TODO job E2E -------------------------
        if KEY_VAR in eff:
            state, msg = verdict_key(eff[KEY_VAR], src[KEY_VAR])
            if state == 'empty':
                ok(msg)
            else:
                bad(msg)
                print('      Un entorno E2E con credencial viva PAGA CRÉDITOS en cada corrida del gate')
                print('      (el arnés enciende el dial único al arrancar). §4.38r.6.1.')
                rc = 1
        else:
            rc = 1
            bad(f'{KEY_VAR} NO está declarada en el env efectivo de este job.')
            print('      Que hoy no esté es una CASUALIDAD, no un diseño: el compose la interpola')
            print('      del entorno del runner. Declárala vacía en el `env:` del job:')
            print(f'          {KEY_VAR}: \'\'')

        # --- (3) la constancia: SOLO a los jobs de arnés ----------------------
        if is_harness:
            if eff.get(ATTEST_VAR, '').strip() == '1':
                ok(f'{ATTEST_VAR} declarada en {src[ATTEST_VAR]} ⇒ el arnés puede encender el dial '
                   'contra una API remota.')
            else:
                rc = 1
                bad(f'Falta {ATTEST_VAR}: \'1\' en el `env:` de este job de arnés.')
                print('      Sin ella, el guardarraíl del arnés SE NIEGA a encender el dial cuando la API')
                print('      bajo prueba es remota (su entorno no es observable desde el runner), y el job')
                print('      muere a mitad. Es constancia de DEVOPS: la firma quien conoce ese entorno.')
        else:
            print(f'      (constancia {ATTEST_VAR} NO exigida: este job no corre el arnés Playwright,')
            print('       que es el único código que la lee y el único que enciende el dial.)')

    # --- Red de seguridad por ARCHIVO: un `secrets.*` en la llave, en el job
    #     que sea, es un hallazgo aunque ese job no corra E2E hoy.
    try:
        raw = open(wf, encoding='utf-8').read()
    except OSError:
        raw = ''
    for m in re.finditer(rf'^[^\S\n]*{KEY_VAR}[^\S\n]*:[^\S\n]*(.+)$', raw, re.M):
        val = re.sub(r'#.*$', '', m.group(1)).strip()
        if 'secrets.' in val:
            if not printed_header:
                print(f'\n  {B}{wf}{N}'); printed_header = True
            bad(f'{KEY_VAR} se alimenta de `secrets.*` (línea {raw[:m.start()].count(chr(10))+1}): «{val}»')
            print('      Basta con cargar ese secret en el repo para que CI empiece a gastar sin que')
            print('      este archivo cambie. §4.38r.6.1.')
            rc = 1

print()
if e2e_jobs_found == 0:
    bad('NO se descubrió NINGÚN job que corra E2E. Esto NO es un verde: es un check que no verificó nada.')
    print('      O el descubrimiento se quedó corto (¿la suite se invoca de otra forma?), o los')
    print('      workflows E2E desaparecieron. Ninguna de las dos se resuelve sola.')
    rc = 1
elif rc == 0:
    ok(f'Los {e2e_jobs_found} job(s) E2E descubiertos declaran su incapacitación frente al proveedor de paga.')
else:
    bad(f'De los {e2e_jobs_found} job(s) E2E descubiertos, alguno NO está declarado incapacitado. '
        'Ver DEVOPS_NOTES §32.12.')
sys.exit(rc)
PYEOF
exit $?

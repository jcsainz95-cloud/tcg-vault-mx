#!/usr/bin/env bash
#
# check-workflow-cwd.sh — «un script del repo que se invoca desde un paso de CI
# tiene que EXISTIR bajo el directorio desde el que ese paso lo busca» · devops
# =============================================================================
# EL HALLAZGO QUE ORIGINA ESTE CANDADO — S-CI-1 (ALTA, seguridad, 2026-09-11)
# ---------------------------------------------------------------------------
# `e2e.yml`, job `backend-e2e`, tiene `defaults.run.working-directory: backend`.
# El paso «Resolver secretos sin literales públicos» invocaba
# `./scripts/webhook-secret-preflight.sh` — que vive en la RAÍZ del repo, no en
# `backend/scripts/` — sin `working-directory: ${{ github.workspace }}`. El paso
# moría con rc=127 («No such file or directory»), los ocho pasos siguientes
# quedaban `skipped` y el job —DEPLOY-BLOCKING por su propio comentario— salió
# rojo en 9 corridas seguidas (runs #1124→#1134) sin que nadie lo diagnosticara.
# El mismo bloque, en `ci.yml`, SÍ llevaba el override, con un comentario que lo
# explicaba. El conocimiento estaba a una línea de distancia, dos veces.
#
# Lo grave no fue la ruta: fue que un rojo por «fichero no encontrado» se leyó
# durante seis commits como «la suite falla», con un dueño por defecto (backend)
# y sin que nadie midiera qué paso había muerto. DEVOPS_NOTES §52.
#
# QUÉ HACE (estático, sin red, sin Docker, ~1 s)
# ---------------------------------------------------------------------------
# Para CADA paso `run:` de CADA workflow:
#   1. calcula el cwd EFECTIVO del paso: `working-directory` del paso, si no el
#      `defaults.run.working-directory` del job, si no la raíz del checkout;
#   2. extrae las invocaciones de scripts del repo (`./scripts/…`, `./security/…`,
#      cualquier `./…sh`, y `${{ github.workspace }}/…sh`);
#   3. resuelve cada una contra ese cwd y exige que el fichero EXISTA.
#
# Un `./scripts/x.sh` bajo `working-directory: backend` que no existe como
# `backend/scripts/x.sh` es EXACTAMENTE el rc=127 de S-CI-1, y aquí sale rojo en
# el PR, con fichero, job, paso y ruta esperada — no seis commits después.
#
# LÍMITES, dichos antes de que alguien los descubra:
#   · Una línea con `cd …` antes de la invocación NO se evalúa (el cwd ya no es
#     estático). Se cuenta como «no evaluada» y se imprime, no se finge verde.
#   · No ejecuta nada: existencia del fichero, no permisos ni contenido.
#   · Si no encuentra NINGUNA invocación en ningún workflow, sale 2 («no
#     concluyente»): un parser roto no puede reportarse como verde.
#
# Uso:
#   ./scripts/check-workflow-cwd.sh [--root DIR]
# Sale 0 si todas las invocaciones resuelven; 1 con el fichero:job:paso exacto;
# 2 si no pudo medir (sin parser YAML o sin invocaciones).
#
# Que este candado MUERDE se demuestra con:
#   scripts/check-workflow-cwd-canary.sh   (reproduce S-CI-1 literalmente)
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "${1:-}" = "--root" ] && [ -n "${2:-}" ]; then
  ROOT_DIR="$(cd "$2" && pwd)"
fi
cd "$ROOT_DIR"

WF_DIR=".github/workflows"
if [ ! -d "$WF_DIR" ]; then
  echo "::error title=check-workflow-cwd::No existe $WF_DIR en $ROOT_DIR. No concluyente."
  exit 2
fi

# ---------------------------------------------------------------------------
# Parser YAML -> JSON. Preferencia: python3 + PyYAML (en los runners de GitHub
# viene instalado; aquí también). Sin parser NO se finge verde: rc=2.
# ---------------------------------------------------------------------------
if ! python3 -c 'import yaml' >/dev/null 2>&1; then
  echo "::error title=check-workflow-cwd::python3 con PyYAML no disponible. Sin parser no hay medición: NO concluyente (rc=2)."
  exit 2
fi

SALIDA="$(python3 - "$ROOT_DIR" "$WF_DIR" <<'PY'
import os, re, sys, glob
import yaml

root, wf_dir = sys.argv[1], sys.argv[2]

# Invocaciones que este candado evalúa (la FAMILIA del defecto: scripts del repo):
#   ./scripts/…  ./security/…  ./algo.sh  ./ruta/algo.sh  ${{ github.workspace }}/…sh
TOKEN_REL = re.compile(r'(?<![\w/.$@:-])(\./(?:scripts|security)/[A-Za-z0-9_./-]+|\./[A-Za-z0-9_./-]*\.sh)')
TOKEN_WS  = re.compile(r'\$\{\{\s*github\.workspace\s*\}\}/([A-Za-z0-9_./-]+\.sh)')
CD_LINE   = re.compile(r'(^|[;&|(]\s*)cd\s')

def base_dir(cwd):
    if cwd is None:
        return root
    cwd = str(cwd).strip()
    if 'github.workspace' in cwd:
        rest = re.sub(r'\$\{\{\s*github\.workspace\s*\}\}', '', cwd).strip('/ ')
        return os.path.join(root, rest) if rest else root
    return os.path.join(root, cwd)

violaciones, no_evaluadas, verificadas, pasos = [], [], 0, 0
for f in sorted(glob.glob(os.path.join(root, wf_dir, '*.yml')) + glob.glob(os.path.join(root, wf_dir, '*.yaml'))):
    rel = os.path.relpath(f, root)
    try:
        doc = yaml.safe_load(open(f, encoding='utf-8'))
    except Exception as e:  # un YAML que no parsea también es un hallazgo
        violaciones.append((rel, '-', 0, '-', '-', f'YAML no parseable: {e}', '-'))
        continue
    jobs = (doc or {}).get('jobs') or {}
    for jname, job in jobs.items():
        if not isinstance(job, dict):
            continue
        job_cwd = (((job.get('defaults') or {}).get('run') or {}).get('working-directory'))
        for idx, step in enumerate(job.get('steps') or [], start=1):
            if not isinstance(step, dict) or not step.get('run'):
                continue
            pasos += 1
            cwd = step.get('working-directory', job_cwd)
            base = base_dir(cwd)
            sname = str(step.get('name') or step.get('id') or f'paso {idx}')
            for line in str(step['run']).splitlines():
                s = line.strip()
                if not s or s.startswith('#'):
                    continue
                toks = [(t, base) for t in TOKEN_REL.findall(s)]
                toks += [('./' + t, root) for t in TOKEN_WS.findall(s)]
                if not toks:
                    continue
                if CD_LINE.search(s):
                    for t, _ in toks:
                        no_evaluadas.append((rel, jname, idx, sname, t))
                    continue
                for t, b in toks:
                    verificadas += 1
                    p = os.path.normpath(os.path.join(b, t))
                    if not os.path.exists(p):
                        violaciones.append((rel, jname, idx, sname, str(cwd), t, os.path.relpath(p, root)))

print(f'PASOS={pasos}')
print(f'VERIFICADAS={verificadas}')
for v in no_evaluadas:
    print('NOEVAL\t' + '\t'.join(map(str, v)))
for v in violaciones:
    print('VIOLA\t' + '\t'.join(map(str, v)))
PY
)"
RC_PY=$?
if [ "$RC_PY" -ne 0 ]; then
  echo "::error title=check-workflow-cwd::el parser terminó con rc=$RC_PY. NO concluyente (rc=2)."
  printf '%s\n' "$SALIDA"
  exit 2
fi

PASOS="$(sed -n 's/^PASOS=//p' <<<"$SALIDA")"
VERIFICADAS="$(sed -n 's/^VERIFICADAS=//p' <<<"$SALIDA")"
NOEVAL="$(grep '^NOEVAL' <<<"$SALIDA" || true)"
VIOLA="$(grep '^VIOLA' <<<"$SALIDA" || true)"

printf '\n\033[1m== ¿Cada script invocado desde CI existe bajo el cwd de su paso? (S-CI-1) ==\033[0m\n\n'
echo "  pasos run: evaluados: ${PASOS:-0} · invocaciones resueltas: ${VERIFICADAS:-0}"

if [ -n "$NOEVAL" ]; then
  echo
  echo "  No evaluadas (la línea cambia de directorio con 'cd'; el cwd deja de ser estático):"
  while IFS=$'\t' read -r _ f j i n t; do
    printf '    · %s · job %s · paso %s «%s» · %s\n' "$f" "$j" "$i" "$n" "$t"
  done <<<"$NOEVAL"
fi

if [ "${VERIFICADAS:-0}" -eq 0 ]; then
  echo
  echo "::error title=check-workflow-cwd::0 invocaciones encontradas en $WF_DIR. Este repo tiene decenas: o el parser se rompió o no hay workflows. NO concluyente (rc=2)."
  exit 2
fi

if [ -n "$VIOLA" ]; then
  echo
  while IFS=$'\t' read -r _ f j i n cwd t esperado; do
    printf '\033[1;31m  ✗ %s · job %s · paso %s «%s»\033[0m\n' "$f" "$j" "$i" "$n"
    printf '      invoca %s con working-directory=%s -> no existe %s\n' "$t" "$cwd" "$esperado"
    echo "::error file=$f,title=S-CI-1 · script fuera del cwd del paso::job '$j', paso $i «$n» invoca $t con working-directory=$cwd, pero no existe $esperado. En CI esto es rc=127 y el resto del job queda skipped. Añade 'working-directory: \${{ github.workspace }}' al paso (como en ci.yml) o corrige la ruta."
  done <<<"$VIOLA"
  echo
  printf '\033[1;31m✗ %s invocación(es) que morirían con rc=127 en CI.\033[0m\n' "$(grep -c '^VIOLA' <<<"$VIOLA")"
  exit 1
fi

printf '\n\033[1;32m✓ Las %s invocaciones de scripts del repo resuelven bajo el cwd de su paso.\033[0m\n' "$VERIFICADAS"
exit 0

#!/usr/bin/env bash
#
# check-chromium-install.sh — «la instalación de Chromium en CI espera el candado
# de apt del runner y vive en UN solo sitio» · devops (CI-APT-LOCK, 2026-11-06)
# =============================================================================
# Runs 42270439578 y 42293757193: «E: Could not get lock /var/lib/dpkg/lock-
# frontend … (apt-get)» y 3 reintentos agotados en < 15 s. El arreglo vive en
# scripts/ci-install-chromium.sh. Este candado (estático, sin red, ~1 s) exige:
#   1. Ningún paso `run:` de ningún workflow llama a `playwright install` por su
#      cuenta: todos pasan por scripts/ci-install-chromium.sh.
#   2. El script fija `DPkg::Lock::Timeout` ≥ 120 s, espera el candado antes de
#      cada intento (`esperar_candado`), aísla cada intento (`setsid -w timeout
#      -k`) y hace backoff ≥ 30 s; y sigue instalando EXACTAMENTE
#      `npx playwright install --with-deps chromium`.
#   3. Cada paso que lo llama declara CHROMIUM_INSTALL_BUDGET_S y un
#      `timeout-minutes` ≥ presupuesto + 60 s (el script falla con su nombre
#      antes de que el runner lo corte a ciegas).
# rc: 0 verde · 1 rojo · 2 no concluyente (ninguna llamada encontrada).
# Uso: ./scripts/check-chromium-install.sh [<raíz del repo>]   (canario: -canary.sh)
# =============================================================================
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
python3 - "$ROOT" <<'PY'
import sys, re, glob, os, yaml
root = sys.argv[1]
fallos, llamadas = [], 0
script = os.path.join(root, 'scripts/ci-install-chromium.sh')
if not os.path.isfile(script):
    fallos.append(f'no existe {script}')
else:
    s = open(script).read()
    m = re.search(r'^APT_LOCK_TIMEOUT_S=(\d+)', s, re.M)
    if not m or int(m.group(1)) < 120:
        fallos.append('APT_LOCK_TIMEOUT_S ausente o < 120 s')
    if 'DPkg::Lock::Timeout \\"$APT_LOCK_TIMEOUT_S\\"' not in s:
        fallos.append('el script no escribe DPkg::Lock::Timeout en apt.conf.d')
    if not re.search(r'^\s*esperar_candado "\$\(min "\$LOCK_WAIT_MAX_S"', s, re.M):
        fallos.append('no hay espera previa del candado antes de cada intento')
    if not re.search(r'setsid -w timeout -k \d+ "\$t" npx playwright install --with-deps chromium\b', s):
        fallos.append('el intento no es `setsid -w timeout -k … npx playwright install --with-deps chromium`')
    m = re.search(r'espera=\$\(\( (\d+) \* intento \)\)', s)
    if not m or int(m.group(1)) < 30:
        fallos.append('backoff ausente o < 30 s por intento')
for f in sorted(glob.glob(os.path.join(root, '.github/workflows/*.y*ml'))):
    wf = yaml.safe_load(open(f)) or {}
    for jn, job in (wf.get('jobs') or {}).items():
        for i, st in enumerate((job or {}).get('steps') or []):
            run = st.get('run') or ''
            cod = '\n'.join(l for l in run.splitlines() if not l.strip().startswith('#'))
            nom = st.get('name', f'#{i}')
            donde = f'{os.path.basename(f)} · {jn} · «{nom}»'
            if 'ci-install-chromium.sh' in cod:
                llamadas += 1
                b = re.search(r'CHROMIUM_INSTALL_BUDGET_S=(\d+)', cod)
                tm = st.get('timeout-minutes')
                if not b:
                    fallos.append(f'{donde}: no declara CHROMIUM_INSTALL_BUDGET_S')
                elif not isinstance(tm, int) or tm * 60 < int(b.group(1)) + 60:
                    fallos.append(f'{donde}: timeout-minutes={tm} no cubre presupuesto {b.group(1)} s + 60 s')
            elif re.search(r'playwright\s+install', cod):
                fallos.append(f'{donde}: `playwright install` inline; usa scripts/ci-install-chromium.sh')
if llamadas == 0 and not fallos:
    print('::error title=check-chromium-install no concluyente::ningún workflow llama a ci-install-chromium.sh'); sys.exit(2)
for x in fallos:
    print(f'::error title=CI-APT-LOCK · instalación de Chromium::{x}')
if fallos: sys.exit(1)
print(f'OK: {llamadas} paso(s) instalan Chromium vía scripts/ci-install-chromium.sh, con espera de candado y backoff.')
PY

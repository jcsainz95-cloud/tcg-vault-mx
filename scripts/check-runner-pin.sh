#!/usr/bin/env bash
#
# check-runner-pin.sh — «ningún job de CI corre en una imagen de runner MÓVIL
# (`*-latest`)» · devops
# =============================================================================
# DE DÓNDE VIENE (2026-10-29, PR #107, run 40849459030)
# ---------------------------------------------------------------------------
# Los 65 `runs-on` de `.github/workflows/*.yml` decían `ubuntu-latest`. GitHub
# movió esa etiqueta de Ubuntu 24.04 a 26.04 entre el 27 y el 29 de octubre:
#   · production verde, run 40599627832 (2026-10-27): «Image: ubuntu-24.04,
#     Version: 20261012.334.1», Ubuntu 24.04.5 LTS;
#   · PR #107, run 40849459030 (2026-10-29): «Image: ubuntu-26.04, Version:
#     20261025.179.1» y `frontend-e2e` + `measurement-e2e (on|off)` mueren con
#     «Playwright does not support chromium on ubuntu26.04-x64» (Playwright 1.56).
# Ningún commit nuestro cambió nada: lo cambió un tercero. Es la misma clase que
# `minio/minio:latest` (ci.yml, compose-images) y CLAUDE.md lo dice en una
# línea: «Toda dependencia externa va fijada». Ahora todos van a `ubuntu-24.04`.
#
# QUÉ HACE (estático, sin red, ~1 s)
# ---------------------------------------------------------------------------
# Para CADA job de CADA workflow lee `runs-on` en sus tres formas (cadena,
# lista de etiquetas, mapa `{group, labels}`) y pone ROJO si alguna etiqueta:
#   · termina en `-latest` (ubuntu-latest, macos-latest, windows-latest…), o
#   · es una expresión `${{ … }}` (no se puede saber estáticamente qué imagen
#     resuelve: una matriz con `ubuntu-latest` dentro se colaría).
# Un job sin `runs-on` y sin `uses:` (reutilizable) también es rojo: GitHub no
# lo acepta y aquí no se finge verde. Los jobs `uses:` se cuentan aparte.
#
# LÍMITES: no valida que la imagen fijada siga existiendo en GitHub (eso lo
# dice el propio CI al no encontrar runner); solo que no es móvil.
#
# Uso:  ./scripts/check-runner-pin.sh [--root DIR]
# rc: 0 verde · 1 rojo (fichero:job:etiqueta) · 2 no concluyente (sin PyYAML,
#     sin workflows o 0 jobs evaluados).
# Que muerde lo demuestra: scripts/check-runner-pin-canary.sh
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "${1:-}" = "--root" ] && [ -n "${2:-}" ]; then
  ROOT_DIR="$(cd "$2" && pwd)"
fi
cd "$ROOT_DIR" || exit 2

WF_DIR=".github/workflows"
if [ ! -d "$WF_DIR" ]; then
  echo "::error title=check-runner-pin::No existe $WF_DIR en $ROOT_DIR. NO concluyente (rc=2)."
  exit 2
fi
if ! python3 -c 'import yaml' >/dev/null 2>&1; then
  echo "::error title=check-runner-pin::python3 con PyYAML no disponible. Sin parser no hay medición: NO concluyente (rc=2)."
  exit 2
fi

SALIDA="$(python3 - "$ROOT_DIR" "$WF_DIR" <<'PY'
import os, re, sys, glob
import yaml

root, wf_dir = sys.argv[1], sys.argv[2]
MOVIL = re.compile(r'-latest$', re.I)
EXPR  = re.compile(r'\$\{\{')

def etiquetas(ro):
    if isinstance(ro, str):
        return [ro]
    if isinstance(ro, list):
        return [str(x) for x in ro]
    if isinstance(ro, dict):
        out = []
        lab = ro.get('labels')
        if isinstance(lab, str):
            out.append(lab)
        elif isinstance(lab, list):
            out += [str(x) for x in lab]
        if ro.get('group') is not None:
            out.append('group:' + str(ro['group']))
        return out
    return [str(ro)]

jobs_ev, reusables, vistos, viola = 0, 0, {}, []
ficheros = sorted(glob.glob(os.path.join(root, wf_dir, '*.yml')) + glob.glob(os.path.join(root, wf_dir, '*.yaml')))
for f in ficheros:
    rel = os.path.relpath(f, root)
    try:
        doc = yaml.safe_load(open(f, encoding='utf-8'))
    except Exception as e:
        viola.append((rel, '-', f'YAML no parseable: {e}'))
        continue
    for jname, job in ((doc or {}).get('jobs') or {}).items():
        if not isinstance(job, dict):
            continue
        if 'runs-on' not in job:
            if 'uses' in job:
                reusables += 1
            else:
                viola.append((rel, jname, 'sin runs-on ni uses'))
            continue
        jobs_ev += 1
        for lab in etiquetas(job['runs-on']):
            vistos[lab] = vistos.get(lab, 0) + 1
            if MOVIL.search(lab.strip()):
                viola.append((rel, jname, f'etiqueta MÓVIL «{lab}»'))
            elif EXPR.search(lab):
                viola.append((rel, jname, f'expresión «{lab}» (imagen no fijable estáticamente)'))

print(f'FICHEROS={len(ficheros)}')
print(f'JOBS={jobs_ev}')
print(f'REUSABLES={reusables}')
for k in sorted(vistos):
    print(f'ETIQ\t{vistos[k]}\t{k}')
for v in viola:
    print('VIOLA\t' + '\t'.join(map(str, v)))
PY
)"
RC_PY=$?
if [ "$RC_PY" -ne 0 ]; then
  echo "::error title=check-runner-pin::el parser terminó con rc=$RC_PY. NO concluyente (rc=2)."
  printf '%s\n' "$SALIDA"
  exit 2
fi

FICHEROS="$(sed -n 's/^FICHEROS=//p' <<<"$SALIDA")"
JOBS="$(sed -n 's/^JOBS=//p' <<<"$SALIDA")"
REUSABLES="$(sed -n 's/^REUSABLES=//p' <<<"$SALIDA")"
VIOLA="$(grep '^VIOLA' <<<"$SALIDA" || true)"

printf '\n\033[1m== ¿Todo runs-on está fijado (ninguna imagen *-latest)? ==\033[0m\n\n'
echo "  workflows: ${FICHEROS:-0} · jobs con runs-on: ${JOBS:-0} · jobs reutilizables (uses:): ${REUSABLES:-0}"
echo "  etiquetas en uso:"
grep '^ETIQ' <<<"$SALIDA" | while IFS=$'\t' read -r _ n lab; do printf '    · %-20s × %s\n' "$lab" "$n"; done

if [ -n "$VIOLA" ]; then
  echo
  while IFS=$'\t' read -r _ f j motivo; do
    printf '\033[1;31m  ✗ %s · job %s · %s\033[0m\n' "$f" "$j" "$motivo"
    echo "::error file=$f,title=runs-on no fijado::job '$j': $motivo. Una etiqueta móvil la mueve GitHub sin avisar (2026-10-29: ubuntu-latest pasó a 26.04 y Playwright 1.56 dejó de instalar Chromium). Fija la imagen (hoy: ubuntu-24.04)."
  done <<<"$VIOLA"
  echo
  printf '\033[1;31m✗ %s job(s) con runner no fijado.\033[0m\n' "$(grep -c '^VIOLA' <<<"$VIOLA")"
  exit 1
fi

if [ "${JOBS:-0}" -eq 0 ]; then
  echo "::error title=check-runner-pin::0 jobs con runs-on en $WF_DIR. Este repo tiene decenas: o el parser se rompió o no hay workflows. NO concluyente (rc=2)."
  exit 2
fi

printf '\n\033[1;32m✓ Los %s jobs corren en una imagen de runner fijada.\033[0m\n' "$JOBS"
exit 0

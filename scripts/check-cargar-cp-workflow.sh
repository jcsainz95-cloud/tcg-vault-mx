#!/usr/bin/env bash
#
# check-cargar-cp-workflow.sh — candado del botón que carga los CP en producción (G-CP-BOTON).   · devops
# =============================================================================
# El workflow `.github/workflows/cargar-codigos-postales.yml` lleva un secreto con ESCRITURA sobre la base de
# producción. Este candado, estático (sin red, sin node, sin base), exige que siga siendo un botón seguro:
#   [A] solo `workflow_dispatch` (nunca push/PR/cron/workflow_run)
#   [B] la acción por defecto es `simulacro` (no escribe)
#   [C] el secreto aparece UNA vez, solo en `env:` del paso «Ejecutar», DESPUÉS de `npm ci`; nunca en un `run:`
#   [D] el job exige la rama `production` y el entorno `catalogo-cp`
#   [E] permisos `contents: read` y ningún `write`
#   [F] el pin del archivo (`check-sepomex-pin.sh`) corre antes de «Ejecutar»
#   [G] el script: siempre `--strict`, nunca `--allow-shrink`, enmascara antes de exportar/correr, URL solo del
#       entorno, sin `set -x` y sin imprimir la URL
# Los comentarios no cuentan (documentar el porqué no lo pone rojo). Canario: check-cargar-cp-workflow-canary.sh.
# Uso: ./scripts/check-cargar-cp-workflow.sh [--root DIR]      DEVOPS_NOTES §107.
# =============================================================================
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "${1:-}" = "--root" ]; then ROOT="$2"; fi
WF="$ROOT/.github/workflows/cargar-codigos-postales.yml"
SH="$ROOT/scripts/geo/cargar-cp-produccion.sh"

FALLOS=0
bad() { printf '  ✗ [%s] %s\n' "$1" "$2"; FALLOS=$((FALLOS+1)); }

[ -f "$WF" ] || { printf '  ✗ [A] no existe %s\n' "${WF#"$ROOT"/}"; exit 1; }
[ -f "$SH" ] || { printf '  ✗ [G] no existe %s\n' "${SH#"$ROOT"/}"; exit 1; }

# Sin comentarios de línea completa ni de cola (« #…» tras espacio). Conserva la numeración.
wf="$(sed -E 's/^[[:space:]]*#.*$//; s/[[:space:]]+#[[:space:]].*$//' "$WF")"
sh="$(sed -E 's/^[[:space:]]*#.*$//' "$SH")"
linea() { printf '%s\n' "$wf" | grep -nE -- "$1" | head -1 | cut -d: -f1; }

# [A] disparadores
on_line="$(printf '%s\n' "$wf" | grep -nE '^(on|"on"|true):' | head -1)"
if [ -z "$on_line" ] || [ "$(printf '%s' "$on_line" | cut -d: -f2- | sed -E 's/^[^:]*:[[:space:]]*//')" != "" ]; then
  bad A "el bloque \`on:\` debe ser un mapa con solo workflow_dispatch (forma en línea no admitida)"
else
  n="${on_line%%:*}"
  keys="$(printf '%s\n' "$wf" | awk -v s="$n" 'NR>s { if ($0 ~ /^[^[:space:]]/ && $0 != "") exit; if ($0 ~ /^  [A-Za-z_]+:/) { sub(/^  /,""); sub(/:.*/,""); print } }' | sort -u | tr '\n' ' ')"
  [ "$keys" = "workflow_dispatch " ] || bad A "disparadores «${keys% }»: solo se admite workflow_dispatch"
fi

# [B] por defecto, simulacro
defs="$(printf '%s\n' "$wf" | grep -E '^[[:space:]]+default:' | sed -E 's/^[[:space:]]+default:[[:space:]]*//; s/["'\'']//g' | tr '\n' ' ')"
[ "$defs" = "simulacro " ] || bad B "la entrada por defecto es «${defs% }»; debe ser solo «simulacro»"

# [C] el secreto
nsec="$(printf '%s\n' "$wf" | grep -oE 'secrets\.[A-Za-z0-9_]+' | wc -l | tr -d ' ')"
sec_l="$(linea 'SEPOMEX_DATABASE_URL:[[:space:]]*\$\{\{[[:space:]]*secrets\.SEPOMEX_DATABASE_URL[[:space:]]*\}\}')"
ej_l="$(linea '^[[:space:]]+- name: Ejecutar')"
ci_l="$(linea 'npm ci')"
[ "$nsec" = 1 ] || bad C "hay $nsec referencias a secrets.*; debe haber exactamente una (SEPOMEX_DATABASE_URL)"
if [ -z "$sec_l" ] || [ -z "$ej_l" ] || [ -z "$ci_l" ]; then
  bad C "falta el paso «Ejecutar», su env SEPOMEX_DATABASE_URL o el «npm ci»"
else
  [ "$sec_l" -gt "$ci_l" ] || bad C "el secreto entra antes de npm ci (las dependencias lo verían)"
  [ "$sec_l" -gt "$ej_l" ] || bad C "el secreto no está dentro del paso «Ejecutar»"
  sig="$(printf '%s\n' "$wf" | awk -v s="$ej_l" 'NR>s && /^[[:space:]]+- (name|uses):/ {print NR; exit}')"
  [ -z "$sig" ] || [ "$sec_l" -lt "$sig" ] || bad C "el secreto está en un paso posterior a «Ejecutar»"
  job_env="$(printf '%s\n' "$wf" | awk '/^    env:/ {print NR; exit}')"
  [ -z "$job_env" ] || bad C "hay \`env:\` a nivel de job (el secreto pasaría a todos los pasos)"
fi
printf '%s\n' "$wf" | grep -E 'run:.*secrets\.' >/dev/null && bad C "un \`run:\` interpola secrets.* directamente"
printf '%s\n' "$wf" | grep -E 'pull_request_target|workflow_run' >/dev/null && bad A "aparece pull_request_target/workflow_run"

# [D] rama y entorno
printf '%s\n' "$wf" | grep -E "^    if:[[:space:]]*github\.ref[[:space:]]*==[[:space:]]*'refs/heads/production'[[:space:]]*$" >/dev/null \
  || bad D "el job no exige github.ref == 'refs/heads/production'"
printf '%s\n' "$wf" | grep -E '^    environment:[[:space:]]*catalogo-cp[[:space:]]*$' >/dev/null || bad D "el job no usa el entorno catalogo-cp"

# [E] permisos
printf '%s\n' "$wf" | grep -E '^permissions:' >/dev/null || bad E "falta \`permissions:\` a nivel de workflow"
printf '%s\n' "$wf" | grep -E '^  contents:[[:space:]]*read[[:space:]]*$' >/dev/null || bad E "falta contents: read"
printf '%s\n' "$wf" | grep -E ':[[:space:]]*write([[:space:]]|$)|write-all' >/dev/null && bad E "hay un permiso de escritura"

# [F] pin antes de ejecutar
pin_l="$(linea '\./scripts/check-sepomex-pin\.sh')"
if [ -z "$pin_l" ] || [ -z "$ej_l" ] || [ "$pin_l" -gt "$ej_l" ]; then bad F "check-sepomex-pin.sh no corre antes de «Ejecutar»"; fi
printf '%s\n' "$wf" | grep -E '\./scripts/geo/cargar-cp-produccion\.sh' >/dev/null || bad F "«Ejecutar» no llama a scripts/geo/cargar-cp-produccion.sh"

# [G] el script
shl() { printf '%s\n' "$sh" | grep -nE -- "$1" | head -1 | cut -d: -f1; }
imports="$(printf '%s\n' "$sh" | grep -E '^[[:space:]]*correr .* (import|verify) ')"
[ -n "$imports" ] || bad G "el script no llama al importador con correr … import/verify"
printf '%s\n' "$imports" | grep -vE -- '--strict' | grep . >/dev/null && bad G "una llamada al importador sin --strict"
printf '%s\n' "$sh" | grep -E -- '--allow-shrink' >/dev/null && bad G "aparece --allow-shrink"
printf '%s\n' "$sh" | grep -E '(^|[;[:space:]])set[[:space:]]+-[a-z]*x' >/dev/null && bad G "set -x (imprimiría la URL)"
printf '%s\n' "$sh" | grep -E '(echo|printf)[^|]*\$\{?(URL|DATABASE_URL|SEPOMEX_DATABASE_URL)\b' >/dev/null && bad G "imprime la URL"
printf '%s\n' "$sh" | grep -E '^URL="\$\{SEPOMEX_DATABASE_URL:-\}"$' >/dev/null || bad G "la URL no se lee solo de SEPOMEX_DATABASE_URL"
mask_l="$(shl '::add-mask::')"; exp_l="$(shl '^export DATABASE_URL=')"; run_l="$(shl '^[[:space:]]*correr ')"
if [ -z "$mask_l" ] || [ -z "$exp_l" ] || [ -z "$run_l" ] || [ "$mask_l" -gt "$exp_l" ] || [ "$mask_l" -gt "$run_l" ]; then
  bad G "el enmascarado (::add-mask::) no va antes de exportar DATABASE_URL y de correr el importador"
fi

if [ "$FALLOS" -ne 0 ]; then printf 'check-cargar-cp-workflow: ROJO (%s)\n' "$FALLOS"; exit 1; fi
echo "check-cargar-cp-workflow: VERDE (A–G)"

#!/usr/bin/env bash
#
# audit-npm.sh — npm audit para backend y frontend. Propiedad: devops.
# =============================================================================
# Corre `npm audit` en cada app y FALLA si hay vulnerabilidades high/critical.
# Se salta limpio la app cuya carpeta aún no exista.
#
# Uso:
#   ./security/scripts/audit-npm.sh                 # gate high/critical
#   AUDIT_LEVEL=critical ./security/scripts/audit-npm.sh   # solo critical
#
# Requiere: node + npm (ya requeridos por el proyecto).
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

AUDIT_LEVEL="${AUDIT_LEVEL:-high}"   # low|moderate|high|critical
FAILED=0

audit_app() {
  local app="$1"
  local dir="${ROOT_DIR}/${app}"
  if [[ ! -f "${dir}/package.json" ]]; then
    echo "· ${app}/: sin package.json todavía, se salta."
    return 0
  fi
  echo "→ npm audit en ${app}/ (nivel: ${AUDIT_LEVEL}) ..."
  cd "${dir}"
  # --omit=dev: en producción solo cuentan las deps de runtime. Quita esta
  # línea si quieres auditar también devDependencies.
  if npm audit --audit-level="${AUDIT_LEVEL}" --omit=dev; then
    echo "✓ ${app}/: sin vulnerabilidades >= ${AUDIT_LEVEL}."
  else
    echo "✗ ${app}/: vulnerabilidades >= ${AUDIT_LEVEL} detectadas."
    FAILED=1
  fi
}

audit_app backend
audit_app frontend

if [[ "${FAILED}" -ne 0 ]]; then
  echo "✗ npm audit encontró vulnerabilidades que bloquean el gate."
  echo "  Corrige con 'npm audit fix' (rol backend/frontend, no devops) o"
  echo "  registra la excepción justificada en docs/TECH_DEBT.md."
  exit 1
fi
echo "✓ npm audit OK en todas las apps."

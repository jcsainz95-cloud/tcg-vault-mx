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
# Variables opcionales (NINGUNA cambia el veredicto por defecto):
#   AUDIT_LEVEL=high|critical|moderate|low   Umbral del gate. Default: high.
#   AUDIT_SUMMARY_FILE=<ruta>   Añade una tabla markdown con el conteo por app.
#                               En CI se le pasa $GITHUB_STEP_SUMMARY para que el
#                               resultado se vea SIN abrir el log del job.
#   AUDIT_REPORT_DIR=<dir>      Vuelca el `npm audit --json` de cada app ahí
#                               (para subirlo como artefacto).
#
# NOTA (S-PROC-1): este script es la ÚNICA definición del umbral. Lo consumen
# tanto el gate por PR (security-sast.yml) como el barrido semanal por
# calendario (security-scheduled.yml). Si cambias el umbral, cámbialo aquí y
# los dos se mueven juntos; nunca dupliques el criterio en un workflow.
#
# Requiere: node + npm (ya requeridos por el proyecto). NO instala dependencias
# ni construye nada: `npm audit` resuelve desde el lockfile, así que el árbol de
# trabajo queda intacto.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

AUDIT_LEVEL="${AUDIT_LEVEL:-high}"   # low|moderate|high|critical
AUDIT_SUMMARY_FILE="${AUDIT_SUMMARY_FILE:-}"
AUDIT_REPORT_DIR="${AUDIT_REPORT_DIR:-}"
FAILED=0

if [[ -n "${AUDIT_REPORT_DIR}" ]]; then
  mkdir -p "${AUDIT_REPORT_DIR}"
  AUDIT_REPORT_DIR="$(cd "${AUDIT_REPORT_DIR}" && pwd)"
fi

summary() {
  [[ -n "${AUDIT_SUMMARY_FILE}" ]] && printf '%s\n' "$1" >> "${AUDIT_SUMMARY_FILE}"
  return 0
}

summary "### npm audit — dependencias de runtime (\`--omit=dev\`)"
summary ""
summary "Umbral del gate: **${AUDIT_LEVEL}** o superior."
summary ""
summary "| App | Crit | High | Mod | Low | Estado |"
summary "|---|---:|---:|---:|---:|---|"

# Extrae metadata.vulnerabilities del JSON de npm audit. Solo para MOSTRAR:
# el veredicto siempre lo da el exit code del propio `npm audit` de abajo.
counts_from_json() {
  node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const v = JSON.parse(s).metadata.vulnerabilities;
        process.stdout.write(`${v.critical}|${v.high}|${v.moderate}|${v.low}`);
      } catch (e) {
        process.stdout.write("?|?|?|?");
      }
    });
  '
}

audit_app() {
  local app="$1"
  local dir="${ROOT_DIR}/${app}"
  if [[ ! -f "${dir}/package.json" ]]; then
    echo "· ${app}/: sin package.json todavía, se salta."
    summary "| \`${app}/\` | — | — | — | — | sin \`package.json\`, se salta |"
    return 0
  fi
  echo "→ npm audit en ${app}/ (nivel: ${AUDIT_LEVEL}) ..."
  cd "${dir}"

  # 1) JSON para el conteo y (si se pide) el artefacto. `npm audit` sale !=0
  #    cuando hay hallazgos, así que aquí NO dejamos que tumbe el script.
  local json crit high mod low
  json="$(npm audit --omit=dev --json 2>/dev/null || true)"
  if [[ -n "${AUDIT_REPORT_DIR}" ]]; then
    printf '%s' "${json}" > "${AUDIT_REPORT_DIR}/npm-audit-${app}.json"
  fi
  IFS='|' read -r crit high mod low <<< "$(printf '%s' "${json}" | counts_from_json)"

  # 2) El gate de verdad: exit code de npm audit con el umbral.
  # --omit=dev: en producción solo cuentan las deps de runtime. Quita esta
  # línea si quieres auditar también devDependencies.
  if npm audit --audit-level="${AUDIT_LEVEL}" --omit=dev; then
    echo "✓ ${app}/: sin vulnerabilidades >= ${AUDIT_LEVEL}."
    summary "| \`${app}/\` | ${crit} | ${high} | ${mod} | ${low} | ✅ sin hallazgos >= ${AUDIT_LEVEL} |"
  else
    echo "✗ ${app}/: vulnerabilidades >= ${AUDIT_LEVEL} detectadas."
    summary "| \`${app}/\` | ${crit} | ${high} | ${mod} | ${low} | ❌ **bloquea el gate** |"
    FAILED=1
  fi
}

audit_app backend
audit_app frontend

summary ""
if [[ "${FAILED}" -ne 0 ]]; then
  echo "✗ npm audit encontró vulnerabilidades que bloquean el gate."
  echo "  Corrige con 'npm audit fix' (rol backend/frontend, no devops) o"
  echo "  registra la excepción justificada en docs/TECH_DEBT.md."
  summary "❌ **Hay vulnerabilidades >= ${AUDIT_LEVEL} en dependencias de runtime.**"
  summary ""
  summary "Dueño de la corrección: **backend** o **frontend** (devops no toca sus \`package.json\`)."
  summary "Salidas válidas: actualizar la dependencia, o registrar la excepción en \`docs/TECH_DEBT.md\`"
  summary "con motivo, alcance y disparador de revisión. Silenciar el gate no es una salida."
  exit 1
fi
echo "✓ npm audit OK en todas las apps."
summary "✅ **Sin vulnerabilidades >= ${AUDIT_LEVEL} en dependencias de runtime.**"

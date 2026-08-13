#!/usr/bin/env bash
#
# new-project.sh — Arranca un proyecto nuevo desde la plantilla del equipo de desarrollo.
#
# Copia el EQUIPO (los agentes y las reglas de coordinación) a una carpeta nueva y la deja
# lista para que empieces a trabajar una idea nueva desde cero. No toca la plantilla original.
#
# Uso:
#   ./scripts/new-project.sh <ruta-destino>
#
# Ejemplo:
#   ./scripts/new-project.sh ../mi-app-nueva
#
set -euo pipefail

# --- Resolver rutas ---------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"   # raíz de la plantilla (dev-team)

# --- Validar argumentos -----------------------------------------------------
if [[ $# -ne 1 ]]; then
  echo "Uso: $0 <ruta-destino>" >&2
  echo "Ejemplo: $0 ../mi-app-nueva" >&2
  exit 1
fi

DEST="$1"

if [[ -e "${DEST}" ]]; then
  echo "Error: el destino '${DEST}' ya existe. Elige una ruta que no exista para no pisar nada." >&2
  exit 1
fi

# --- Crear estructura -------------------------------------------------------
echo "→ Creando proyecto nuevo en: ${DEST}"
mkdir -p "${DEST}/docs"

# El equipo (no cambia entre proyectos)
cp -r "${TEMPLATE_DIR}/.claude" "${DEST}/.claude"
cp "${TEMPLATE_DIR}/CLAUDE.md" "${DEST}/CLAUDE.md"

# Plantilla de idea en blanco (lo único que rellenas por proyecto)
cp "${TEMPLATE_DIR}/PROJECT.md" "${DEST}/PROJECT.md"

# Diagrama visual del equipo (referencia)
if [[ -f "${TEMPLATE_DIR}/docs/team-overview.html" ]]; then
  cp "${TEMPLATE_DIR}/docs/team-overview.html" "${DEST}/docs/team-overview.html"
fi

# docs/ arranca vacío (aquí escribirán arquitecto, ux-ui, etc.)
touch "${DEST}/docs/.gitkeep"

# --- Mensaje final ----------------------------------------------------------
cat <<EOF

✓ Proyecto creado en: ${DEST}

Siguientes pasos:
  1. cd "${DEST}"
  2. Abre Claude Code en la carpeta.
  3. Pídele al equipo que arranque, por ejemplo:
       "Usa al product-owner para aterrizar esta idea en PROJECT.md: <tu idea>"
  4. Sigue el flujo: product-owner → arquitecto → ux-ui + backend + frontend → qa → techlead → devops.

  Consulta docs/team-overview.html para ver el flujo completo del equipo.
EOF

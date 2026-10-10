#!/usr/bin/env bash
#
# new-project.sh — Arranca un proyecto nuevo desde la plantilla del equipo de desarrollo.
#                                                                        · devops
# =============================================================================
# Copia el EQUIPO (los agentes, las reglas de coordinación y las plantillas de arranque)
# a una carpeta nueva y la deja lista para trabajar una idea nueva desde cero. No toca
# la plantilla original.
#
# DE DÓNDE VIENE (2026-10-10, medido por el orquestador)
# ---------------------------------------------------------------------------
# La versión anterior copiaba `PROJECT.md` DE LA RAÍZ como «plantilla en blanco». Ese
# fichero es el PROJECT.md VIVO del proyecto en curso (12 967 líneas / 1.2 MB): un
# proyecto nuevo arrancaba con el producto del anterior ya escrito. Además el mensaje
# final omitía tres gates obligatorios de `CLAUDE.md` (tester-e2e, pentester, seguridad).
#
# QUÉ COPIA (y de dónde)
# ---------------------------------------------------------------------------
#   .claude/                 → .claude/            (agentes + templates, el equipo entero)
#   CLAUDE.md                → CLAUDE.md           (reglas de coordinación)
#   .claude/templates/PROJECT.md     → PROJECT.md        (en blanco; NO el de la raíz)
#   .claude/templates/HECHOS.md      → HECHOS.md
#   .claude/templates/PENDIENTES.md  → PENDIENTES.md
#   .claude/templates/HISTORIAL.md   → HISTORIAL.md
#   .claude/templates/TRASPASO.md    → TRASPASO.md
#   .claude/templates/DECISIONES.md  → docs/DECISIONES.md
#   docs/team-overview.html  → docs/team-overview.html (si existe; referencia visual)
#
# Si falta CUALQUIER plantilla, el script falla ANTES de crear nada: nada de copias a
# medias. Comprobación: `scripts/check-new-project.sh` (y su canario).
#
# Uso:
#   ./scripts/new-project.sh <ruta-destino>
#
# Ejemplo:
#   ./scripts/new-project.sh ../mi-app-nueva
#
# Sale 0 si creó el proyecto; 1 si argumentos/destino inválidos; 2 si la plantilla
# está incompleta (no se creó nada).
# =============================================================================
set -euo pipefail

# --- Resolver rutas ---------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"   # raíz de la plantilla (dev-team)
TEMPLATES_DIR="${TEMPLATE_DIR}/.claude/templates" # plantillas en blanco por proyecto

# Las plantillas que viajan a la RAÍZ del proyecto nuevo…
PLANTILLAS_RAIZ=(PROJECT.md HECHOS.md PENDIENTES.md HISTORIAL.md TRASPASO.md)
# …y las que viajan a docs/.
PLANTILLAS_DOCS=(DECISIONES.md)

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

# --- Validar la plantilla ANTES de tocar el disco ---------------------------
# Un proyecto creado a medias es peor que ninguno: el orquestador arrancaría leyendo
# un HECHOS.md que no existe y lo daría por «sin hechos». Se comprueba todo primero.
FALTAN=()
[[ -d "${TEMPLATE_DIR}/.claude/agents" ]] || FALTAN+=(".claude/agents/ (directorio)")
[[ -f "${TEMPLATE_DIR}/CLAUDE.md" ]]      || FALTAN+=("CLAUDE.md")
[[ -d "${TEMPLATES_DIR}" ]]               || FALTAN+=(".claude/templates/ (directorio)")
for f in "${PLANTILLAS_RAIZ[@]}" "${PLANTILLAS_DOCS[@]}"; do
  [[ -f "${TEMPLATES_DIR}/${f}" ]] || FALTAN+=(".claude/templates/${f}")
done

if (( ${#FALTAN[@]} > 0 )); then
  echo "Error: la plantilla en '${TEMPLATE_DIR}' está INCOMPLETA. Falta:" >&2
  for f in "${FALTAN[@]}"; do echo "  - ${f}" >&2; done
  echo "No se creó nada en '${DEST}'. Restaura las plantillas (git checkout / git pull) y vuelve a correr." >&2
  exit 2
fi

# --- Crear estructura -------------------------------------------------------
echo "→ Creando proyecto nuevo en: ${DEST}"
mkdir -p "${DEST}/docs"

# El equipo (no cambia entre proyectos): agentes + templates + reglas
cp -r "${TEMPLATE_DIR}/.claude" "${DEST}/.claude"
cp "${TEMPLATE_DIR}/CLAUDE.md" "${DEST}/CLAUDE.md"

# Ficheros de arranque EN BLANCO (desde .claude/templates/, nunca desde la raíz viva)
for f in "${PLANTILLAS_RAIZ[@]}"; do
  cp "${TEMPLATES_DIR}/${f}" "${DEST}/${f}"
done
for f in "${PLANTILLAS_DOCS[@]}"; do
  cp "${TEMPLATES_DIR}/${f}" "${DEST}/docs/${f}"
done

# Diagrama visual del equipo (referencia)
if [[ -f "${TEMPLATE_DIR}/docs/team-overview.html" ]]; then
  cp "${TEMPLATE_DIR}/docs/team-overview.html" "${DEST}/docs/team-overview.html"
fi

# --- Mensaje final ----------------------------------------------------------
cat <<EOM

✓ Proyecto creado en: ${DEST}

Qué hay dentro:
  .claude/agents/      el equipo (roles)            CLAUDE.md      reglas de coordinación
  .claude/templates/   plantillas en blanco         PROJECT.md     la idea (en blanco; la redacta product-owner)
  HECHOS.md            lo que el dueño establece    PENDIENTES.md  índice de abiertos (con fecha de medición)
  HISTORIAL.md         lo cerrado, verbatim         TRASPASO.md    prompt de arranque entre sesiones
  docs/DECISIONES.md   historia de decisiones del humano (una línea por decisión)

Siguientes pasos:
  1. cd "${DEST}"  &&  git init
  2. Abre Claude Code en la carpeta.
  3. El orquestador ARRANCA leyendo HECHOS.md entero y el índice de PENDIENTES.md (regla O-11 de CLAUDE.md),
     antes de preguntar nada al humano.
  4. Pídele al equipo que arranque, por ejemplo:
       "Usa al product-owner para aterrizar esta idea en PROJECT.md: <tu idea>"
  5. Flujo completo (CLAUDE.md «Flujo de trabajo estándar»):
       product-owner → arquitecto → (ux-ui ∥ devops) → (backend ∥ frontend)
       → qa → techlead → tester-e2e (contra el stack real) → pentester → seguridad → devops (deploy)
     Los gates (qa, techlead, tester-e2e, pentester, seguridad) solo leen y reportan: todo hallazgo vuelve al
     rol dueño del código. devops despliega solo con los tres veredictos (QA + techlead + seguridad).

  Consulta docs/team-overview.html para ver el flujo completo del equipo.
EOM

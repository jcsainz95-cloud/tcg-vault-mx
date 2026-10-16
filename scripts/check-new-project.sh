#!/usr/bin/env bash
#
# check-new-project.sh — «¿new-project.sh arranca un proyecto EN BLANCO, entero y
#                         sin arrastrar el PROJECT.md vivo?»             · devops
# =============================================================================
# DE DÓNDE VIENE (2026-10-10)
# ---------------------------------------------------------------------------
# `new-project.sh` copiaba el PROJECT.md de la raíz (el vivo, 12 967 líneas) como
# «plantilla en blanco». Nadie lo midió porque nadie arranca proyectos nuevos a
# diario: es justo la clase de defecto que vive años sin que lo pise nadie. Este
# candado lo corre en un directorio temporal y comprueba el resultado.
#
# QUÉ EXIGE
# ---------------------------------------------------------------------------
#  1. El script acaba en 0 y el destino existe.
#  2. `PROJECT.md` del destino tiene MENOS de 60 líneas y es byte a byte la plantilla
#     `.claude/templates/PROJECT.md` (no el de la raíz, si existe y es distinto).
#  3. En la raíz del destino están `HECHOS.md`, `PENDIENTES.md`, `HISTORIAL.md`,
#     `TRASPASO.md`, idénticos a su plantilla.
#  4. `docs/DECISIONES.md` existe e idéntico a su plantilla.
#  5. `.claude/` del destino es idéntico (diff -r) al de la plantilla: agentes y
#     templates viajan enteros. Se imprime el conteo de cada uno.
#  6. `CLAUDE.md` idéntico.
#  7. Con un destino que ya existe, el script se niega (exit 1) y NO lo toca.
#  8. Sin argumentos, exit 1.
#
# Uso:
#   ./scripts/check-new-project.sh           # usa el árbol donde vive el script
#
# Sale 0 si todo cumple; 1 si algo falla; 2 si no pudo medir.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NP="${ROOT_DIR}/scripts/new-project.sh"
TPL="${ROOT_DIR}/.claude/templates"
MAX_LINEAS_PROJECT=60

[[ -x "$NP" ]] || { echo "::error::no encuentro ${NP} ejecutable. NO concluyente."; exit 2; }

BASE="$(mktemp -d -t new-project-check-XXXXXX)" || exit 2
trap 'rm -rf "$BASE"' EXIT
DEST="${BASE}/proyecto-nuevo"

FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
mal() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }

printf '\n\033[1m== new-project.sh: ¿proyecto en blanco, entero? ==\033[0m\n\n'

# --- 1. corre y crea el destino ---------------------------------------------
SALIDA="$("$NP" "$DEST" 2>&1)"; RC=$?
if [[ $RC -eq 0 && -d "$DEST" ]]; then ok "new-project.sh sale 0 y crea el destino"
else mal "new-project.sh salió ${RC} (esperaba 0). Salida:"; printf '%s\n' "$SALIDA" | sed 's/^/      /'; fi

# --- 2. PROJECT.md en blanco, no el vivo -------------------------------------
if [[ -f "$DEST/PROJECT.md" ]]; then
  LINEAS="$(wc -l <"$DEST/PROJECT.md")"
  if (( LINEAS < MAX_LINEAS_PROJECT )); then ok "PROJECT.md del destino: ${LINEAS} líneas (< ${MAX_LINEAS_PROJECT})"
  else mal "PROJECT.md del destino tiene ${LINEAS} líneas (≥ ${MAX_LINEAS_PROJECT}): es el vivo, no la plantilla"; fi
  if cmp -s "$DEST/PROJECT.md" "$TPL/PROJECT.md"; then ok "PROJECT.md del destino == .claude/templates/PROJECT.md"
  else mal "PROJECT.md del destino NO es la plantilla .claude/templates/PROJECT.md"; fi
  if [[ -f "$ROOT_DIR/PROJECT.md" ]] && ! cmp -s "$ROOT_DIR/PROJECT.md" "$TPL/PROJECT.md"; then
    if cmp -s "$DEST/PROJECT.md" "$ROOT_DIR/PROJECT.md"; then mal "PROJECT.md del destino es el de la RAÍZ (el vivo)"
    else ok "PROJECT.md del destino != PROJECT.md de la raíz (el vivo no viaja)"; fi
  fi
else
  mal "falta PROJECT.md en el destino"
fi

# --- 3/4. ficheros de arranque ----------------------------------------------
for f in HECHOS.md PENDIENTES.md HISTORIAL.md TRASPASO.md; do
  if [[ -f "$DEST/$f" ]] && cmp -s "$DEST/$f" "$TPL/$f"; then ok "raíz/${f} presente e idéntico a la plantilla"
  elif [[ -f "$DEST/$f" ]]; then mal "raíz/${f} presente pero DISTINTO de la plantilla"
  else mal "falta raíz/${f}"; fi
done
if [[ -f "$DEST/docs/DECISIONES.md" ]] && cmp -s "$DEST/docs/DECISIONES.md" "$TPL/DECISIONES.md"; then
  ok "docs/DECISIONES.md presente e idéntico a la plantilla"
else mal "falta docs/DECISIONES.md o difiere de la plantilla"; fi

# --- 5. .claude/ entero --------------------------------------------------------
if [[ -d "$DEST/.claude" ]] && diff -rq "$ROOT_DIR/.claude" "$DEST/.claude" >/dev/null 2>&1; then
  N_AG="$(find "$DEST/.claude/agents" -maxdepth 1 -type f -name '*.md' | wc -l)"
  N_TP="$(find "$DEST/.claude/templates" -maxdepth 1 -type f -name '*.md' | wc -l)"
  ok ".claude/ idéntico a la plantilla · agents: ${N_AG} ficheros · templates: ${N_TP} ficheros"
  (( N_TP >= 6 )) && ok ".claude/templates/ trae las 6 plantillas (o más)" || mal ".claude/templates/ trae ${N_TP} plantillas (< 6)"
else
  mal ".claude/ del destino falta o difiere de la plantilla"; diff -rq "$ROOT_DIR/.claude" "$DEST/.claude" 2>&1 | head -10 | sed 's/^/      /'
fi

# --- 6. CLAUDE.md ------------------------------------------------------------
if cmp -s "$DEST/CLAUDE.md" "$ROOT_DIR/CLAUDE.md" 2>/dev/null; then ok "CLAUDE.md idéntico"
else mal "CLAUDE.md falta o difiere"; fi

# --- 7. destino existente: se niega y no toca --------------------------------
HUELLA="$(find "$DEST" -type f | sort | xargs md5sum 2>/dev/null | md5sum)"
if "$NP" "$DEST" >/dev/null 2>&1; then mal "sobre un destino existente salió 0 (debería negarse)"
else
  HUELLA2="$(find "$DEST" -type f | sort | xargs md5sum 2>/dev/null | md5sum)"
  [[ "$HUELLA" == "$HUELLA2" ]] && ok "destino existente: se niega (exit ≠ 0) y no toca nada" || mal "destino existente: se negó pero MODIFICÓ ficheros"
fi

# --- 8. sin argumentos -------------------------------------------------------
if "$NP" >/dev/null 2>&1; then mal "sin argumentos salió 0"; else ok "sin argumentos: exit ≠ 0"; fi

echo
if (( FALLOS == 0 )); then printf '\033[1;32m✓ check-new-project: %s/%s.\033[0m\n' "$PASADAS" "$PASADAS"; exit 0; fi
printf '\033[1;31m✗ check-new-project: %s fallo(s) de %s.\033[0m\n' "$FALLOS" "$((PASADAS+FALLOS))"; exit 1

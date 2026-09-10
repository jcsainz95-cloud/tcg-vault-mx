#!/usr/bin/env bash
#
# audit-npm-dev.sh — Trinquete del audit de devDependencies.  Propiedad: devops.
# =============================================================================
# QUÉ PROBLEMA RESUELVE (P-DEP-1, pentester 2026-09-10)
# ---------------------------------------------------------------------------
# `security-sast.yml` ya corría un `npm audit` CON devDependencies… con
# `continue-on-error: true` y un `|| true` dentro del bucle. Un escáner que no
# puede cambiar el color de nada es un escáner que nadie lee: las 3 altas/críticas
# del tooling del frontend llevaban ahí sin dueño ni fecha hasta que el pentester
# las nombró.
#
# La respuesta NO es silenciarlo (prohibido) ni bloquear el pipeline entero por
# un CVE de tooling cuyo arreglo es un major de `vitest` que no me pertenece
# (`frontend/package.json` es del rol frontend). La respuesta es un TRINQUETE:
#
#   · Hallazgo alto/crítico de tooling que NO está fichado  ->  ROJO.
#   · Ficha con `revisar_antes_de` ya pasado                ->  ROJO.
#   · Ficha que ya no corresponde a nada (se arregló)       ->  AVISO, y se poda.
#
# Así el estado de hoy queda VERDE (está fichado, con dueño y fecha) y cualquier
# EMPEORAMIENTO —o el simple paso del tiempo— se pone rojo solo. Es el mismo
# criterio del registro de excepciones de Trivy (§47.4): una excepción que solo
# vive en la configuración es una excepción que nadie revisa.
#
# LO QUE ESTE SCRIPT **NO** HACE, a propósito:
#   · No toca umbrales de runtime. Las dependencias de producción las gatea
#     `security/scripts/audit-npm.sh` (high, sin fichas, sin excepciones), que
#     sigue siendo la ÚNICA definición de ese umbral (S-PROC-1).
#   · No arregla nada: los lockfiles de `backend/` y `frontend/` son de sus roles.
#
# Uso:
#   ./security/scripts/audit-npm-dev.sh
#   AUDIT_DEV_FIXTURES=<dir> ./security/scripts/audit-npm-dev.sh   # self-test:
#       usa <dir>/<app>.dev.json y <dir>/<app>.prod.json en vez de correr npm.
#   AUDIT_DEV_HOY=YYYY-MM-DD   # self-test: finge la fecha de hoy.
#   AUDIT_SUMMARY_FILE=<ruta>  # tabla markdown (en CI: $GITHUB_STEP_SUMMARY).
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
FICHAS="${AUDIT_DEV_FICHAS:-${ROOT_DIR}/security/npm-audit-dev-fichas.tsv}"
FIXTURES="${AUDIT_DEV_FIXTURES:-}"
HOY="${AUDIT_DEV_HOY:-$(date -u +%F)}"
AUDIT_SUMMARY_FILE="${AUDIT_SUMMARY_FILE:-}"
APPS="${AUDIT_DEV_APPS:-backend frontend}"

sum() { [ -n "$AUDIT_SUMMARY_FILE" ] && printf '%s\n' "$1" >> "$AUDIT_SUMMARY_FILE"; return 0; }

echo "== Trinquete de devDependencies (P-DEP-1) — hoy: ${HOY} =="
[ -f "$FICHAS" ] || { echo "::error::No existe el fichero de fichas ${FICHAS}. Sin él, las excepciones vuelven a ser invisibles: ROJO."; exit 1; }

# --- 1. Hallazgos altos/críticos que SOLO existen con devDependencies --------
# Se resta el audit de runtime: esos ya los gatea audit-npm.sh y no admiten
# ficha. Un hecho, un dueño.
recolectar() {   # recolectar <app> -> líneas "GHSA<TAB>paquete<TAB>severidad<TAB>título"
  local app="$1" dev prod
  if [ -n "$FIXTURES" ]; then
    dev="$(cat "${FIXTURES}/${app}.dev.json" 2>/dev/null)"
    prod="$(cat "${FIXTURES}/${app}.prod.json" 2>/dev/null || echo '{}')"
  else
    [ -f "${ROOT_DIR}/${app}/package.json" ] || return 0
    dev="$(cd "${ROOT_DIR}/${app}" && npm audit --json 2>/dev/null)"
    prod="$(cd "${ROOT_DIR}/${app}" && npm audit --omit=dev --json 2>/dev/null)"
  fi
  [ -n "$dev" ] || return 0
  DEV_JSON="$dev" PROD_JSON="$prod" APP="$app" node -e '
    const ids = (raw) => {
      const out = new Map();
      let d; try { d = JSON.parse(raw || "{}"); } catch { return out; }
      for (const [pkg, v] of Object.entries(d.vulnerabilities || {})) {
        for (const via of v.via || []) {
          if (typeof via !== "object") continue;
          if (!["high", "critical"].includes(via.severity)) continue;
          const id = (via.url || "").split("/").pop() || via.source;
          if (id) out.set(id, { pkg, sev: via.severity, title: via.title || "" });
        }
      }
      return out;
    };
    const dev = ids(process.env.DEV_JSON), prod = ids(process.env.PROD_JSON);
    for (const [id, m] of dev) {
      if (prod.has(id)) continue;            // es de runtime: lo gatea audit-npm.sh
      console.log([id, m.pkg, m.sev, m.title].join("\t"));
    }
  '
}

HALLAZGOS=""
for app in $APPS; do
  while IFS= read -r l; do
    [ -n "$l" ] && HALLAZGOS="${HALLAZGOS}${app}"$'\t'"${l}"$'\n'
  done < <(recolectar "$app")
done

# --- 2. Fichas declaradas ----------------------------------------------------
declare -A FICHA_FECHA FICHA_DUENO FICHA_VISTA
while IFS=$'\t' read -r ghsa app pkg dueno fecha motivo; do
  case "${ghsa:-}" in ''|'#'*) continue ;; esac
  FICHA_FECHA["$ghsa"]="$fecha"
  FICHA_DUENO["$ghsa"]="${dueno} (${app}/${pkg})"
  FICHA_VISTA["$ghsa"]=0
done < "$FICHAS"

# --- 3. Veredicto ------------------------------------------------------------
ROJO=0
SIN_FICHA=""; CADUCADAS=""; VIVAS=""
while IFS=$'\t' read -r app ghsa pkg sev titulo; do
  [ -n "${ghsa:-}" ] || continue
  if [ -z "${FICHA_FECHA[$ghsa]:-}" ]; then
    SIN_FICHA="${SIN_FICHA}  · ${sev^^} ${ghsa} — ${app}/${pkg}: ${titulo}"$'\n'
    ROJO=1
  else
    FICHA_VISTA["$ghsa"]=1
    if [[ "$HOY" > "${FICHA_FECHA[$ghsa]}" ]]; then
      CADUCADAS="${CADUCADAS}  · ${ghsa} (${app}/${pkg}) — la ficha venció el ${FICHA_FECHA[$ghsa]}; dueño: ${FICHA_DUENO[$ghsa]}"$'\n'
      ROJO=1
    else
      VIVAS="${VIVAS}  · ${ghsa} (${app}/${pkg}) — fichada hasta ${FICHA_FECHA[$ghsa]}; dueño: ${FICHA_DUENO[$ghsa]}"$'\n'
    fi
  fi
done <<< "$HALLAZGOS"

PODAR=""
for ghsa in "${!FICHA_FECHA[@]}"; do
  [ "${FICHA_VISTA[$ghsa]}" = "0" ] && PODAR="${PODAR}  · ${ghsa} — ya no aparece en el audit: PÓDALA de ${FICHAS#"$ROOT_DIR"/}"$'\n'
done

sum "### npm audit — devDependencies (trinquete P-DEP-1)"
sum ""
sum "Fichas vivas: \`$(printf '%s' "$VIVAS" | grep -c '·' || true)\` · sin ficha: \`$(printf '%s' "$SIN_FICHA" | grep -c '·' || true)\` · caducadas: \`$(printf '%s' "$CADUCADAS" | grep -c '·' || true)\`"
sum ""
sum "Fuente única de las excepciones: \`security/npm-audit-dev-fichas.tsv\` (dueño y fecha por hallazgo)."

[ -n "$VIVAS" ]  && { echo; echo "Hallazgos de tooling FICHADOS (aceptados, con dueño y fecha):"; printf '%s' "$VIVAS"; }
[ -n "$PODAR" ]  && { echo; echo "⚠ Fichas obsoletas (alguien lo arregló — esto NO es rojo):"; printf '%s' "$PODAR"; }

if [ -n "$SIN_FICHA" ]; then
  echo
  echo "::error title=Vulnerabilidad de tooling SIN ficha::Apareció un alto/crítico en devDependencies que nadie ha decidido."
  printf '%s' "$SIN_FICHA"
  echo "  Qué hacer: arreglarlo (lo normal) o ficharlo en ${FICHAS#"$ROOT_DIR"/} con dueño, fecha"
  echo "  de revisión y el motivo MEDIDO por el que no es alcanzable. Subir el umbral no es una opción."
fi
if [ -n "$CADUCADAS" ]; then
  echo
  echo "::error title=Ficha de tooling caducada::Una excepción declarada pasó su fecha de revisión."
  printf '%s' "$CADUCADAS"
  echo "  La fecha no es burocracia: es lo que impide que 'lo vemos luego' dure un año."
fi

echo
if [ "$ROJO" -ne 0 ]; then
  echo "✗ TRINQUETE ROJO."
  exit 1
fi
echo "✓ Trinquete verde: todo alto/crítico de devDependencies está fichado y en fecha."
exit 0

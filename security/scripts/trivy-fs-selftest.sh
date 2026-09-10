#!/usr/bin/env bash
#
# trivy-fs-selftest.sh — ¿el candado de `trivy fs` sabe ponerse ROJO?  ·  devops
# =============================================================================
# Hermano de `dast-selftest.sh`, y existe por la MISMA razón: un gate que sólo
# se ha visto en verde no está verificado, está sin observar.
#
# QUÉ HACE
#   1. Corre el gate REAL sobre el repo limpio  ->  exige VERDE.
#   2. PLANTA un `package-lock.json` canario con dependencias vulnerables
#      conocidas dentro de `scripts/s3-local/` (el directorio que se discutió en
#      §47: la maqueta S3 de la ruta nativa) y vuelve a correr EL MISMO comando
#      con LA MISMA config y EL MISMO ignorefile  ->  exige ROJO, y exige que el
#      CVE plantado aparezca por su nombre en el informe.
#   3. Borra el canario y comprueba que no quedó nada en el árbol.
#
#   Verde en el paso 2  ->  ESTE SCRIPT FALLA. Es la única forma de distinguir
#   «no hay vulnerabilidades» de «el escáner no está mirando aquí».
#
# POR QUÉ ESTE DIRECTORIO Y ESTE CVE
#   El canario incluye a propósito `dicer@0.3.0` / CVE-2022-24434 — exactamente
#   el hallazgo que bloqueó el release (§47) y que se cerró ELIMINANDO el
#   componente (override de `busboy` a 1.6.0), NO ignorándolo. Si algún día
#   alguien "arregla" un rojo parecido metiendo una exclusión de ruta o de CVE,
#   este self-test se pone verde donde debería estar rojo y FALLA. El candado
#   queda amarrado al sitio del que se sospechó.
#
# Uso:
#   ./security/scripts/trivy-fs-selftest.sh
#   TRIVY_SELFTEST_DIR=otra/ruta ./security/scripts/trivy-fs-selftest.sh
#
# Requiere: trivy en PATH (en CI lo instala el job `trivy-fs` por apt).
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEC_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${SEC_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

# Directorio donde se planta el canario. Por defecto, DENTRO de la maqueta S3:
# es el sitio cuyo escaneo se quiso poner en duda, así que es el sitio que hay
# que demostrar que se sigue escaneando.
CANARY_DIR="${TRIVY_SELFTEST_DIR:-scripts/s3-local}/.trivy-selftest-canary"
CANARY_LOCK="${CANARY_DIR}/package-lock.json"

# CVE que el canario DEBE provocar. `dicer` es el del release (§47);
# `minimist` es un segundo testigo independiente por si la DB moviera el
# estado de alguno (así el test no depende de un único aviso).
CVE_OBLIGATORIO="CVE-2022-24434"     # dicer@0.3.0  (HIGH, sin fix)
CVE_TESTIGO="CVE-2021-44906"         # minimist@1.2.0 (CRITICAL, con fix)

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; echo "::error title=Self-test de trivy-fs::$*"; exit 1; }

limpiar() { rm -rf "${CANARY_DIR}"; }
trap limpiar EXIT INT TERM

if ! command -v trivy >/dev/null 2>&1; then
  fail "trivy no está en PATH. El self-test NO se salta: sin escáner no hay nada que verificar."
fi

# El gate REAL, palabra por palabra. Si esto se desalinea de security-sast.yml o
# de trivy-fs.sh, el self-test deja de probar el candado que corre en CI.
gate() {
  trivy fs \
    --config "${SEC_DIR}/trivy.yaml" \
    --ignorefile "${SEC_DIR}/.trivyignore" \
    --severity HIGH,CRITICAL \
    --ignore-unfixed=false \
    --exit-code 1 \
    --format table \
    --no-progress \
    .
}

# ---------------------------------------------------------------------------
# (1) Árbol limpio -> el gate tiene que estar VERDE.
# ---------------------------------------------------------------------------
log "(1/3) Gate sobre el árbol limpio — se espera VERDE"
limpiar
SALIDA_LIMPIA="$(gate 2>&1)"; RC_LIMPIO=$?
if [ "${RC_LIMPIO}" -ne 0 ]; then
  echo "${SALIDA_LIMPIA}"
  fail "El gate ya está ROJO sin canario: hay hallazgos HIGH/CRITICAL REALES en el repo. Arréglalos (o repórtalos al rol dueño); este self-test no puede medir nada encima de un rojo real."
fi
echo "✓ verde sobre el árbol limpio."

# ---------------------------------------------------------------------------
# (2) Con canario plantado -> el gate tiene que ponerse ROJO.
# ---------------------------------------------------------------------------
log "(2/3) Plantando canario vulnerable en ${CANARY_LOCK}"
mkdir -p "${CANARY_DIR}"
cat > "${CANARY_LOCK}" <<'JSON'
{
  "name": "trivy-fs-selftest-canary",
  "version": "0.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "trivy-fs-selftest-canary",
      "version": "0.0.0",
      "dependencies": { "dicer": "0.3.0", "minimist": "1.2.0" }
    },
    "node_modules/dicer": {
      "version": "0.3.0",
      "resolved": "https://registry.npmjs.org/dicer/-/dicer-0.3.0.tgz"
    },
    "node_modules/minimist": {
      "version": "1.2.0",
      "resolved": "https://registry.npmjs.org/minimist/-/minimist-1.2.0.tgz"
    }
  }
}
JSON
# NO se instala nada: trivy lee el lockfile. El canario es un fichero de texto,
# nunca un `node_modules` real, y vive segundos.

SALIDA_CANARIO="$(gate 2>&1)"; RC_CANARIO=$?
echo "${SALIDA_CANARIO}"

if [ "${RC_CANARIO}" -eq 0 ]; then
  fail "EL CANDADO NO MUERDE: con ${CANARY_LOCK} plantado (dicer@0.3.0 + minimist@1.2.0) el gate salió VERDE. O el directorio está excluido del escaneo, o el ignorefile es demasiado ancho, o la severidad está mal puesta. Un verde que no puede volverse rojo no es una medición."
fi

grep -q "${CVE_OBLIGATORIO}" <<<"${SALIDA_CANARIO}" \
  || fail "El gate falló pero NO reportó ${CVE_OBLIGATORIO} (dicer@0.3.0), que es el hallazgo del release §47. Si ese CVE está silenciado por ruta o por ID, el candado dejó de vigilar justo lo que se cerró."
grep -q "${CVE_TESTIGO}" <<<"${SALIDA_CANARIO}" \
  || fail "El gate falló pero NO reportó ${CVE_TESTIGO} (minimist@1.2.0). Testigo independiente caído: revisa la DB de trivy y el alcance del escaneo."
grep -q "${CANARY_LOCK}" <<<"${SALIDA_CANARIO}" \
  || fail "Los CVE aparecen pero el informe NO menciona ${CANARY_LOCK}. No se puede afirmar que el hallazgo venga del directorio que se quería demostrar en alcance."

echo "✓ ROJO con el canario, y por los CVE correctos, y atribuido a ${CANARY_LOCK}."

# ---------------------------------------------------------------------------
# (3) El canario no se queda en el árbol.
# ---------------------------------------------------------------------------
log "(3/3) Retirando el canario"
limpiar
[ ! -e "${CANARY_DIR}" ] || fail "El canario sobrevivió en ${CANARY_DIR}. NO se puede dejar: contaminaría el siguiente escaneo y podría acabar commiteado."
echo "✓ árbol limpio."

printf '\n\033[1;32m✓ Self-test de trivy-fs OK: verde en limpio, ROJO con canario en %s.\033[0m\n' "${CANARY_DIR}"

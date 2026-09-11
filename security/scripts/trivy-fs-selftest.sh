#!/usr/bin/env bash
#
# trivy-fs-selftest.sh — ¿el candado de `trivy fs` sabe ponerse ROJO?  ·  devops
# =============================================================================
# Hermano de `dast-selftest.sh`, y existe por la MISMA razón: un gate que sólo
# se ha visto en verde no está verificado, está sin observar.
#
# QUÉ HACE
#   1. Corre el gate REAL (security/scripts/trivy-fs.sh, el MISMO comando que
#      CI) sobre el árbol tal cual y anota su LÍNEA BASE: color y CVE reportados.
#      NO exige verde. Antes sí lo exigía, y eso cegaba al canario justo cuando
#      más falta hacía: con el gate rojo por algo real, este self-test abortaba
#      con «no puedo medir nada encima de un rojo real» — 11 corridas seguidas
#      (S-SAST-1). Un candado permanentemente rojo era tan ciego como uno
#      permanentemente verde. Ahora el rojo real lo reporta el paso del gate;
#      este paso mide lo suyo IGUAL.
#   2. PLANTA un `package-lock.json` canario con dependencias vulnerables
#      conocidas dentro de `scripts/s3-local/` (el directorio que se discutió en
#      §47) y vuelve a correr EL MISMO comando  ->  exige ROJO, exige que los CVE
#      plantados aparezcan por su nombre, atribuidos al canario, y que NO
#      estuvieran ya en la línea base (si no, el rojo no sería del canario).
#   3. Planta también un `sk_test_…` de ficción junto al canario y exige que el
#      gate NO lo reporte: este gate es de VULNERABILIDADES; los secretos son de
#      gitleaks, y comprueba que ese job siga cableado en security-sast.yml.
#      (Es la avería de S-SAST-1: el escáner de secretos de trivy corriendo sin
#      que nadie lo hubiera decidido, con una allowlist distinta a la de
#      gitleaks.)
#   4. Borra el canario y comprueba que no quedó nada en el árbol.
#
#   Verde en el paso 2  ->  ESTE SCRIPT FALLA. Es la única forma de distinguir
#   «no hay vulnerabilidades» de «el escáner no está mirando aquí».
#
# POR QUÉ ESTE DIRECTORIO Y ESTE CVE
#   El canario incluye a propósito `dicer@0.3.0` / CVE-2022-24434 — exactamente
#   el hallazgo que bloqueó el release (§47) y que se cerró ELIMINANDO el
#   componente (override de `busboy` a 1.6.0), NO ignorándolo. Si algún día
#   alguien "arregla" un rojo parecido metiendo una exclusión de ruta o de CVE,
#   este self-test se pone verde donde debería estar rojo y FALLA.
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

GATE_SH="${SCRIPT_DIR}/trivy-fs.sh"

# Directorio donde se planta el canario. Por defecto, DENTRO de la maqueta S3:
# es el sitio cuyo escaneo se quiso poner en duda, así que es el sitio que hay
# que demostrar que se sigue escaneando.
CANARY_DIR="${TRIVY_SELFTEST_DIR:-scripts/s3-local}/.trivy-selftest-canary"
CANARY_LOCK="${CANARY_DIR}/package-lock.json"
CANARY_SECRET="${CANARY_DIR}/fixture-con-clave-de-ficcion.sh"

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
[ -x "${GATE_SH}" ] || fail "No existe/ejecuta ${GATE_SH}: el self-test tiene que correr EL MISMO comando que CI, y ese comando vive ahí."

# El gate REAL: el mismo script que ejecuta CI. Ni una bandera distinta.
gate() { "${GATE_SH}"; }

cves_de() { grep -oE 'CVE-[0-9]{4}-[0-9]+' <<<"$1" | sort -u; }

# ---------------------------------------------------------------------------
# (1) Línea base sobre el árbol tal cual. Se ANOTA, no se exige.
# ---------------------------------------------------------------------------
log "(1/4) Gate sobre el árbol tal cual — línea base"
limpiar
SALIDA_BASE="$(gate 2>&1)"; RC_BASE=$?
CVES_BASE="$(cves_de "${SALIDA_BASE}")"
if [ "${RC_BASE}" -ne 0 ]; then
  echo "  línea base: ROJO (rc=${RC_BASE}) — hay hallazgos REALES; los reporta el paso del gate, no éste."
  echo "  CVE en la línea base: $(tr '\n' ' ' <<<"${CVES_BASE:-ninguno}")"
  echo "  Este self-test sigue midiendo: un rojo real no puede apagar al canario (S-SAST-1)."
else
  echo "  línea base: verde (0 HIGH/CRITICAL de runtime)."
fi
for cve in "${CVE_OBLIGATORIO}" "${CVE_TESTIGO}"; do
  grep -q "${cve}" <<<"${CVES_BASE}" \
    && fail "${cve} ya aparece SIN canario. No puedo atribuir el rojo al canario: o el árbol tiene ese CVE de verdad (arréglalo) o el canario quedó plantado de otra corrida."
done

# ---------------------------------------------------------------------------
# (2) Con canario plantado -> el gate tiene que ponerse ROJO por los CVE del canario.
# ---------------------------------------------------------------------------
log "(2/4) Plantando canario vulnerable en ${CANARY_LOCK}"
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

# (3, plantado aquí para que una sola corrida mida las dos cosas) Una «clave» de
# Stripe de FICCIÓN con la forma exacta que el escáner de secretos de trivy
# detecta (sk_test_ + 24..99 alfanuméricos). Ceros: no es una clave de nadie.
printf '#!/usr/bin/env bash\n# fixture del self-test: NO es una clave\nCLAVE_FICCION="sk_test_%s"\n' \
  "$(printf '0%.0s' $(seq 1 40))" > "${CANARY_SECRET}"

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

echo "✓ ROJO con el canario, por los CVE correctos, atribuido a ${CANARY_LOCK}, y ninguno de los dos estaba en la línea base."

# ---------------------------------------------------------------------------
# (3) El gate es de VULNERABILIDADES: la clave de ficción NO puede aparecer, y
#     el escáner de secretos de verdad (gitleaks) tiene que seguir cableado.
# ---------------------------------------------------------------------------
log "(3/4) Alcance: secretos fuera de este gate, gitleaks dentro del workflow"
if grep -qE 'stripe-secret-token|\(secrets\)|fixture-con-clave-de-ficcion' <<<"${SALIDA_CANARIO}"; then
  fail "El gate de trivy-fs reportó la clave de FICCIÓN de ${CANARY_SECRET}: el escáner de SECRETOS de trivy está encendido. Este gate es de vulnerabilidades; los secretos los juzga gitleaks con su allowlist. Dos escáneres de secretos con dos criterios es S-SAST-1 otra vez. Revisa --scanners vuln en trivy-fs.sh y scan.scanners en trivy.yaml."
fi
grep -qE '^\s+gitleaks:\s*$' .github/workflows/security-sast.yml \
  || fail "security-sast.yml ya no tiene el job 'gitleaks'. Sin él, apartar los secretos del gate de trivy los deja sin escáner: NO se puede."
grep -qE 'gitleaks' .github/workflows/security-sast.yml && grep -qE "needs:.*gitleaks" .github/workflows/security-sast.yml \
  || fail "El job 'gitleaks' no está en el 'needs' de sast-ok: existe pero no gatea."
echo "✓ la clave de ficción no entra en este gate; el job gitleaks existe y sast-ok depende de él."

# ---------------------------------------------------------------------------
# (4) El canario no se queda en el árbol.
# ---------------------------------------------------------------------------
log "(4/4) Retirando el canario"
limpiar
[ ! -e "${CANARY_DIR}" ] || fail "El canario sobrevivió en ${CANARY_DIR}. NO se puede dejar: contaminaría el siguiente escaneo y podría acabar commiteado."
echo "✓ árbol limpio."

if [ "${RC_BASE}" -ne 0 ]; then
  printf '\n\033[1;33m! Self-test de trivy-fs OK (el candado MUERDE), pero la línea base está ROJA por hallazgos reales: el paso del gate es el que lo reporta.\033[0m\n'
else
  printf '\n\033[1;32m✓ Self-test de trivy-fs OK: verde en limpio, ROJO con canario en %s, secretos fuera del alcance.\033[0m\n' "${CANARY_DIR}"
fi

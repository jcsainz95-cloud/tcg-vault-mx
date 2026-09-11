#!/usr/bin/env bash
#
# trivy-fs.sh — EL gate de `trivy fs` (dependencias de RUNTIME)  ·  devops
# =============================================================================
# Este fichero es EL comando del gate. Lo ejecutan, palabra por palabra:
#   · CI: security-sast.yml, job `trivy-fs` (antes era una `trivy-action` con
#     sus propios inputs, que NO pasaba security/trivy.yaml — ver abajo);
#   · el self-test: security/scripts/trivy-fs-selftest.sh (función `gate`);
#   · cualquiera en local: ./security/scripts/trivy-fs.sh
# Si el comando vive en tres sitios, se desalinean; aquí vive en uno.
#
# ALCANCE — y por qué hay que decirlo en voz alta (S-SAST-1, DEVOPS_NOTES §53)
# ---------------------------------------------------------------------------
# `trivy fs` enciende POR DEFECTO dos escáneres: `vuln` y `secret`. Este gate es
# el de VULNERABILIDADES. Los secretos son de gitleaks (security/gitleaks.toml),
# que tiene la allowlist de placeholders de este repo (`sk_test_…`, `CHANGE_ME`,
# `*_dummy`) y es el gate de secretos que seguridad audita. Medido 2026-09-11:
# con el default, trivy ponía el gate en ROJO por cinco `sk_test_…` de FICCIÓN
# en dos canarios (`scripts/check-secret-defaults-canary.sh`,
# `scripts/check-stripe-webhook-failclosed-canary.sh`) mientras gitleaks —el
# escáner de secretos de verdad— estaba verde por allowlist. Ese rojo duró 11
# corridas (#1124→#1134) y todo el equipo, seguridad incluida, lo atribuyó a
# las devDependencies del frontend (P-DEP-1): trivy NI SIQUIERA MIRA las
# devDependencies por defecto (0 vulnerabilidades en los tres lockfiles).
#
# `--scanners vuln` va en la línea de comandos Y en security/trivy.yaml: el
# yaml ya lo «declaraba» con una clave que trivy no leía. El alcance del gate
# no puede volver a depender de que un esquema de config no derive.
#
# QUÉ NO ES ESTO: no es una excepción ni una rebaja. El umbral (HIGH/CRITICAL,
# sin ignore-unfixed, sin entradas activas en .trivyignore) no cambia. Lo que
# cambia es que el gate mide lo que su política dice que mide.
#
# devDependencies: fuera del alcance de ESTE comando (default de trivy para
# npm), igual que `audit-npm.sh --omit=dev`. Las gatea, con las MISMAS fichas
# y las MISMAS fechas que `npm audit`, security/scripts/trivy-dev-fichas.sh.
#
# Uso:
#   ./security/scripts/trivy-fs.sh              # tabla, exit 1 si HIGH/CRITICAL
#   TRIVY_SARIF=1 ./security/scripts/trivy-fs.sh
#   Variables nativas de trivy que respeta: TRIVY_CACHE_DIR, TRIVY_DB_REPOSITORY,
#   TRIVY_SKIP_DB_UPDATE (útiles donde ghcr.io no sea alcanzable).
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEC_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${SEC_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

if ! command -v trivy >/dev/null 2>&1; then
  echo "✗ trivy no está instalado. Ver https://aquasecurity.github.io/trivy"
  echo "  (o usa la imagen aquasec/trivy). En CI lo instala el job por apt."
  exit 127
fi

# El objetivo del escaneo (por defecto, el repo entero). El self-test lo usa
# tal cual; no hay una segunda copia del comando en ningún sitio.
TARGET="${1:-.}"

ARGS=(
  fs
  --scanners vuln                          # SOLO vulnerabilidades (secretos = gitleaks)
  --config "${SEC_DIR}/trivy.yaml"
  --ignorefile "${SEC_DIR}/.trivyignore"   # excepciones justificadas (hoy: ninguna activa)
  --severity HIGH,CRITICAL
  --ignore-unfixed=false                   # también los que no tienen parche
  --exit-code 1                            # gate: HIGH/CRITICAL => fallo
  --no-progress
)
if [[ "${TRIVY_SARIF:-0}" == "1" ]]; then
  ARGS+=(--format sarif --output trivy-fs.sarif)
else
  ARGS+=(--format table)
fi

echo "→ Trivy fs (vuln, HIGH/CRITICAL) sobre ${TARGET} ..."
trivy "${ARGS[@]}" "${TARGET}"
echo "✓ Trivy fs OK (sin HIGH/CRITICAL en dependencias de runtime)."

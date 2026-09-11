#!/usr/bin/env bash
#
# trivy-dev-fichas.sh — las devDependencies según TRIVY, juzgadas por LAS MISMAS
# fichas (y el mismo código) que las juzga `npm audit`.               · devops
# =============================================================================
# POR QUÉ EXISTE (S-SAST-1, seguridad 2026-09-11 — DEVOPS_NOTES §53)
# ---------------------------------------------------------------------------
# Seguridad pidió que «los dos escáneres digan lo mismo sobre el mismo hecho»:
# si la ficha fechada de `security/npm-audit-dev-fichas.tsv` es la política del
# proyecto para las devDependencies, trivy tiene que honrarla con la MISMA fecha
# de caducidad, o la política no es una política.
#
# Lo medido: trivy NO mira devDependencies por defecto (npm), así que su
# silencio sobre P-DEP-1 no era «verde»: era «fuera de alcance». Este script
# las mete en alcance —`--include-dev-deps`— y NO reimplementa la política:
# convierte la salida de trivy a la forma que `audit-npm-dev.sh` ya entiende (su
# interfaz de fixtures) y lo llama. Una política, UN código, UN fichero de
# fichas, DOS bases de datos de avisos (la de GitHub vía npm, la de trivy).
#
#   · alto/crítico de tooling que trivy ve y NO está fichado -> ROJO
#   · ficha vencida (misma `revisar_antes_de`)               -> ROJO
#   · ficha que trivy ya no ve (alguien lo arregló)          -> AVISO (podar)
#
# Lo de runtime NO pasa por aquí: lo gatea trivy-fs.sh sin fichas posibles
# (igual que audit-npm.sh). Por eso se restan los hallazgos del escaneo sin
# devDeps: si algo aparece en runtime, es rojo por el otro camino, no ficha.
#
# IDs: las fichas se indexan por GHSA. Trivy reporta CVE y deja el GHSA en
# `References`; de ahí se recupera. Si un hallazgo no trae GHSA, se usa su
# VulnerabilityID (CVE) y la ficha, si procede, se escribe con ese ID.
#
# Uso:
#   ./security/scripts/trivy-dev-fichas.sh
#   AUDIT_SUMMARY_FILE=<ruta>   -> tabla markdown (CI: $GITHUB_STEP_SUMMARY)
#   AUDIT_DEV_HOY=YYYY-MM-DD    -> se propaga a audit-npm-dev.sh (self-test)
# Requiere trivy en PATH (respeta TRIVY_CACHE_DIR / TRIVY_DB_REPOSITORY / …).
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEC_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${SEC_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

APPS="${AUDIT_DEV_APPS:-backend frontend}"
RATCHET="${SCRIPT_DIR}/audit-npm-dev.sh"

command -v trivy >/dev/null 2>&1 || { echo "::error::trivy no está en PATH. Sin escáner no hay medición: ROJO."; exit 1; }
[ -x "$RATCHET" ] || { echo "::error::no existe/ejecuta $RATCHET (el trinquete cuya política se reutiliza)."; exit 1; }

WORK="$(mktemp -d -t trivy-dev-fichas-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

# trivy JSON -> forma `npm audit --json` mínima que audit-npm-dev.sh consume:
#   { "vulnerabilities": { "<pkg>": { "severity", "via": [ { "url", "severity", "title" } ] } } }
convertir() {  # convertir <trivy.json> <salida.json>
  node -e '
    const fs = require("fs");
    const t = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const out = {};
    for (const r of t.Results || []) for (const v of r.Vulnerabilities || []) {
      const sev = String(v.Severity || "").toLowerCase();
      if (!["high", "critical"].includes(sev)) continue;
      let ghsa = /^GHSA-/.test(v.VulnerabilityID) ? v.VulnerabilityID : null;
      if (!ghsa) for (const u of v.References || []) { const m = u.match(/advisories\/(GHSA-[0-9a-z-]+)/i); if (m) { ghsa = m[1]; break; } }
      const id = ghsa || v.VulnerabilityID;
      const pkg = v.PkgName;
      out[pkg] = out[pkg] || { severity: sev, via: [] };
      out[pkg].via.push({ url: "https://github.com/advisories/" + id, severity: sev,
                          title: (v.Title || v.VulnerabilityID) + " [trivy: " + v.VulnerabilityID + " · " + pkg + "@" + v.InstalledVersion + "]" });
    }
    fs.writeFileSync(process.argv[2], JSON.stringify({ vulnerabilities: out }));
  ' "$1" "$2"
}

echo "== devDependencies según trivy, juzgadas por las fichas de npm-audit (S-SAST-1) =="
ESCANEADAS=0
for app in $APPS; do
  LOCK="${app}/package-lock.json"
  [ -f "$LOCK" ] || { echo "  · ${app}: sin package-lock.json, se omite."; continue; }
  ESCANEADAS=$((ESCANEADAS+1))
  # (a) CON devDependencies  (b) SIN (runtime) — la resta la hace el trinquete.
  trivy fs --scanners vuln --config "${SEC_DIR}/trivy.yaml" --ignorefile "${SEC_DIR}/.trivyignore" \
    --severity HIGH,CRITICAL --ignore-unfixed=false --include-dev-deps \
    --format json --exit-code 0 --no-progress --output "${WORK}/${app}.dev.trivy.json" "$LOCK" \
    || { echo "::error::trivy falló escaneando ${LOCK} (con devDeps). Sin medición no hay verde: ROJO."; exit 1; }
  trivy fs --scanners vuln --config "${SEC_DIR}/trivy.yaml" --ignorefile "${SEC_DIR}/.trivyignore" \
    --severity HIGH,CRITICAL --ignore-unfixed=false \
    --format json --exit-code 0 --no-progress --output "${WORK}/${app}.prod.trivy.json" "$LOCK" \
    || { echo "::error::trivy falló escaneando ${LOCK} (runtime). ROJO."; exit 1; }
  convertir "${WORK}/${app}.dev.trivy.json"  "${WORK}/${app}.dev.json"
  convertir "${WORK}/${app}.prod.trivy.json" "${WORK}/${app}.prod.json"
  echo "  · ${app}: $(node -e 'const j=require(process.argv[1]);console.log(Object.keys(j.vulnerabilities).length)' "${WORK}/${app}.dev.json") paquete(s) alto/crítico con devDeps, $(node -e 'const j=require(process.argv[1]);console.log(Object.keys(j.vulnerabilities).length)' "${WORK}/${app}.prod.json") en runtime"
done
[ "$ESCANEADAS" -gt 0 ] || { echo "::error::no se escaneó ningún lockfile (${APPS}). NO concluyente: ROJO."; exit 1; }

echo
echo "→ Mismo trinquete, mismas fichas, mismas fechas (audit-npm-dev.sh sobre los hallazgos de trivy):"
AUDIT_DEV_APPS="$APPS" AUDIT_DEV_FIXTURES="$WORK" "$RATCHET"

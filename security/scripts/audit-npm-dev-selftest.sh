#!/usr/bin/env bash
#
# audit-npm-dev-selftest.sh — «¿el trinquete de devDependencies muerde?» · devops
# =============================================================================
# Mismo principio que el self-test de `trivy-fs` (§47) y el canario de P-WH-1:
# el trinquete de P-DEP-1 nace para sustituir a un paso `continue-on-error` que
# no podía ponerse rojo. Sería ridículo sustituirlo por otro que tampoco puede.
# Aquí se le dan audits SINTÉTICOS (fixtures) y se comprueba, caso por caso, que
# el color sale donde debe.
#
# Uso:  ./security/scripts/audit-npm-dev-selftest.sh
# Sale 0 si los 6 casos salen como deben. Sin red, sin npm install. ~1 s.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RATCHET="$SCRIPT_DIR/audit-npm-dev.sh"
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; FALLOS=$((FALLOS+1)); }

printf '\n\033[1m== ¿El trinquete de devDependencies (P-DEP-1) muerde? ==\033[0m\n\n'
[ -x "$RATCHET" ] || { bad "No existe/ejecuta $RATCHET"; exit 1; }

BASE="$(mktemp -d -t pdep1-selftest-XXXXXX)"
trap 'rm -rf "$BASE"' EXIT

# fixture <fichero> <GHSA:sev:pkg> …
fixture() {
  local out="$1"; shift
  local entradas=""
  for spec in "$@"; do
    IFS=: read -r id sev pkg <<< "$spec"
    entradas="${entradas}\"${pkg}\":{\"severity\":\"${sev}\",\"via\":[{\"url\":\"https://github.com/advisories/${id}\",\"severity\":\"${sev}\",\"title\":\"sintético ${id}\"}]},"
  done
  printf '{"vulnerabilities":{%s}}' "${entradas%,}" > "$out"
}

# caso <ROJO|VERDE> <nombre> <hoy> <fichas> <dev-specs…>  (usa app única "frontend")
caso() {
  local esperado="$1" nombre="$2" hoy="$3" fichas="$4"; shift 4
  local dir="$BASE/c$((PASADAS+FALLOS+1))"; mkdir -p "$dir"
  fixture "$dir/frontend.dev.json" "$@"
  printf '{"vulnerabilities":{}}' > "$dir/frontend.prod.json"
  local salida rc
  salida="$(AUDIT_DEV_APPS=frontend AUDIT_DEV_FIXTURES="$dir" AUDIT_DEV_HOY="$hoy" \
            AUDIT_DEV_FICHAS="$fichas" "$RATCHET" 2>&1)"; rc=$?
  if [ "$esperado" = ROJO ] && [ "$rc" -eq 0 ]; then bad "$nombre — quedó VERDE (rc=0)"; return; fi
  if [ "$esperado" = VERDE ] && [ "$rc" -ne 0 ]; then
    bad "$nombre — quedó ROJO (rc=$rc)"; printf '      %s\n' "$(grep -E '·|error' <<< "$salida" | head -3)"; return
  fi
  ok "$nombre — $esperado"
}

T=$'\t'
FICHAS_OK="$BASE/fichas-ok.tsv"
printf '# comentario\nGHSA-AAAA%sfrontend%svitest%sfrontend%s2026-10-10%smotivo medido\n' "$T" "$T" "$T" "$T" "$T" > "$FICHAS_OK"

caso VERDE "Hallazgo fichado y en fecha"             2026-09-10 "$FICHAS_OK" "GHSA-AAAA:critical:vitest"
caso ROJO  "Hallazgo NUEVO sin ficha"                2026-09-10 "$FICHAS_OK" "GHSA-AAAA:critical:vitest" "GHSA-NUEVO:critical:otro"
caso ROJO  "Ficha CADUCADA (solo pasó el tiempo)"    2026-10-11 "$FICHAS_OK" "GHSA-AAAA:critical:vitest"
caso VERDE "Ficha obsoleta: avisa, no castiga"       2026-09-10 "$FICHAS_OK"
caso VERDE "Moderadas: no entran al trinquete"       2026-09-10 "$FICHAS_OK" "GHSA-AAAA:critical:vitest" "GHSA-MOD:moderate:algo"

# Sin tabla de fichas, las excepciones vuelven a ser invisibles: eso es rojo.
dir="$BASE/sin-fichas"; mkdir -p "$dir"
fixture "$dir/frontend.dev.json" "GHSA-AAAA:critical:vitest"
printf '{"vulnerabilities":{}}' > "$dir/frontend.prod.json"
if AUDIT_DEV_APPS=frontend AUDIT_DEV_FIXTURES="$dir" AUDIT_DEV_HOY=2026-09-10 \
   AUDIT_DEV_FICHAS="$BASE/no-existe.tsv" "$RATCHET" >/dev/null 2>&1; then
  bad "Tabla de fichas BORRADA — quedó verde (así desaparece un registro sin que nadie lo note)"
else
  ok "Tabla de fichas BORRADA — ROJO"
fi

TOTAL=$((PASADAS+FALLOS))
printf '\n'
if [ "$FALLOS" -gt 0 ]; then
  printf '\033[1;31m✗ %s/%s — el trinquete no muerde como dice.\033[0m\n\n' "$PASADAS" "$TOTAL"; exit 1
fi
printf '\033[1;32m✓ %s/%s — el trinquete se pone rojo ante un hallazgo nuevo, ante una ficha caducada y ante la pérdida del registro.\033[0m\n\n' "$PASADAS" "$TOTAL"
exit 0

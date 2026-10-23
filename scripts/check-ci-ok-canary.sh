#!/usr/bin/env bash
#
# check-ci-ok-canary.sh — «¿ci-ok pone ROJO a un job fuera de OPCIONALES que no
# terminó en success?» · devops (techlead N3, 2026-09-11)
# =============================================================================
# Ejercita scripts/check-ci-ok.sh con NEEDS_JSON fabricados y ci.yml de juguete.
#   1. todo success                                  → 0
#   2. opcional (backend) skipped                    → 0
#   3. opcional (backend) failure                    → 1
#   4. gate declarado (dast-gate-live) skipped       → 1 (¡el default invertido!)
#   5. job DESCONOCIDO (sin bloque, sin lista) skipped → 1
#   6. job desconocido success                       → 0
#   7. gate cancelled                                → 1
#   7b. QA-REL-2: backend/frontend DETECTADO y cancelled → 1; NO detectado y
#       skipped → 0; detectado y skipped → 1; no detectado y cancelled → 1;
#       format-mix cancelled → 1, skipped con base → 1, skipped sin base → 0
#   8. estática: ci.yml real                         → 0
#   9. estática: ci.yml con un job nuevo FUERA del needs de ci-ok → 1
#  10. estática: sin NEEDS_JSON                      → 2
# Uso: ./scripts/check-ci-ok-canary.sh
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE="$ROOT_DIR/scripts/check-ci-ok.sh"; CI="$ROOT_DIR/.github/workflows/ci.yml"
[ -x "$GATE" ] && [ -f "$CI" ] || { echo "✗ falta $GATE o $CI"; exit 1; }
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }
printf '\n\033[1m== ¿ci-ok exige success a todo lo que no sea OPCIONAL declarado? ==\033[0m\n\n'
TMP="$(mktemp -d -t ci-ok-canario-XXXXXX)"; trap 'rm -rf "$TMP"' EXIT

# needs reales de ci-ok, todos en success, como base de cada caso
NEEDS="$(awk '/^  ci-ok:/{f=1} f&&/^ *needs:/{print; exit}' "$CI" | sed -E 's/.*\[(.*)\].*/\1/; s/,/ /g')"
base_json() { local j="{"; for n in $NEEDS; do j="$j\"$n\":{\"result\":\"success\"},"; done; printf '%s}' "${j%,}"; }
con() { jq -c --arg k "$1" --arg v "$2" '.[$k] = {"result": $v}' <<<"$(base_json)"; }
# caso <rc> <nombre> <json> [ci-yml]
caso() { local rc; NEEDS_JSON="$3" "$GATE" ${4:+--ci-yml "$4"} >/dev/null 2>&1; rc=$?; [ "$rc" -eq "$1" ] && ok "$2 — rc=$rc" || bad "$2 — rc=$rc, esperaba $1"; }

caso 0 "todo success" "$(base_json)"
caso 0 "opcional backend skipped" "$(con backend skipped)"
caso 1 "opcional backend failure" "$(con backend failure)"
caso 1 "gate dast-gate-live skipped (default invertido)" "$(con dast-gate-live skipped)"
caso 1 "job DESCONOCIDO skipped (sin bloque, sin lista)" "$(con job-nuevo-sin-bloque skipped)"
caso 0 "job desconocido success" "$(con job-nuevo-sin-bloque success)"
caso 1 "gate provenance-gate cancelled" "$(con provenance-gate cancelled)"
# QA-REL-2: opcionales con los outputs del detector (como los da toJSON(needs) en CI)
det() { jq -c --arg k "$1" --arg v "$2" --arg b "$3" --arg f "$4" '.[$k] = {"result": $v} | .detect = {"result":"success","outputs":{"backend":$b,"frontend":$f}}' <<<"$(base_json)"; }
caso 1 "QA-REL-2: frontend DETECTADO y cancelled" "$(det frontend cancelled true true)"
caso 1 "QA-REL-2: backend DETECTADO y cancelled" "$(det backend cancelled true true)"
caso 0 "QA-REL-2: frontend NO detectado y skipped" "$(det frontend skipped true false)"
caso 1 "QA-REL-2: backend DETECTADO y skipped" "$(det backend skipped true true)"
caso 1 "QA-REL-2: frontend NO detectado pero cancelled" "$(det frontend cancelled true false)"
fm() { jq -c --arg v "$1" --arg r "$2" '.["format-mix"] = {"result": $v} | .["format-mix-base"] = {"result":"success","outputs":{"ref":$r}}' <<<"$(base_json)"; }
caso 1 "QA-REL-2: format-mix cancelled (sin base)" "$(fm cancelled '')"
caso 1 "QA-REL-2: format-mix skipped CON base" "$(fm skipped abc123)"
caso 0 "QA-REL-2: format-mix skipped sin base" "$(fm skipped '')"
"$GATE" --static >/dev/null 2>&1; rc=$?; [ "$rc" -eq 0 ] && ok "estática sobre el ci.yml real — rc=0" || bad "estática sobre el ci.yml real — rc=$rc"
# job nuevo fuera del needs
{ cat "$CI"; printf '\n  job-nuevo-fuera-de-needs:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n'; } > "$TMP/ci-extra.yml"
"$GATE" --static --ci-yml "$TMP/ci-extra.yml" >/dev/null 2>&1; rc=$?; [ "$rc" -eq 1 ] && ok "estática: job nuevo FUERA del needs de ci-ok ⇒ rc=1" || bad "estática: job fuera del needs ⇒ rc=$rc, esperaba 1"
NEEDS_JSON='' "$GATE" >/dev/null 2>&1; rc=$?; [ "$rc" -eq 2 ] && ok "sin NEEDS_JSON ⇒ rc=2 (no concluyente)" || bad "sin NEEDS_JSON ⇒ rc=$rc, esperaba 2"

TOTAL=$((PASADAS+FALLOS)); echo
[ "$FALLOS" -eq 0 ] && { printf '\033[1;32m✓ Canario ci-ok: %s/%s — skipped fuera de OPCIONALES es rojo.\033[0m\n' "$PASADAS" "$TOTAL"; exit 0; }
printf '\033[1;31m✗ Canario ci-ok: %s/%s.\033[0m\n' "$PASADAS" "$TOTAL"; exit 1

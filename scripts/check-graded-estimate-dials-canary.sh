#!/usr/bin/env bash
# =============================================================================
# check-graded-estimate-dials-canary.sh — candado + canario del comparador de diales
# del gancho PSA tras §DYN (v1.113⟨portada⟩, 2026-10-29) · devops
# -----------------------------------------------------------------------------
# §DYN retiró el dial por corrida `ingestMaxCardsPerRun` (API_CONTRACT §DYN.3, I-5): sale
# de toda salida de M2. El comparador lo exigía y lo traducía a créditos/día, así que
# contra el backend nuevo habría salido rc=2 «clave ausente» en cada post-deploy, y con un
# binario viejo habría seguido hablando de un tope que ya no gobierna el gasto. Ahora lee
# `gradedEstimateDailyCreditCap` (M10) y el panel de presupuesto (§DYN.4.6).
#
# Este candado corre el `check-graded-estimate-dials.sh` REAL contra una API de maqueta
# (`scripts/stack-test/fake-admin-api.py`, :39990, solo 127.0.0.1) con las formas del
# contrato. Escenarios y rc esperados:
#   A. binario §DYN, tope 3000, cuota 20000, diales al día      ⇒ 0, «3000 créditos/día»
#   B. el DTO de M2 aún trae `ingestMaxCardsPerRun`            ⇒ 2
#   C. `providerDailyQuota: null` (falta la env)               ⇒ 10, nombra la variable
#   D. tope 25000 > cuota 20000                                 ⇒ 20
#   E. M10 sin `gradedEstimateDailyCreditCap`                   ⇒ 2
#   F. panel y M10 discrepan en el tope                         ⇒ 2
#   G. estático: `post-deploy.sh` no vuelve a «traducir ingestMaxCardsPerRun».
#
# Uso:  ./scripts/check-graded-estimate-dials-canary.sh            # candado
#       ./scripts/check-graded-estimate-dials-canary.sh --canary   # mutaciones ⇒ todas ROJAS
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d -t dials-XXXXXX)"
PORT=39990; SRV=""
limpiar() { [ -z "$SRV" ] || kill "$SRV" 2>/dev/null; rm -rf "$TMP"; }
trap limpiar EXIT
command -v jq >/dev/null || { echo "::error::falta jq (el comparador lo exige)"; exit 2; }
if curl -s -m 2 -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then echo "::error:::$PORT ocupado (NO concluyente)"; exit 2; fi
FIX="$TMP/fix"; mkdir -p "$FIX"
python3 -I "$ROOT_DIR/scripts/stack-test/fake-admin-api.py" "$PORT" "$FIX" >/dev/null 2>&1 & SRV=$!
for _ in $(seq 1 50); do curl -s -m 1 -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null && break; sleep 0.2; done

escenario() {  # $1 settings  $2 m2  $3 budget
  printf '%s' "$1" > "$FIX/settings.json"; printf '%s' "$2" > "$FIX/m2.json"; printf '%s' "$3" > "$FIX/budget.json"
}
SET_OK='{"gradingHookEnabled":"off","gradedEstimateDailyCreditCap":3000}'
M2_OK='{"enabled":false,"manualFreshnessDays":30,"minSampleCount":5,"maxRawMultiple":100}'
BUD() { printf '{"hookEnabled":false,"dailyCreditCap":%s,"creditsToday":0,"creditsLast7Days":0,"creditsTodayAllMeasured":true,"providerDailyQuota":%s,"providerDailyRemaining":null,"publishedCards":120,"cardsScannedLast7Days":0,"cardsUnmapped":3,"weeklyCreditsNeeded":9000,"cycleDays":3,"capToCoverWeek":1300}' "$1" "$2"; }

correr() {  # $1 script ; RC y OUT
  OUT="$(ADMIN_BASE_URL="http://127.0.0.1:$PORT/api/v1" ADMIN_JWT="token-de-maqueta" timeout 60 bash "$1" 2>&1)"; RC=$?
}

comprobar() {  # $1 check-graded-estimate-dials.sh  $2 post-deploy.sh
  local fallos=0
  ok() { echo "  ✔ $*"; }
  ko() { echo "  ✗ $*"; fallos=$((fallos+1)); }
  esperar() {  # $1 rc esperado  $2 texto que debe salir  $3 nombre
    if [ "$RC" = "$1" ] && printf '%s' "$OUT" | grep -qF -- "$2"; then ok "$3 ⇒ rc=$RC"
    else ko "$3 ⇒ rc=$RC (esperado $1 con «$2») — $(printf '%s' "$OUT" | grep -E '✖|⚠' | head -n 2 | tr '\n' ' ')"; fi
  }
  escenario "$SET_OK" "$M2_OK" "$(BUD 3000 20000)"; correr "$1"
  esperar 0 "3000 créditos/día" "A. binario §DYN, tope 3000, cuota 20000"
  escenario "$SET_OK" '{"enabled":false,"manualFreshnessDays":30,"minSampleCount":5,"maxRawMultiple":100,"ingestMaxCardsPerRun":250}' "$(BUD 3000 20000)"; correr "$1"
  esperar 2 "ingestMaxCardsPerRun" "B. el DTO de M2 aún trae el dial retirado"
  escenario "$SET_OK" "$M2_OK" "$(BUD 3000 null)"; correr "$1"
  esperar 10 "POKEMONPRICETRACKER_DAILY_QUOTA" "C. falta la cuota del proveedor"
  escenario '{"gradingHookEnabled":"off","gradedEstimateDailyCreditCap":25000}' "$M2_OK" "$(BUD 25000 20000)"; correr "$1"
  esperar 20 "MAYOR que la cuota" "D. tope por encima de la cuota"
  escenario '{"gradingHookEnabled":"off"}' "$M2_OK" "$(BUD 3000 20000)"; correr "$1"
  esperar 2 "gradedEstimateDailyCreditCap" "E. M10 sin el tope"
  escenario "$SET_OK" "$M2_OK" "$(BUD 2000 20000)"; correr "$1"
  esperar 2 "INCOHERENCIA" "F. panel y M10 discrepan"
  if grep -n 'ingestMaxCardsPerRun' "$2" | grep -vq 'retir'; then ko "G. post-deploy.sh vuelve a usar ingestMaxCardsPerRun como dial vigente"
  else ok "G. post-deploy.sh solo nombra ingestMaxCardsPerRun como retirado"; fi
  [ "$fallos" = 0 ]
}

SRC="$ROOT_DIR/scripts/check-graded-estimate-dials.sh"; PD="$ROOT_DIR/scripts/post-deploy.sh"
if [ "${1:-}" != "--canary" ]; then
  echo "== Comparador de diales del gancho PSA tras §DYN (API de maqueta) =="
  comprobar "$SRC" "$PD" && { echo "✓ OK"; exit 0; }
  echo "✗ ROJO"; exit 1
fi
echo "== Canario de check-graded-estimate-dials =="
comprobar "$SRC" "$PD" >/dev/null 2>&1 || { echo "✗ el original ya está rojo: el canario no concluye"; exit 2; }
muerde=0; total=0
mutar() {  # $1 nombre  $2 fichero (dials|pd)  $3 sed
  total=$((total+1)); local src m s="$SRC" p="$PD"
  if [ "$2" = dials ]; then src="$SRC"; else src="$PD"; fi
  m="$TMP/m$total"; sed "$3" "$src" > "$m"
  if cmp -s "$m" "$src"; then echo "  ✗ mutación '$1' no cambió nada (canario ciego)"; return; fi
  if [ "$2" = dials ]; then s="$m"; else p="$m"; fi
  if comprobar "$s" "$p" >/dev/null 2>&1; then echo "  ✗ '$1' ⇒ VERDE (el candado NO muerde)"
  else echo "  ✔ '$1' ⇒ ROJO"; muerde=$((muerde+1)); fi
}
mutar "tolera el dial retirado"        dials 's|^if \[ "\$(field "\$OUT" ingestMaxCardsPerRun)" != "__ABSENT__" \]; then$|if false; then|'
mutar "cuota null no cuenta"           dials 's|^  null[|]__ABSENT__)$|  nunca)|'
mutar "no compara tope y cuota"        dials 's|"\$CAP" -gt "\$QUOTA"|"$CAP" -gt 999999999|'
mutar "no exige el tope de M10"        dials 's|^if ! printf .%s. "\$CAP" [|] grep -Eq .\^\[0-9\]+\$.; then$|if false; then|'
mutar "no cruza panel y M10"           dials 's|^elif \[ "\$B_CAP" != "\$CAP" \]; then$|elif false; then|'
mutar "post-deploy vuelve a traducir"  pd    's|^#   (`gradingHookEnabled`) y, desde v1.113.*|#   (`gradingHookEnabled`) y traduce `ingestMaxCardsPerRun` a créditos/día.|'
echo "Canario: $muerde/$total mutaciones salen ROJAS."
[ "$muerde" = "$total" ]

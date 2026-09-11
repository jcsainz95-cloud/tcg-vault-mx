#!/usr/bin/env bash
#
# check-ci-ok.sh — el veredicto de `ci-ok`: TODO exige `success` salvo una lista
# DECLARADA de opcionales · devops
# =============================================================================
# DE DÓNDE VIENE (techlead N3, 2026-09-11)
# ---------------------------------------------------------------------------
# `ci-ok` tenía ocho bloques `if [ "${{ needs.X.result }}" != "success" ]`
# copiados a mano, con dos criterios distintos (`= "failure"` para los
# opcionales, `!= "success"` para los gates). El default era el PELIGROSO: un
# gate nuevo añadido a `needs:` SIN su bloque quedaba skipped = verde — que es
# exactamente la forma en que un gate deja de gatear sin avisar.
#
# Aquí el default está INVERTIDO: todo job de `needs` exige `success`, y solo
# los que están en OPCIONALES (declarados abajo, con motivo) pueden estar
# `skipped` sin poner rojo (nunca `failure`). Un job nuevo en `needs` sin
# entrada aquí ⇒ exige success ⇒ si se salta, rojo.
#
# Además comprueba ESTÁTICAMENTE (lee ci.yml, sin red) que:
#   · todo job de ci.yml salvo `ci-ok` está en el `needs:` de `ci-ok` (un gate
#     que no está en needs no se evalúa aquí: no gatea);
#   · toda entrada de OPCIONALES es un job real de ci.yml (lista no desfasada).
#
# Uso (en CI):  NEEDS_JSON='${{ toJSON(needs) }}' ./scripts/check-ci-ok.sh
#      local:   ./scripts/check-ci-ok.sh --static            (solo la parte estática)
#               NEEDS_JSON='{…}' ./scripts/check-ci-ok.sh [--ci-yml RUTA]
# rc: 0 verde · 1 rojo (algún job no cumple, o la estática falla) · 2 no concluyente
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR" || exit 2

# -----------------------------------------------------------------------------
# OPCIONALES: pueden estar `skipped` (greenfield / sin base). `failure` sigue
# siendo rojo. Cualquier otro job de `needs` exige `success`.
# -----------------------------------------------------------------------------
declare -A OPCIONALES=(
  [backend]="puede no existir en greenfield (detect lo salta)"
  [frontend]="puede no existir en greenfield (detect lo salta)"
  [format-mix-base]="resuelve la base; si no la hay lo dice con ::warning"
  [format-mix]="skipped = sin base utilizable (NO medido, no verde; ya lo dice format-mix-base)"
)
# Punteros por job para que el rojo diga dónde mirar (opcional; hay mensaje genérico).
declare -A PUNTERO=(
  [provenance-gate]="si el comprobador de SEC-OPS-1 deja de estar cableado, el resto de gates no significan lo que dicen. DEVOPS_NOTES §38"
  [e2e-provider-guard]="guarda del proveedor de paga (§4.38r.6.1). DEVOPS_NOTES §32.12"
  [e2e-harness-gaps]="guarda de huecos del arnés E2E. DEVOPS_NOTES §39"
  [price-provider-interim-expiry]="la medida interina D-PP-2 caducó y sigue cableada. DEVOPS_NOTES §43.2"
  [dast-report-only-expiry]="report_only del DAST de release caducado o su disparador no corrió. Dueño: seguridad (decisión) / devops (cableado). DEVOPS_NOTES §56.9"
  [dast-gate-live]="el candado del DAST no está vivo. DEVOPS_NOTES §44"
  [daemon-stdout-leak]="un script deja un daemon con el stdout del invocador (\`| tail\` se cuelga). DEVOPS_NOTES §46.2"
  [parity-gate-canary]="el candado de paridad I-PP5 no está vivo. DEVOPS_NOTES §48.1"
  [stripe-webhook-failclosed]="la firma del webhook de Stripe puede verificarse con una clave conocida (P-WH-1). DEVOPS_NOTES §49"
  [workflow-cwd]="un script invocado desde un paso de CI no existe bajo su cwd (rc=127 silencioso). DEVOPS_NOTES §52"
  [e2e-skip-census]="el censo de salvaguardas E2E (mockOnly/needsSeed/…) creció sin nota. DEVOPS_NOTES §56.9 (N7)"
)

CI_YML=".github/workflows/ci.yml"; SOLO_ESTATICO=0
while [ $# -gt 0 ]; do
  case "$1" in
    --static) SOLO_ESTATICO=1; shift ;;
    --ci-yml) CI_YML="$2"; shift 2 ;;
    *) echo "::error::argumento desconocido: $1"; exit 2 ;;
  esac
done
FALLOS=0
ok()  { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
bad() { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; FALLOS=$((FALLOS+1)); }

# --- Estática: needs de ci-ok cubre todos los jobs; OPCIONALES no desfasada ----
printf '\n\033[1m== ci-ok: todo exige success salvo OPCIONALES declarados ==\033[0m\n\n'
[ -f "$CI_YML" ] || { echo "::error::no existe $CI_YML. NO concluyente."; exit 2; }
mapfile -t JOBS < <(awk '/^jobs:/{f=1;next} f&&/^  [a-z][a-z0-9-]*:$/{sub(/^  /,"");sub(/:$/,"");print}' "$CI_YML")
[ "${#JOBS[@]}" -gt 1 ] || { echo "::error::no encuentro jobs en $CI_YML. NO concluyente."; exit 2; }
BLOQUE="$(awk '/^  ci-ok:/{f=1} f&&/^  [a-z][a-z0-9-]*:$/&&!/^  ci-ok:/{f=0} f' "$CI_YML")"
NEEDS_LINE="$(grep -E '^\s*needs:\s*\[' <<<"$BLOQUE" | head -1)"
[ -n "$NEEDS_LINE" ] || { echo "::error::ci-ok no declara \`needs: [...]\` en una línea. NO concluyente."; exit 2; }
NEEDS_STATIC="$(sed -E 's/.*\[(.*)\].*/\1/; s/,/ /g' <<<"$NEEDS_LINE")"
en_needs() { for n in $NEEDS_STATIC; do [ "$n" = "$1" ] && return 0; done; return 1; }
for j in "${JOBS[@]}"; do
  [ "$j" = "ci-ok" ] && continue
  if en_needs "$j"; then ok "job \`$j\` está en el needs de ci-ok"; else bad "job \`$j\` NO está en el needs de ci-ok: no se evalúa aquí ⇒ no gatea. Añádelo a needs (exigirá success salvo que lo declares OPCIONAL con motivo)."; fi
done
for o in "${!OPCIONALES[@]}"; do
  printf '%s\n' "${JOBS[@]}" | grep -qx "$o" || bad "OPCIONALES lleva \`$o\`, que ya no es un job de $CI_YML: lista desfasada."
done
if [ "$SOLO_ESTATICO" -eq 1 ]; then
  [ "$FALLOS" -eq 0 ] && { echo; ok "estática OK (${#JOBS[@]} jobs, $(wc -w <<<"$NEEDS_STATIC") en needs, ${#OPCIONALES[@]} opcionales)"; exit 0; }
  echo "::error::la estática de ci-ok falló ($FALLOS)."; exit 1
fi

# --- Dinámica: resultados reales de `needs` ----------------------------------
[ -n "${NEEDS_JSON:-}" ] || { echo "::error::falta NEEDS_JSON (\${{ toJSON(needs) }}). NO concluyente."; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "::error::sin jq no puedo leer NEEDS_JSON. NO concluyente."; exit 2; }
mapfile -t FILAS < <(jq -r 'to_entries[] | "\(.key)\t\(.value.result // "?")"' <<<"$NEEDS_JSON" 2>/dev/null)
[ "${#FILAS[@]}" -gt 0 ] || { echo "::error::NEEDS_JSON no parsea o está vacío. NO concluyente."; exit 2; }
echo
for fila in "${FILAS[@]}"; do
  job="${fila%%$'\t'*}"; res="${fila#*$'\t'}"
  if [ -n "${OPCIONALES[$job]+x}" ]; then
    case "$res" in
      success) ok "$job: success" ;;
      failure) bad "$job: failure (opcional: puede saltarse, no fallar)." ;;
      *)       printf '  \033[2m·\033[0m %s: %s (opcional: %s)\n' "$job" "$res" "${OPCIONALES[$job]}" ;;
    esac
  else
    if [ "$res" = "success" ]; then ok "$job: success"
    else bad "$job: $res — exige success (\`skipped\` NO es verde). ${PUNTERO[$job]:-Job no declarado como OPCIONAL: si puede saltarse legítimamente, decláralo en scripts/check-ci-ok.sh con motivo. Dueño: devops.}"; fi
  fi
done
echo
if [ "$FALLOS" -ne 0 ]; then
  echo "::error title=ci-ok::$FALLOS job(s) no cumplen. Todo exige success salvo OPCIONALES (scripts/check-ci-ok.sh)."; exit 1
fi
echo "CI OK (los opcionales saltados son esperados mientras no exista el código / no haya base)."
exit 0

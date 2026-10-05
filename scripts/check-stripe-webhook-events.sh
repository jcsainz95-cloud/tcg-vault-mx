#!/usr/bin/env bash
#
# check-stripe-webhook-events.sh — «el backend no maneja un evento al que nadie suscribio el endpoint» · devops
# =============================================================================
# POR QUE EXISTE (medido 2026-09-29, §M4-SHIP)
# ---------------------------------------------------------------------------
# Los eventos del webhook de Stripe se suscriben A MANO en el dashboard (DEVOPS_NOTES §11.G):
# ningun script ni workflow los registra (`grep enabled_events|stripe listen|webhook_endpoints`
# en scripts/ y .github/ => 0). Un evento nuevo en el backend (`charge.refund.updated`) que nadie
# anade al endpoint pasa todos los gates y en produccion no llega jamas: las filas del libro de
# reembolsos se quedan en `submitted` para siempre. Este candado obliga a que la lista de
# suscripcion (security/stripe-webhook-events.txt) y el paso del dueno (§11.G) crezcan CON el backend.
#
# QUE COMPRUEBA (rc=1 con el evento exacto; rc=0 si todo cuadra)
#   A. todo `case '<evento Stripe>':` de backend/src/**/*.ts (sin specs) esta en el manifiesto;
#   B. todo evento del manifiesto aparece en la seccion §11.G de docs/DEVOPS_NOTES.md.
#   (El sentido inverso —manifiesto con un evento que el backend aun no maneja— solo avisa:
#    es el orden natural cuando devops se adelanta a backend.)
# Uso:  ./scripts/check-stripe-webhook-events.sh [RAIZ]    (RAIZ = arbol a medir; por defecto el repo)
# Barato: sin red ni Docker.
# =============================================================================
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
MANIFEST="$ROOT/security/stripe-webhook-events.txt"
NOTES="$ROOT/docs/DEVOPS_NOTES.md"
[ -f "$MANIFEST" ] || { echo "::error::falta security/stripe-webhook-events.txt"; exit 1; }
[ -f "$NOTES" ] || { echo "::error::falta docs/DEVOPS_NOTES.md"; exit 1; }
[ -d "$ROOT/backend/src" ] || { echo "::error::falta backend/src"; exit 1; }

PREFIJOS='(payment_intent|charge|refund|checkout|customer|invoice|payout|setup_intent|payment_method)'
manifest="$(grep -vE '^\s*(#|$)' "$MANIFEST" | tr -d ' \r' | sort -u)"
backend="$(grep -rhoE --include='*.ts' --exclude='*.spec.ts' --exclude='*.e2e-spec.ts' \
            "case '${PREFIJOS}\.[a-z_.]+'" "$ROOT/backend/src" | sed -E "s/case '(.*)'/\1/" | sort -u)"
seccion="$(awk '/^### 11\.G/{f=1;next} /^### 11\.H/{f=0} f' "$NOTES")"

rc=0
# Sin `printf … | grep -q` bajo pipefail: grep -q sale al primer acierto, printf (búfer por línea)
# muere por SIGPIPE (141) y pipefail lo convierte en «no encontrado» ⇒ falso rojo bajo carga
# (medido 2/2000 con load≈6–8; QA: canario 1/4 rojo con load≈10–13). Here-strings. DEVOPS_NOTES §84.
[ -n "$backend" ] || { echo "::error::no encontre ningun evento en backend/src: el extractor no lee nada (un candado que no lee no protege)."; exit 1; }
while IFS= read -r ev; do
  [ -n "$ev" ] || continue
  if ! grep -qxF "$ev" <<<"$manifest"; then
    echo "::error::el backend maneja '$ev' pero security/stripe-webhook-events.txt no lo lista: nadie suscribio el endpoint a ese evento."; rc=1
  fi
done <<<"$backend"
while IFS= read -r ev; do
  [ -n "$ev" ] || continue
  if ! grep -qF "\`$ev\`" <<<"$seccion"; then
    echo "::error::'$ev' esta en el manifiesto pero no en la lista de DEVOPS_NOTES §11.G (el paso del dueno en el dashboard)."; rc=1
  fi
  grep -qxF "$ev" <<<"$backend" || echo "::notice::'$ev' esta suscrito en el manifiesto pero el backend aun no lo maneja (esperado si backend no ha aterrizado)."
done <<<"$manifest"
[ "$rc" -eq 0 ] && echo "OK: $(printf '%s\n' "$backend" | grep -c .) evento(s) del backend cubiertos por el manifiesto y por §11.G."
exit "$rc"

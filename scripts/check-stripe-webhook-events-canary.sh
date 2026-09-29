#!/usr/bin/env bash
# check-stripe-webhook-events-canary.sh — «¿el candado de eventos del webhook MUERDE?» · devops
# Ejercita scripts/check-stripe-webhook-events.sh sobre una COPIA del arbol (nunca el vivo):
#   verde: copia intacta; verde: manifiesto con evento que el backend aun no maneja (solo aviso);
#   ROJO : backend maneja un evento nuevo que el manifiesto no lista;
#   ROJO : manifiesto con un evento que §11.G no lista;
#   ROJO : extractor ciego (backend sin ningun case de Stripe).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE="scripts/check-stripe-webhook-events.sh"
F=0; ok(){ printf '  ok  %s\n' "$*"; }; bad(){ printf '  MAL %s\n' "$*"; F=$((F+1)); }
B="$(mktemp -d -t whevents-canario-XXXXXX)"; trap 'rm -rf "$B"' EXIT
mk() { rm -rf "$B/t"; mkdir -p "$B/t/scripts" "$B/t/security" "$B/t/docs" "$B/t/backend/src/modules/payments"
  cp "$ROOT/$GATE" "$B/t/scripts/"; cp "$ROOT/security/stripe-webhook-events.txt" "$B/t/security/"
  cp "$ROOT/docs/DEVOPS_NOTES.md" "$B/t/docs/"
  # backend sintetico: los eventos del manifiesto MENOS los dos de M4-SHIP (aun no aterrizados)
  { echo "switch (t) {"; grep -vE '^\s*(#|$)' "$ROOT/security/stripe-webhook-events.txt" | grep -vE 'refund\.updated' | sed -E "s/(.*)/case '\1': break;/"; echo "}"; } > "$B/t/backend/src/modules/payments/p.service.ts"; }
run() { (cd "$B/t" && ./$GATE "$B/t" >/dev/null 2>&1); }
mk;  run && ok "intacto ⇒ verde" || bad "intacto debia salir 0"
mk; echo "case 'charge.refund.updated': break;" >> "$B/t/backend/src/modules/payments/p.service.ts"; run && ok "backend maneja evento del manifiesto ⇒ verde" || bad "verde legitimo salio rojo"
mk; echo "case 'charge.expired': break;" >> "$B/t/backend/src/modules/payments/p.service.ts"; run && bad "evento nuevo del backend fuera del manifiesto DEBIA ser rojo" || ok "evento nuevo sin suscribir ⇒ ROJO"
mk; echo "customer.deleted" >> "$B/t/security/stripe-webhook-events.txt"; run && bad "evento del manifiesto fuera de §11.G DEBIA ser rojo" || ok "manifiesto sin §11.G ⇒ ROJO"
mk; sed -i "s/case '/cas3 '/" "$B/t/backend/src/modules/payments/p.service.ts"; run && bad "extractor ciego DEBIA ser rojo" || ok "extractor ciego ⇒ ROJO"
[ "$F" -eq 0 ] && { echo "canario: el candado muerde donde debe"; exit 0; } || { echo "canario: $F fallo(s)"; exit 1; }

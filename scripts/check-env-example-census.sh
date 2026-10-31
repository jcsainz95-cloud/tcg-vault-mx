#!/usr/bin/env bash
# =============================================================================
# check-env-example-census.sh — censo «variable que lee el backend ⇒ línea en .env.example»
# devops · 2026-10-29 (§DYN: `POKEMONPRICETRACKER_DAILY_QUOTA` la leía el código y no
# estaba documentada en ninguna parte; sin ella el panel de presupuesto da `null`).
# -----------------------------------------------------------------------------
# Lee de `backend/src/**/*.ts` (sin pruebas) cada `config.get('X')`, `process.env.X` y
# `process.env['X']`, y exige que X aparezca en `.env.example`. Medido el 2026-10-29 sobre
# fb67d43b: 66 variables leídas, 26 sin documentar. Arreglar las 26 no es de este pase, así
# que el censo es un TRINQUETE: las que faltaban ese día viven en
# `scripts/env-example-census.baseline` y esa lista SOLO PUEDE BAJAR:
#   · una variable nueva sin línea en .env.example            ⇒ ROJO;
#   · una del baseline que ya se documentó                     ⇒ ROJO hasta quitarla del
#     baseline (`--update` la quita; nunca añade);
#   · una del baseline que el código ya no lee                 ⇒ ídem.
# `POKEMONPRICETRACKER_DAILY_QUOTA` y `FEATURED_ROTATION_CRON` (§DYN) salieron del baseline
# el mismo día que entraron en .env.example.
#
# Uso:  ./scripts/check-env-example-census.sh [--root DIR] [--update]
#       ./scripts/check-env-example-census.sh --canary
# rc: 0 verde · 1 rojo · 2 no concluyente
# =============================================================================
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODO=check
case "${1:-}" in --root) ROOT="$(cd "$2" && pwd)"; shift 2 ;; esac
case "${1:-}" in --update) MODO=update ;; --canary) MODO=canary ;; esac

leidas() {  # $1 raíz ⇒ variables leídas por backend/src, una por línea, ordenadas
  grep -rhoE "(config\.get(<[^>]*>)?\(\s*'[A-Z][A-Z0-9_]+'|process\.env\.[A-Z][A-Z0-9_]+|process\.env\[\s*'[A-Z][A-Z0-9_]+')" \
      "$1/backend/src" --include='*.ts' --exclude='*.spec.ts' --exclude='*.test.ts' 2>/dev/null \
    | grep -oE "[A-Z][A-Z0-9_]{2,}" | sort -u
}
documentada() { grep -qE "(^|[^A-Z0-9_])$2([^A-Z0-9_]|$)" "$1/.env.example"; }

censo() {  # $1 raíz ; imprime informe ; rc 0/1/2
  local r="$1" base="$1/scripts/env-example-census.baseline" v fallos=0 n=0
  [ -d "$r/backend/src" ] && [ -f "$r/.env.example" ] || { echo "∅ falta backend/src o .env.example (NO concluyente)"; return 2; }
  [ -f "$base" ] || { echo "∅ falta $base (NO concluyente)"; return 2; }
  local faltan; faltan="$(for v in $(leidas "$r"); do documentada "$r" "$v" || echo "$v"; done)"
  n="$(leidas "$r" | wc -l | tr -d ' ')"
  [ "$n" -gt 10 ] || { echo "∅ solo $n variables leídas: el extractor no está viendo el código (NO concluyente)"; return 2; }
  for v in $faltan; do
    grep -qx "$v" <(grep -vE '^\s*(#|$)' "$base") || { echo "  ✗ $v la lee backend/src y NO está en .env.example"; fallos=$((fallos+1)); }
  done
  for v in $(grep -vE '^\s*(#|$)' "$base"); do
    printf '%s\n' $faltan | grep -qx "$v" || { echo "  ✗ $v sigue en el baseline pero ya no falta (documentada o sin lector): quítala (--update)"; fallos=$((fallos+1)); }
  done
  echo "  · $n variables leídas por backend/src; $(printf '%s\n' $faltan | grep -c .) sin documentar (todas del baseline si está verde)"
  [ "$fallos" = 0 ]
}

case "$MODO" in
  check)
    echo "== Censo de .env.example (trinquete: el baseline solo baja) =="
    censo "$ROOT"; rc=$?
    [ "$rc" = 0 ] && echo "✓ OK" || { [ "$rc" = 1 ] && echo "✗ ROJO"; }
    exit "$rc" ;;
  update)
    base="$ROOT/scripts/env-example-census.baseline"; tmp="$(mktemp)"
    grep -E '^\s*#' "$base" > "$tmp"
    for v in $(grep -vE '^\s*(#|$)' "$base"); do documentada "$ROOT" "$v" || { leidas "$ROOT" | grep -qx "$v" && echo "$v"; }; done >> "$tmp"
    mv "$tmp" "$base"; echo "baseline actualizado (solo se quitaron entradas)."; exit 0 ;;
  canary)
    TMP="$(mktemp -d -t env-census-XXXXXX)"; trap 'rm -rf "$TMP"' EXIT
    mk() { rm -rf "$TMP/t"; mkdir -p "$TMP/t/scripts" "$TMP/t/backend"; cp -r "$ROOT/backend/src" "$TMP/t/backend/src"
           cp "$ROOT/.env.example" "$TMP/t/"; cp "$ROOT/scripts/env-example-census.baseline" "$TMP/t/scripts/"; }
    echo "== Canario del censo de .env.example =="
    mk; censo "$TMP/t" >/dev/null || { echo "✗ el original ya está rojo: el canario no concluye"; exit 2; }
    muerde=0; total=0
    probar() { total=$((total+1)); if censo "$TMP/t" >/dev/null; then echo "  ✗ '$1' ⇒ VERDE (no muerde)"; else echo "  ✔ '$1' ⇒ ROJO"; muerde=$((muerde+1)); fi; }
    mk; sed -i '/^POKEMONPRICETRACKER_DAILY_QUOTA=/d; s/POKEMONPRICETRACKER_DAILY_QUOTA/POKEMON_X/g' "$TMP/t/.env.example"
    probar "quitar POKEMONPRICETRACKER_DAILY_QUOTA de .env.example"
    mk; printf "export const x = process.env.CANARIO_VAR_NUEVA;\n" > "$TMP/t/backend/src/canario-env.ts"
    probar "variable nueva leída sin documentar"
    mk; echo "POKEMONPRICETRACKER_DAILY_QUOTA" >> "$TMP/t/scripts/env-example-census.baseline"
    probar "meter en el baseline una que ya está documentada"
    echo "Canario: $muerde/$total mutaciones salen ROJAS."
    [ "$muerde" = "$total" ] ;;
esac

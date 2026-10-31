#!/usr/bin/env bash
# =============================================================================
# check-image-optimizer-cost-reading-expiry.sh — ⏳ «la lectura de coste del optimizador a 7 días tiene fecha» · devops
# ARCHITECTURE §4.DYN (f) 7 (v1.114.5, residual de PEN-DYN-1), candado `image-optimizer-cost-reading-expiry` (ci.yml).
# -----------------------------------------------------------------------------
# DE DÓNDE VIENE: el arquitecto aceptó el residual de PEN-DYN-1 (scrydex responde 200 genérico a cualquier id con la
# forma, así que `/_next/image` no tiene tope de orígenes distintos) con alerta de gasto, interruptor y una CONDICIÓN:
# dueño devops, lectura de coste de Vercel a los 7 días de publicar, escrita en DEVOPS_NOTES §106.4 con cifras y fecha;
# caduca 2026-12-01. Este candado la cobra: desde 2026-12-01, si §106.4 no trae la línea
#     LECTURA-IMG-7D <AAAA-MM-DD> <transformaciones al día, entero>
# ⇒ ROJO. Y si la lectura trae > 1 000 transformaciones/día, es el disparador de la opción (b) (§4.DYN (f) 7) ⇒ ROJO
# también: un disparador que nadie vigila no dispara nada.
#
# QUÉ MIRA (estático, sin red): solo el bloque **106.4** de docs/DEVOPS_NOTES.md (desde «**106.4» hasta «**106.5»). Una
# línea con el formato fuera de ese bloque no cuenta. Si el bloque no está (renombrado, borrado), NO CONCLUYENTE (rc 2,
# rojo en CI): un candado cuyo operando nadie produce no es un candado.
# Fecha de la lectura válida: 2026-10-30 ≤ fecha ≤ hoy (una lectura «del futuro» no es una lectura).
#
# Uso:  ./scripts/check-image-optimizer-cost-reading-expiry.sh [--today AAAA-MM-DD] [--root DIR]
#       ./scripts/check-image-optimizer-cost-reading-expiry.sh --canary   # casos ⇒ todos como se esperan
# rc: 0 vigente o lectura anotada · 8 la lectura dispara (b) · 9 CADUCÓ sin lectura · 2 no concluyente
# FECHA_LIMITE no se mueve sin pase del arquitecto (§4.DYN (f) 7: «si no se publica antes del 2026-11-24, devops corre
# la fecha con pase del arquitecto»).
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SELF="$ROOT_DIR/scripts/check-image-optimizer-cost-reading-expiry.sh"
FECHA_LIMITE="2026-12-01"   # rojo DESDE este día si no hay lectura
FECHA_MIN="2026-10-30"      # la condición nace con v1.114.5
DISPARADOR_B=1000           # transformaciones/día por encima de las cuales se abre la opción (b)

if [ "${1:-}" = "--canary" ]; then
  echo "== Canario de image-optimizer-cost-reading-expiry =="
  TMP="$(mktemp -d -t img-cost-XXXXXX)"; trap 'rm -rf "$TMP"' EXIT
  ok=0; total=0
  notas() {  # $1 = línea dentro de §106.4 (o vacía) · $2 = línea fuera (o vacía) · $3 = "sin-bloque" para quitar §106.4
    local d="$TMP/c$total"; mkdir -p "$d/docs"
    if [ "${3:-}" = sin-bloque ]; then
      printf '## §106\n\n**106.3 algo.**\n\n%s\n\n**106.5 Candados.**\n' "$1" > "$d/docs/DEVOPS_NOTES.md"
    else
      printf '## §106\n\n**106.4 Coste del optimizador.** LECTURA-IMG-7D <fecha> <transformaciones/día>\n| — | **NO MEDIDO** | | dueño |\n%s\n\n**106.5 Candados.**\n%s\n' "$1" "$2" > "$d/docs/DEVOPS_NOTES.md"
    fi
    printf '%s' "$d"
  }
  caso() {  # $1 nombre · $2 hoy · $3 rc esperado · $4 dentro · $5 fuera · $6 sin-bloque
    total=$((total+1)); local d rc; d="$(notas "${4:-}" "${5:-}" "${6:-}")"
    "$SELF" --root "$d" --today "$2" >/dev/null 2>&1; rc=$?
    if [ "$rc" = "$3" ]; then echo "  ✔ $1 ⇒ rc $rc"; ok=$((ok+1)); else echo "  ✗ $1 ⇒ rc $rc (esperado $3)"; fi
  }
  caso "sin lectura, 2026-11-30 (último día)"            2026-11-30 0
  caso "sin lectura, 2026-12-01 (caducó)"                2026-12-01 9
  caso "sin lectura, 2027-02-01"                         2027-02-01 9
  caso "lectura válida (140/día), 2026-12-15"            2026-12-15 0 "LECTURA-IMG-7D 2026-11-20 140"
  caso "lectura válida antes de caducar, 2026-11-25"     2026-11-25 0 "- LECTURA-IMG-7D 2026-11-24 0"
  caso "lectura con fecha futura, 2026-12-05"            2026-12-05 9 "LECTURA-IMG-7D 2026-12-20 140"
  caso "lectura anterior a la condición, 2026-12-05"     2026-12-05 9 "LECTURA-IMG-7D 2026-10-01 140"
  caso "lectura > 1 000/día (dispara b), 2026-11-10"     2026-11-10 8 "LECTURA-IMG-7D 2026-11-09 1500"
  caso "lectura FUERA de §106.4, 2026-12-05"             2026-12-05 9 "" "LECTURA-IMG-7D 2026-11-20 140"
  caso "lectura sin número, 2026-12-05"                  2026-12-05 9 "LECTURA-IMG-7D 2026-11-20 muchas"
  caso "sin el bloque §106.4, 2026-11-10"                2026-11-10 2 "LECTURA-IMG-7D 2026-11-09 140" "" sin-bloque
  echo "Canario: $ok/$total casos como se esperan."
  [ "$ok" = "$total" ]; exit $?
fi

HOY="$(date -u +%F)"
while [ $# -gt 0 ]; do
  case "$1" in
    --today) HOY="${2:-}"; shift 2 ;;
    --root)  ROOT_DIR="$(cd "${2:-}" && pwd)" || exit 2; shift 2 ;;
    *) echo "::error::argumento desconocido: $1"; exit 2 ;;
  esac
done
[[ "$HOY" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "::error::--today debe ser AAAA-MM-DD (recibí '$HOY')"; exit 2; }
NOTAS="$ROOT_DIR/docs/DEVOPS_NOTES.md"
[ -f "$NOTAS" ] || { echo "::error::no existe $NOTAS (NO concluyente)"; exit 2; }
BLOQUE="$(awk '/^\*\*106\.4[ .]/{d=1} /^\*\*106\.5[ .]/{d=0} d' "$NOTAS")"
[ -n "$BLOQUE" ] || { echo "::error title=image-optimizer-cost-reading-expiry: NO CONCLUYENTE::No encuentro el bloque **106.4 de docs/DEVOPS_NOTES.md (hasta **106.5): el candado no tiene dónde leer. Dueño: devops."; exit 2; }

# Lecturas válidas: «LECTURA-IMG-7D AAAA-MM-DD N» con FECHA_MIN ≤ fecha ≤ hoy. Se queda con la MÁS RECIENTE.
mejor_f=""; mejor_n=""
while read -r f n; do
  [[ "$f" < "$FECHA_MIN" ]] && continue
  [[ "$f" > "$HOY" ]] && continue
  if [ -z "$mejor_f" ] || [[ "$f" > "$mejor_f" ]] || [ "$f" = "$mejor_f" ]; then mejor_f="$f"; mejor_n="$n"; fi
done < <(printf '%s\n' "$BLOQUE" | grep -oE 'LECTURA-IMG-7D [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]+([^0-9.,]|$)' \
          | sed -E 's/^LECTURA-IMG-7D ([0-9-]+) ([0-9]+).*/\1 \2/')

if [ -n "$mejor_f" ]; then
  if [ "$mejor_n" -gt "$DISPARADOR_B" ]; then
    echo "::error title=image-optimizer-cost-reading-expiry: la lectura DISPARA la opción (b)::Lectura del $mejor_f: $mejor_n transformaciones/día (> $DISPARADOR_B). ARCHITECTURE §4.DYN (f) 7: se abre la opción (b) (proxy/loader con lista de ids) o se acciona el interruptor. Dueño: arquitecto (decisión) y frontend (interruptor)."
    exit 8
  fi
  echo "✔ Lectura de coste a 7 días anotada en DEVOPS_NOTES §106.4: $mejor_f, $mejor_n transformaciones/día (≤ $DISPARADOR_B). Condición de PEN-DYN-1 cobrada."
  exit 0
fi
if [[ "$HOY" < "$FECHA_LIMITE" ]]; then
  echo "✔ Sin lectura de coste a 7 días todavía; vigente hasta el día anterior a $FECHA_LIMITE (hoy $HOY). Formato: «LECTURA-IMG-7D <AAAA-MM-DD> <transformaciones/día>» en DEVOPS_NOTES §106.4."
  exit 0
fi
echo "::error title=image-optimizer-cost-reading-expiry: CADUCÓ::Desde $FECHA_LIMITE DEVOPS_NOTES §106.4 tenía que traer la lectura de coste del optimizador a 7 días de publicar («LECTURA-IMG-7D <AAAA-MM-DD> <transformaciones/día>», ARCHITECTURE §4.DYN (f) 7, residual de PEN-DYN-1). Dueño: devops (la lectura la hace el dueño en Vercel, §106.4). Si no se publicó, se corre la fecha con pase del arquitecto."
exit 9

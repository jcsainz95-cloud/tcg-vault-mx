#!/usr/bin/env bash
#
# check-measurement-artifact.sh — C-F1 (API_CONTRACT §MKT.H.11), la mitad de devops        · devops
# =============================================================================
# «Build con `off`: el artefacto (`.next/static` y `.next/server`) no contiene googletagmanager.com,
#  google-analytics.com, connect.facebook.net, fbevents, gtag/js — y el mismo grep sobre un build con
#  `on` da > 0.» (contrato). Un grep del ARTEFACTO es más fuerte que mirar peticiones: lo que no está
#  en el bundle no se ejecuta por ninguna ruta, ni por una que el E2E no recorra (ARCHITECTURE §14.1).
#
# Uso:  ./scripts/check-measurement-artifact.sh <dir-de-build-de-next> <off|on>
#   off ⇒ rc 0 solo si NINGÚN fichero de <dir>/static ni <dir>/server contiene un patrón;
#         rc 1 con la lista de ficheros y patrones.
#   on  ⇒ rc 0 solo si el grep da > 0 (el cargador existe: el grep de `off` sabe ver lo que busca).
#   rc 2  ⇒ no concluyente (falta <dir>/static o <dir>/server: no hubo build que medir).
# Canario: scripts/check-measurement-artifact-canary.sh
# =============================================================================
set -uo pipefail
DIR="${1:-}"; MODO="${2:-}"
[ -n "$DIR" ] && [[ "$MODO" =~ ^(off|on)$ ]] || { echo "uso: $0 <dir-build> <off|on>"; exit 2; }
for sub in static server; do
  [ -d "$DIR/$sub" ] || { echo "::error::C-F1: no existe $DIR/$sub — no hubo build que medir (NO concluyente)."; exit 2; }
done
# Lista ÚNICA de patrones de C-F1 (contrato §MKT.H.11). Cadenas fijas, no regex.
PATRONES=(googletagmanager.com google-analytics.com connect.facebook.net fbevents gtag/js)
TOTAL=0; DETALLE=""
for p in "${PATRONES[@]}"; do
  n="$(grep -rlF -- "$p" "$DIR/static" "$DIR/server" 2>/dev/null | wc -l | tr -d ' ')"
  TOTAL=$((TOTAL+n))
  [ "$n" -gt 0 ] && DETALLE+="  · «$p» en $n fichero(s): $(grep -rlF -- "$p" "$DIR/static" "$DIR/server" 2>/dev/null | head -3 | sed "s#^$DIR/##" | paste -sd, -)"$'\n'
done
if [ "$MODO" = off ]; then
  if [ "$TOTAL" -eq 0 ]; then echo "VERDE C-F1 (off): 0 ficheros de $DIR/{static,server} contienen hosts de medición."; exit 0; fi
  echo "::error::C-F1 (off): el artefacto APAGADO contiene código de medición ($TOTAL coincidencias). Dueño: frontend (el cargador debe importarse solo bajo la constante horneada, ARCHITECTURE §14.1)."
  printf '%s' "$DETALLE"; exit 1
fi
if [ "$TOTAL" -gt 0 ]; then echo "VERDE C-F1 (on): el artefacto ENCENDIDO contiene el cargador ($TOTAL coincidencias) — el grep de off sabe ver lo que busca."; printf '%s' "$DETALLE"; exit 0; fi
echo "::error::C-F1 (on): el build ENCENDIDO no contiene ninguno de los patrones: o el cargador no existe, o el grep de off está ciego. Dueño: frontend."
exit 1

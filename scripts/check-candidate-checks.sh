#!/usr/bin/env bash
#
# check-candidate-checks.sh — «¿qué dicen TODOS los check-runs de este commit?»
#                                                                        · devops
# =============================================================================
# POR QUÉ EXISTE (S-CI-1, 2026-09-11)
# ---------------------------------------------------------------------------
# El candidato `0417da1` se presentó a los tres veredictos como «verde» citando
# UN run verde (`E2E real` #34538020057). Ese mismo commit tenía CUATRO
# check-runs en rojo (`backend-e2e`, `e2e-ok`, `trivy-fs`, `sast-ok`) desde
# hacía nueve corridas. Seguridad lo midió con una sola llamada a la API de
# check-runs. Nadie del equipo la había hecho.
#
#     ► «Un run verde de un workflow no es el estado de un candidato.»
#
# Esto es esa llamada, para que no vuelva a faltar. No lee logs (el proxy de
# los agentes los bloquea): lee la API de checks, que sí responde, y para cada
# check-run que no esté en `success` imprime también sus ANOTACIONES — que es
# donde `backend-e2e` deja ahora su veredicto de fase (§52) y `trivy-fs` su
# motivo. Con eso un rc=127 se distingue de una suite roja sin abrir la UI.
#
# Uso:
#   ./scripts/check-candidate-checks.sh [<sha|ref>]     (por defecto: HEAD)
#   Requiere GITHUB_TOKEN o GH_TOKEN con lectura del repo.
# Sale 0 si TODOS los check-runs completados del commit están en `success`
# (y hay al menos uno); 1 si alguno no lo está; 2 si no pudo medir.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REF="${1:-HEAD}"
SHA="$(git rev-parse "$REF" 2>/dev/null)" || { echo "::error::no resuelvo '$REF' a un commit"; exit 2; }
TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
[ -n "$TOKEN" ] || { echo "::error::sin GITHUB_TOKEN/GH_TOKEN no puedo leer la API de checks. NO concluyente."; exit 2; }

REMOTE="$(git config --get remote.origin.url)"
SLUG="$(sed -E 's#(git@github\.com:|https://github\.com/)##; s#\.git$##' <<<"$REMOTE")"
API="https://api.github.com/repos/$SLUG"
H=(-H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json")

JSON="$(curl -sS "${H[@]}" "$API/commits/$SHA/check-runs?per_page=100")" || { echo "::error::la API de check-runs no respondió"; exit 2; }

printf '\n\033[1m== Estado del candidato %s (%s) ==\033[0m\n\n' "${SHA:0:7}" "$SLUG"

RESUMEN="$(node -e '
  const j = JSON.parse(process.argv[1]);
  if (!j.check_runs) { console.log("ERR " + JSON.stringify(j).slice(0,200)); process.exit(0); }
  const rows = j.check_runs.map(c => [c.name, c.status, c.conclusion || "-", c.id, c.html_url]);
  for (const r of rows) console.log(r.join("\t"));
' "$JSON")"
if [[ "$RESUMEN" == ERR* ]]; then echo "::error::respuesta inesperada: ${RESUMEN#ERR }"; exit 2; fi
[ -n "$RESUMEN" ] || { echo "::error::el commit no tiene NINGÚN check-run. Eso no es verde: es «nadie ha medido»."; exit 2; }

MAL=0; TOTAL=0; PENDIENTES=0
while IFS=$'\t' read -r nombre estado concl id url; do
  [ -n "$nombre" ] || continue
  TOTAL=$((TOTAL+1))
  if [ "$estado" != "completed" ]; then
    printf '  … %-32s %s\n' "$nombre" "$estado"; PENDIENTES=$((PENDIENTES+1)); continue
  fi
  if [ "$concl" = "success" ] || [ "$concl" = "skipped" ]; then
    printf '  \033[1;32m✔\033[0m %-32s %s\n' "$nombre" "$concl"
  else
    MAL=$((MAL+1))
    printf '  \033[1;31m✗\033[0m %-32s %s   %s\n' "$nombre" "$concl" "$url"
    curl -sS "${H[@]}" "$API/check-runs/$id/annotations" | node -e '
      let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
        let a=[]; try { a=JSON.parse(s); } catch { return; }
        for (const x of a) if (x.annotation_level !== "notice" && !/Node\.js 20 is deprecated/.test(x.message))
          console.log("      · [" + x.annotation_level + "] " + (x.title ? x.title + " — " : "") + x.message.replace(/\s+/g," ").slice(0,300));
      });'
  fi
done <<<"$RESUMEN"

echo
echo "  check-runs: $TOTAL · en rojo: $MAL · sin terminar: $PENDIENTES"
if [ "$MAL" -ne 0 ]; then
  printf '\033[1;31m✗ El candidato %s NO está verde: %s check-run(s) en rojo. Un run verde de un workflow no es el estado del commit.\033[0m\n' "${SHA:0:7}" "$MAL"
  exit 1
fi
if [ "$PENDIENTES" -ne 0 ]; then
  printf '\033[1;33m… %s check-run(s) sin terminar. Todavía no se puede afirmar nada de %s.\033[0m\n' "$PENDIENTES" "${SHA:0:7}"
  exit 2
fi
printf '\033[1;32m✓ Los %s check-runs de %s están en verde.\033[0m\n' "$TOTAL" "${SHA:0:7}"
exit 0

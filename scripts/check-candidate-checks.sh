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
# (y hay al menos uno); 1 si alguno está en rojo; 2 si no pudo medir (o hay
# check-runs sin terminar); 3 si hay `skipped` SIN motivo escrito.
#
# `skipped` NO es verde (techlead F1-2, 2026-09-11). La primera versión lo
# sumaba al verde sin motivo, contra la doctrina de ci.yml `ci-ok` («skipped es
# justo la forma en que un gate deja de gatear sin avisar»). Ahora es una
# TERCERA clasificación: se imprime aparte, no suma al verde, y solo se tolera
# si el job está en la lista cerrada SKIPPED_ESPERADOS de abajo, con su motivo.
# Medido al escribirlo: `d2efe07` (26 check-runs), `c13f4179` y `17ce9a9` tienen
# 0 skipped — la lista describe lo que deploy.yml salta POR CONSTRUCCIÓN en un
# push (CD apagado), todavía NO MEDIDO en un push real a `production`.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR" || exit 2

REF="${1:-HEAD}"
SHA="$(git rev-parse "$REF" 2>/dev/null)" || { echo "::error::no resuelvo '$REF' a un commit"; exit 2; }
TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
[ -n "$TOKEN" ] || { echo "::error::sin GITHUB_TOKEN/GH_TOKEN no puedo leer la API de checks. NO concluyente."; exit 2; }

REMOTE="$(git config --get remote.origin.url)"
SLUG="$(sed -E 's#(git@github\.com:|https://github\.com/)##; s#\.git$##' <<<"$REMOTE")"
API="https://api.github.com/repos/$SLUG"
H=(-H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json")

# -----------------------------------------------------------------------------
# LA RESPUESTA VA A FICHERO, NO A `argv` (C5, 2026-09-11). La primera versión
# pasaba el JSON por `node -e '…' "$JSON"`. Con 47 check-runs la respuesta pesa
# ~200 KB y `execve` la rechaza («Argument list too long», rc=2); el `$(…)`
# quedaba vacío y el script caía en la rama «el commit no tiene NINGÚN check-run»
# — que era FALSO (por API: 47, 45 en verde). Un instrumento que confunde «no
# pude leer» con «no hay nada» es peor que ninguno: aquí las dos ramas se separan
# y cada una lleva su rc. Además pagina: `per_page=100` no es un tope infinito.
# -----------------------------------------------------------------------------
TMP="$(mktemp -d -t candidate-checks-XXXXXX)"; trap 'rm -rf "$TMP"' EXIT
PAGE=1; TOTAL_API=""
while :; do
  curl -sS "${H[@]}" "$API/commits/$SHA/check-runs?per_page=100&page=$PAGE" -o "$TMP/page$PAGE.json" \
    || { echo "::error::la API de check-runs no respondió (página $PAGE). NO concluyente."; exit 2; }
  # `total_count` viene en cada página; con él se sabe si falta otra.
  TOTAL_API="$(node -e '
    const fs=require("fs"); let j;
    try { j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch (e) { console.log("PARSE " + e.message); process.exit(0); }
    if (!j || !Array.isArray(j.check_runs) || typeof j.total_count !== "number") { console.log("SHAPE " + JSON.stringify(j).slice(0,200)); process.exit(0); }
    console.log(j.total_count);
  ' "$TMP/page$PAGE.json" 2>&1)" || { echo "::error::no pude ejecutar el parser (node rc≠0): $TOTAL_API. NO concluyente."; exit 2; }
  case "$TOTAL_API" in
    PARSE*) echo "::error::respuesta de la API NO parseable (página $PAGE): ${TOTAL_API#PARSE }. NO concluyente: esto no es «sin check-runs»."; exit 2 ;;
    SHAPE*) echo "::error::respuesta inesperada de la API (página $PAGE): ${TOTAL_API#SHAPE }. NO concluyente."; exit 2 ;;
  esac
  [ "$TOTAL_API" -gt $((PAGE*100)) ] 2>/dev/null || break
  PAGE=$((PAGE+1))
  [ "$PAGE" -le 10 ] || { echo "::error::más de 1000 check-runs en un commit; no sigo paginando. NO concluyente."; exit 2; }
done

RESUMEN="$(node -e '
  const fs=require("fs"); const rows=[];
  for (const f of process.argv.slice(1)) {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    for (const c of j.check_runs) rows.push([c.name, c.status, c.conclusion || "-", c.id, c.html_url].join("\t"));
  }
  process.stdout.write(rows.join("\n"));
' "$TMP"/page*.json 2>&1)" || { echo "::error::el parser falló al leer las páginas: $RESUMEN. NO concluyente."; exit 2; }

# La rama «sin check-runs» SOLO se toma cuando la API dice total_count == 0.
# Un parser roto ya salió por arriba con rc=2 y su mensaje de parseo.
if [ "$TOTAL_API" -eq 0 ]; then
  echo "::error::el commit no tiene NINGÚN check-run (total_count=0). Eso no es verde: es «nadie ha medido»."; exit 2
fi
[ -n "$RESUMEN" ] || { echo "::error::total_count=$TOTAL_API pero no obtuve filas: incoherencia de la API. NO concluyente."; exit 2; }

# -----------------------------------------------------------------------------
# LISTA CERRADA de jobs cuyo `skipped` es POR CONSTRUCCIÓN y no oculta ninguna
# medición (F1-2). Cada entrada lleva su motivo. Lo que NO está aquí y sale
# `skipped` es «no medido» y baja el veredicto a rc=3. `format-mix` NO entra a
# propósito: su skipped significa «sin base utilizable», que ci.yml ya declara
# como NO medido. Añadir una entrada exige motivo, no solo nombre.
# -----------------------------------------------------------------------------
declare -A SKIPPED_ESPERADOS=(
  # deploy.yml en un `push` a production: solo corre `dast-release`; el CD está
  # apagado (`secrets-gate` sin secrets de CD, HECHOS.md) y los `promote-*`
  # exigen dispatch con `promote_to_prod`. Cuando el CD se reactive, se quitan.
  [deploy-ci-gate]="CD apagado: secrets-gate sin secrets de CD (deploy.yml)"
  [preflight]="CD apagado: cuelga de deploy-ci-gate (deploy.yml)"
  [e2e-real]="CD apagado: cuelga de preflight (deploy.yml; el E2E real corre en e2e-real.yml)"
  [deploy-staging-backend]="CD apagado y sin staging (HECHOS.md)"
  [deploy-staging-frontend]="CD apagado y sin staging (HECHOS.md)"
  [staging-serves-head]="CD apagado y sin staging (HECHOS.md)"
  [staging-provider-parity]="CD apagado y sin staging (HECHOS.md)"
  [promote-production-backend]="solo con dispatch promote_to_prod=true (deploy.yml); en push se salta por construcción"
  [promote-production-frontend]="solo con dispatch promote_to_prod=true (deploy.yml); en push se salta por construcción"
)

MAL=0; TOTAL=0; PENDIENTES=0; SALTADOS=0; SALTADOS_ESPERADOS=0
while IFS=$'\t' read -r nombre estado concl id url; do
  [ -n "$nombre" ] || continue
  TOTAL=$((TOTAL+1))
  if [ "$estado" != "completed" ]; then
    printf '  … %-32s %s\n' "$nombre" "$estado"; PENDIENTES=$((PENDIENTES+1)); continue
  fi
  if [ "$concl" = "success" ]; then
    printf '  \033[1;32m✔\033[0m %-32s %s\n' "$nombre" "$concl"
  elif [ "$concl" = "skipped" ]; then
    if [ -n "${SKIPPED_ESPERADOS[$nombre]+x}" ]; then
      SALTADOS_ESPERADOS=$((SALTADOS_ESPERADOS+1))
      printf '  \033[2m·\033[0m %-32s skipped (esperado: %s)\n' "$nombre" "${SKIPPED_ESPERADOS[$nombre]}"
    else
      SALTADOS=$((SALTADOS+1))
      printf '  \033[1;33m·\033[0m %-32s skipped — SIN motivo escrito: no medido, no verde   %s\n' "$nombre" "$url"
    fi
  else
    MAL=$((MAL+1))
    printf '  \033[1;31m✗\033[0m %-32s %s   %s\n' "$nombre" "$concl" "$url"
    curl -sS "${H[@]}" "$API/check-runs/$id/annotations" | node -e '
      let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
        let a=[]; try { a=JSON.parse(s); } catch { return; }
        for (const x of a) if (x.annotation_level !== "notice" && !/Node\.js \d+ .*deprecated/i.test(x.message))
          console.log("      · [" + x.annotation_level + "] " + (x.title ? x.title + " — " : "") + x.message.replace(/\s+/g," ").slice(0,300));
      });'
  fi
done <<<"$RESUMEN"

echo
echo "  check-runs: $TOTAL · en rojo: $MAL · sin terminar: $PENDIENTES · saltados sin motivo: $SALTADOS · saltados esperados: $SALTADOS_ESPERADOS"
if [ "$MAL" -ne 0 ]; then
  printf '\033[1;31m✗ El candidato %s NO está verde: %s check-run(s) en rojo. Un run verde de un workflow no es el estado del commit.\033[0m\n' "${SHA:0:7}" "$MAL"
  exit 1
fi
if [ "$PENDIENTES" -ne 0 ]; then
  printf '\033[1;33m… %s check-run(s) sin terminar. Todavía no se puede afirmar nada de %s.\033[0m\n' "$PENDIENTES" "${SHA:0:7}"
  exit 2
fi
if [ "$SALTADOS" -ne 0 ]; then
  printf '\033[1;33m· %s check-run(s) saltado(s) SIN motivo escrito en %s. Lo medido está en verde, pero un skipped no es un verde: o se mide, o se anota en SKIPPED_ESPERADOS con su motivo.\033[0m\n' "$SALTADOS" "${SHA:0:7}"
  exit 3
fi
if [ "$SALTADOS_ESPERADOS" -ne 0 ]; then
  printf '\033[1;32m✓ Los %s check-runs medidos de %s están en verde (%s saltados por construcción, motivo impreso arriba).\033[0m\n' "$((TOTAL-SALTADOS_ESPERADOS))" "${SHA:0:7}" "$SALTADOS_ESPERADOS"
  exit 0
fi
printf '\033[1;32m✓ Los %s check-runs de %s están en verde.\033[0m\n' "$TOTAL" "${SHA:0:7}"
exit 0

#!/usr/bin/env bash
#
# limpieza-ramas.sh — borra las ramas remotas YA FUSIONADAS en `production`   · devops
# =============================================================================
# POR QUÉ EXISTE
# ---------------------------------------------------------------------------
# El dueño autorizó el 2026-10-30 (HECHOS.md, fila «Limpieza de ramas») borrar las
# ramas remotas fusionadas en `production` y archivar `main` (etiqueta
# `archive/main` + borrado). Medido ese día: 192 ramas remotas, 135 fusionadas.
# El proxy de las sesiones de agentes bloquea el borrado por sus dos vías
# (`git push --delete` corta la conexión; `DELETE /git/refs` → 403), así que lo
# dispara el dueño desde GitHub Actions: `.github/workflows/limpieza-ramas.yml`.
# Cómo se usa y cómo se deshace: DEVOPS_NOTES §105.
#
# QUÉ BORRA (y nada más)
#   Una rama remota `R` se borra SOLO si se cumplen TODAS:
#     1. su último commit es ancestro de `<remoto>/<base>` (`git merge-base
#        --is-ancestor`) ⇒ borrarla no pierde ningún commit;
#     2. no está en PROTEGIDAS (lista fija de abajo) ni es la base;
#     3. no es cabeza NI base de una PR abierta (fichero --pr-file, una rama por
#        línea; el workflow lo llena con la API `pulls?state=open`). La base
#        también, porque borrar la base de una PR abierta la CIERRA en GitHub;
#     4. al empujar el borrado, la rama sigue en el sha que se midió
#        (`--force-with-lease=refs/heads/R:<sha>`): si alguien empujó entre la
#        medición y el borrado, GitHub lo rechaza y la rama sobrevive.
#   Solo toca `refs/heads/*`. Nunca borra etiquetas.
#
# FAIL-CLOSED
#   Sin --pr-file legible ⇒ rc=2 y NO borra nada (sin la lista de PR abiertas no
#   se sabe qué está en uso). `--confirmar` que no sea exactamente `true`/`false`
#   ⇒ rc=2. Sin la rama base en el remoto ⇒ rc=2.
#
# ARCHIVAR `main` (--archivar-main true)
#   Exige --rama-defecto igual a la base (si `main` sigue siendo la rama por
#   defecto, GitHub no deja borrarla y además el dueño no ha hecho el paso 1).
#   Empuja la etiqueta `archive/main` al último commit de `main`, comprueba en el
#   remoto que la etiqueta apunta a ese sha, y SOLO entonces borra `main` con
#   lease. Si `archive/main` ya existe en otro sha ⇒ rc=2 sin tocar nada.
#   Con --confirmar false solo dice lo que haría.
#
# Uso:
#   ./scripts/limpieza-ramas.sh --pr-file F [--confirmar true|false]
#       [--archivar-main true|false] [--rama-defecto NOMBRE]
#       [--repo DIR] [--remoto origin] [--base production] [--no-fetch]
#   El resumen (markdown) va a $GITHUB_STEP_SUMMARY si existe, y siempre a stdout.
# Sale 0 = hecho (o listado) · 1 = algún borrado falló · 2 = precondición, no tocó nada.
# Canario: scripts/limpieza-ramas-canary.sh (repo de juguete en un directorio temporal).
# =============================================================================
set -uo pipefail

# Lista FIJA de ramas que este script no borra nunca, fusionadas o no. Añadir aquí
# es seguro; quitar exige pasar el canario (que las comprueba por nombre).
PROTEGIDAS=(production main staging gh-pages)

REPO_DIR="$PWD"; REMOTO=origin; BASE=production
PR_FILE=""; CONFIRMAR=false; ARCHIVAR=false; RAMA_DEFECTO=""; FETCH=1
while [ $# -gt 0 ]; do
  case "$1" in
    --repo)          REPO_DIR="$2"; shift 2 ;;
    --remoto)        REMOTO="$2"; shift 2 ;;
    --base)          BASE="$2"; shift 2 ;;
    --pr-file)       PR_FILE="$2"; shift 2 ;;
    --confirmar)     CONFIRMAR="$2"; shift 2 ;;
    --archivar-main) ARCHIVAR="$2"; shift 2 ;;
    --rama-defecto)  RAMA_DEFECTO="$2"; shift 2 ;;
    --no-fetch)      FETCH=0; shift ;;
    *) echo "::error::argumento desconocido: $1"; exit 2 ;;
  esac
done

no_toca() { echo "::error title=limpieza-ramas::$*  — NO se borró nada."; exit 2; }
for v in "$CONFIRMAR" "$ARCHIVAR"; do
  case "$v" in true|false) ;; *) no_toca "valor «$v»: --confirmar y --archivar-main solo aceptan true|false" ;; esac
done
[ -n "$PR_FILE" ] && [ -r "$PR_FILE" ] || no_toca "falta --pr-file legible (lista de ramas de PR abiertas): sin ella no sé qué está en uso"

G() { git -C "$REPO_DIR" "$@"; }
G rev-parse --git-dir >/dev/null 2>&1 || no_toca "$REPO_DIR no es un repositorio git"

if [ "$FETCH" = 1 ]; then
  G fetch --quiet --prune --no-tags "$REMOTO" "+refs/heads/*:refs/remotes/$REMOTO/*" \
    || no_toca "git fetch de $REMOTO falló"
fi
BASE_SHA="$(G rev-parse --verify --quiet "refs/remotes/$REMOTO/$BASE^{commit}")" \
  || no_toca "no existe $REMOTO/$BASE"

# Precondiciones de archivar main: se comprueban ANTES de borrar ninguna rama.
MAIN_SHA=""; TAG_REMOTO=""
if [ "$ARCHIVAR" = true ]; then
  [ "$RAMA_DEFECTO" = "$BASE" ] || no_toca "la rama por defecto del repositorio es «${RAMA_DEFECTO:-desconocida}», no «$BASE»: primero Settings → General → Default branch → $BASE"
  MAIN_SHA="$(G rev-parse --verify --quiet "refs/remotes/$REMOTO/main^{commit}")" || MAIN_SHA=""
  if [ -n "$MAIN_SHA" ]; then
    TAG_REMOTO="$(G ls-remote "$REMOTO" refs/tags/archive/main | cut -f1)" || no_toca "no pude leer las etiquetas de $REMOTO"
    if [ -n "$TAG_REMOTO" ] && [ "$TAG_REMOTO" != "$MAIN_SHA" ]; then
      no_toca "la etiqueta archive/main ya existe en ${TAG_REMOTO:0:12}, distinto de main ${MAIN_SHA:0:12}"
    fi
  fi
fi

declare -A EN_PR=() PROT=()
while IFS= read -r l; do l="${l//[$'\r\t ']/}"; [ -n "$l" ] && EN_PR["$l"]=1; done < "$PR_FILE"
for p in "${PROTEGIDAS[@]}" "$BASE"; do PROT["$p"]=1; done

BORRAR=(); SALTA_PROT=(); SALTA_PR=(); SIN_FUSIONAR=0; TOTAL=0
while IFS=' ' read -r sha ref; do
  rama="${ref#refs/remotes/$REMOTO/}"
  [ "$rama" = HEAD ] && continue
  TOTAL=$((TOTAL+1))
  if [ -n "${PROT[$rama]+x}" ]; then SALTA_PROT+=("$rama"); continue; fi
  if [ -n "${EN_PR[$rama]+x}" ]; then SALTA_PR+=("$rama"); continue; fi
  if G merge-base --is-ancestor "$sha" "$BASE_SHA"; then
    BORRAR+=("$rama $sha")
  else
    SIN_FUSIONAR=$((SIN_FUSIONAR+1))
  fi
done < <(G for-each-ref --format='%(objectname) %(refname)' "refs/remotes/$REMOTO/")

RESUMEN="${GITHUB_STEP_SUMMARY:-/dev/null}"
out() { printf '%s\n' "$*"; printf '%s\n' "$*" >> "$RESUMEN"; }

MODO="SOLO LISTA (confirmar=false): no se borró nada"; [ "$CONFIRMAR" = true ] && MODO="BORRADO (confirmar=true)"
out "## Limpieza de ramas — $MODO"
out ""
out "Base: \`$REMOTO/$BASE\` @ \`${BASE_SHA:0:12}\` · ramas remotas: $TOTAL · fusionadas a borrar: ${#BORRAR[@]} · sin fusionar (se quedan): $SIN_FUSIONAR · protegidas: ${#SALTA_PROT[@]} · en PR abierta: ${#SALTA_PR[@]}"
out ""
[ "${#SALTA_PROT[@]}" -gt 0 ] && out "Protegidas (no se tocan): $(printf '`%s` ' "${SALTA_PROT[@]}")"
[ "${#SALTA_PR[@]}" -gt 0 ]  && out "Cabeza o base de PR abierta (no se tocan): $(printf '`%s` ' "${SALTA_PR[@]}")"
out ""
out "| rama | último commit | fecha | resultado |"
out "|---|---|---|---|"

FALLIDAS=0; BORRADAS=0
for e in "${BORRAR[@]}"; do
  rama="${e% *}"; sha="${e##* }"
  fecha="$(G log -1 --format=%cs "$sha")"
  if [ "$CONFIRMAR" = true ]; then
    if G push --quiet --force-with-lease="refs/heads/$rama:$sha" "$REMOTO" ":refs/heads/$rama" 2>/dev/null; then
      res="borrada"; BORRADAS=$((BORRADAS+1))
    else
      res="**FALLÓ** (¿se movió o está protegida en GitHub?)"; FALLIDAS=$((FALLIDAS+1))
    fi
  else
    res="se borraría"
  fi
  out "| \`$rama\` | \`${sha:0:12}\` | $fecha | $res |"
done
out ""
[ "$CONFIRMAR" = true ] && out "Borradas: $BORRADAS · fallidas: $FALLIDAS. Para recuperar una: ver DEVOPS_NOTES §105 (el sha está en esta tabla)."

# --- archivar main (precondiciones ya comprobadas arriba) -------------------------
if [ "$ARCHIVAR" = true ]; then
  out ""
  out "### Archivar \`main\`"
  if [ -z "$MAIN_SHA" ]; then
    out "\`main\` ya no existe en el remoto: nada que archivar."
  elif [ "$CONFIRMAR" != true ]; then
    out "Se crearía \`archive/main\` → \`${MAIN_SHA:0:12}\` y después se borraría \`main\`. (confirmar=false: no se hizo.)"
  else
    [ -n "$TAG_REMOTO" ] || G push --quiet "$REMOTO" "$MAIN_SHA:refs/tags/archive/main" 2>/dev/null || true
    if [ "$(G ls-remote "$REMOTO" refs/tags/archive/main | cut -f1)" != "$MAIN_SHA" ]; then
      out "**FALLÓ**: \`archive/main\` no quedó en \`${MAIN_SHA:0:12}\` en el remoto, así que \`main\` NO se borró."; FALLIDAS=$((FALLIDAS+1))
    elif G push --quiet --force-with-lease="refs/heads/main:$MAIN_SHA" "$REMOTO" ":refs/heads/main" 2>/dev/null; then
      out "\`archive/main\` → \`${MAIN_SHA:0:12}\` creada y \`main\` borrada."
    else
      out "**FALLÓ** el borrado de \`main\` (la etiqueta \`archive/main\` sí quedó)."; FALLIDAS=$((FALLIDAS+1))
    fi
  fi
fi

[ "$FALLIDAS" -eq 0 ] || exit 1
exit 0

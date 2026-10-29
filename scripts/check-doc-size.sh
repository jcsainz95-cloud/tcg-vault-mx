#!/usr/bin/env bash
#
# check-doc-size.sh — trinquete de tamaño de los documentos (ficha DOC-SIZE / D8)   · devops
# =============================================================================
# POR QUÉ EXISTE
# ---------------------------------------------------------------------------
# CLAUDE.md («Documentos: estado, no bitácora») fija topes orientativos (PROJECT.md ~400 líneas;
# API_CONTRACT y ARCHITECTURE ~3 000; DESIGN_SYSTEM ~2 000; cada *_NOTES.md ~1 500) y manda que,
# rebasado el tope, el rol dueño COMPACTE ANTES DE AÑADIR. Medido por el techlead el 2026-10-18:
# todos los grandes están 10-50× por encima. Un tope que nadie mide no es un tope; este script es el
# trinquete que el techlead exigió en CI antes del próximo cierre de release:
#
#   ► ningún documento de `docs/` (recursivo) ni `PROJECT.md` puede tener MÁS líneas que su umbral
#     en `scripts/doc-size.baseline`. Los umbrales son lo medido el día que nació el candado y
#     SOLO PUEDEN BAJAR: `--update` reescribe el fichero con min(umbral, actual), nunca sube uno;
#     y en CI `--against-ref <sha>` pone rojo si alguien subió un umbral a mano.
#
# Documento NUEVO (sin fila en el baseline): su umbral es el tope de CLAUDE.md para su clase
# (PROJECT.md 400 · API_CONTRACT/ARCHITECTURE 3000 · DESIGN_SYSTEM 2000 · resto 1500).
#
# Uso:
#   ./scripts/check-doc-size.sh                       # mide; rc 1 si algo creció (dice qué y cuánto)
#   ./scripts/check-doc-size.sh --against-ref <ref>   # además: ningún umbral subió respecto a <ref>
#   ./scripts/check-doc-size.sh --update              # baja los umbrales a lo medido (nunca sube)
#   [--root DIR]                                      # otro árbol (lo usa el canario)
# Sale 0 verde · 1 rojo · 2 no concluyente (falta el baseline o la ref no se puede leer).
# Canario: scripts/check-doc-size-canary.sh
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODO=check; REF=""
while [ $# -gt 0 ]; do
  case "$1" in
    --root)        ROOT_DIR="$(cd "$2" && pwd)"; shift 2 ;;
    --update)      MODO=update; shift ;;
    --against-ref) REF="$2"; shift 2 ;;
    *) echo "::error::argumento desconocido: $1"; exit 2 ;;
  esac
done
BASELINE_REL="scripts/doc-size.baseline"
BASELINE="$ROOT_DIR/$BASELINE_REL"
[ -f "$BASELINE" ] || { echo "::error::falta $BASELINE_REL — sin umbrales el trinquete no mide nada (NO concluyente)."; exit 2; }

tope_clase() {
  case "$1" in
    PROJECT.md)                                   echo 400 ;;
    docs/API_CONTRACT.md|docs/ARCHITECTURE.md)    echo 3000 ;;
    docs/DESIGN_SYSTEM.md)                        echo 2000 ;;
    *)                                            echo 1500 ;;
  esac
}
lineas() { wc -l < "$ROOT_DIR/$1" | tr -d ' '; }

declare -A UMBRAL=()
while IFS=$'\t' read -r n f; do
  [[ -z "${n:-}" || "$n" == \#* ]] && continue
  [[ "$n" =~ ^[0-9]+$ ]] || { echo "::error::$BASELINE_REL: línea mal formada «$n	$f»"; exit 2; }
  UMBRAL["$f"]="$n"
done < "$BASELINE"

# Documentos medidos: todo fichero de texto bajo docs/ (recursivo) + PROJECT.md. Se excluye el
# marcador vacío `.gitkeep`.
mapfile -t DOCS < <(cd "$ROOT_DIR" && { [ -f PROJECT.md ] && echo PROJECT.md; find docs -type f ! -name '.gitkeep' 2>/dev/null; } | LC_ALL=C sort)

if [ "$MODO" = update ]; then
  TMP="$(mktemp)"
  {
    # Conserva los comentarios del baseline (incluida `# base-sha:`): --update solo baja números.
    grep '^#' "$BASELINE" || echo "# scripts/doc-size.baseline — umbral de líneas por documento (wc -l). SOLO PUEDE BAJAR."
    for f in "${DOCS[@]}"; do
      a="$(lineas "$f")"; u="${UMBRAL[$f]:-}"
      # Documento SIN fila: no se le escribe ninguna. Sigue rigiendo el tope de su clase (CLAUDE.md).
      # Antes se le escribía min(tope, medido) = lo medido, y eso clavaba a su tamaño de hoy un
      # documento que crece por diseño (medido 2026-10-29: `docs/DECISIONES.md` quedaba en 77 y la
      # siguiente decisión del dueño habría puesto CI en rojo). Lo que sube por encima de su clase
      # sigue frenado abajo («nace por encima del tope»).
      [ -n "$u" ] || continue
      [ "$a" -lt "$u" ] && u="$a"
      printf '%s\t%s\n' "$u" "$f"
    done
  } > "$TMP"
  # Un documento nuevo que ya NACE por encima del tope de su clase no entra en silencio por --update.
  for f in "${DOCS[@]}"; do
    if [ -z "${UMBRAL[$f]:-}" ] && [ "$(lineas "$f")" -gt "$(tope_clase "$f")" ]; then
      echo "::error::$f es nuevo y ya nace con $(lineas "$f") líneas (> tope $(tope_clase "$f") de CLAUDE.md). --update no lo admite: compáctalo primero."
      rm -f "$TMP"; exit 1
    fi
  done
  mv "$TMP" "$BASELINE"; echo "umbrales actualizados en $BASELINE_REL (solo bajan)."; exit 0
fi

ROJOS=0; HOLGURA=0
printf '\n\033[1m== DOC-SIZE: ningún documento crece por encima de su umbral ==\033[0m\n'
for f in "${DOCS[@]}"; do
  a="$(lineas "$f")"; u="${UMBRAL[$f]:-}"; origen="umbral medido"
  if [ -z "$u" ]; then u="$(tope_clase "$f")"; origen="documento nuevo: tope de CLAUDE.md"; fi
  if [ "$a" -gt "$u" ]; then
    ROJOS=$((ROJOS+1))
    printf '\033[1;31m  ✗ %s CRECIÓ: %s líneas > %s (%s), +%s. Compacta lo que ya no está vigente antes de añadir (CLAUDE.md).\033[0m\n' "$f" "$a" "$u" "$origen" "$((a-u))"
    echo "::error file=$f::DOC-SIZE: $f tiene $a líneas, umbral $u ($origen), +$((a-u))."
  elif [ "$a" -lt "$u" ] && [ "$origen" = "umbral medido" ]; then
    HOLGURA=$((HOLGURA+1))
    printf '  · %s: %s ≤ %s (bajó %s; ./scripts/check-doc-size.sh --update fija el umbral nuevo)\n' "$f" "$a" "$u" "$((u-a))"
  fi
done
# Filas del baseline cuyo documento ya no existe: no es rojo (borrar compacta), pero se avisa.
for f in "${!UMBRAL[@]}"; do [ -f "$ROOT_DIR/$f" ] || echo "  · $f ya no existe (su fila sale con --update)."; done

if [ -n "$REF" ]; then
  printf '\n\033[1m== DOC-SIZE: ningún umbral SUBIÓ respecto a %s ==\033[0m\n' "$REF"
  if ! VIEJO="$(git -C "$ROOT_DIR" show "$REF:$BASELINE_REL" 2>/dev/null)"; then
    if git -C "$ROOT_DIR" cat-file -e "$REF^{commit}" 2>/dev/null; then
      echo "  · $REF no tenía $BASELINE_REL: es el commit que lo crea (nada que comparar)."
    else
      echo "::error::no puedo leer la ref $REF (¿fetch-depth?). La comparación de umbrales NO es concluyente."; exit 2
    fi
  else
    # Re-medición DECLARADA (DEVOPS_NOTES §101.5). Una subida de umbral respecto a la ref solo se
    # admite si se cumplen LAS CUATRO:
    #   1. el baseline declara `# base-sha: <sha>` y la ref NO declaraba ninguno: la re-medición se
    #      gasta UNA vez; con un base-sha ya en la ref, cualquier cambio de base-sha es rojo;
    #   2. ese sha es ancestro (o igual) de la ref;
    #   3. el umbral nuevo es exactamente `wc -l` del documento en ese sha;
    #   4. y no supera `wc -l` del documento EN LA REF. Ésta es la que cierra la puerta trasera (R3
    #      del techlead): un ancestro anterior a una compactación tendría el wc viejo, pero la ref ya
    #      tiene el compactado, así que volver a subir es rojo. La subida admitida es solo la de un
    #      texto que YA está en la rama base, nunca la de uno que trae el cambio.
    # Se eligió (4) y no «sha = merge-base» porque mide la propiedad que importa (el texto ya
    # existe en la base) sin depender de cómo se calcule la base en cada evento de CI.
    base_sha() { grep -oE '^# base-sha: [0-9a-f]{7,40}$' | head -1 | awk '{print $3}'; }
    SHA_NUEVO="$(base_sha < "$BASELINE")"; SHA_VIEJO="$(base_sha <<< "$VIEJO")"
    REMEDIDA=0
    if [ -n "$SHA_VIEJO" ] && [ "$SHA_NUEVO" != "$SHA_VIEJO" ]; then
      ROJOS=$((ROJOS+1))
      printf '\033[1;31m  ✗ base-sha cambió (%s → %s): la re-medición ya se usó una vez y no se repite.\033[0m\n' "${SHA_VIEJO:0:10}" "${SHA_NUEVO:0:10}"
      echo "::error file=$BASELINE_REL::DOC-SIZE: base-sha cambió de $SHA_VIEJO a ${SHA_NUEVO:-ninguno}; la re-medición declarada solo vale una vez."
    elif [ -n "$SHA_NUEVO" ] && [ -z "$SHA_VIEJO" ] \
       && git -C "$ROOT_DIR" merge-base --is-ancestor "$SHA_NUEVO" "$REF" 2>/dev/null; then REMEDIDA=1; fi
    while IFS=$'\t' read -r n f; do
      [[ -z "${n:-}" || "$n" == \#* ]] && continue
      nu="${UMBRAL[$f]:-}"
      if [ -n "$nu" ] && [ "$nu" -gt "$n" ] && [ "$REMEDIDA" = 1 ]; then
        enbase="$(git -C "$ROOT_DIR" show "$SHA_NUEVO:$f" 2>/dev/null | wc -l | tr -d ' ')"
        enref="$(git -C "$ROOT_DIR" show "$REF:$f" 2>/dev/null | wc -l | tr -d ' ')"
        if [ "$nu" = "$enbase" ] && [ "$nu" -le "$enref" ]; then
          echo "  · $f: umbral $n → $nu por re-medición declarada sobre ${SHA_NUEVO:0:10} (wc en ese sha = $enbase; en $REF = $enref)."
          continue
        fi
        echo "  · $f: re-medición NO admitida (umbral $nu; wc en ${SHA_NUEVO:0:10} = $enbase; en la ref = $enref)."
      fi
      if [ -n "$nu" ] && [ "$nu" -gt "$n" ]; then
        ROJOS=$((ROJOS+1))
        printf '\033[1;31m  ✗ el umbral de %s SUBIÓ de %s a %s. El trinquete solo baja.\033[0m\n' "$f" "$n" "$nu"
        echo "::error file=$BASELINE_REL::DOC-SIZE: umbral de $f subió de $n a $nu respecto a $REF."
      fi
    done <<< "$VIEJO"
  fi
fi

if [ "$ROJOS" -gt 0 ]; then printf '\n\033[1;31mROJO: %s incumplimiento(s) del trinquete DOC-SIZE.\033[0m\n' "$ROJOS"; exit 1; fi
printf '\n\033[1;32mVERDE: %s documentos medidos, ninguno por encima de su umbral (%s con holgura para bajar).\033[0m\n' "${#DOCS[@]}" "$HOLGURA"

#!/usr/bin/env bash
# =============================================================================
# vercel-ignore-build.sh — Ignored Build Step de Vercel
# =============================================================================
# PROBLEMA QUE RESUELVE (medido, 2026-09-08):
#   El remoto tiene 46 ramas. Vercel construye una VISTA PREVIA en cada push a
#   CUALQUIERA de ellas y guarda esos deployments para siempre. El almacenamiento
#   del proyecto iba al 75% de 10 GB. Nadie usa esas vistas previas.
#
# QUÉ HACE:
#   Solo `main` y `production` construyen. El resto de ramas se cancela ANTES
#   de arrancar el build (no consume build minutes ni almacenamiento).
#
# ⚠️ SEMÁNTICA DE LOS CÓDIGOS DE SALIDA — ES AL REVÉS DE LO INTUITIVO:
#     exit 0  ⇒ CANCELAR el build   ("Ignoring the change")
#     exit 1  ⇒ CONSTRUIR           ("Proceeding with deployment")
#
#   Verificado, no supuesto: es la semántica que implementa la propia herramienta
#   oficial de Vercel para este hueco, `turbo-ignore` (npm, publicada por Vercel).
#   En su `dist/cli.js`:
#       function _y(){ return $v(`⏭ Ignoring the change`),   process.exit(0) }
#       function vy(){ return $v(`✓ Proceeding with deployment`), process.exit(1) }
#   Equivocarse de signo aquí NO da error: deja de desplegarse producción y el
#   sitio se queda congelado en la versión vieja SIN QUE NADIE SE ENTERE.
#
# ⚠️ FAIL-SAFE DELIBERADO: si `VERCEL_GIT_COMMIT_REF` viene VACÍA o AUSENTE,
#   CONSTRUIMOS (exit 1). Ante la duda se construye. Nunca dejar producción sin
#   desplegar por una variable que no llegó. Esa es la razón del `:-main`.
#
# `VERCEL_GIT_COMMIT_REF` = nombre de la rama del commit desplegado. Es la env
#   var oficial de Vercel para esto (`turbo-ignore` la usa para el mismo fin:
#   `... on branch "${process.env.VERCEL_GIT_COMMIT_REF}"`).
#
# DÓNDE SE USA (la lógica está DUPLICADA a propósito, ver DEVOPS_NOTES §40):
#   1. `vercel.json` → `ignoreCommand` (versión INLINE, sin depender del CWD).
#   2. Vercel Dashboard → Settings → Git → Ignored Build Step (mismo one-liner).
#   3. Este script: la copia EJECUTABLE Y PROBABLE en local. Es la que se usa
#      para demostrar el comportamiento antes de tocar nada en Vercel.
#
# PROBARLO EN LOCAL (los cuatro casos que importan):
#   VERCEL_GIT_COMMIT_REF=main            ./scripts/vercel-ignore-build.sh; echo $?  # → 1 construye
#   VERCEL_GIT_COMMIT_REF=production      ./scripts/vercel-ignore-build.sh; echo $?  # → 1 construye
#   VERCEL_GIT_COMMIT_REF=claude/loquesea ./scripts/vercel-ignore-build.sh; echo $?  # → 0 cancela
#   VERCEL_GIT_COMMIT_REF=""              ./scripts/vercel-ignore-build.sh; echo $?  # → 1 construye
#   env -u VERCEL_GIT_COMMIT_REF          ./scripts/vercel-ignore-build.sh; echo $?  # → 1 construye
#   O de golpe:  ./scripts/vercel-ignore-build.sh --self-test
#
# CÓMO SE REVIERTE EN 30 SEGUNDOS: DEVOPS_NOTES §40.4.
# CÓMO SE FUERZA UNA VISTA PREVIA:  DEVOPS_NOTES §40.5.
# =============================================================================

# Ramas que SÍ construyen. Si añades una, añádela también al `ignoreCommand`
# de `vercel.json` y al campo del dashboard: son tres copias del mismo one-liner.
BUILD_BRANCHES='main production'

self_test() {
  printf '%-38s %-8s %-8s %s\n' 'CASO' 'ESPERADO' 'REAL' 'VEREDICTO'
  rc=0
  _check() { # $1=descripción $2=esperado $3=real
    if [ "$2" = "$3" ]; then v='OK'; else v='FALLA'; rc=1; fi
    printf '%-38s %-8s %-8s %s\n' "$1" "$2" "$3" "$v"
  }

  VERCEL_GIT_COMMIT_REF=main "$0" >/dev/null 2>&1; got=$?
  _check 'main (construye)' 1 "$got"

  VERCEL_GIT_COMMIT_REF=production "$0" >/dev/null 2>&1; got=$?
  _check 'production (construye)' 1 "$got"

  VERCEL_GIT_COMMIT_REF=claude/loquesea "$0" >/dev/null 2>&1; got=$?
  _check 'claude/loquesea (CANCELA)' 0 "$got"

  VERCEL_GIT_COMMIT_REF='' "$0" >/dev/null 2>&1; got=$?
  _check 'var VACIA (construye: fail-safe)' 1 "$got"

  env -u VERCEL_GIT_COMMIT_REF "$0" >/dev/null 2>&1; got=$?
  _check 'var AUSENTE (construye: fail-safe)' 1 "$got"

  echo
  if [ "$rc" -eq 0 ]; then
    echo 'SELF-TEST: verde. exit 0 = cancelar, exit 1 = construir.'
  else
    echo 'SELF-TEST: ROJO. NO pongas esto en Vercel hasta arreglarlo.'
  fi
  exit "$rc"
}

[ "${1:-}" = '--self-test' ] && self_test

# --- La decisión. `:-main` = fail-safe: sin variable, se construye. -----------
ref="${VERCEL_GIT_COMMIT_REF:-main}"

for b in $BUILD_BRANCHES; do
  if [ "$ref" = "$b" ]; then
    echo "✓ Rama '$ref': se CONSTRUYE (exit 1 = proceed)."
    exit 1
  fi
done

echo "⏭ Rama '$ref': build CANCELADO (exit 0 = ignore). Solo construyen: $BUILD_BRANCHES."
echo "   ¿Necesitas la vista previa de verdad? Ver docs/DEVOPS_NOTES.md §40.5."
exit 0

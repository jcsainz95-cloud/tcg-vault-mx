#!/usr/bin/env bash
#
# check-mail-sink-scope.sh — el buzón falso de correo NO sale del E2E real · devops
# =============================================================================
# DE DÓNDE VIENE (2026-11-04, run 41757369935 de e2e-real.yml)
#   Para que `frontend/e2e/cuenta-correo.spec.ts` lea el enlace del correo en CI,
#   `docker-compose.e2e-mail.yml` pone `RESEND_BASE_URL` al backend: el SDK de
#   Resend (4.8.0) manda entonces cada correo a `scripts/e2e-mail-sink.mjs` en el
#   runner en lugar de a api.resend.com. Esa misma variable en PRODUCCIÓN mandaría
#   TODOS los correos —verificación, «Termina tu cuenta», reseteo de contraseña,
#   con su token— a quien controle la URL. Es una llave de desvío de correo.
#
# QUÉ EXIGE
#   R1. `RESEND_BASE_URL` solo aparece en: docker-compose.e2e-mail.yml,
#       scripts/e2e-mail-sink.mjs, este candado y su canario (y en docs/*.md, que
#       no configuran nada). En particular NUNCA en docker-compose.yml,
#       docker-compose.staging.yml, .env.example, configs de deploy, otro workflow
#       ni el código del backend.
#   R2. El override `docker-compose.e2e-mail.yml` solo lo nombra
#       `.github/workflows/e2e-real.yml` (ningún otro workflow ni script).
#   R3. En el override, `RESEND_BASE_URL` apunta a `http://host.docker.internal:`
#       (el runner) y a nada más.
#   ⚠️ Lo que este candado NO ve: las variables de Railway/Vercel de producción
#   (no están en el repo). Comprobarlas es del operador: DEVOPS_NOTES «Correo en
#   el E2E real».
#
# Uso: ./scripts/check-mail-sink-scope.sh [--root DIR]
# rc: 0 verde · 1 rojo
# Canario: scripts/check-mail-sink-scope-canary.sh
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
while [ $# -gt 0 ]; do
  case "$1" in
    --root) ROOT="${2:-}"; shift 2 ;;
    *) echo "uso: $0 [--root DIR]"; exit 2 ;;
  esac
done
cd "$ROOT" || { echo "✗ no puedo entrar en $ROOT"; exit 1; }

VAR='RESEND_BASE_''URL'
OVR='docker-compose.e2e-mail.yml'
FALLOS=0
bad() { printf '✗ %s\n' "$*"; FALLOS=$((FALLOS+1)); }

# R1 ---------------------------------------------------------------------------
PERMITIDOS=" ./$OVR ./scripts/e2e-mail-sink.mjs ./scripts/check-mail-sink-scope.sh ./scripts/check-mail-sink-scope-canary.sh "
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$PERMITIDOS" in *" $f "*) continue ;; esac
  case "$f" in ./docs/*.md) continue ;; esac
  bad "R1 $VAR aparece en $f: solo puede vivir en $OVR (desviaría el correo de producción)."
done < <(grep -rIl --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next \
           --exclude-dir=test-results --exclude-dir=playwright-report -e "$VAR" . 2>/dev/null | sort)

[ -f "$OVR" ] || bad "R1 falta $OVR (el E2E real no tendría buzón; si se retiró a propósito, retira también este candado)."

# R2 ---------------------------------------------------------------------------
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in
    ./.github/workflows/e2e-real.yml|"./$OVR"|./scripts/check-mail-sink-scope.sh|./scripts/check-mail-sink-scope-canary.sh|./scripts/e2e-mail-sink.mjs) continue ;;
    ./docs/*.md) continue ;;
  esac
  bad "R2 $f usa $OVR: el buzón falso es SOLO de e2e-real.yml."
done < <(grep -rIl --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next \
           --exclude-dir=test-results --exclude-dir=playwright-report -e 'docker-compose\.e2e-mail' . 2>/dev/null | sort)

# R3 ---------------------------------------------------------------------------
if [ -f "$OVR" ]; then
  VALORES="$(grep -E "^[[:space:]]*-?[[:space:]]*${VAR}[:=]" "$OVR" || true)"
  [ -n "$VALORES" ] || bad "R3 $OVR no declara $VAR: el buzón no recibiría nada."
  while IFS= read -r l; do
    [ -n "$l" ] || continue
    v="$(printf '%s' "$l" | sed -E "s/^[[:space:]]*-?[[:space:]]*${VAR}[:=][[:space:]]*//; s/^[\"']//; s/[\"'][[:space:]]*\$//")"
    case "$v" in
      'http://host.docker.internal:'*) : ;;
      *) bad "R3 $OVR apunta $VAR a «$v»: solo se admite http://host.docker.internal:<puerto> (el runner)." ;;
    esac
  done <<< "$VALORES"
fi

if [ "$FALLOS" -gt 0 ]; then
  echo "check-mail-sink-scope: ROJO ($FALLOS)"
  exit 1
fi
echo "check-mail-sink-scope: verde — $VAR solo en $OVR, que solo usa e2e-real.yml, y apunta al runner."

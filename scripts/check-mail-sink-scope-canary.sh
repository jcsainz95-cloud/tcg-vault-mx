#!/usr/bin/env bash
#
# check-mail-sink-scope-canary.sh — demuestra que check-mail-sink-scope.sh MUERDE · devops
# =============================================================================
# Copia solo lo que el candado lee (compose, .env.example, workflows, scripts del
# buzón, un fichero de backend) a un directorio temporal, comprueba que el
# prístino sale VERDE y que cada mutación lo pone ROJO nombrando la regla.
# Uso: ./scripts/check-mail-sink-scope-canary.sh      rc: 0 si TODAS muerden
# =============================================================================
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE_REL="scripts/check-mail-sink-scope.sh"
[ -f "$ROOT_DIR/$GATE_REL" ] || { echo "✗ No existe $GATE_REL: el candado desapareció."; exit 1; }

VAR='RESEND_BASE_''URL'
BASE="$(mktemp -d -t mail-sink-canario-XXXXXX)"
trap 'rm -rf "$BASE"' EXIT
P="$BASE/pristino"
mkdir -p "$P/scripts" "$P/backend/src/modules/mail"
cp "$ROOT_DIR/$GATE_REL" "$P/$GATE_REL"
cp "$ROOT_DIR/scripts/check-mail-sink-scope-canary.sh" "$ROOT_DIR/scripts/e2e-mail-sink.mjs" "$P/scripts/"
cp -r "$ROOT_DIR/.github" "$P/.github"
cp "$ROOT_DIR"/docker-compose*.yml "$P/"
cp "$ROOT_DIR/.env.example" "$P/.env.example"
cp "$ROOT_DIR/backend/src/modules/mail/mail.module.ts" "$P/backend/src/modules/mail/"

PASADAS=0; FALLOS=0
correr() { bash "$1/$GATE_REL" --root "$1" 2>&1; }

salida="$(correr "$P")"; rc=$?
if [ "$rc" -ne 0 ]; then
  echo "✗ el árbol PRÍSTINO ya sale rojo: el canario no puede medir nada."; echo "$salida"; exit 1
fi
echo "  ✔ prístino VERDE"

caso() { # caso <nombre> <regla esperada> <mutador>
  local d="$BASE/c$((PASADAS+FALLOS+1))"
  rm -rf "$d"; cp -a "$P" "$d"; "$3" "$d"
  local s r; s="$(correr "$d")"; r=$?
  if [ "$r" -eq 0 ]; then echo "  ✗ $1 — VERDE ante la mutación"; FALLOS=$((FALLOS+1)); return; fi
  if ! grep -q "^✗ $2 " <<< "$s"; then echo "  ✗ $1 — rojo, pero no por $2"; echo "$s" | head -3; FALLOS=$((FALLOS+1)); return; fi
  echo "  ✔ $1 — ROJO por $2"; PASADAS=$((PASADAS+1))
}

ins() { awk -v pat="$2" -v linea="$3" '{print} !h && index($0, pat) {print linea; h=1}' "$1" > "$1.tmp" && mv "$1.tmp" "$1"; }

m_staging() { ins "$1/docker-compose.staging.yml" 'RESEND_API_KEY:' "      $VAR: \${$VAR:-}"; }
m_local()   { ins "$1/docker-compose.yml" 'environment:' "      $VAR: http://host.docker.internal:8025"; }
m_envex()   { printf '%s=\n' "$VAR" >> "$1/.env.example"; }
m_backend() { printf '// %s\nexport const X = process.env.%s;\n' x "$VAR" >> "$1/backend/src/modules/mail/mail.module.ts"; }
m_wf_var()  { ins "$1/.github/workflows/deploy.yml" 'runs-on:' "    env: { $VAR: 'https://example.invalid' }"; }
m_wf_ovr()  { printf '# docker compose -f docker-compose.staging.yml -f docker-compose.e2e-mail.yml up\n' >> "$1/.github/workflows/security-dast.yml"; }
m_url()     { sed -E "s#($VAR: ).*#\\1https://example.invalid#" "$1/docker-compose.e2e-mail.yml" > "$1/x" && mv "$1/x" "$1/docker-compose.e2e-mail.yml"; }
m_novar()   { grep -v "$VAR" "$1/docker-compose.e2e-mail.yml" > "$1/x"; mv "$1/x" "$1/docker-compose.e2e-mail.yml"; }

caso "variable en docker-compose.staging.yml"     R1 m_staging
caso "variable en docker-compose.yml"             R1 m_local
caso "variable en .env.example"                   R1 m_envex
caso "variable leída en backend/src"              R1 m_backend
caso "variable en deploy.yml"                     R1 m_wf_var
caso "override usado por security-dast.yml"       R2 m_wf_ovr
caso "override apuntando fuera del runner"        R3 m_url
caso "override sin la variable"                   R3 m_novar

TOTAL=$((PASADAS+FALLOS))
echo "check-mail-sink-scope-canary: $PASADAS/$TOTAL mutaciones muerden"
[ "$FALLOS" -eq 0 ]

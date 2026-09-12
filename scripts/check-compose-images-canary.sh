#!/usr/bin/env bash
#
# check-compose-images-canary.sh — «¿el candado de imágenes clavadas muerde?»
#                                                                        · devops
# =============================================================================
# DE DÓNDE VIENE (2026-09-11)
# ---------------------------------------------------------------------------
# El candado `check-compose-images.sh` nació porque `minio/minio:latest` dejó de
# ser descargable y se llevó por delante el DAST entero. Un candado que vigila
# eso tiene que poder ponerse ROJO, y tiene que hacerlo también cuando la
# etiqueta móvil llega por un camino que nadie previó — sobre todo **en un
# compose que aún no existe**, que es como volvería a entrar el defecto.
#
# Muta SIEMPRE sobre una COPIA (O-8/O-9): el árbol vivo no se toca (hay más
# agentes trabajando en él). Cada mutación se corre N veces y se reporta la
# proporción (O-3).
#
#   m1  `:latest` en una imagen que estaba clavada
#   m2  etiqueta IMPLÍCITA (sin `:`) — el `latest` que no se ve
#   m3  `${MINIO_TAG}` sin resolver — «la que diga el entorno» no es una versión
#   m4  etiqueta que no es versión (`:alpine`) — parece fija y no lo es
#   m5  un compose NUEVO con una imagen móvil ⇒ prueba que la enumeración NO es
#       una lista a mano y que un fichero nuevo entra solo
#   m6  (control inverso) clavar por digest `@sha256:` ⇒ el candado debe seguir VERDE
#
# Uso:  ./scripts/check-compose-images-canary.sh [N]
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
N="${1:-3}"
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
mal() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }

BASE="$(mktemp -d -t compose-pin-canary-XXXXXX)"; trap 'rm -rf "$BASE"' EXIT

preparar() {
  D="$BASE/$1"; rm -rf "$D"; mkdir -p "$D/scripts"
  cp "$ROOT_DIR/scripts/check-compose-images.sh" "$D/scripts/" || return 1
  chmod +x "$D/scripts/check-compose-images.sh"
  # Un compose de referencia PROPIO del canario: así el canario no depende de
  # cómo esté hoy el árbol (si mañana el árbol cambia, este caso sigue midiendo
  # lo mismo). Todo clavado a propósito.
  cat >"$D/docker-compose.yml" <<'YML'
services:
  postgres:
    image: postgres:16-alpine
  redis:
    image: redis:7-alpine
  objeto:
    image: quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z
  construido:
    build:
      context: .
      dockerfile: Dockerfile.backend
YML
  # Y un workflow de referencia, CLAVADO: desde §4.52.4 el candado también mira
  # `services:`/`container:` de `.github/workflows/**` — ahí vivía la imagen que
  # bloqueaba el despliegue y que no vigilaba nadie.
  mkdir -p "$D/.github/workflows"
  cat >"$D/.github/workflows/ci.yml" <<'YML2'
jobs:
  pruebas:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
    steps:
      - run: echo ok
  escaner:
    runs-on: ubuntu-latest
    container:
      image: returntocorp/semgrep:1.177.0
    steps:
      - run: echo ok
YML2
  printf '%s' "$D"
}

D0="$(preparar limpio)" || { echo "✗ no pude preparar la copia. NO concluyente."; exit 2; }
if ( cd "$D0" && ./scripts/check-compose-images.sh >/dev/null 2>&1 ); then
  ok "la copia sin mutar sale VERDE (y el servicio con \`build:\` no cuenta como imagen externa)"
else
  mal "la copia sin mutar ya sale roja: el canario no puede concluir nada"
  ( cd "$D0" && ./scripts/check-compose-images.sh 2>&1 | tail -12 )
  echo; printf '\033[1;31m✗ Canario de imágenes: base rota.\033[0m\n'; exit 1
fi

mutar() { # $1=id  $2=descripción  $3=comando sh dentro de la copia  $4=esperado (ROJO|VERDE)
  local id="$2" cmd="$3" esperado="${4:-ROJO}" cuenta=0 i D
  for i in $(seq 1 "$N"); do
    D="$(preparar "m$1_$i")" || continue
    ( cd "$D" && eval "$cmd" ) || { printf '  (m%s: la mutación no aplicó)\n' "$1"; continue; }
    if ( cd "$D" && ./scripts/check-compose-images.sh >/dev/null 2>&1 ); then
      [ "$esperado" = "VERDE" ] && cuenta=$((cuenta+1))
    else
      [ "$esperado" = "ROJO" ] && cuenta=$((cuenta+1))
    fi
  done
  if [ "$cuenta" -eq "$N" ]; then ok "m$1 · $id ⇒ candado $esperado $cuenta/$N"
  else mal "m$1 · $id ⇒ solo $cuenta/$N salieron $esperado (debería ser $N/$N)"; fi
}

mutar 1 'etiqueta `:latest` en una imagen clavada' \
  "sed -i 's|postgres:16-alpine|postgres:latest|' docker-compose.yml" ROJO

mutar 2 'etiqueta IMPLÍCITA (sin dos puntos)' \
  "sed -i 's|postgres:16-alpine|postgres|' docker-compose.yml" ROJO

mutar 3 'interpolación ${MINIO_TAG} sin resolver' \
  "sed -i 's|quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z|quay.io/minio/minio:\${MINIO_TAG}|' docker-compose.yml" ROJO

mutar 4 'etiqueta que NO es versión (:alpine)' \
  "sed -i 's|postgres:16-alpine|postgres:alpine|' docker-compose.yml" ROJO

mutar 5 'compose NUEVO con imagen móvil (la enumeración no es una lista a mano)' \
  "printf 'services:\n  colado:\n    image: minio/minio:latest\n' > docker-compose.nuevo.yml" ROJO

mutar 6 'clavar por DIGEST @sha256 (control inverso: debe seguir verde)' \
  "sed -i 's|postgres:16-alpine|postgres@sha256:0000000000000000000000000000000000000000000000000000000000000000|' docker-compose.yml" VERDE

# --- §4.52.4: la cobertura NUEVA (workflows). Es donde vivía el MinIO que
# bloqueaba el deploy, así que su canario no es opcional.
mutar 7 'service de WORKFLOW con etiqueta movil (el caso bitnamilegacy/minio:latest)' \
  "sed -i 's|image: postgres:16-alpine|image: bitnamilegacy/minio:latest|' .github/workflows/ci.yml" ROJO

mutar 8 'container: de WORKFLOW con etiqueta movil (el caso semgrep:latest)' \
  "sed -i 's|image: returntocorp/semgrep:1.177.0|image: returntocorp/semgrep:latest|' .github/workflows/ci.yml" ROJO

mutar 9 'workflow NUEVO con service movil (la enumeracion de workflows no es una lista)' \
  "printf 'jobs:\\n  colado:\\n    runs-on: ubuntu-latest\\n    services:\\n      almacen:\\n        image: minio/minio:latest\\n    steps:\\n      - run: echo ok\\n' > .github/workflows/nuevo.yml" ROJO

echo
if [ "$FALLOS" -eq 0 ]; then
  printf '\033[1;32m✓ Canario de imágenes clavadas: %s/%s.\033[0m\n' "$PASADAS" "$PASADAS"
  exit 0
fi
printf '\033[1;31m✗ Canario de imágenes clavadas: %s fallo(s) de %s.\033[0m\n' "$FALLOS" "$((PASADAS+FALLOS))"
exit 1

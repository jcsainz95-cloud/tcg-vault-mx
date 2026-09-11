#!/usr/bin/env bash
#
# check-compose-images.sh — «¿de qué imágenes ajenas cuelga este proyecto, y
#                            están TODAS clavadas?»                      · devops
# =============================================================================
# DE DÓNDE VIENE (2026-09-11, run `34650494939`)
# ---------------------------------------------------------------------------
# El DAST —la ÚNICA puerta que mira la aplicación CORRIENDO— llevaba meses
# colgando de que una imagen ajena siguiera siendo descargable, y nadie lo
# vigilaba. Un día Docker Hub dejó de servir `minio/minio` sin autenticación:
#
#     minio Error pull access denied for minio/minio, repository does not exist
#           or may require 'docker login': denied
#     ✗  compose up falló
#
# Nuestro árbol era **byte a byte** idéntico al de la release anterior, que pasó.
# No cambió nuestro código: cambió lo que hay **al otro lado**. Y como la etiqueta
# era `:latest` —una etiqueta MÓVIL— no había ni siquiera un número al que volver.
#
#     ► «Una cobertura que se cree viva y depende de algo que nadie vigila es
#        la misma clase de defecto de §56, con otro disfraz.»
#
# QUÉ EXIGE (estático, sin red — corre en cada PR)
# ---------------------------------------------------------------------------
# Enumera **todas** las imágenes externas de **todos** los `docker-compose*.yml`
# (no una lista a mano: un compose nuevo entra solo) y exige que cada una esté
# **CLAVADA**: por `@sha256:` (lo más fuerte) o por una etiqueta de VERSIÓN.
# Rechaza `:latest`, `:stable`, `:main`, `:edge`, `:master`, `:dev`, la etiqueta
# IMPLÍCITA (sin `:`) y cualquier `${VARIABLE}` sin resolver — porque «la imagen
# que me den hoy» no es una dependencia, es una apuesta.
#
# MODO `--resolve` (CON red, opcional): además comprueba que cada imagen clavada
# **existe y se puede descargar ANÓNIMAMENTE** en su registro. Eso es lo que
# habría cazado este incidente el día que pasó, en vez de en el siguiente deploy.
# No se mete en el candado estático a propósito: un candado de PR no puede
# depender de que un registro ajeno esté de buenas.
#
# Uso:
#   ./scripts/check-compose-images.sh              # estático (CI)
#   ./scripts/check-compose-images.sh --resolve    # + comprobar que se descargan
#   ./scripts/check-compose-images.sh --list       # solo enumerar
#
# Sale 0 si todas están clavadas (y resuelven, en `--resolve`); 1 si alguna no;
# 2 si no pudo medir.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR" || exit 2

MODO="check"
case "${1:-}" in
  --resolve) MODO="resolve" ;;
  --list)    MODO="list" ;;
  "")        ;;
  -h|--help) sed -n '1,45p' "$0"; exit 0 ;;
  *) echo "::error::opción desconocida '${1}'. Uso: $0 [--resolve|--list]"; exit 2 ;;
esac

command -v python3 >/dev/null 2>&1 || { echo "::error::sin python3 no puedo leer los compose. NO concluyente."; exit 2; }

# --- Enumeración: TODOS los compose, TODOS los servicios con `image:` --------
INVENTARIO="$(python3 - <<'PY'
import glob, sys
try:
    import yaml
except ImportError:
    print("ERRNOYAML"); sys.exit(0)
filas = []
for f in sorted(glob.glob("docker-compose*.yml")) + sorted(glob.glob("docker-compose*.yaml")):
    try:
        d = yaml.safe_load(open(f)) or {}
    except Exception as e:
        print(f"ERRPARSE\t{f}\t{e}"); sys.exit(0)
    for nombre, svc in (d.get("services") or {}).items():
        if not isinstance(svc, dict):
            continue
        img = svc.get("image")
        if img:
            filas.append(f"{f}\t{nombre}\t{img}")
if not filas:
    print("ERRVACIO")
else:
    print("\n".join(filas))
PY
)"
case "$INVENTARIO" in
  ERRNOYAML*) echo "::error::falta PyYAML (python3 -m pip install pyyaml). NO concluyente."; exit 2 ;;
  ERRPARSE*)  echo "::error::un compose no parsea: ${INVENTARIO#ERRPARSE	}. NO concluyente."; exit 2 ;;
  ERRVACIO*)  echo "::error::no encontré NINGUNA imagen en los compose. Eso no es «todo clavado»: es «no medí»."; exit 2 ;;
esac

# --- Clasificación -----------------------------------------------------------
# CLAVADA  = `@sha256:…`  ó  etiqueta de versión (empieza por dígito, o `vN…`,
#            o `RELEASE.…` que es la convención de MinIO).
# MÓVIL    = etiqueta de la lista negra, etiqueta IMPLÍCITA, o `${VAR}`.
clasificar() { # $1 = referencia de imagen -> imprime "CLAVADA|MOVIL<TAB>motivo"
  ref="$1"
  case "$ref" in
    *'${'*) printf 'MOVIL\tinterpolación sin resolver (`%s`): lo que se descargue depende del entorno' "$ref"; return ;;
    *@sha256:*) printf 'CLAVADA\tdigest inmutable'; return ;;
  esac
  # La etiqueta es lo que va tras el ÚLTIMO `:`, y solo si ese `:` va después
  # del último `/` (si no, es el puerto de un registro: `host:5000/img`).
  resto="${ref##*/}"
  case "$resto" in
    *:*) tag="${resto##*:}" ;;
    *)   printf 'MOVIL\tetiqueta IMPLÍCITA (sin `:`) ⇒ `latest` ⇒ hoy te dan una cosa y mañana otra'; return ;;
  esac
  case "$tag" in
    latest|stable|main|master|edge|dev|devel|nightly|rolling|release|current)
      printf 'MOVIL\tetiqueta móvil `:%s` ⇒ no hay número al que volver' "$tag"; return ;;
  esac
  case "$tag" in
    RELEASE.[0-9]*) printf 'CLAVADA\tetiqueta de versión `%s`' "$tag"; return ;;
    [0-9]*)         printf 'CLAVADA\tetiqueta de versión `%s`' "$tag"; return ;;
    v[0-9]*)        printf 'CLAVADA\tetiqueta de versión `%s`' "$tag"; return ;;
  esac
  printf 'MOVIL\tetiqueta `:%s` no parece una versión (ni dígito inicial, ni `vN`, ni `RELEASE.`, ni digest)' "$tag"
}

# --- `--resolve`: ¿existe y se descarga ANÓNIMAMENTE? ------------------------
resolver() { # $1 = referencia -> 0 si se puede descargar anónimamente
  ref="$1"; ref="${ref%%@*}"
  resto="${ref##*/}"; sinTag="${ref%:*}"
  case "$resto" in *:*) tag="${resto##*:}" ;; *) tag="latest" ;; esac
  case "$sinTag" in
    */*/*|*.*/*) registro="${sinTag%%/*}"; repo="${sinTag#*/}" ;;
    */*)         registro="registry-1.docker.io"; repo="$sinTag" ;;
    *)           registro="registry-1.docker.io"; repo="library/$sinTag" ;;
  esac
  case "$registro" in *.*|localhost*) ;; *) repo="$registro/$repo"; registro="registry-1.docker.io" ;; esac
  desafio="$(curl -sS -m 20 -o /dev/null -D - "https://$registro/v2/" 2>/dev/null | tr -d '\r' | grep -i '^www-authenticate:')"
  realm="$(sed -E 's/.*realm="([^"]+)".*/\1/i' <<<"$desafio")"
  servicio="$(sed -E 's/.*service="([^"]+)".*/\1/i' <<<"$desafio")"
  tok=""
  [ -n "$realm" ] && tok="$(curl -sS -m 20 "$realm?service=$servicio&scope=repository:$repo:pull" 2>/dev/null \
      | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('token') or d.get('access_token') or '')" 2>/dev/null)"
  codigo="$(curl -sS -m 25 -o /dev/null -w '%{http_code}' \
      -H "Authorization: Bearer ${tok:-}" \
      -H 'Accept: application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.v2+json' \
      "https://$registro/v2/$repo/manifests/$tag" 2>/dev/null)"
  printf '%s' "$codigo"
}

MAL=0; BIEN=0; TOTAL=0
printf '\n\033[1m== Imágenes externas de los compose: ¿clavadas? ==\033[0m\n\n'
while IFS=$'\t' read -r fichero servicio imagen; do
  [ -n "${imagen:-}" ] || continue
  TOTAL=$((TOTAL+1))
  IFS=$'\t' read -r veredicto motivo <<<"$(clasificar "$imagen")"
  if [ "$veredicto" = "CLAVADA" ]; then
    BIEN=$((BIEN+1))
    printf '  \033[1;32m✔\033[0m %-34s %-14s %s\n' "$imagen" "$servicio" "$motivo"
  else
    MAL=$((MAL+1))
    printf '  \033[1;31m✗\033[0m %-34s %-14s %s\n' "$imagen" "$servicio" "$motivo"
    printf '      └─ %s (servicio `%s`)\n' "$fichero" "$servicio"
  fi
  if [ "$MODO" = "resolve" ] && [ "$veredicto" = "CLAVADA" ]; then
    cod="$(resolver "$imagen")"
    case "$cod" in
      200) printf '      \033[2m└─ se descarga anónimamente (HTTP 200)\033[0m\n' ;;
      401|403) MAL=$((MAL+1)); printf '      \033[1;31m└─ NO se descarga anónimamente (HTTP %s): exige login. Esto es lo que tumbó el DAST.\033[0m\n' "$cod" ;;
      404) MAL=$((MAL+1)); printf '      \033[1;31m└─ NO EXISTE (HTTP 404): la etiqueta está mal escrita o se retiró.\033[0m\n' ;;
      *)   printf '      \033[1;33m└─ no concluyente (HTTP %s): registro inalcanzable desde aquí\033[0m\n' "$cod" ;;
    esac
  fi
done <<<"$INVENTARIO"

echo
if [ "$MODO" = "list" ]; then
  printf '  %s imagen(es) externa(s) en los compose.\n\n' "$TOTAL"; exit 0
fi
printf '  imágenes: %s · clavadas: %s · sin clavar: %s\n\n' "$TOTAL" "$BIEN" "$MAL"
if [ "$MAL" -ne 0 ]; then
  cat <<'FIN'
  ✗ Hay imágenes sin clavar (o que ya no se descargan).
    Una etiqueta móvil no es una dependencia: es una apuesta a que nadie de fuera
    cambie nada. El día que cambie, se cae el stack efímero y con él el DAST —
    la única puerta que mira la aplicación corriendo— y el árbol propio estará
    intacto, así que nadie sabrá dónde mirar.
    Arreglo: poner versión (`:1.2.3`, `:RELEASE.…`) o digest (`@sha256:…`).
FIN
  exit 1
fi
printf '\033[1;32m✓ Las %s imágenes externas están clavadas.\033[0m\n' "$TOTAL"
exit 0

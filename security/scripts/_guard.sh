#!/usr/bin/env bash
#
# _guard.sh — Guardia anti-producción COMPARTIDA de los scripts DAST. devops.
# =============================================================================
# Se SOURCEA desde los 4 scripts dast-*.sh (source obligatorio: si este archivo
# falta, el script que lo sourcea aborta por `set -e` — los 5 viven juntos en
# security/scripts/ y viajan juntos en el repo).
#
# P-21 cierre (hallazgo QA + DO-P21-1): la versión anterior comparaba SUBSTRING
# sobre la URL completa (`*"staging"*`), así que `https://tcghunt.mx/staging-x`
# o `?env=staging` la bypaseaban. Esta versión extrae el HOST de TARGET_URL y
# decide SOLO por host:
#   * Producción = el host es (o es subdominio de) `tcgvaultmx.com` (dominio
#     viejo, prod mientras viva el redirect 301), `tcghunt.mx` (dominio nuevo)
#     o el placeholder histórico `tudominio.com`.
#   * Exención de staging = el HOST empieza con `staging.` (p. ej.
#     `staging.tcghunt.mx`). Un path/query que contenga "staging" NO exime.
#   * Producción solo se permite con ALLOW_PROD_DAST=1, dentro de una ventana
#     autorizada por escrito (runbook en docs/DEVOPS_NOTES.md).
# =============================================================================

# Extrae el host de una URL: quita esquema, userinfo, path/query/fragment y
# puerto; normaliza a minúsculas. Ej.: "https://u@Staging.TCGhunt.mx:443/a?b=c"
# → "staging.tcghunt.mx".
_dast_host_from_url() {
  local h="$1"
  h="${h#*://}"      # esquema
  h="${h%%/*}"       # path
  h="${h%%\?*}"      # query (si no había path)
  h="${h%%#*}"       # fragment
  h="${h##*@}"       # userinfo
  h="${h%%:*}"       # puerto
  printf '%s' "${h}" | tr '[:upper:]' '[:lower:]'
}

# dast_prod_guard <TARGET_URL> — aborta con exit 2 si el host es de producción
# y no hay ALLOW_PROD_DAST=1. No imprime nada si el objetivo es válido.
dast_prod_guard() {
  local url="${1:-${TARGET_URL:-}}"
  if [[ -z "${url}" ]]; then
    echo "✗ dast_prod_guard: falta TARGET_URL." >&2
    exit 2
  fi

  local host
  host="$(_dast_host_from_url "${url}")"

  local is_prod=0
  case "${host}" in
    tcgvaultmx.com | *.tcgvaultmx.com) is_prod=1 ;;
    tcghunt.mx | *.tcghunt.mx) is_prod=1 ;;
    tudominio.com | *.tudominio.com) is_prod=1 ;;
  esac

  # Exención SOLO por host de staging (prefijo del HOST, no substring de la URL).
  case "${host}" in
    staging.*) is_prod=0 ;;
  esac

  if [[ "${is_prod}" == "1" && "${ALLOW_PROD_DAST:-0}" != "1" ]]; then
    echo "✗ TARGET_URL apunta a PRODUCCIÓN (host: ${host}). El DAST contra prod requiere autorización." >&2
    echo "  Sigue el runbook 'prueba puntual autorizada' (docs/DEVOPS_NOTES.md) y" >&2
    echo "  exporta ALLOW_PROD_DAST=1 solo dentro de la ventana autorizada." >&2
    exit 2
  fi
}

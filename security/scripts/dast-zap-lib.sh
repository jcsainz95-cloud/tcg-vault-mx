# shellcheck shell=bash
# dast-zap-lib.sh — lo común a TODO script que arranca ZAP. devops. Se hace `source`.
# =============================================================================
# DEVOPS_NOTES §96.7. Dos cosas que tienen que ser iguales en los cuatro sitios
# que lanzan ZAP (dast-ephemeral, dast-selftest, dast-zap-full, dast-zap-baseline),
# y que por eso viven en UN sitio:
#
# 1) LA IMAGEN, FIJADA POR DIGEST. `:stable` es una etiqueta móvil de un tercero:
#    la decide un desconocido por nosotros (CLAUDE.md, «Toda dependencia externa
#    va fijada»). Este digest es el que corrió el DAST full de producción
#    (job 114263040360) y el que reventó con 10055-3 (job 114278597979): misma
#    imagen, así que el reventón fue del sha, no del entorno. Para subirla: medir
#    el digest nuevo (`docker pull ghcr.io/zaproxy/zaproxy:stable` → «Digest:»),
#    cambiar AQUÍ y correr el canario de security-dast.yml en la rama-taller.
#    Lo vigila scripts/check-zap-conf.sh.
#
# 2) LA POLÍTICA QUE RECIBE ZAP ≠ LA QUE LEE EL CANDADO. ZAP solo entiende claves
#    enteras; dast-gate.py además entiende `<regla>-<sub>`. `zap_conf_for_zap`
#    escribe la copia filtrada que se le monta a ZAP. El original sigue siendo la
#    única fuente de verdad, y lo lee dast-gate.py con --policy.
# =============================================================================

ZAP_IMAGE_FIJADA="ghcr.io/zaproxy/zaproxy@sha256:7aaa659b0d43078febd82e29bad112285c370727e86ab8340444220e17d9f0d2"
ZAP_IMAGE="${ZAP_IMAGE:-${ZAP_IMAGE_FIJADA}}"

# Ruta DENTRO del contenedor donde se monta la copia filtrada. Un nombre distinto
# de `conf/` a propósito: el candado estático distingue así «recibe la filtrada»
# de «recibe el original».
ZAP_CONF_MOUNT="/zap/wrk/conf-zap"

# zap_conf_for_zap <dir_salida>
#   Deja <dir_salida>/baseline.conf con solo lo que ZAP sabe leer y comprueba,
#   con la emulación de su lector, que no lo hará reventar. rc≠0 ⇒ NO arrancar ZAP.
zap_conf_for_zap() {
  local out_dir="$1" lib_dir
  lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local politica="${lib_dir}/../zap/baseline.conf"
  mkdir -p "${out_dir}" || return 1
  python3 "${lib_dir}/dast-zap-policy.py" for-zap "${politica}" "${out_dir}/baseline.conf" || return 1
  python3 "${lib_dir}/dast-zap-policy.py" check "${out_dir}/baseline.conf" || return 1
  # ZAP corre como uid 1000 dentro del contenedor.
  chmod 755 "${out_dir}" 2>/dev/null || true
  chmod 644 "${out_dir}/baseline.conf" 2>/dev/null || true
}

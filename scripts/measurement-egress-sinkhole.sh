#!/usr/bin/env bash
#
# measurement-egress-sinkhole.sh — «nada sale de CI a Google ni a Meta» (C-F3, API_CONTRACT §MKT.H.11)  · devops
# =============================================================================
# Los specs de medición interceptan los terceros con `page.route` (frontend). Esto es la RED DE
# SEGURIDAD de devops por debajo: aunque un spec olvide interceptar un host, el runner no puede
# resolverlo, así que ninguna petición sale a la red real (y el spec lo ve como petición fallida,
# que sigue contando como «hubo petición» para C-F3).
#
#   sudo ./scripts/measurement-egress-sinkhole.sh apply    # añade los hosts a /etc/hosts → 0.0.0.0
#   ./scripts/measurement-egress-sinkhole.sh verify        # rc 1 si alguno resuelve a otra cosa
#
# Lista de hosts: los de medición de ARCHITECTURE §14.8 en sus nombres concretos (un /etc/hosts no
# admite comodines). Si `gtag.js`/`fbevents.js` piden un host nuevo, se añade aquí.
# NO se tocan accounts.google.com ni www.google.com (no son de medición; §14.8).
# =============================================================================
set -uo pipefail
HOSTS=(
  googletagmanager.com www.googletagmanager.com
  google-analytics.com www.google-analytics.com region1.google-analytics.com ssl.google-analytics.com
  analytics.google.com region1.analytics.google.com
  stats.g.doubleclick.net googleads.g.doubleclick.net
  connect.facebook.net facebook.com www.facebook.com
)
case "${1:-}" in
  apply)
    [ -w /etc/hosts ] || { echo "::error::/etc/hosts no es escribible (¿sin sudo?)"; exit 2; }
    { echo "# measurement-egress-sinkhole (C-F3): nada sale a Google/Meta desde CI"; for h in "${HOSTS[@]}"; do echo "0.0.0.0 $h"; done; } >> /etc/hosts
    echo "sumidero aplicado a ${#HOSTS[@]} hosts." ;;
  verify)
    malos=0
    for h in "${HOSTS[@]}"; do
      ip="$(getent hosts "$h" | awk '{print $1}' | head -1)"
      if [ "$ip" != "0.0.0.0" ] && [ -n "$ip" ]; then echo "::error::$h resuelve a $ip (debería ser 0.0.0.0): saldría a la red real."; malos=$((malos+1)); fi
    done
    [ "$malos" -eq 0 ] && echo "VERDE: ${#HOSTS[@]} hosts de medición no salen del runner." || exit 1 ;;
  *) echo "uso: $0 apply|verify"; exit 2 ;;
esac

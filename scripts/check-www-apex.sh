#!/usr/bin/env bash
#
# check-www-apex.sh — MKT-E2: ¿`www.tcghunt.mx` redirige PERMANENTE al apex conservando ruta y query?  · devops
# =============================================================================
# El canónico de la tienda es el APEX (`https://tcghunt.mx`: es el que usan metadataBase, sitemap y
# enlaces del frontend; medido 2026-10-19 con grep de frontend/src). `www` es un alias que debe
# devolver 301 (o 308, equivalente para buscadores) a `https://tcghunt.mx<misma ruta>?<misma query>`.
#
# Medido el 2026-10-19 (DEVOPS_NOTES §101.6): `www.tcghunt.mx` NO EXISTE en el DNS (NXDOMAIN en la
# zona de Cloudflare `eleanor.ns.cloudflare.com`), así que hoy no hay nada que redirigir y NADA del
# repo puede arreglarlo: ni `vercel.json` ni el middleware reciben una petición a un nombre que no
# resuelve. Lo hace el dueño en dos pantallas (Vercel → Domains y Cloudflare → DNS); esto lo verifica.
#
# Uso:  ./scripts/check-www-apex.sh [ruta-con-query]      (por defecto /es/catalogo?utm_source=e2)
# Sale 0 verde · 1 rojo (no redirige o redirige mal) · 2 no se pudo medir (red/proxy).
# Lo corre un rol técnico, no el dueño (O-21).
# =============================================================================
set -uo pipefail
RUTA="${1:-/es/catalogo?utm_source=e2}"
WWW="https://www.tcghunt.mx$RUTA"; ESPERADO="https://tcghunt.mx$RUTA"
# DNS primero, por DNS-sobre-HTTPS: detrás de un proxy, un NXDOMAIN llega como «CONNECT 502» y se
# confundiría con la política de red (medido así el 2026-10-19).
DNS="$(curl -sS -m 15 "https://dns.google/resolve?name=www.tcghunt.mx&type=A" 2>/dev/null | jq -r '.Status // empty' 2>/dev/null)"
if [ "$DNS" = "3" ]; then echo "ROJO: www.tcghunt.mx no existe en el DNS (NXDOMAIN, dns.google): falta el registro de www (DEVOPS_NOTES §101.6, paso del dueño)."; exit 1; fi
CAB="$(curl -sS -m 20 -o /dev/null -D - --max-redirs 0 "$WWW" 2>&1)"; rc=$?
if [ "$rc" -eq 6 ]; then echo "ROJO: www.tcghunt.mx no resuelve (NXDOMAIN): falta el registro DNS de www (DEVOPS_NOTES §101.6, paso del dueño)."; exit 1; fi
if [ "$rc" -ne 0 ]; then echo "NO MEDIDO: curl rc=$rc ($(tail -1 <<<"$CAB")). Si hay proxy, puede ser la política de red, no el sitio."; exit 2; fi
# Con proxy HTTP, curl antepone la respuesta del CONNECT: la que cuenta es la ÚLTIMA línea de estado.
ESTADO="$(grep -E '^HTTP/' <<<"$CAB" | tail -1 | awk '{print $2}')"
LOC="$(grep -i '^location:' <<<"$CAB" | tail -1 | sed 's/^[Ll]ocation:[[:space:]]*//' | tr -d '\r')"
case "$ESTADO" in
  301|308)
    if [ "$LOC" = "$ESPERADO" ]; then echo "VERDE: $WWW → $ESTADO → $LOC (ruta y query intactas)."; exit 0; fi
    echo "ROJO: $ESTADO pero Location=«$LOC», esperaba «$ESPERADO» (¿pierde la ruta o la query?)."; exit 1 ;;
  302|307) echo "ROJO: redirección TEMPORAL ($ESTADO → $LOC). En Vercel elige 301 (permanente)."; exit 1 ;;
  "") echo "NO MEDIDO: sin línea de estado HTTP en la respuesta."; exit 2 ;;
  *) echo "ROJO: www responde $ESTADO sin redirigir al apex."; exit 1 ;;
esac

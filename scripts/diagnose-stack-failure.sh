#!/usr/bin/env bash
#
# diagnose-stack-failure.sh — «que el job diga POR QUÉ, no que no arrancó» · devops
# =============================================================================
# DE DÓNDE VIENE
# ---------------------------------------------------------------------------
# `e2e-real.yml` run 34531002011: el paso «Esperar salud del backend» esperó
# **cinco minutos** y dijo «no respondió». El contenedor del backend había muerto
# a los tres segundos. Y el volcado de logs del final (`docker compose logs`) los
# ordena **por servicio, alfabéticamente**, así que las líneas del backend salen
# enterradas detrás de tres servicios que sí arrancaron.
#
# Coste medido de eso: **tres relanzamientos de 8 minutos** para averiguar una
# causa que el propio job tenía delante. Y el orquestador es el único que puede
# leer esos logs (el proxy le bloquea el blob storage de Actions), así que cada
# ida y vuelta cuesta una corrida entera.
#
# QUÉ HACE DISTINTO
#   1. **No espera a un contenedor muerto.** Si el backend ya salió, corta ya.
#   2. **El log del backend va PRIMERO y con cabecera propia**, no mezclado.
#   3. **La causa sale por `::error::`** — las anotaciones se leen por API, sin
#      descargar el log; y por `$GITHUB_STEP_SUMMARY`, que se ve en la página.
#   4. **Clasifica las firmas conocidas y dice de qué ROL es el hallazgo**, para
#      que no haya que adivinar a quién se enruta.
#
# Uso:
#   ./scripts/diagnose-stack-failure.sh <fichero-compose> [servicio]
# Siempre sale 0: es un diagnosticador, no un gate. Quien lo llama decide el rc.
# =============================================================================
set -uo pipefail

COMPOSE="${1:-docker-compose.staging.yml}"
SERVICIO="${2:-backend}"
LINEAS="${DIAG_LINEAS:-120}"

dc() { docker compose -f "$COMPOSE" "$@" 2>/dev/null; }

# --- Estado y código de salida ----------------------------------------------
# `ps -a` (no `ps`): un contenedor que MURIÓ no sale en `ps` a secas, y entonces
# el diagnóstico diría «no hay nada raro» sobre justo lo que falló.
ESTADO="$(dc ps -a --format '{{.Service}} {{.State}} {{.Status}}' | awk -v s="$SERVICIO" '$1==s')"
[ -n "$ESTADO" ] || ESTADO="$SERVICIO (sin registro en compose ps -a)"

LOG="$(dc logs --no-color --tail="$LINEAS" "$SERVICIO")"
[ -n "$LOG" ] || LOG="(el contenedor no emitió NADA: no llegó ni a ejecutar su entrypoint)"

# --- Firmas conocidas → causa y dueño ---------------------------------------
# Cada una nació de un fallo real. Si la firma no está, se dice que no se sabe:
# un diagnóstico inventado es peor que ninguno.
CAUSA="no clasificada — mira el log de abajo"
DUENO="por determinar"
case "$LOG" in
  *"PREFLIGHT DE SECRETOS — ARRANQUE ABORTADO"*)
    CAUSA="el preflight de secretos del ENTRYPOINT abortó: al contenedor le falta un secreto que exige security/secretos-exigidos-contenedor.txt (S-88-1)"
    DUENO="devops" ;;
  *"PREFLIGHT DEL WEBHOOK DE STRIPE — ARRANQUE ABORTADO"*)
    CAUSA="el preflight del webhook abortó: clave de Stripe real junto a un secreto ausente o publicado (P-WH-1)"
    DUENO="devops" ;;
  *"SIN BLANCO"*)
    CAUSA="el preflight arrancó sin catálogo: el fichero de exigidos no viajó en la imagen"
    DUENO="devops" ;;
  *"Missing required env vars"*|*"Weak JWT secret"*)
    CAUSA="la validación de entorno del backend rechazó la configuración recibida"
    DUENO="devops (config) — el mensaje dice qué variable" ;;
  *"P3009"*|*"migrate"*"failed"*|*"Migration"*"failed"*)
    CAUSA="las migraciones de Prisma fallaron al arrancar"
    DUENO="backend" ;;
  *"EADDRINUSE"*)
    CAUSA="el puerto ya estaba ocupado (¿stack superviviente?)"
    DUENO="devops" ;;
  *"Cannot find module"*|*"MODULE_NOT_FOUND"*)
    CAUSA="falta un módulo en la imagen (build incompleto)"
    DUENO="devops (Dockerfile) o backend (dependencia sin declarar)" ;;
  *"Nest application successfully started"*)
    CAUSA="el backend SÍ arrancó: el fallo está en la red/healthcheck, no en el arranque"
    DUENO="devops" ;;
esac

# --- 1) A la consola: el servicio que falló, PRIMERO y con cabecera ---------
printf '\n\033[1;31m========================================================================\033[0m\n'
printf '\033[1;31m  LOG DE «%s» — EL SERVICIO QUE FALLÓ, PRIMERO Y SOLO\033[0m\n' "$SERVICIO"
printf '\033[1;31m========================================================================\033[0m\n'
printf '  estado : %s\n' "$ESTADO"
printf '  causa  : %s\n' "$CAUSA"
printf '  dueño  : %s\n' "$DUENO"
printf '\033[1;31m------------------------------ log -----------------------------------\033[0m\n'
printf '%s\n' "$LOG"
printf '\033[1;31m========================================================================\033[0m\n\n'

# --- 2) Anotación: se lee por API, SIN descargar el log del job -------------
# El orquestador no puede bajar el blob del log. Las anotaciones sí se consultan
# por API, así que la causa viaja por ahí. `%0A` es el salto de línea que Actions
# entiende dentro del mensaje de una anotación.
if [ -n "${GITHUB_ACTIONS:-}" ]; then
  COLA="$(printf '%s\n' "$LOG" | tail -25 | sed 's/%/%25/g; s/\r/ /g' | awk '{printf "%s%%0A", $0}')"
  printf '::error title=%s no arrancó — %s::estado: %s%%0A%%0A--- ultimas lineas de %s ---%%0A%s\n' \
    "$SERVICIO" "$DUENO" "$ESTADO" "$SERVICIO" "$COLA"
fi

# --- 3) Resumen del job: se ve en la página, sin descargar nada -------------
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "## ❌ \`$SERVICIO\` no llegó a estar sano"
    echo ""
    echo "| | |"
    echo "|---|---|"
    echo "| **estado** | \`$ESTADO\` |"
    echo "| **causa** | $CAUSA |"
    echo "| **dueño del hallazgo** | **$DUENO** |"
    echo ""
    echo "<details open><summary>Últimas $LINEAS líneas de <code>$SERVICIO</code></summary>"
    echo ""
    echo '```'
    printf '%s\n' "$LOG"
    echo '```'
    echo ""
    echo "</details>"
    echo ""
    echo "<details><summary>Estado de todos los servicios</summary>"
    echo ""
    echo '```'
    dc ps -a
    echo '```'
    echo ""
    echo "</details>"
  } >> "$GITHUB_STEP_SUMMARY"
fi

exit 0
